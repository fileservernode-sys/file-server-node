/**
 * Administrative Email Tracking API Routes (/api/v1/admin/emails)
 * Protected by admin authentication and 'emails.read' RBAC permission.
 * Phase 13.3 Architecture
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminEmailService } from '../../services/admin/admin_email_service.js';
import { AdminEmailAnalyticsService } from '../../services/admin/admin_email_analytics_service.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError } from '../../errors/app-error.js';
import {
  EmailMessageStatus,
  EmailSourcePipeline,
  EmailTransport
} from '@prisma/client';

const queryEmailsSchema = z.object({
  status: z.nativeEnum(EmailMessageStatus).optional(),
  sourcePipeline: z.nativeEnum(EmailSourcePipeline).optional(),
  transport: z.nativeEnum(EmailTransport).optional(),
  provider: z.string().trim().max(64).optional(),
  emailType: z.string().trim().max(100).optional(),
  templateId: z.string().trim().max(100).optional(),
  recipientEmail: z.string().trim().max(255).optional(),
  userId: z.string().trim().optional(),
  providerMessageId: z.string().trim().max(255).optional(),
  notificationRecordId: z.string().trim().optional(),
  channelDeliveryRecordId: z.string().trim().optional(),
  requestId: z.string().trim().max(128).optional(),
  correlationId: z.string().trim().max(128).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  sortBy: z.enum([
    'createdAt',
    'queuedAt',
    'sentAt',
    'deliveredAt',
    'failedAt',
    'status',
    'emailType',
    'recipientEmail',
    'provider'
  ]).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

const queryAnalyticsSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

const emailParamsSchema = z.object({
  emailId: z.string().trim().min(1, 'emailId is required')
});

const userEmailsParamsSchema = z.object({
  userId: z.string().trim().min(1, 'userId is required')
});

const userEmailsQuerySchema = queryEmailsSchema.omit({ userId: true });

export async function adminEmailRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/users/:userId/emails
   * Retrieves chronological outbound email history for a specific customer user account.
   */
  app.get(
    '/admin/users/:userId/emails',
    {
      preHandler: [adminAuthenticate, requirePermission('emails.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = userEmailsParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        throw new ValidationError('Valid userId path parameter is required');
      }

      const parsedQuery = userEmailsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError(parsedQuery.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminEmailService.getUserEmailHistory(parsedParams.data.userId, parsedQuery.data);

      return reply.send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/users/:userId/emails
   * Operational alias for customer user outbound email history.
   */
  app.get(
    '/admin/operations/users/:userId/emails',
    {
      preHandler: [adminAuthenticate, requirePermission('emails.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = userEmailsParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        throw new ValidationError('Valid userId path parameter is required');
      }

      const parsedQuery = userEmailsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError(parsedQuery.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminEmailService.getUserEmailHistory(parsedParams.data.userId, parsedQuery.data);

      return reply.send(createSuccessResponse(result));
    }
  );
  /**
   * GET /api/v1/admin/emails/analytics
   * Retrieves aggregated email metrics, status counts, source pipeline distribution,
   * transport distribution, and daily time-series buckets across a bounded date range.
   */
  app.get(
    '/admin/emails/analytics',
    {
      preHandler: [adminAuthenticate, requirePermission('emails.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = queryAnalyticsSchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminEmailAnalyticsService.getDailyAnalytics(parsed.data);

      return reply.send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/emails/retention
   * Retrieves read-only operational telemetry and metrics for the email retention & cleanup worker.
   */
  app.get(
    '/admin/emails/retention',
    {
      preHandler: [adminAuthenticate, requirePermission('emails.read')]
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const { defaultEmailRetentionWorker } = await import('../../services/email_retention_worker.js');
      const metrics = defaultEmailRetentionWorker.getMetrics();

      return reply.send(createSuccessResponse({ retention: metrics }));
    }
  );

  /**
   * GET /api/v1/admin/emails
   * Lists and searches outbound email records with rich administrative filtering and bounded pagination.
   */
  app.get(
    '/admin/emails',
    {
      preHandler: [adminAuthenticate, requirePermission('emails.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = queryEmailsSchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminEmailService.listEmails(parsed.data);

      return reply.send(createSuccessResponse({
        emails: result.items,
        items: result.items,
        pagination: result.pagination
      }));
    }
  );

  /**
   * GET /api/v1/admin/emails/:emailId
   * Retrieves full audit detail for a specific email message including sanitized metadata and attempts.
   */
  app.get(
    '/admin/emails/:emailId',
    {
      preHandler: [adminAuthenticate, requirePermission('emails.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = emailParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        throw new ValidationError('Valid emailId path parameter is required');
      }

      const emailDetail = await AdminEmailService.getEmailById(parsedParams.data.emailId);

      return reply.send(createSuccessResponse({ email: emailDetail }));
    }
  );

  /**
   * GET /api/v1/admin/emails/:emailId/attempts
   * Retrieves delivery attempt logs for a specific email message.
   */
  app.get(
    '/admin/emails/:emailId/attempts',
    {
      preHandler: [adminAuthenticate, requirePermission('emails.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = emailParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        throw new ValidationError('Valid emailId path parameter is required');
      }

      const attempts = await AdminEmailService.getEmailAttempts(parsedParams.data.emailId);

      return reply.send(createSuccessResponse({
        emailId: parsedParams.data.emailId,
        attempts
      }));
    }
  );
}
