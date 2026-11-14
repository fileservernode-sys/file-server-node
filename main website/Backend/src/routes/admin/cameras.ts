/**
 * Administrative Camera Management API Routes (/api/v1/admin/cameras)
 * Phase 20 Batch 20.6.3 — Camera Admin RBAC & Read-Only Administration APIs
 *
 * Protected by admin authentication, granular RBAC permissions:
 * - 'cameras.view'
 * - 'cameras.sessions.view'
 * - 'cameras.audit.view'
 * - 'cameras.usage.view'
 * and adminOperationsRateLimitConfig (120 req/min).
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminCameraService } from './operations/cameras/service.js';
import {
  cameraParamSchema,
  cameraListQuerySchema,
  cameraSessionListQuerySchema,
  cameraAuditListQuerySchema,
  cameraUsageListQuerySchema
} from './operations/cameras/schemas.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError } from '../../errors/app-error.js';
import { adminOperationsRateLimitConfig } from '../../middleware/rate_limit_presets.js';
import { metricsCollector } from '../../observability/metrics.js';

export async function adminCamerasRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/cameras/metrics
   * Summary operational metrics across Camera instances, process-local signaling, and worker health.
   */
  app.get(
    '/admin/cameras/metrics',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('cameras.view')]
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminCameraService.getCameraSummaryMetrics();
      metricsCollector.recordAdminOperation('cameras', 200);
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/cameras
   * Lists Camera instances with status/user/device filtering, search, sorting, and pagination.
   */
  app.get(
    '/admin/cameras',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('cameras.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = cameraListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminCameraService.listCameras(parsed.data);
      metricsCollector.recordAdminOperation('cameras', 200);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/cameras/:cameraId
   * Retrieves operational details, endpoints, subscription, and safe metadata for a specific Camera.
   */
  app.get(
    '/admin/cameras/:cameraId',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('cameras.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = cameraParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid cameraId parameter');
      }

      const { cameraId } = parsedParam.data;
      const camera = await AdminCameraService.getCameraDetail(cameraId);
      metricsCollector.recordAdminOperation('cameras', 200);
      return reply.status(200).send(createSuccessResponse({ camera }));
    }
  );

  /**
   * GET /api/v1/admin/cameras/:cameraId/sessions
   * Lists streaming sessions for a specific Camera with status/viewer filtering and pagination.
   */
  app.get(
    '/admin/cameras/:cameraId/sessions',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('cameras.sessions.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = cameraParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid cameraId parameter');
      }

      const parsedQuery = cameraSessionListQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError(parsedQuery.error.errors[0]?.message || 'Invalid session query parameters');
      }

      const { cameraId } = parsedParam.data;
      const result = await AdminCameraService.listCameraStreamSessions(cameraId, parsedQuery.data);
      metricsCollector.recordAdminOperation('cameras', 200);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/cameras/:cameraId/audit-events
   * Lists CameraAccessAuditEvent records for a specific Camera with sanitized metadata.
   */
  app.get(
    '/admin/cameras/:cameraId/audit-events',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('cameras.audit.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = cameraParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid cameraId parameter');
      }

      const parsedQuery = cameraAuditListQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError(parsedQuery.error.errors[0]?.message || 'Invalid audit query parameters');
      }

      const { cameraId } = parsedParam.data;
      const result = await AdminCameraService.listCameraAuditEvents(cameraId, parsedQuery.data);
      metricsCollector.recordAdminOperation('cameras', 200);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/cameras/:cameraId/usage
   * Retrieves aggregate usage summary and paginated usage records for a specific Camera.
   */
  app.get(
    '/admin/cameras/:cameraId/usage',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('cameras.usage.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = cameraParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid cameraId parameter');
      }

      const parsedQuery = cameraUsageListQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError(parsedQuery.error.errors[0]?.message || 'Invalid usage query parameters');
      }

      const { cameraId } = parsedParam.data;
      const result = await AdminCameraService.getCameraUsage(cameraId, parsedQuery.data);
      metricsCollector.recordAdminOperation('cameras', 200);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
