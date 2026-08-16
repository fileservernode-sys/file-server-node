import { FastifyInstance, FastifyReply } from 'fastify';
import nodemailer from 'nodemailer';
import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
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

      app.log.error(
        {
          dbDiagnostic: {
            category: diagnostic.category,
            prismaCode: diagnostic.code,
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

  /**
  /**
   * GET /api/v1/health/smtp (and alias /api/v1/health/email)
   * Safe Email / SMTP Configuration & Connectivity Diagnostic Probe.
   * Tests Brevo HTTPS REST API (port 443) or SMTP relay without exposing secrets.
   */
  const emailHealthHandler = async (_request: any, reply: FastifyReply) => {
    const brevoApiKey = (process.env.BREVO_API_KEY || config.BREVO_API_KEY || '').trim();
    const host = process.env.SMTP_HOST || config.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || config.SMTP_PORT);
    const user = process.env.SMTP_USERNAME || process.env.SMTP_USER || config.SMTP_USERNAME;
    const pass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || config.SMTP_PASSWORD;

    // 1. Check Brevo HTTPS REST API
    if (brevoApiKey) {
      try {
        const res = await fetch('https://api.brevo.com/v3/account', {
          method: 'GET',
          headers: {
            'api-key': brevoApiKey,
            'accept': 'application/json'
          }
        });

        if (res.ok) {
          const accountData: any = await res.json().catch(() => ({}));
          return reply.status(200).send(
            createSuccessResponse({
              status: 'ok',
              provider: 'brevo_api',
              email: accountData?.email ? '***@' + (accountData.email.split('@')[1] || '***') : 'configured',
              message: 'Brevo Transactional Email API is authenticated and ready to dispatch emails over HTTPS (Port 443).'
            })
          );
        } else {
          const errData: any = await res.json().catch(() => ({}));
          return reply.status(200).send(
            createSuccessResponse({
              status: 'warning',
              provider: 'brevo_api',
              message: `Brevo API authentication error: ${errData?.message || res.statusText}`
            })
          );
        }
      } catch (e: any) {
        return reply.status(200).send(
          createSuccessResponse({
            status: 'warning',
            provider: 'brevo_api',
            message: `Brevo API connection error: ${e?.message || 'Network error'}`
          })
        );
      }
    }

    // 2. Check SMTP Relay
    const isConfigured = Boolean(host && user && pass);

    if (!isConfigured) {
      return reply.status(200).send(
        createSuccessResponse({
          status: 'warning',
          provider: 'smtp_relay',
          message: 'No email service credentials configured. Please set BREVO_API_KEY in Render environment variables.',
          host,
          port,
          hasUsername: Boolean(user),
          hasPassword: Boolean(pass)
        })
      );
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 8000
      });

      await transporter.verify();

      return reply.status(200).send(
        createSuccessResponse({
          status: 'ok',
          provider: 'smtp_relay',
          message: 'SMTP relay is authenticated and ready to dispatch emails.',
          host,
          port
        })
      );
    } catch (err: any) {
      const sanitizedError = (err?.message || 'SMTP verification failed').replace(/:[^\s@/:]+@/g, ':***@');
      app.log.warn({ err: sanitizedError }, 'SMTP probe failed to authenticate or connect');

      return reply.status(200).send(
        createSuccessResponse({
          status: 'warning',
          provider: 'smtp_relay',
          message: `Unable to connect to SMTP server: ${sanitizedError}`,
          host,
          port
        })
      );
    }
  };

  app.get('/health/smtp', emailHealthHandler);
  app.get('/health/email', emailHealthHandler);
}
