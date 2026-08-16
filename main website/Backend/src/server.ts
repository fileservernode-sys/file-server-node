import { buildApp } from './app.js';
import { config } from './config/env.js';
import { disconnectDatabase } from './config/database.js';
import { runStartupMigrations } from './services/db_migrator.js';

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

    app.log.info(`🚀 Control Plane Backend running at ${address}/api/v1`);
    app.log.info(`📊 Health probe available at ${address}/api/v1/health`);

    // Graceful Shutdown Logic
    const shutdown = async (signal: string) => {
      app.log.info(`Received ${signal}. Starting graceful shutdown...`);

      try {
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
