import express from 'express';
import * as authController from '../controllers/authController';
import { rateLimiter, recoveryRateLimiter } from '../middleware/rateLimiter';
import { requireAuth } from '../middleware/auth';
import { profilePhotoUpload } from '../middleware/profilePhotoUpload';

const router = express.Router();

router.post('/register', rateLimiter, authController.register);
router.post('/login', rateLimiter, authController.login);
router.get('/recovery-options', authController.recoveryOptions);
router.post('/forgot-password', recoveryRateLimiter, authController.forgotPassword);
router.post('/reset-password', recoveryRateLimiter, authController.resetPassword);
router.get('/me', requireAuth, authController.getMe);
router.put('/profile', rateLimiter, requireAuth, authController.updateProfile);
router.put('/avatar', requireAuth, rateLimiter, profilePhotoUpload, authController.updateAvatar);
router.delete('/avatar', requireAuth, rateLimiter, authController.removeAvatar);

export default router;
