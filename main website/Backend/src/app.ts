import Fastify, { FastifyInstance } from 'fastify';
import { config } from './config/env.js';
import { registerSecurityPlugins } from './middleware/security.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { createErrorResponse } from './schemas/response.js';
import { apiV1Routes } from './routes/index.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.passwordHash']
    }
  });

  // 1. Security & CORS
  await registerSecurityPlugins(app);

  // 2. Global Error Handler
  app.setErrorHandler(globalErrorHandler);

  // 3. Custom 404 Not Found Handler for Standardized Error Format
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send(createErrorResponse('NOT_FOUND', `Route ${request.method}:${request.url} not found`));
  });

  // 4. API Versioning Router (/api/v1)
  await app.register(apiV1Routes, { prefix: '/api/v1' });

  return app;
}

