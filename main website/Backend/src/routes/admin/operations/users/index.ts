import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../middleware/admin-auth.js';
import { requireOperationPermission } from '../middleware/require_operation_permission.js';
import { assertAdminCanOperateOnResource } from '../middleware/object_authorization.js';
import { createSuccessResponse } from '../../../../schemas/response.js';
import { ValidationError } from '../../../../errors/app-error.js';
import { AdminUserService } from './service.js';
import {
  userListQuerySchema,
  userParamSchema,
  userSuspendSchema,
  userRestoreSchema
} from './schemas.js';

export * from './schemas.js';
export * from './service.js';

export async function adminUserOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/users
   * Lists customer accounts with allowlisted filtering, search, and pagination.
   */
  app.get(
    '/admin/operations/users',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('users.read')]
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
   * GET /api/v1/admin/operations/users/:userId
   * Retrieves operational metadata and resource overview for a specific customer account.
   */
  app.get(
    '/admin/operations/users/:userId',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('users.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = userParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid userId parameter');
      }

      const { userId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'user',
        resourceId: userId,
        operation: 'read',
        context: request.operationContext!
      });

      const user = await AdminUserService.getUserDetail(userId);
      return reply.status(200).send(createSuccessResponse({ user }));
    }
  );

  /**
   * POST /api/v1/admin/operations/users/:userId/suspend
   * Suspends an active customer user account and revokes active sessions.
   */
  app.post(
    '/admin/operations/users/:userId/suspend',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
            return `user_suspend_${adminId}_${forwarded || req.ip || '127.0.0.1'}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('users.suspend')]
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

      await assertAdminCanOperateOnResource({
        resourceType: 'user',
        resourceId: userId,
        operation: 'suspend',
        context: request.operationContext!
      });

      const result = await AdminUserService.suspendUser(
        userId,
        request.operationContext!,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        user: result,
        message: `User '${result.email}' has been suspended successfully`
      }));
    }
  );

  /**
   * POST /api/v1/admin/operations/users/:userId/restore
   * Restores a suspended customer user account back to active status.
   */
  app.post(
    '/admin/operations/users/:userId/restore',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
            return `user_restore_${adminId}_${forwarded || req.ip || '127.0.0.1'}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('users.suspend')]
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

      await assertAdminCanOperateOnResource({
        resourceType: 'user',
        resourceId: userId,
        operation: 'restore',
        context: request.operationContext!
      });

      const result = await AdminUserService.restoreUser(
        userId,
        request.operationContext!,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        user: result,
        message: `User '${result.email}' has been restored successfully`
      }));
    }
  );
}
