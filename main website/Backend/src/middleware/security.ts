import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/env.js';
import { isOriginAllowed } from '../utils/security.js';
import { createErrorResponse } from '../schemas/response.js';

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  // 1. Security Headers (HSTS, Content-Type-Options, Frameguard, etc.)
  await app.register(helmet, {
    contentSecurityPolicy: false, // Managed granularly per route context (e.g. /admin/* has dedicated strict CSP hook)
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    xContentTypeOptions: true,
    hsts: config.NODE_ENV === 'production' ? {
      maxAge: 15552000,
      includeSubDomains: true
    } : false
  });

  // 2. CORS Configuration (Strict Whitelist with Fail-Closed Behavior)
  const allowedOrigins = config.CORS_ORIGIN.split(',').map(origin => origin.trim().toLowerCase());
  const baseDomain = config.REMOTENODE_BASE_DOMAIN.toLowerCase();

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = isOriginAllowed(origin, config.NODE_ENV, allowedOrigins, baseDomain);
      if (allowed) {
        cb(null, true);
      } else {
        // Fail-closed in both development and production for unauthorized external origins
        cb(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Admin-Session-Token', 'x-admin-session-token', 'X-Request-Id', 'x-request-id'],
    exposedHeaders: ['x-admin-session-token', 'content-disposition', 'x-request-id', 'X-Request-Id']
  });

  // 3. Rate Limiting Foundation (Prevents abuse / DOS)
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: (req) => createErrorResponse('TOO_MANY_REQUESTS', 'Rate limit exceeded. Please try again later.', (req as any)?.id)
  });
}

