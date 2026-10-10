import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { authSchema } from '../utils/validators';
import { RESET_TOKEN_PATTERN, resetTokenHash } from '../services/passwordRecovery';
import { recoveryConfiguration, supportEmail } from '../services/recoveryMail';
import { enqueueRecovery, enqueuePasswordChanged } from '../queue/passwordRecoveryQueue';
import logger from '../utils/logger';
import { profilePhoto, PHOTO_FORMAT_ERROR } from '../services/profilePhoto';

const prisma = new PrismaClient();
const publicSelect = { id: true, name: true, email: true, avatarUrl: true, role: true, plan: true, status: true, mfaEnabled: true, lastLogin: true, createdAt: true, updatedAt: true } as const;
const publicUser = (user: any) => Object.fromEntries(Object.keys(publicSelect).map(key => [key, user[key]]));
const signToken = (user: any) => jwt.sign({ userId: user.id, role: user.role, authVersion: user.authVersion || 0 }, process.env.JWT_SECRET as string,
  { expiresIn: (process.env.JWT_EXPIRES_IN || '1d') as any });
const notifyPasswordChanged = (id: string) => enqueuePasswordChanged(id).catch(() => logger.warn('Password change notification could not be queued.'));

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = authSchema.register.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { name, email, password } = value;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await argon2.hash(password);

    // Create user
    const role = 'OWNER';
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role },
      select: { ...publicSelect, authVersion: true }
    });

    // Generate JWT
    const token = signToken(user);
    res.status(201).json({ user: publicUser(user), token });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = authSchema.login.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password } = value;

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Account is suspended' });

    // Verify password
    const isValid = await argon2.verify(user.passwordHash, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    // Generate JWT
    const token = signToken(user);
    res.json({ user: publicUser(user), token });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = authSchema.forgotPassword.validate(req.body);
    if (error) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!recoveryConfiguration()) return res.status(503).json({ error: 'Email recovery is unavailable. Please try again later.' });
    await enqueueRecovery(value.email);
    res.json({ message: 'If an active account uses this email, you will receive a password-reset link shortly.' });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = authSchema.resetPassword.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const invalid = () => res.status(400).json({ error: 'This reset link is invalid or expired. Request a new one.' });
    if (!RESET_TOKEN_PATTERN.test(value.token)) return invalid();
    const hash = resetTokenHash(value.token);
    const user = await prisma.user.findUnique({ where: { resetTokenHash: hash } });
    if (!user || user.status !== 'ACTIVE' || !user.resetExpiresAt || user.resetExpiresAt <= new Date()) return invalid();
    if (await argon2.verify(user.passwordHash, value.password)) return res.status(400).json({ error: 'Choose a password different from your current password.' });
    const passwordHash = await argon2.hash(value.password);
    // The conditional update atomically consumes the link, including concurrent attempts.
    const result = await prisma.user.updateMany({
      where: { id: user.id, status: 'ACTIVE', authVersion: user.authVersion, resetTokenHash: hash, resetExpiresAt: { gt: new Date() } },
      data: { passwordHash, authVersion: { increment: 1 }, resetTokenHash: null, resetExpiresAt: null, resetRequestedAt: null },
    });
    if (!result.count) return invalid();
    void notifyPasswordChanged(user.id);
    res.json({ message: 'Your password was reset. Sign in with your new password.' });
  } catch (error) {
    next(error);
  }
};

export const recoveryOptions = (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ available: Boolean(recoveryConfiguration()), supportEmail: supportEmail() });
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, password, currentPassword, confirmPassword } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 120))
      return res.status(400).json({ error: 'Name must contain 1 to 120 characters' });
    if (password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 256))
      return res.status(400).json({ error: 'Password must contain 12 to 256 characters' });
    const updateData: any = {};
    if (name) updateData.name = name.trim();
    let token: string | undefined;
    if (password !== undefined) {
      if (typeof currentPassword !== 'string' || currentPassword.length > 256 || !currentPassword || confirmPassword !== password)
        return res.status(400).json({ error: 'Enter your current password and matching new passwords.' });
      const account = await prisma.user.findUnique({ where: { id: userId } });
      if (!account || account.authVersion !== (req as any).account.authVersion || !await argon2.verify(account.passwordHash, currentPassword))
        return res.status(400).json({ error: 'Your current password is incorrect. Try again.' });
      if (currentPassword === password) return res.status(400).json({ error: 'Choose a password different from your current password.' });
      const result = await prisma.user.updateMany({ where: { id: userId, status: 'ACTIVE', authVersion: account.authVersion, passwordHash: account.passwordHash },
        data: { ...updateData, passwordHash: await argon2.hash(password), authVersion: { increment: 1 }, resetTokenHash: null, resetExpiresAt: null, resetRequestedAt: null } });
      if (!result.count) return res.status(409).json({ error: 'Your account changed. Sign in again before retrying.' });
      token = signToken({ ...account, authVersion: account.authVersion + 1 });
      void notifyPasswordChanged(userId);
    }

    const updatedUser = password === undefined ? await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: publicSelect
    }) : await prisma.user.findUnique({ where: { id: userId }, select: publicSelect });

    res.json({ user: updatedUser, ...(token ? { token } : {}) });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: publicSelect
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
};

export const updateAvatar = async (req: Request, res: Response, next: NextFunction) => {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ error: 'Choose a photo to upload.' });
  let avatarUrl: string;
  try { avatarUrl = await profilePhoto(file.buffer); }
  catch { return res.status(400).json({ error: PHOTO_FORMAT_ERROR }); }
  try {
    const user = await prisma.user.update({ where: { id: (req as any).account.id }, data: { avatarUrl }, select: publicSelect });
    res.json({ user });
  } catch (error) { next(error); }
};

export const removeAvatar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.update({ where: { id: (req as any).account.id }, data: { avatarUrl: null }, select: publicSelect });
    res.json({ user });
  } catch (error) { next(error); }
};
