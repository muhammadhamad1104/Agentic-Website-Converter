import request from 'supertest';
import express from 'express';
import authRoutes from '../routes/auth';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

process.env.JWT_SECRET = 'test-secret';

process.env.JWT_SECRET = 'test-secret';

jest.mock('@prisma/client', () => {
  const mPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  return { PrismaClient: jest.fn(() => mPrisma) };
});

const mockPrisma = new PrismaClient() as any;

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Auth API', () => {
  let testHash: string;

  beforeAll(async () => {
    testHash = await argon2.hash('password123');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should register a new user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as never);
    mockPrisma.user.create.mockResolvedValue({
      id: 'uuid-1',
      name: 'Test User',
      email: 'test@example.com',
      role: 'OWNER',
      createdAt: new Date(),
    } as never);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      });
    
    expect(res.status).toBe(201);
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user.name).toBe('Test User');
    expect(res.body).toHaveProperty('token');
  });

  it('should login an existing user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uuid-1',
      email: 'test@example.com',
      passwordHash: testHash,
      role: 'OWNER',
    } as never);
    mockPrisma.user.update.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });
    
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('test@example.com');
    expect(res.body).toHaveProperty('token');
  });

  it('should fail login with incorrect password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uuid-1',
      email: 'test@example.com',
      passwordHash: testHash,
      role: 'OWNER',
    } as never);

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'wrongpassword'
      });
    
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});
