import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { PLAN_CATALOG, planFor } from '../services/plans';

const prisma = new PrismaClient();
const stripeClient = () => new Stripe(process.env.STRIPE_SECRET_KEY!);

export const createPaymentIntent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Payments are not configured' });
    const user = (req as any).account;
    if (planFor(user).key !== 'STARTER') return res.status(409).json({ error: 'Your account already has unlimited access' });
    const plan = PLAN_CATALOG.PRO;
    const intent = await stripeClient().paymentIntents.create({
      amount: plan.priceCents, currency: plan.currency, automatic_payment_methods: { enabled: true },
      metadata: { userId: user.id, product: 'converter-pro-lifetime', plan: 'PRO' },
    });
    res.json({ clientSecret: intent.client_secret, amount: plan.priceCents, currency: plan.currency });
  } catch (error) { next(error); }
};

export const handleWebhook = async (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)
    return res.status(503).json({ error: 'Payments are not configured' });
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent((req as any).rawBody || req.body,
      String(req.headers['stripe-signature'] || ''), process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }
  try {
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      if (intent.metadata.product === 'converter-pro-lifetime' && intent.metadata.plan === 'PRO'
        && intent.metadata.userId && intent.amount_received === PLAN_CATALOG.PRO.priceCents
        && intent.currency === PLAN_CATALOG.PRO.currency) {
        await prisma.user.update({ where: { id: intent.metadata.userId }, data: { plan: 'PRO' } });
      }
    }
    res.json({ received: true });
  } catch (error) { next(error); }
};
