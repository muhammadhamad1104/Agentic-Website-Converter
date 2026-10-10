import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { createPaymentIntent, handleWebhook } from '../controllers/payment.controller';
jest.mock('@prisma/client', () => {
  const db = { user: { update: jest.fn() } };
  return { PrismaClient: jest.fn(() => db) };
});
jest.mock('stripe', () => {
  const client = { paymentIntents: { create: jest.fn() }, webhooks: { constructEvent: jest.fn() } };
  return { __esModule: true, default: jest.fn(() => client) };
});
const db = new PrismaClient() as any;
const stripe = new Stripe('test') as any;
let account: any;
const app = express();
app.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);
app.use(express.json());
app.post('/intent', (req, _res, next) => { (req as any).account = account; next(); }, createPaymentIntent);
beforeEach(() => {
  jest.clearAllMocks(); process.env.STRIPE_SECRET_KEY = 'test'; process.env.STRIPE_WEBHOOK_SECRET = 'test';
  account = { id: 'owner-1', role: 'OWNER', plan: 'STARTER' };
  stripe.paymentIntents.create.mockResolvedValue({ client_secret: 'secret' });
});
test('ignores a tampered price and charges the server catalog amount', async () => {
  expect((await request(app).post('/intent').send({ amount: 1, currency: 'eur' })).body.amount).toBe(19900);
  expect(stripe.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 19900, currency: 'usd' }));
});
test('does not sell unlimited access again to admins', async () => {
  account.role = 'ADMIN';
  expect((await request(app).post('/intent').send({})).status).toBe(409);
  expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
});
test.each([1, 19900])('only grants Pro for the exact received amount %i', async amount => {
  stripe.webhooks.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: {
    amount_received: amount, currency: 'usd', metadata: { userId: 'owner-1', product: 'converter-pro-lifetime', plan: 'PRO' },
  } } });
  expect((await request(app).post('/webhook').set('Content-Type', 'application/json').send('{"verified":"event"}')).status).toBe(200);
  expect(Buffer.isBuffer(stripe.webhooks.constructEvent.mock.calls[0][0])).toBe(true);
  expect(db.user.update).toHaveBeenCalledTimes(amount === 19900 ? 1 : 0);
});
test('rejects invalid webhook signatures', async () => {
  stripe.webhooks.constructEvent.mockImplementation(() => { throw new Error('invalid'); });
  expect((await request(app).post('/webhook').set('Content-Type', 'application/json').send('{}')).status).toBe(400);
  expect(db.user.update).not.toHaveBeenCalled();
});
