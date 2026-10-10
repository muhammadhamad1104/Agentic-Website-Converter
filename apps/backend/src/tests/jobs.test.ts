import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import jobs from '../routes/jobs';
import { conversionQueue } from '../queue/jobQueue';
import { summary, adminSummary } from '../controllers/insightController';
import { requireAuth } from '../middleware/auth';
import { deleteSite } from '../controllers/siteController';
import { processingDuration, workerMetrics } from '../services/conversionMetrics';
import { entitlement, planFor, PLAN_CATALOG } from '../services/plans';
import axios from 'axios';

jest.mock('axios');
jest.mock('../queue/jobQueue', () => ({ conversionQueue: { add: jest.fn() } }));
jest.mock('@prisma/client', () => {
  const db: any = {
    user: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    crawl: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), aggregate: jest.fn() },
    site: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), delete: jest.fn() },
    auditLog: { findMany: jest.fn(), create: jest.fn() },
  };
  db.$transaction = (fn: any) => fn(db);
  return { PrismaClient: jest.fn(() => db) };
});
const db = new PrismaClient() as any;
const app = express();
app.use(express.json());
app.use('/jobs', jobs);
app.get('/summary', requireAuth, summary);
app.get('/admin', requireAuth, adminSummary);
app.delete('/sites/:id', requireAuth, deleteSite);
process.env.JWT_SECRET = 'test-only-secret';
const token = jwt.sign({ userId: 'owner-1' }, process.env.JWT_SECRET);
const auth = { Authorization: 'Bearer ' + token };
let account: any;
beforeEach(() => {
  jest.resetAllMocks();
  account = { id: 'owner-1', role: 'OWNER', plan: 'STARTER', status: 'ACTIVE' };
  db.user.findUnique.mockImplementation(async () => account);
  db.auditLog.findMany.mockResolvedValue([]);
  db.crawl.count.mockResolvedValue(0);
  db.crawl.findMany.mockResolvedValue([]);
  db.site.count.mockResolvedValue(0);
  db.site.findUnique.mockResolvedValue({ id: 'site-1', ownerId: 'owner-1' });
  db.crawl.findUnique.mockResolvedValue({ id: 'job-1', siteId: 'site-1', status: 'PENDING', site: { ownerId: 'owner-1' } });
  db.crawl.create.mockResolvedValue({ id: 'job-1', siteId: 'site-1', status: 'PENDING' });
  db.crawl.aggregate.mockResolvedValue({ _avg: { durationMs: null }, _count: { durationMs: 0 } });
});
describe('Plan policy and durable usage', () => {
  test('Starter has five lifetime conversions; paid and admin have no cap', () => {
    expect(PLAN_CATALOG.PRO).toMatchObject({ priceCents: 19900, billing: 'one-time', conversionLimit: null });
    expect(planFor(account).conversionLimit).toBe(5);
    expect(planFor({ role: 'ADMIN', plan: 'STARTER' }).conversionLimit).toBeNull();
    expect(planFor({ role: 'OWNER', plan: 'PRO' }).conversionLimit).toBeNull();
  });
  test('includes deleted-job audit entries and only unrecorded legacy jobs', async () => {
    db.auditLog.findMany.mockResolvedValue([{ targetId: 'deleted-job' }, { targetId: 'existing-job' }]);
    db.crawl.count.mockResolvedValue(3);
    expect(await entitlement(db, account)).toMatchObject({ used: 5, remaining: 0, canConvert: false, canExport: true });
    expect(db.crawl.count).toHaveBeenCalledWith({ where: { site: { ownerId: 'owner-1' }, id: { notIn: ['deleted-job', 'existing-job'] } } });
  });
  test('blocks the sixth Starter job before enqueueing', async () => {
    db.crawl.count.mockResolvedValue(5);
    expect((await request(app).post('/jobs').set(auth).send({ siteId: 'site-1', url: 'https://example.com' })).status).toBe(403);
    expect(conversionQueue.add).not.toHaveBeenCalled();
    expect(db.crawl.create).not.toHaveBeenCalled();
  });
  test.each([{ role: 'OWNER', plan: 'PRO' }, { role: 'ADMIN', plan: 'STARTER' }])('unlimited for %j', async details => {
    Object.assign(account, details);
    db.crawl.count.mockResolvedValue(100000);
    expect((await request(app).post('/jobs').set(auth).send({ siteId: 'site-1', url: 'https://example.com' })).status).toBe(201);
    expect(db.auditLog.create).toHaveBeenCalled();
  });
  test('locks the account before reserving its allowance', async () => {
    expect((await request(app).post('/jobs').set(auth).send({ siteId: 'site-1', url: 'https://example.com' })).status).toBe(201);
    expect(db.user.update.mock.invocationCallOrder[0]).toBeLessThan(db.crawl.count.mock.invocationCallOrder[0]);
    expect(conversionQueue.add).toHaveBeenCalledWith('convert-site', expect.objectContaining({ maxPages: 0, maxAssets: 0, fullSite: true }), { jobId: 'job-1' });
  });
  test('materializes legacy usage before deleting a project', async () => {
    db.crawl.findMany.mockResolvedValue([{ id: 'legacy-job' }]);
    expect((await request(app).delete('/sites/site-1').set(auth)).status).toBe(200);
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetId: 'legacy-job', actorUserId: 'owner-1' }) });
    expect(db.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(db.site.delete.mock.invocationCallOrder[0]);
  });
});
describe('Account and project access', () => {
  test('rejects unauthenticated jobs', async () => expect((await request(app).post('/jobs').send({ url: 'https://example.com' })).status).toBe(401));
  test('rejects missing URLs', async () => expect((await request(app).post('/jobs').set(auth).send({})).status).toBe(400));
  test.each(['get', 'post', 'put', 'delete'])('rejects cross-account %s access', async method => {
    db.crawl.findUnique.mockResolvedValue({ id: 'other', site: { ownerId: 'other-owner' } });
    const path = method === 'get' ? '/jobs/other' : '/jobs/other/preview/11111111-1111-4111-8111-111111111111';
    expect((await (request(app) as any)[method](path).set(auth)).status).toBe(403);
  });
  test('blocks owners from the admin API', async () => expect((await request(app).get('/admin').set(auth)).status).toBe(403));
  test('invalidates suspended accounts even with a valid token', async () => {
    account.status = 'SUSPENDED';
    expect((await request(app).get('/summary').set(auth)).status).toBe(401);
  });
  test('forwards a scoped preview lease using the authenticated account', async () => {
    process.env.PREVIEW_API_SECRET = 'test-preview-secret';
    db.crawl.findUnique.mockResolvedValue({ id: 'job-1', logRef: 'worker-1', site: { ownerId: 'owner-1' } });
    (axios.post as jest.Mock).mockResolvedValue({ data: { status: 'starting' } });
    const lease = '11111111-1111-4111-8111-111111111111';
    const response = await request(app).post('/jobs/job-1/preview/' + lease).set(auth).send({ owner_id: 'spoofed' });
    expect(response.status).toBe(200);
    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/worker-1/preview/start'),
      { owner_id: 'owner-1', lease_id: lease }, expect.objectContaining({ headers: { 'X-Preview-Secret': 'test-preview-secret' } }));
  });
});
describe('Measured metrics', () => {
  test('never estimates duration from creation time', () => {
    expect(processingDuration({ status: 'completed', createdAt: '2020-01-01' })).toBeNull();
    expect(processingDuration({ status: 'running', trace_events: [{ duration_ms: 1200 }] })).toBeNull();
    expect(processingDuration({ status: 'failed', trace_events: [{ duration_ms: 1200 }, { duration_ms: 800 }, { duration_ms: -1 }] })).toBe(2000);
  });
  test('prefers source counts including measured zeros', () => {
    expect(workerMetrics({ generated_artifacts: { source_report: { page_count: 7, asset_count: 0 } } }, { pagesCrawled: 99, assetsDiscovered: 99 }))
      .toMatchObject({ pages: 7, assets: 0, models: 0, durationMs: null });
  });
  test('reports no average when no timed jobs exist', async () => {
    const response = await request(app).get('/summary').set(auth);
    expect(response.body.stats).toMatchObject({ averageDurationMs: null, timedConversions: 0, totalSites: 0 });
  });
});
