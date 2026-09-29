import { buildApp } from './app.js';
import { config } from './config/env.js';
import { validateEnvironment } from './config/env_validator.js';
import { disconnectDatabase } from './config/database.js';
import { runStartupMigrations } from './services/db_migrator.js';
import { defaultGatewayService } from './gateway/gateway_service.js';
import { appLogger } from './observability/logger.js';

async function startServer() {
  try {
    // 0. Perform startup environment & configuration validation
    const envValidation = validateEnvironment();
    if (!envValidation.valid) {
      console.error('Fatal configuration errors detected:', envValidation.errors);
      process.exit(1);
    }

    const app = await buildApp();

    // Execute runtime safe Prisma migrations on startup
    await runStartupMigrations(app.log);

    // Ensure default GatewayNode is registered in MySQL
    try {
      const { prisma } = await import('./config/database.js');
      await prisma.gatewayNode.upsert({
        where: { hostname: config.REMOTENODE_GATEWAY_DOMAIN },
        update: { status: 'ACTIVE', lastHeartbeatAt: new Date() },
        create: {
          hostname: config.REMOTENODE_GATEWAY_DOMAIN,
          region: 'eu-west',
          status: 'ACTIVE',
          lastHeartbeatAt: new Date()
        }
      });
      app.log.info(`🌐 Active gateway node initialized: ${config.REMOTENODE_GATEWAY_DOMAIN}`);
    } catch (err: any) {
      app.log.warn({ err: err?.message }, 'Gateway node startup registration deferred');
    }

    // Initialize/verify authoritative Plan Catalog in MySQL
    try {
      const { PlanService } = await import('./services/billing/plan_service.js');
      await PlanService.seedInitialCatalog(app.log);
    } catch (err: any) {
      app.log.warn({ err: err?.message }, 'Plan catalog startup initialization deferred');
    }

    const address = await app.listen({
      port: config.PORT,
      host: config.HOST
    });

    // Attach Gateway WebSocket Transport Server to main HTTP server
    defaultGatewayService.attachToHttpServer(app.server);

    // Start background notification delivery worker and retention worker
    const { defaultDeliveryWorker, defaultRetentionWorker } = await import('./notifications/index.js');
    if (config.NOTIFICATION_WORKER_ENABLED) {
      defaultDeliveryWorker.start();
      defaultRetentionWorker.start();
      app.log.info(`🔔 Background Notification Delivery Worker (${defaultDeliveryWorker.getWorkerId()}) & Retention Worker initialized.`);
    }

    app.log.info(`🚀 Control Plane Backend & Gateway running at ${address}`);
    app.log.info(`📊 Health probes available at ${address}/health and ${address}/api/v1/health`);

    // Graceful Shutdown Logic
    const shutdown = async (signal: string) => {
      app.log.info(`Received ${signal}. Starting graceful shutdown...`);

      // Bounded shutdown timer: force exit if cleanup exceeds 15 seconds
      const forceExitTimer = setTimeout(() => {
        app.log.error('Graceful shutdown timeout exceeded (15s). Forcing process exit.');
        process.exit(1);
      }, 15000);
      forceExitTimer.unref();

      try {
        if (config.NOTIFICATION_WORKER_ENABLED) {
          await defaultDeliveryWorker.stop();
          defaultRetentionWorker.stop();
          app.log.info('Notification background workers stopped.');
        }

        // 1. Close Gateway WebSocket Relay Server
        await defaultGatewayService.stop();
        app.log.info('Gateway WebSocket relay stopped.');

        // 2. Close HTTP Server
        await app.close();
        app.log.info('HTTP server closed.');

        // 3. Disconnect Database Pool
        await disconnectDatabase();
        app.log.info('Database client disconnected.');

        clearTimeout(forceExitTimer);
        appLogger.info('Graceful shutdown completed successfully', { operation: 'SHUTDOWN', event: signal });
        process.exit(0);
      } catch (err) {
        clearTimeout(forceExitTimer);
        app.log.error({ err }, 'Error during graceful shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('Fatal server startup failure:', err);
    process.exit(1);
  }
}

startServer();
