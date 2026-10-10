import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { adminSummary } from '../controllers/insightController';
import { refreshConversionMetrics } from '../services/conversionMetrics';

jest.mock('@prisma/client', () => {
  const db = {
    user: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    site: { count: jest.fn() }, crawl: { count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
  };
  return { PrismaClient: jest.fn(() => db) };
});
jest.mock('../services/conversionMetrics', () => ({ refreshConversionMetrics: jest.fn() }));
const db = new PrismaClient() as any;
let role: string;
const app = express();
app.get('/summary', (req, _res, next) => { (req as any).account = { id: 'fixture', role }; next(); }, adminSummary);
beforeEach(() => {
  jest.clearAllMocks(); role = 'ADMIN';
  db.user.count.mockResolvedValue(12); db.site.count.mockResolvedValue(23); db.crawl.count.mockResolvedValue(5);
  db.user.findMany.mockResolvedValue([]); db.crawl.findMany.mockResolvedValue([]);
  db.crawl.aggregate.mockResolvedValue({ _avg: { durationMs: 125000 }, _count: { durationMs: 9 } });
  db.user.groupBy.mockResolvedValue([
    { role: 'OWNER', plan: 'STARTER', _count: 7 }, { role: 'COLLABORATOR', plan: 'STARTER', _count: 1 },
    { role: 'OWNER', plan: 'PRO', _count: 2 }, { role: 'ADMIN', plan: 'STARTER', _count: 1 },
    { role: 'ADMIN', plan: 'PRO', _count: 1 },
  ]);
});
test('counts admin membership by actual entitlement rather than the stored billing plan', async () => {
  const response = await request(app).get('/summary');
  expect(response.status).toBe(200);
  expect(response.body.plans).toEqual(expect.arrayContaining([
    { plan: 'STARTER', _count: 8 }, { plan: 'PRO', _count: 2 }, { plan: 'ADMIN', _count: 2 },
  ]));
  expect(response.body.plans).toHaveLength(3);
  expect(db.user.groupBy).toHaveBeenCalledWith({ by: ['role', 'plan'], _count: true });
});
test('preserves actual timing measurements in the administration overview', async () => {
  const response = await request(app).get('/summary');
  expect(response.body.stats.averageDurationMs).toBe(125000);
  expect(response.body.stats.timedConversions).toBe(9);
  expect(refreshConversionMetrics).toHaveBeenCalledWith(db);
});
test('does not permit a Starter or Pro member to fetch administration data', async () => {
  role = 'OWNER'; expect((await request(app).get('/summary')).status).toBe(403);
  expect(db.user.count).not.toHaveBeenCalled(); expect(refreshConversionMetrics).not.toHaveBeenCalled();
});
