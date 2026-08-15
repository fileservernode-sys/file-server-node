import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/env.js';

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  // 1. Security Headers (HSTS, Content-Security-Policy, Frameguard)
  await app.register(helmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'same-site' }
  });

  // 2. CORS Configuration (Configurable via environment, no wildcard * in production)
  const allowedOrigins = config.CORS_ORIGIN.split(',').map(origin => origin.trim());
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. mobile apps, curl) or allowed origins list
      if (!origin || allowedOrigins.includes(origin) || config.NODE_ENV === 'development') {
        cb(null, true);
      } else {
        cb(new Error('CORS policy: Access denied from origin ' + origin), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // 3. Rate Limiting Foundation (Prevents abuse / DOS)
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded. Please try again later.'
      }
    })
  });
}
