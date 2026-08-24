import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { requireAuth } from '../middleware/auth';
import { createPaymentIntent, handleWebhook } from '../controllers/payment.controller';

const router = Router();

router.post('/create-payment-intent', requireAuth, createPaymentIntent);

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req: Request, res: Response, next: NextFunction) => {
    (req as any).rawBody = req.body;
    next();
  },
  handleWebhook
);

export default router;
