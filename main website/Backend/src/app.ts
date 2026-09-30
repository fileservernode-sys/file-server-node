import Fastify, { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config/env.js';
import { registerSecurityPlugins } from './middleware/security.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { createErrorResponse, createSuccessResponse } from './schemas/response.js';
import { apiV1Routes } from './routes/index.js';
import { defaultGatewayService } from './gateway/gateway_service.js';
import { getAdminCspHeader } from './utils/security.js';
import { metricsCollector } from './observability/metrics.js';
import { checkDatabaseReadiness } from './config/database.js';
import { RequestContextStore } from './observability/request_context.js';


const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function getWebDir(): string {
  const candidates = [
    path.resolve(__dirname, 'gateway/web'),
    path.resolve(process.cwd(), 'dist/gateway/web'),
    path.resolve(process.cwd(), 'src/gateway/web'),
    path.resolve(__dirname, '../src/gateway/web')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function getFrontendDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../Frontend'),
    path.resolve(process.cwd(), '../Frontend'),
    path.resolve(process.cwd(), 'Frontend'),
    path.resolve(__dirname, '../../../main website/Frontend')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 104857600, // 100 MB body limit for file uploads
    genReqId: (req) => {
      const headerId = req.headers['x-request-id'];
      if (typeof headerId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(headerId)) {
        return headerId;
      }
      return crypto.randomUUID();
    },
    requestIdHeader: 'x-request-id',
    logger: {
      level: config.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-razorpay-signature"]',
        'body.password',
        'body.passwordHash',
        'body.keySecret',
        'body.webhookSecret'
      ]
    }
  });

  // Attach Content-Type parser that preserves exact raw payload Buffer on request.rawBody
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const json = body.length === 0 ? {} : JSON.parse(body.toString('utf8'));
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Metrics and Request Correlation Hooks
  app.addHook('onRequest', (request, _reply, done) => {
    (request.raw as any).__startTime = Date.now();
    RequestContextStore.run({ requestId: request.id }, () => {
      done();
    });
  });


  app.addHook('onResponse', async (request, reply) => {
    const start = (request.raw as any).__startTime || Date.now();
    const duration = Date.now() - start;
    metricsCollector.recordHttpRequest(request.method, reply.statusCode, duration);
  });

  // 1. Security & CORS
  await registerSecurityPlugins(app);

  // 2. Attach Content-Security-Policy, Frame Protection, and Request-ID Hook
  app.addHook('onSend', async (request, reply) => {
    if (request.id) {
      reply.header('x-request-id', request.id);
    }

    const rawUrl = request.raw.url || request.url || '';
    const urlPath = rawUrl.split('?')[0];

    if (urlPath === '/admin' || urlPath.startsWith('/admin/') || urlPath.startsWith('/api/v1/admin/')) {
      reply.header('Content-Security-Policy', getAdminCspHeader());
      reply.header('X-Frame-Options', 'DENY');
    }
  });

  // 3. Global Error Handler
  app.setErrorHandler(globalErrorHandler);

  // 4. Root Health & Readiness Probes (For Cloud LB & Kubernetes)
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }));

  app.get('/health/live', async () => ({
    status: 'live',
    timestamp: new Date().toISOString()
  }));

  app.get('/health/ready', async (_req, reply) => {
    const isReady = await checkDatabaseReadiness();
    if (isReady) {
      return reply.status(200).send({
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    }
    return reply.status(503).send({
      status: 'unavailable',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  });

  // 5. API Versioning Router (/api/v1)
  await app.register(apiV1Routes, { prefix: '/api/v1' });

  // 5. Subdomain File Manager & Frontend Static File Serving Router
  app.setNotFoundHandler(async (request, reply) => {
    const rawUrl = request.raw.url || request.url || '';
    const urlPath = rawUrl.split('?')[0];

    // If it's a non-existent /api/ route, return standard 404 JSON
    if (urlPath.startsWith('/api/')) {
      return reply.status(404).send(createErrorResponse('NOT_FOUND', `Route ${request.method}:${request.url} not found`, request.id));
    }


    // Storage proxy API routes for phone file server
    if (
      urlPath.startsWith('/api/files') ||
      urlPath.startsWith('/api/storage') ||
      urlPath.startsWith('/api/folders') ||
      urlPath.startsWith('/api/rename') ||
      urlPath.startsWith('/api/upload') ||
      urlPath.startsWith('/api/download')
    ) {
      return defaultGatewayService.handleFastifyStorageRequest(request, reply);
    }

    const hostHeader = (request.headers.host || '').split(':')[0].toLowerCase();
    const query = request.query as Record<string, any> | undefined;

    // Exact hostnames that serve the main marketing landing website & dashboard
    const mainWebsiteHosts = new Set([
      'zdexcloud.com',
      'www.zdexcloud.com',
      'app.zdexcloud.com',
      'viewduration.com',
      'www.viewduration.com',
      'remotenode.net',
      'www.remotenode.net',
      'localhost',
      '127.0.0.1'
    ]);

    // Detect if this request is targeting a Personal File Manager subdomain or endpoint
    const isSubdomain =
      urlPath.startsWith('/file-manager') ||
      !!query?.['endpoint'] ||
      !!query?.['deviceId'] ||
      hostHeader.startsWith('srv-') ||
      hostHeader.startsWith('node-') ||
      (!mainWebsiteHosts.has(hostHeader) && hostHeader.includes('.'));

    const baseDir = isSubdomain ? getWebDir() : getFrontendDir();
    let relativePath = urlPath === '/' ? '/index.html' : urlPath;
    if (relativePath.startsWith('/file-manager')) {
      relativePath = relativePath.replace(/^\/file-manager/, '') || '/index.html';
    }

    let filePath = path.normalize(path.join(baseDir, relativePath));
    const isAdminRoute = urlPath === '/admin' || urlPath.startsWith('/admin/');

    const applyCacheHeaders = (isHtml: boolean, isAsset: boolean) => {
      if (isHtml) {
        if (isAdminRoute || filePath.includes(`${path.sep}admin`)) {
          reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
          reply.header('Pragma', 'no-cache');
          reply.header('Expires', '0');
        } else {
          reply.header('Cache-Control', 'no-cache, must-revalidate');
        }
      } else if (isAsset) {
        if (isAdminRoute || filePath.includes(`${path.sep}admin`)) {
          reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
        } else {
          reply.header('Cache-Control', 'public, max-age=86400');
        }
      }
    };

    // 1. Direct file match
    if (filePath.startsWith(baseDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isHtml = ext === '.html';
      const isAsset = ext === '.css' || ext === '.js' || ext === '.svg' || ext === '.png' || ext === '.jpg' || ext === '.woff' || ext === '.woff2' || ext === '.ico';
      applyCacheHeaders(isHtml, isAsset);
      reply.type(contentType);
      return reply.send(fs.createReadStream(filePath));
    }

    // 2. Clean SEO slug match (e.g. /product -> /product.html or /pages/product.html or /admin/login -> /admin/login.html)
    if (!path.extname(relativePath)) {
      const candidates = [
        path.normalize(path.join(baseDir, `${relativePath}.html`)),
        path.normalize(path.join(baseDir, relativePath, 'index.html')),
        path.normalize(path.join(baseDir, 'pages', `${relativePath}.html`)),
        path.normalize(path.join(baseDir, 'pages', relativePath))
      ];

      for (const candidate of candidates) {
        if (candidate.startsWith(baseDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          applyCacheHeaders(true, false);
          reply.type('text/html; charset=utf-8');
          return reply.send(fs.createReadStream(candidate));
        }
      }
    }

    // 3. Direct /pages/ route match with .html fallback
    if (relativePath.startsWith('/pages/')) {
      const pageFile = path.normalize(path.join(baseDir, relativePath));
      if (pageFile.startsWith(baseDir) && fs.existsSync(pageFile) && fs.statSync(pageFile).isFile()) {
        applyCacheHeaders(true, false);
        reply.type('text/html; charset=utf-8');
        return reply.send(fs.createReadStream(pageFile));
      }
    }

    // 4. Fallback to index.html for SPA routes (non-admin root)
    if (!isAdminRoute) {
      const indexPath = path.join(baseDir, 'index.html');
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        applyCacheHeaders(true, false);
        reply.type('text/html; charset=utf-8');
        return reply.send(fs.createReadStream(indexPath));
      }
    }

    // Fallback 404
    const acceptsHtml = String(request.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      reply.type('text/html; charset=utf-8');
      return reply.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 Not Found - ZdexCloud</title><style>body{font-family:sans-serif;background:#0B0F19;color:#F9FAFB;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style></head><body><div style="text-align:center;"><h1>404</h1><p>Resource not found</p><a href="/" style="color:#3B82F6;">Return Home</a></div></body></html>');
    }

    return reply.status(404).send(createErrorResponse('NOT_FOUND', `Resource not found`, request.id));
  });


  return app;
}
