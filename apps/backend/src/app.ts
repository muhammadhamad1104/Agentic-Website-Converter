import { Request, Response, NextFunction } from 'express';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
// Auto-catch async errors (native in Express 5)
import authRoutes from './routes/auth';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { checkDatabaseConnection } from './config/database';
import { checkRedisConnection } from './config/redis';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl) or any localhost/dev origin
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Logging
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy (for accurate IP addresses behind reverse proxy)
app.set('trust proxy', 1);

// Routes
app.use('/api/auth', authRoutes);
import jobsRoutes from './routes/jobs';
app.use('/api/jobs', jobsRoutes);
import paymentRoutes from './routes/payment.route';
app.use('/api/payments', paymentRoutes);
import sitesRoutes from './routes/sites';
app.use('/api/sites', sitesRoutes);

// Health check endpoint (includes database and redis status)
app.get('/api/health', async (req: Request, res: Response) => {
  const dbHealth = await checkDatabaseConnection();
  const redisHealth = await checkRedisConnection();
  
  const isHealthy = dbHealth.status === 'healthy' && redisHealth.status === 'healthy';
  const statusCode = isHealthy ? 200 : 503;
  
  res.status(statusCode).json({
    status: isHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbHealth,
      cache: redisHealth,
    },
    environment: process.env.NODE_ENV || 'development',
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    timestamp: new Date().toISOString(),
  });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
