import express from 'express';
import * as authController from '../controllers/authController';
import { rateLimiter } from '../middleware/rateLimiter';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

router.post('/register', rateLimiter, authController.register);
router.post('/login', rateLimiter, authController.login);
router.post('/forgot-password', rateLimiter, authController.forgotPassword);
router.post('/reset-password', rateLimiter, authController.resetPassword);
router.get('/me', requireAuth, authController.getMe);
router.put('/profile', rateLimiter, requireAuth, authController.updateProfile);

export default router;
