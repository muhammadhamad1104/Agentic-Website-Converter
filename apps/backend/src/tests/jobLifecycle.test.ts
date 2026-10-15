import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { conversionQueue } from '../queue/jobQueue';
import { getJobStatus, inferSchema, runJob, submitSchemaDecision } from '../controllers/jobController';

jest.mock('axios');
jest.mock('../queue/jobQueue', () => ({ conversionQueue: { add: jest.fn(), getJob: jest.fn() } }));
jest.mock('@prisma/client', () => {
  const db = { crawl: { findUnique: jest.fn(), update: jest.fn() }, site: { findUnique: jest.fn(), update: jest.fn() } };
  return { PrismaClient: jest.fn(() => db) };
});

const db = new PrismaClient() as any;
let crawl: any;
let sequence = 0;
beforeEach(() => {
  jest.resetAllMocks();
  crawl = { id: 'crawl-1', siteId: 'site-1', logRef: `worker-${++sequence}`, status: 'CRAWLED',
    pagesCrawled: 0, assetsDiscovered: 0, site: { id: 'site-1' } };
  db.crawl.findUnique.mockImplementation(async () => ({ ...crawl }));
  db.crawl.update.mockImplementation(async ({ data }: any) => ({ ...crawl, ...data }));
  db.site.update.mockResolvedValue({});
});
afterEach(() => jest.restoreAllMocks());

async function call(controller: any, body = {}) {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await controller({ params: { id: crawl.id }, body }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res;
}

test.each([
  ['extracted', 'CRAWLED'], ['inferring_schema', 'INFERRING_SCHEMA'], ['schema_proposed', 'AWAITING_APPROVAL'],
  ['approved', 'GENERATING'], ['generating', 'GENERATING'], ['generated', 'GENERATING'],
  ['validated', 'COMPLETED'], ['cancelled', 'FAILED'], ['error', 'FAILED'],
])('poll maps worker %s to truthful %s', async (status, expected) => {
  (axios.get as jest.Mock).mockResolvedValue({ data: { job: { status } } });
  const res = await call(getJobStatus);
  expect(res.json.mock.calls[0][0].job.status).toBe(expected);
});

test('idempotent inference response does not regress a completed schema', async () => {
  (axios.post as jest.Mock).mockResolvedValue({ data: { job: { status: 'awaiting_approval' } } });
  await call(inferSchema);
  expect(db.crawl.update).toHaveBeenCalledWith({ where: { id: crawl.id }, data: { status: 'AWAITING_APPROVAL' } });
});

test('pending review stays awaiting approval', async () => {
  (axios.post as jest.Mock).mockResolvedValue({ data: { job: { status: 'awaiting_approval' } } });
  await call(submitSchemaDecision, { decision: 'pending' });
  expect(db.crawl.update).toHaveBeenCalledWith({ where: { id: crawl.id }, data: { status: 'AWAITING_APPROVAL' } });
  expect(db.site.update).toHaveBeenCalledWith({ where: { id: 'site-1' }, data: { status: 'ANALYZING' } });
});

test('invalid decisions are rejected before contacting worker', async () => {
  const res = await call(submitSchemaDecision, { decision: 'invalid' });
  expect(res.status).toHaveBeenCalledWith(400);
  expect(axios.post).not.toHaveBeenCalled();
});

test('worker conflicts are preserved without advancing state', async () => {
  (axios.post as jest.Mock).mockRejectedValue({ response: { status: 409, data: { detail: 'Crawl must complete' } } });
  const res = await call(inferSchema);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(db.crawl.update).not.toHaveBeenCalled();
});

test('lost launch response is retryable and does not invent a running state', async () => {
  (axios.post as jest.Mock).mockRejectedValue({ code: 'ECONNABORTED' });
  const res = await call(submitSchemaDecision, { decision: 'approved' });
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
  expect(db.crawl.update).not.toHaveBeenCalled();
});

test('retry resumes saved worker job without queueing a fresh conversion', async () => {
  (axios.post as jest.Mock).mockResolvedValue({ data: { job: { status: 'generating' } } });
  await call(runJob);
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining(`/api/jobs/${crawl.logRef}/run`), {}, { timeout: 5000 });
  expect(conversionQueue.add).not.toHaveBeenCalled();
});

test('duplicate retry before handoff reuses active queue entry', async () => {
  crawl.logRef = null;
  const queued = { getState: jest.fn().mockResolvedValue('active') };
  (conversionQueue.getJob as jest.Mock).mockResolvedValue(queued);
  await call(runJob);
  expect(conversionQueue.add).not.toHaveBeenCalled();
});

test('failed queue entry is retried with the same identity', async () => {
  crawl.logRef = null;
  const queued = { getState: jest.fn().mockResolvedValue('failed'), retry: jest.fn() };
  (conversionQueue.getJob as jest.Mock).mockResolvedValue(queued);
  await call(runJob);
  expect(queued.retry).toHaveBeenCalledTimes(1);
  expect(conversionQueue.add).not.toHaveBeenCalled();
});

test('poll outage is bounded without overwriting an active conversion and recovers', async () => {
  crawl.status = 'GENERATING';
  const now = jest.spyOn(Date, 'now').mockReturnValue(100000);
  (axios.get as jest.Mock).mockRejectedValue({ code: 'ECONNREFUSED' });
  let res = await call(getJobStatus);
  expect(res.json.mock.calls[0][0].job).toMatchObject({ status: 'GENERATING', workerConnection: { retryable: true } });
  now.mockReturnValue(160001);
  res = await call(getJobStatus);
  expect(res.json.mock.calls[0][0].job.status).toBe('FAILED');
  expect(db.crawl.update).not.toHaveBeenCalled();
  (axios.get as jest.Mock).mockResolvedValue({ data: { job: { status: 'generating' } } });
  res = await call(getJobStatus);
  expect(res.json.mock.calls[0][0].job.status).toBe('GENERATING');
  expect(res.json.mock.calls[0][0].job.workerConnection).toBeUndefined();
});

test('missing worker job stops polling immediately', async () => {
  (axios.get as jest.Mock).mockRejectedValue({ response: { status: 404 } });
  const res = await call(getJobStatus);
  expect(res.json.mock.calls[0][0].job).toMatchObject({ status: 'FAILED', workerConnection: { status: 'missing' } });
});
