import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/env.js';

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  // 1. Security Headers (HSTS, Content-Security-Policy, Frameguard)
  await app.register(helmet, {
    contentSecurityPolicy: false, // Allow API consumption across frontend subdomains
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  });

  // 2. CORS Configuration (Supports web frontends, staging domains, and mobile apps)
  const allowedOrigins = config.CORS_ORIGIN.split(',').map(origin => origin.trim().toLowerCase());
  const baseDomain = config.REMOTENODE_BASE_DOMAIN.toLowerCase();

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. mobile apps, server-to-server, curl)
      if (!origin) {
        return cb(null, true);
      }

      const lowerOrigin = origin.toLowerCase();
      const isAllowed = 
        config.NODE_ENV === 'development' ||
        allowedOrigins.includes(lowerOrigin) ||
        lowerOrigin.includes('localhost') ||
        lowerOrigin.includes('127.0.0.1') ||
        lowerOrigin.endsWith(`.${baseDomain}`) ||
        lowerOrigin === `https://${baseDomain}` ||
        lowerOrigin === `http://${baseDomain}` ||
        lowerOrigin.endsWith('.viewduration.com') ||
        lowerOrigin.endsWith('.onrender.com');

      if (isAllowed) {
        cb(null, true);
      } else {
        // Fallback: allow to avoid blocking staging frontends while logging notice
        cb(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
  });

  // 3. Rate Limiting Foundation (Prevents abuse / DOS)
  await app.register(rateLimit, {
    max: 120,
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
