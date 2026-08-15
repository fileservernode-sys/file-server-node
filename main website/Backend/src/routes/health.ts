import { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';

/**
 * Categorizes database errors safely for server-side diagnostic logging.
 * Never exposes passwords, user tokens, or raw connection strings.
 */
function classifyDatabaseError(err: unknown): { category: string; code: string; sanitizedSummary: string } {
  const errorObj = err as Record<string, any> | null;
  const rawMessage = (errorObj?.message || String(err) || '').toString();
  const prismaCode = (errorObj?.code || '').toString();

  // Sanitize any credentials or URLs that might appear in raw messages
  const sanitizedSummary = rawMessage
    .replace(/mysql:\/\/[^@\s]+@[^\s/]+/gi, 'mysql://***:***@***')
    .replace(/password=[^\s&]+/gi, 'password=***')
    .replace(/:[^\s@/:]+@/g, ':***@')
    .substring(0, 300);

  let category = 'UNKNOWN_DATABASE_ERROR';

  if (prismaCode === 'P1000' || /access denied|authentication failed|1045/i.test(rawMessage)) {
    category = 'AUTHENTICATION_FAILED';
  } else if (prismaCode === 'P1001' || /econnrefused|can't reach database server|connection refused/i.test(rawMessage)) {
    category = 'CANNOT_REACH_DATABASE_OR_CONNECTION_REFUSED';
  } else if (prismaCode === 'P1002' || prismaCode === 'P1008' || /etimedout|timed out|timeout/i.test(rawMessage)) {
    category = 'CONNECTION_TIMEOUT';
  } else if (prismaCode === 'P1003' || /database .* does not exist|unknown database|1049/i.test(rawMessage)) {
    category = 'DATABASE_NOT_FOUND';
  } else if (prismaCode === 'P1011' || /tls|ssl|handshake/i.test(rawMessage)) {
    category = 'TLS_SSL_ERROR';
  } else if (/enotfound|eai_again|dns/i.test(rawMessage)) {
    category = 'DNS_RESOLUTION_FAILURE';
  } else if (prismaCode === 'P1013' || /the url must start with/i.test(rawMessage)) {
    category = 'INVALID_CONNECTION_STRING_FORMAT';
  }

  return {
    category,
    code: prismaCode || (errorObj?.name ?? 'UNKNOWN'),
    sanitizedSummary
  };
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/health
   * Process Liveness Probe: Differentiates process liveness from database readiness.
   * Does NOT expose secrets, credentials, or system paths.
   */
  app.get('/health', async () => {
    return createSuccessResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  /**
   * GET /api/v1/health/db
   * Database Connectivity Verification & Diagnostic Probe.
   * Executes a minimal SELECT 1 query via the Prisma singleton.
   * Logs structured redacted diagnostic telemetry server-side while keeping the public response sanitized.
   */
  app.get('/health/db', async (_request, reply: FastifyReply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.status(200).send(
        createSuccessResponse({
          status: 'ok',
          database: 'connected'
        })
      );
    } catch (err) {
      const diagnostic = classifyDatabaseError(err);

      // Server-side structured diagnostic log (redacted: no username, password, or connection string)
      app.log.error(
        {
          dbDiagnostic: {
            category: diagnostic.category,
            prismaCode: diagnostic.code,
            host: 'mysql.gb.stackcp.com',
            port: 45878,
            summary: diagnostic.sanitizedSummary
          }
        },
        'Database connectivity check failed during /api/v1/health/db probe'
      );

      return reply.status(503).send(
        createErrorResponse(
          'DATABASE_UNAVAILABLE',
          'Database connectivity check failed'
        )
      );
    }
  });
}
