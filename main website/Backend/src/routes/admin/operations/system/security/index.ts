/**
 * Fastify Operations Routes for Admin System Security Controls
 * Phase 17 Batch 17.8 — System Security Controls
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../../middleware/admin-auth.js';
import { requireOperationPermission, resolveOperationContext } from '../../middleware/require_operation_permission.js';
import { createSuccessResponse } from '../../../../../schemas/response.js';
import { ValidationError } from '../../../../../errors/app-error.js';
import { adminOperationsRateLimitConfig, highCapacityHealthRateLimitConfig } from '../../../../../middleware/rate_limit_presets.js';
import { AdminSystemSecurityService, SecurityOperationContext } from './service.js';
import {
  adminSessionQuerySchema,
  revokeSessionParamSchema,
  revokeSessionBodySchema,
  revokeAllAdminSessionsParamSchema,
  revokeAllAdminSessionsBodySchema,
  unlockLockoutBodySchema,
  securityEventQuerySchema,
  securityEventParamSchema
} from './schemas.js';

export * from './types.js';
export * from './schemas.js';
export * from './service.js';

export async function adminSystemSecurityOperationsRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/admin/operations/system/security
   * Overall Security Controls Posture & Metrics Overview
   */
  app.get(
    '/admin/operations/system/security',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const overview = await AdminSystemSecurityService.getSecurityOverview();
      return reply.status(200).send(createSuccessResponse(overview));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/security/sessions
   * Paginated list of administrative sessions with bounded filtering
   */
  app.get(
    '/admin/operations/system/security/sessions',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = adminSessionQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid session query parameters');
      }

      const result = await AdminSystemSecurityService.listAdminSessions(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/operations/system/security/sessions/:sessionId/revoke
   * Revokes a single administrative session
   */
  app.post(
    '/admin/operations/system/security/sessions/:sessionId/revoke',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = revokeSessionParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid session ID parameter');
      }

      const body = revokeSessionBodySchema.safeParse(request.body || {});
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid revocation payload');
      }

      const opContext = await resolveOperationContext(request);
      const secContext: SecurityOperationContext = {
        adminId: opContext.adminId,
        adminEmail: opContext.adminEmail,
        ipAddress: opContext.clientIp,
        userAgent: opContext.userAgent,
        currentSessionId: request.adminSession?.id
      };

      const result = await AdminSystemSecurityService.revokeSession(
        params.data.sessionId,
        body.data.reason,
        secContext
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/operations/system/security/sessions/admins/:adminId/revoke-all
   * Revokes all active sessions for a target administrator
   */
  app.post(
    '/admin/operations/system/security/sessions/admins/:adminId/revoke-all',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = revokeAllAdminSessionsParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid admin ID parameter');
      }

      const body = revokeAllAdminSessionsBodySchema.safeParse(request.body || {});
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid revocation payload');
      }

      const opContext = await resolveOperationContext(request);
      const secContext: SecurityOperationContext = {
        adminId: opContext.adminId,
        adminEmail: opContext.adminEmail,
        ipAddress: opContext.clientIp,
        userAgent: opContext.userAgent,
        currentSessionId: request.adminSession?.id
      };

      const result = await AdminSystemSecurityService.revokeAllAdminSessions(
        params.data.adminId,
        body.data.reason,
        secContext
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/security/lockouts
   * Lists active and recent brute-force lockout records
   */
  app.get(
    '/admin/operations/system/security/lockouts',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const lockouts = await AdminSystemSecurityService.listLockouts();
      return reply.status(200).send(createSuccessResponse({ items: lockouts, total: lockouts.length }));
    }
  );

  /**
   * POST /api/v1/admin/operations/system/security/lockouts/unlock
   * Releases/clears a brute-force lockout record
   */
  app.post(
    '/admin/operations/system/security/lockouts/unlock',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = unlockLockoutBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid unlock payload');
      }

      const opContext = await resolveOperationContext(request);
      const secContext: SecurityOperationContext = {
        adminId: opContext.adminId,
        adminEmail: opContext.adminEmail,
        ipAddress: opContext.clientIp,
        userAgent: opContext.userAgent
      };

      const result = await AdminSystemSecurityService.unlockLockout(body.data, secContext);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/security/events
   * Paginated security audit events
   */
  app.get(
    '/admin/operations/system/security/events',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = securityEventQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid security event query parameters');
      }

      const result = await AdminSystemSecurityService.listSecurityEvents(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/security/events/:eventId
   * Detailed inspection of a specific security audit event
   */
  app.get(
    '/admin/operations/system/security/events/:eventId',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = securityEventParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid event ID parameter');
      }

      const event = await AdminSystemSecurityService.getSecurityEventDetail(params.data.eventId);
      return reply.status(200).send(createSuccessResponse({ event }));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/security/rbac
   * RBAC inventory, permissions matrix, and role hierarchy
   */
  app.get(
    '/admin/operations/system/security/rbac',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const inventory = await AdminSystemSecurityService.getRbacInventory();
      return reply.status(200).send(createSuccessResponse(inventory));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/security/credentials
   * Admin credential & 2FA configuration posture
   */
  app.get(
    '/admin/operations/system/security/credentials',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const posture = await AdminSystemSecurityService.getCredentialPosture();
      return reply.status(200).send(createSuccessResponse({ items: posture, total: posture.length }));
    }
  );
}
