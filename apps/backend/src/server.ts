import 'dotenv/config';
import app from './app';
import { logger } from './utils/logger';
import { prisma, closeDatabase } from './config/database';
import { closeRedis } from './config/redis';
import { createPreviewGateway } from './services/previewGateway';
import { startPasswordRecoveryWorker, closePasswordRecoveryQueue } from './queue/passwordRecoveryQueue';

const PORT = process.env.PORT || 5000;

// Test database connection before starting
async function startServer() {
  try {
    // Test database connection
    await prisma.$connect();
    startPasswordRecoveryWorker();
    logger.info('✅ Database connected successfully');
    
    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 API URL: http://localhost:${PORT}/api`);
      logger.info(`💚 Health check: http://localhost:${PORT}/api/health`);
    });
    const previewServer = createPreviewGateway().listen(Number(process.env.PREVIEW_PORT || 5001));
    previewServer.on('error', error => logger.error('Preview gateway failed to start:', error));

    // Graceful shutdown handler
    const gracefulShutdown = async (signal) => {
      logger.info(`\n🛑 ${signal} received. Starting graceful shutdown...`);
      
      // Stop accepting new connections
      previewServer.close();
      server.close(async () => {
        logger.info('✅ HTTP server closed');
        
        try {
          // Close database connections
          await closePasswordRecoveryQueue();
          await closeDatabase();
          logger.info('✅ Database connections closed');
          
          // Close Redis connections
          await closeRedis();
          logger.info('✅ Redis connections closed');
          
          logger.info('✨ Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          logger.error('❌ Error during shutdown:', error);
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('❌ Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('UNHANDLED_REJECTION');
    });

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

