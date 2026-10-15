import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { processConversionJob } from '../queue/jobQueue';

jest.mock('axios');
jest.mock('bullmq', () => ({ Queue: jest.fn(), Worker: jest.fn(() => ({ on: jest.fn() })) }));
jest.mock('../config/redis', () => ({ bullmqConnection: {} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@prisma/client', () => {
  const db = { crawl: { findUnique: jest.fn(), update: jest.fn() }, site: { update: jest.fn() },
    entityDefinition: { create: jest.fn(), findFirst: jest.fn() }, fieldDefinition: { create: jest.fn() },
    conversionPlan: { create: jest.fn(), findFirst: jest.fn() } };
  return { PrismaClient: jest.fn(() => db) };
});
const db = new PrismaClient() as any;
const job: any = { id: 'queue-1', data: { jobId: 'crawl-1', siteId: 'site-1', url: 'https://example.invalid' } };

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  db.crawl.findUnique.mockResolvedValue({ id: 'crawl-1', logRef: 'saved-worker' });
  db.crawl.update.mockResolvedValue({});
  db.site.update.mockResolvedValue({});
});
afterEach(() => jest.useRealTimers());

async function processJob() {
  const result = processConversionJob(job);
  // Attach a rejection handler before driving timers.
  const settled = result.then(value => ({ value }), error => ({ error }));
  await jest.runAllTimersAsync();
  return settled;
}

test.each([['extracted', 'CRAWLED'], ['schema_proposed', 'AWAITING_APPROVAL'],
  ['inferring_schema', 'INFERRING_SCHEMA'], ['generating', 'GENERATING'], ['ready', 'COMPLETED']])(
  'existing job at %s is recovered as %s without a second creation', async (status, expected) => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { job: { status } } });
    const result = await processJob();
    expect(result).toMatchObject({ value: { success: true, workerJobId: 'saved-worker' } });
    expect(axios.post).not.toHaveBeenCalled();
    expect(db.crawl.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: expected }) }));
    expect(db.conversionPlan.create).not.toHaveBeenCalled();
  });

test('creation sends a stable idempotency key and saves the worker identity', async () => {
  db.crawl.findUnique.mockResolvedValue({ id: 'crawl-1', logRef: null });
  (axios.post as jest.Mock).mockResolvedValue({ data: { job_id: 'new-worker' } });
  (axios.get as jest.Mock).mockResolvedValue({ data: { job: { status: 'crawled' } } });
  await processJob();
  expect(axios.post).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.objectContaining({
    headers: { 'X-Conversion-Id': 'crawl-1' }, timeout: 15000,
  }));
  expect(db.crawl.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ logRef: 'new-worker' }) }));
});

test('transient poll errors recover without losing worker identity', async () => {
  (axios.get as jest.Mock).mockRejectedValueOnce(new Error('temporarily offline'))
    .mockResolvedValue({ data: { job: { status: 'crawled' } } });
  expect(await processJob()).toHaveProperty('value');
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.post).not.toHaveBeenCalled();
});

test('persistent transport errors fail in bounded polls and retain saved identity', async () => {
  (axios.get as jest.Mock).mockRejectedValue(new Error('offline'));
  const result = await processJob();
  expect(result).toHaveProperty('error');
  expect(axios.get).toHaveBeenCalledTimes(15);
  expect(db.crawl.update).toHaveBeenLastCalledWith({ where: { id: 'crawl-1' },
    data: { status: 'FAILED', errors: ['Worker unavailable while polling conversion'] } });
});

test('malformed successful poll responses cannot keep UI running forever', async () => {
  (axios.get as jest.Mock).mockResolvedValue({ data: {} });
  expect(await processJob()).toHaveProperty('error');
  expect(axios.get).toHaveBeenCalledTimes(15);
});

test('missing worker fails immediately and never creates a replacement', async () => {
  (axios.get as jest.Mock).mockRejectedValue({ response: { status: 404 }, message: 'missing' });
  expect(await processJob()).toHaveProperty('error');
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.post).not.toHaveBeenCalled();
});

test('worker failure is returned as failure and does not persist a fake conversion plan', async () => {
  (axios.get as jest.Mock).mockResolvedValue({ data: { job: { status: 'failed', errors: ['validation blocked'] } } });
  expect(await processJob()).toMatchObject({ value: { success: false } });
  expect(db.conversionPlan.create).not.toHaveBeenCalled();
  expect(db.crawl.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ errors: ['validation blocked'] }) }));
});
