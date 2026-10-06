/**
 * Administrative Notification & Communication Management API Routes (/api/v1/admin/notifications)
 * Phase 17 Batch 17.4 — Notifications & Communication Management
 *
 * Protected by admin authentication, RBAC permissions ('notifications.read', 'notifications.write'),
 * rate limiting, and tamper-evident SHA-256 audit logging.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminNotificationService } from './operations/notifications/service.js';
import {
  notificationListQuerySchema,
  failedDeliveriesQuerySchema,
  pushTokensQuerySchema,
  notificationParamSchema,
  deliveryRetryParamSchema,
  deliveryRetryBodySchema,
  tokenRevokeParamSchema,
  tokenRevokeBodySchema
} from './operations/notifications/schemas.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError } from '../../errors/app-error.js';
import { adminOperationsRateLimitConfig } from '../../middleware/rate_limit_presets.js';
import { resolveClientIp } from '../../utils/ip.js';
import { resolveOperationContext } from './operations/middleware/require_operation_permission.js';

export async function adminNotificationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/notifications/metrics
   * Summary count metrics across notifications, channel deliveries, and push tokens.
   */
  app.get(
    '/admin/notifications/metrics',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('notifications.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminNotificationService.getNotificationSummaryMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/notifications
   * Lists notifications with multi-column filtering, customer search, and pagination.
   */
  app.get(
    '/admin/notifications',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('notifications.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = notificationListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminNotificationService.listNotifications(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/notifications/deliveries/failures
   * Lists failed or retrying channel deliveries for diagnostics.
   */
  app.get(
    '/admin/notifications/deliveries/failures',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('notifications.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = failedDeliveriesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminNotificationService.listFailedDeliveries(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/notifications/tokens
   * Lists device push tokens with masked fingerprints (never raw tokens) and device health.
   */
  app.get(
    '/admin/notifications/tokens',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('notifications.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = pushTokensQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminNotificationService.listPushTokens(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/notifications/:notificationId
   * Retrieves full notification detail with sanitized bodies and channel delivery logs.
   */
  app.get(
    '/admin/notifications/:notificationId',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('notifications.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = notificationParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid notificationId parameter');
      }

      const { notificationId } = parsedParam.data;
      const notification = await AdminNotificationService.getNotificationDetail(notificationId);
      return reply.status(200).send(createSuccessResponse({ notification }));
    }
  );

  /**
   * POST /api/v1/admin/notifications/deliveries/:deliveryId/retry
   * Schedules an administrative retry for a failed channel delivery record.
   */
  app.post(
    '/admin/notifications/deliveries/:deliveryId/retry',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `notif_retry_canonical_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('notifications.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = deliveryRetryParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid deliveryId parameter');
      }

      const parsedBody = deliveryRetryBodySchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid request body');
      }

      const { deliveryId } = parsedParam.data;
      const context = await resolveOperationContext(request);
      const result = await AdminNotificationService.retryDelivery(
        deliveryId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(
        createSuccessResponse({
          message: 'Notification delivery retry successfully scheduled',
          delivery: result
        })
      );
    }
  );

  /**
   * POST /api/v1/admin/notifications/tokens/:tokenId/revoke
   * Administratively revokes/invalidates a device push token.
   */
  app.post(
    '/admin/notifications/tokens/:tokenId/revoke',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `push_token_revoke_canonical_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('notifications.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = tokenRevokeParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid tokenId parameter');
      }

      const parsedBody = tokenRevokeBodySchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid request body');
      }

      const { tokenId } = parsedParam.data;
      const context = await resolveOperationContext(request);
      const result = await AdminNotificationService.revokePushToken(
        tokenId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(
        createSuccessResponse({
          message: 'Push token successfully revoked',
          token: result
        })
      );
    }
  );
}
