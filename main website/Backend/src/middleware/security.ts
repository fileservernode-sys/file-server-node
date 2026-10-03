import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { config } from '../config/env.js';
import { isOriginAllowed } from '../utils/security.js';
import { createErrorResponse } from '../schemas/response.js';

import { buildRateLimitErrorResponse } from './rate_limit_presets.js';

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  // 0. Cookie Parser Foundation (HttpOnly Browser Sessions)
  await app.register(cookie);

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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Admin-Session-Token', 'x-admin-session-token', 'X-Request-Id', 'x-request-id', 'x-zdex-csrf-token', 'X-Zdex-Csrf-Token', 'x-admin-csrf-token', 'X-Admin-Csrf-Token', 'x-zdex-admin-csrf-token', 'X-Zdex-Admin-Csrf-Token', 'Range', 'range'],
    exposedHeaders: ['x-admin-session-token', 'content-disposition', 'x-request-id', 'X-Request-Id', 'x-zdex-csrf-token', 'x-admin-csrf-token', 'x-zdex-admin-csrf-token', 'Content-Range', 'Accept-Ranges', 'Content-Length']
  });

  // 3. Rate Limiting Foundation (Prevents abuse / DOS)
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: buildRateLimitErrorResponse
  });
}

