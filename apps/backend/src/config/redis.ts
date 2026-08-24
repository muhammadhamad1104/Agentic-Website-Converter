import Redis from 'ioredis';

/**
 * Redis Client Configuration
 * Used for caching, sessions, and job queues (BullMQ)
 */

// Parse Redis URL
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis Client Options
const redisOptions = {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 10000,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      // Only reconnect when the error contains "READONLY"
      return true;
    }
    return false;
  },
};

// Main Redis client for general operations
export const redis = new Redis(redisUrl, redisOptions);

// Separate client for BullMQ (required by BullMQ design)
export const bullmqConnection = new Redis(redisUrl, {
  ...redisOptions,
  maxRetriesPerRequest: null, // BullMQ requirement
});

// Redis event handlers
redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

redis.on('ready', () => {
  console.log('✅ Redis ready for operations');
});

redis.on('close', () => {
  console.warn('⚠️ Redis connection closed');
});

/**
 * Health check for Redis
 */
export const checkRedisConnection = async () => {
  try {
    await redis.ping();
    return { status: 'healthy', cache: 'redis' };
  } catch (error) {
    console.error('Redis health check failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
};

/**
 * Graceful shutdown
 */
export const closeRedis = async () => {
  await redis.quit();
  await bullmqConnection.quit();
  console.log('Redis connections closed');
};

// Handle process termination
process.on('SIGINT', async () => {
  await closeRedis();
});

process.on('SIGTERM', async () => {
  await closeRedis();
});

export default { redis, bullmqConnection, checkRedisConnection, closeRedis };
