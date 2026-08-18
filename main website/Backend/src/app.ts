import Fastify, { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config/env.js';
import { registerSecurityPlugins } from './middleware/security.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { createErrorResponse } from './schemas/response.js';
import { apiV1Routes } from './routes/index.js';
import { defaultGatewayService } from './gateway/gateway_service.js';

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
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.passwordHash']
    }
  });

  // 1. Security & CORS
  await registerSecurityPlugins(app);

  // 2. Global Error Handler
  app.setErrorHandler(globalErrorHandler);

  // 3. API Versioning Router (/api/v1)
  await app.register(apiV1Routes, { prefix: '/api/v1' });

  // 4. Subdomain File Manager & Frontend Static File Serving Router
  app.setNotFoundHandler(async (request, reply) => {
    const rawUrl = request.raw.url || request.url || '';
    const urlPath = rawUrl.split('?')[0];

    // If it's a non-existent /api/v1/ route, return standard 404 JSON
    if (urlPath.startsWith('/api/v1/')) {
      return reply.status(404).send(createErrorResponse('NOT_FOUND', `Route ${request.method}:${request.url} not found`));
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

    // 1. Direct file match
    if (filePath.startsWith(baseDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      reply.type(contentType);
      return reply.send(fs.createReadStream(filePath));
    }

    // 2. Clean SEO slug match (e.g. /product -> /product.html or /pages/product.html)
    if (!path.extname(relativePath)) {
      const candidates = [
        path.normalize(path.join(baseDir, `${relativePath}.html`)),
        path.normalize(path.join(baseDir, 'pages', `${relativePath}.html`)),
        path.normalize(path.join(baseDir, 'pages', relativePath))
      ];

      for (const candidate of candidates) {
        if (candidate.startsWith(baseDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          reply.type('text/html; charset=utf-8');
          return reply.send(fs.createReadStream(candidate));
        }
      }
    }

    // 3. Direct /pages/ route match with .html fallback
    if (relativePath.startsWith('/pages/')) {
      const pageFile = path.normalize(path.join(baseDir, relativePath));
      if (pageFile.startsWith(baseDir) && fs.existsSync(pageFile) && fs.statSync(pageFile).isFile()) {
        reply.type('text/html; charset=utf-8');
        return reply.send(fs.createReadStream(pageFile));
      }
    }

    // 4. Fallback to index.html for SPA routes
    const indexPath = path.join(baseDir, 'index.html');
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      reply.type('text/html; charset=utf-8');
      return reply.send(fs.createReadStream(indexPath));
    }

    return reply.status(404).send(createErrorResponse('NOT_FOUND', `Resource not found`));
  });

  return app;
}


