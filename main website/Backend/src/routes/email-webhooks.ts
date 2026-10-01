/**
 * Provider Email Webhook Routes (/api/v1/webhooks/email)
 * Phase 13.9 Architecture
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EmailWebhookService } from '../services/email_webhook_service.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { config } from '../config/env.js';
import { RequestContextStore } from '../observability/request_context.js';

import { sanitizeFailureReason } from '../utils/email_sanitizer.js';

export async function emailWebhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/webhooks/email/brevo
   * Unauthenticated provider callback endpoint for Brevo transactional delivery events.
   * Authentication is enforced via configurable shared secret check.
   */
  app.post(
    '/webhooks/email/brevo',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // 1. Check if Brevo Webhook Ingestion is enabled
      if (!config.BREVO_WEBHOOK_ENABLED) {
        return reply.status(503).send(createErrorResponse('SERVICE_UNAVAILABLE', 'Brevo webhook ingestion is currently disabled'));
      }

      // 2. Extract shared secret from standard headers or query parameter
      const secretHeader = (
        request.headers['x-brevo-webhook-secret'] ||
        request.headers['x-webhook-secret'] ||
        request.headers['x-secret-token']
      ) as string | undefined;

      const authHeader = request.headers.authorization;
      const bearerSecret = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : undefined;

      const query = request.query as Record<string, any> | undefined;
      const querySecret = query?.token || query?.secret;

      const candidateSecret = secretHeader || bearerSecret || querySecret;

      // 3. Timing-safe verification of webhook shared secret
      const isAuthorized = EmailWebhookService.verifyWebhookSecret(candidateSecret);
      if (!isAuthorized) {
        return reply.status(401).send(createErrorResponse('UNAUTHORIZED', 'Invalid or missing webhook authentication secret'));
      }

      // 4. Ingest and synchronize delivery events
      const requestId = RequestContextStore.get()?.requestId;
      try {
        const results = await EmailWebhookService.processWebhookPayload(request.body, requestId);
        return reply.status(200).send(createSuccessResponse({
          processedCount: results.length,
          results
        }));
      } catch (err: any) {
        const safeErrMsg = sanitizeFailureReason(err.message || 'Malformed webhook payload');
        return reply.status(400).send(createErrorResponse('BAD_REQUEST', safeErrMsg));
      }
    }
  );
}
