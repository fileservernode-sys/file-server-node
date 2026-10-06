/**
 * Administrative User & Account Management API Routes (/api/v1/admin/users)
 * Phase 17 Batch 17.2 — User & Account Administration
 *
 * Protected by admin authentication, RBAC permissions ('users.read', 'users.suspend', 'users.write'),
 * rate limiting, and tamper-evident audit logging.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminUserService } from './operations/users/service.js';
import {
  userListQuerySchema,
  userParamSchema,
  userSuspendSchema,
  userRestoreSchema,
  userRevokeSessionsSchema
} from './operations/users/schemas.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError, UnauthorizedError } from '../../errors/app-error.js';
import { adminOperationsRateLimitConfig } from '../../middleware/rate_limit_presets.js';
import { resolveClientIp } from '../../utils/ip.js';
import { resolveOperationContext } from './operations/middleware/require_operation_permission.js';

export async function adminUsersRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/users/metrics
   * Summary count metrics across all customer accounts.
   */
  app.get(
    '/admin/users/metrics',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('users.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminUserService.getUserSummaryMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/users
   * Lists customer user accounts with search, filter, and pagination.
   */
  app.get(
    '/admin/users',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('users.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = userListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminUserService.listUsers(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/users/:userId
   * Retrieves operational metadata and deep device/server relationships for a specific user.
   */
  app.get(
    '/admin/users/:userId',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('users.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = userParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid userId parameter');
      }

      const { userId } = parsedParam.data;
      const user = await AdminUserService.getUserDetail(userId);
      return reply.status(200).send(createSuccessResponse({ user }));
    }
  );

  /**
   * POST /api/v1/admin/users/:userId/suspend
   * Suspends a customer user account and invalidates active login sessions.
   */
  app.post(
    '/admin/users/:userId/suspend',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `users_suspend_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('users.suspend')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = userParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid userId parameter');
      }

      const parsedBody = userSuspendSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { userId } = parsedParam.data;
      const context = await resolveOperationContext(request, 'user_suspend', 'user', userId);

      const result = await AdminUserService.suspendUser(
        userId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        user: result,
        message: `User '${result.email}' has been suspended successfully`
      }));
    }
  );

  /**
   * POST /api/v1/admin/users/:userId/restore
   * Restores a suspended customer user account back to ACTIVE status.
   */
  app.post(
    '/admin/users/:userId/restore',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `users_restore_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('users.suspend')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = userParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid userId parameter');
      }

      const parsedBody = userRestoreSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { userId } = parsedParam.data;
      const context = await resolveOperationContext(request, 'user_restore', 'user', userId);

      const result = await AdminUserService.restoreUser(
        userId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        user: result,
        message: `User '${result.email}' has been restored successfully`
      }));
    }
  );

  /**
   * POST /api/v1/admin/users/:userId/revoke-sessions
   * Forcefully invalidates all active sessions for a customer user account.
   */
  app.post(
    '/admin/users/:userId/revoke-sessions',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `users_revoke_sessions_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('users.suspend')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = userParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid userId parameter');
      }

      const parsedBody = userRevokeSessionsSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { userId } = parsedParam.data;
      const context = await resolveOperationContext(request, 'user_revoke_sessions', 'user', userId);

      const result = await AdminUserService.revokeUserSessions(
        userId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        user: result,
        message: `All active sessions (${result.revokedSessionsCount}) for '${result.email}' have been revoked successfully`
      }));
    }
  );
}
