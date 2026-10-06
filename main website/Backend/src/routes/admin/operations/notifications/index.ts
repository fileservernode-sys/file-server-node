import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../middleware/admin-auth.js';
import { requireOperationPermission } from '../middleware/require_operation_permission.js';
import { createSuccessResponse } from '../../../../schemas/response.js';
import { ValidationError } from '../../../../errors/app-error.js';
import { resolveClientIp } from '../../../../utils/ip.js';
import { AdminNotificationService } from './service.js';
import {
  notificationListQuerySchema,
  failedDeliveriesQuerySchema,
  pushTokensQuerySchema,
  notificationParamSchema,
  deliveryRetryParamSchema,
  deliveryRetryBodySchema,
  tokenRevokeParamSchema,
  tokenRevokeBodySchema
} from './schemas.js';

export * from './types.js';
export * from './schemas.js';
export * from './service.js';

export async function adminNotificationOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/notifications/metrics
   * Retrieves summary count metrics across notifications, channel deliveries, and push tokens.
   */
  app.get(
    '/admin/operations/notifications/metrics',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('notifications.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminNotificationService.getNotificationSummaryMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/operations/notifications
   * Lists notifications with multi-column filtering, customer search, and pagination.
   */
  app.get(
    '/admin/operations/notifications',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('notifications.read')]
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
   * GET /api/v1/admin/operations/notifications/deliveries/failures
   * Lists failed or retrying channel deliveries for diagnostics.
   */
  app.get(
    '/admin/operations/notifications/deliveries/failures',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('notifications.read')]
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
   * GET /api/v1/admin/operations/notifications/tokens
   * Lists device push tokens with masked fingerprints (never raw tokens) and device health.
   */
  app.get(
    '/admin/operations/notifications/tokens',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('notifications.read')]
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
   * GET /api/v1/admin/operations/notifications/:notificationId
   * Retrieves full notification detail with sanitized bodies and channel delivery logs.
   */
  app.get(
    '/admin/operations/notifications/:notificationId',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('notifications.read')]
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
   * POST /api/v1/admin/operations/notifications/deliveries/:deliveryId/retry
   * Schedules an administrative retry for a failed channel delivery record.
   */
  app.post(
    '/admin/operations/notifications/deliveries/:deliveryId/retry',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `notif_retry_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('notifications.write')]
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
      const result = await AdminNotificationService.retryDelivery(
        deliveryId,
        request.operationContext!,
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
   * POST /api/v1/admin/operations/notifications/tokens/:tokenId/revoke
   * Administratively revokes/invalidates a device push token.
   */
  app.post(
    '/admin/operations/notifications/tokens/:tokenId/revoke',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `push_token_revoke_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('notifications.write')]
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
      const result = await AdminNotificationService.revokePushToken(
        tokenId,
        request.operationContext!,
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
