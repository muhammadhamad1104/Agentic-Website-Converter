import request from 'supertest';
import app from '../app';
import { PrismaClient } from '@prisma/client';
import { conversionQueue } from '../queue/jobQueue';

// Mock BullMQ queue
jest.mock('../queue/jobQueue', () => ({
  conversionQueue: {
    add: jest.fn(),
  },
}));

// Mock Prisma
jest.mock('@prisma/client', () => {
  const mPrisma = {
    crawl: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  return { PrismaClient: jest.fn(() => mPrisma) };
});

const mockPrisma = new PrismaClient() as any;

describe('Jobs API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/jobs', () => {
    it('should create a new job and add to queue', async () => {
      mockPrisma.crawl.create.mockResolvedValue({
        id: 'job-123',
        siteId: 'site-456',
        startUrl: 'https://example.com',
        status: 'PENDING',
      } as never);

      const res = await request(app)
        .post('/api/jobs')
        .send({
          siteId: 'site-456',
          url: 'https://example.com',
        });

      expect(res.status).toBe(201);
      expect(res.body.job.id).toBe('job-123');
      expect(conversionQueue.add).toHaveBeenCalledWith(
        'convert-site',
        expect.objectContaining({ jobId: 'job-123', url: 'https://example.com' }),
        expect.objectContaining({ jobId: 'job-123' })
      );
    });

    it('should return 400 if url is missing', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({
          siteId: 'site-456',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('URL is required');
    });
  });

  describe('GET /api/jobs/:id', () => {
    it('should return job status if job exists', async () => {
      mockPrisma.crawl.findUnique.mockResolvedValue({
        id: 'job-123',
        siteId: 'site-456',
        startUrl: 'https://example.com',
        status: 'ANALYZING',
      } as never);

      const res = await request(app).get('/api/jobs/job-123');

      expect(res.status).toBe(200);
      expect(res.body.job.status).toBe('ANALYZING');
    });

    it('should return 404 if job does not exist', async () => {
      mockPrisma.crawl.findUnique.mockResolvedValue(null as never);

      const res = await request(app).get('/api/jobs/non-existent-job');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Job not found');
    });
  });
});
