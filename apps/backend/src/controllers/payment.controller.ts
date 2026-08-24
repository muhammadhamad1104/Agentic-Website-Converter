import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
  apiVersion: '2023-10-16' as any,
});

const prisma = new PrismaClient();

export const createPaymentIntent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount } = req.body;
    
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Optional: We can automatically upgrade user after the intent succeeds if we hook it up via Webhook.
    // For now, returning the intent client secret to the frontend.
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount), // must be an integer in cents
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        userId: userId
      }
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Stripe Payment Intent Error:', error);
    next(error);
  }
};

export const handleWebhook = async (req: Request, res: Response, next: NextFunction) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      (req as any).rawBody,
      sig as string,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as any;
    const userId = paymentIntent.metadata?.userId;
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { plan: 'PRO' }
      });
      console.log(`[Webhook] User ${userId} upgraded to PRO via Stripe PaymentIntent`);
    }
  }

  res.json({ received: true });
};
