import { buildApp } from './app.js';
import { config } from './config/env.js';
import { disconnectDatabase } from './config/database.js';
import { runStartupMigrations } from './services/db_migrator.js';
import { defaultGatewayService } from './gateway/gateway_service.js';

async function startServer() {
  try {
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
    app.log.info(`📊 Health probe available at ${address}/api/v1/health`);

    // Graceful Shutdown Logic
    const shutdown = async (signal: string) => {
      app.log.info(`Received ${signal}. Starting graceful shutdown...`);

      try {
        if (config.NOTIFICATION_WORKER_ENABLED) {
          await defaultDeliveryWorker.stop();
          defaultRetentionWorker.stop();
          app.log.info('Notification background workers stopped.');
        }

        await app.close();
        app.log.info('HTTP server closed.');

        await disconnectDatabase();
        app.log.info('Database client disconnected.');

        process.exit(0);
      } catch (err) {
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
