import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const { Pool } = pg;

/**
 * Prisma Client Configuration
 * Handles connection pooling automatically with optimized settings
 */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  errorFormat: 'pretty',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

/**
 * Direct PostgreSQL Connection Pool (for raw queries when needed)
 * Use this for advanced operations not supported by Prisma
 */
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection pool configuration
  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : 20, // Maximum connections
  min: process.env.DB_POOL_MIN ? parseInt(process.env.DB_POOL_MIN) : 5,  // Minimum connections
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Fail after 10s if no connection available
  maxUses: 7500, // Close connection after 7500 uses (prevents memory leaks)
  
  // SSL Configuration (for production)
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false, // Set to true in production with proper certs
  } : false,
});

/**
 * Health check for database connection
 */
export const checkDatabaseConnection = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const poolClient = await pgPool.connect();
    poolClient.release();
    return { status: 'healthy', database: 'postgresql' };
  } catch (error) {
    console.error('Database connection failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
};

/**
 * Graceful shutdown
 */
export const closeDatabase = async () => {
  await prisma.$disconnect();
  await pgPool.end();
  console.log('Database connections closed');
};

// Handle process termination
process.on('SIGINT', async () => {
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabase();
  process.exit(0);
});

export default { prisma, pgPool, checkDatabaseConnection, closeDatabase };
