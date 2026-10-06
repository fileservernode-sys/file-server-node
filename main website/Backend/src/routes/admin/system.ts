/**
 * Administrative System Management API Routes (/api/v1/admin/system)
 * Phase 17 Batch 17.1 — System Overview
 * Phase 17 Batch 17.5 — System Logs & Diagnostics
 *
 * Protected by admin authentication and 'system.read' RBAC permission.
 * Exposes authoritative, read-only operational health telemetry,
 * subsystem diagnostic signals, application errors, gateway diagnostics, and safe log exports.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { SystemOverviewService } from '../../services/admin/system_overview_service.js';
import { AdminSystemLogsService } from './operations/system/logs/service.js';
import { AdminBackgroundJobsService } from './operations/system/jobs/service.js';
import { AdminSystemConfigService } from './operations/system/config/service.js';
import { AdminSystemSecurityService, SecurityOperationContext } from './operations/system/security/service.js';
import {
  systemErrorQuerySchema,
  systemErrorParamSchema,
  systemEventQuerySchema,
  gatewayDiagnosticsQuerySchema,
  systemIncidentQuerySchema,
  systemLogsExportQuerySchema
} from './operations/system/logs/schemas.js';
import {
  backgroundJobQuerySchema,
  failedJobQuerySchema,
  backgroundJobParamSchema,
  backgroundJobsExportQuerySchema
} from './operations/system/jobs/schemas.js';
import {
  systemConfigQuerySchema,
  systemSettingParamSchema,
  updateSystemSettingSchema,
  featureFlagParamSchema,
  updateFeatureFlagSchema
} from './operations/system/config/schemas.js';
import {
  adminSessionQuerySchema,
  revokeSessionParamSchema,
  revokeSessionBodySchema,
  revokeAllAdminSessionsParamSchema,
  revokeAllAdminSessionsBodySchema,
  unlockLockoutBodySchema,
  securityEventQuerySchema,
  securityEventParamSchema
} from './operations/system/security/schemas.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { UnauthorizedError, ValidationError } from '../../errors/app-error.js';
import { highCapacityHealthRateLimitConfig, adminOperationsRateLimitConfig } from '../../middleware/rate_limit_presets.js';
import { resolveOperationContext } from './operations/middleware/require_operation_permission.js';

export async function adminSystemRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/admin/system/overview
   * Returns comprehensive operational health status, subsystem diagnostics,
   * gateway metrics, Android edge topology counters, and safe environment metadata.
   */
  app.get(
    '/admin/system/overview',
    {
      config: {
        rateLimit: highCapacityHealthRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const overview = await SystemOverviewService.getSystemOverview();

      return reply.status(200).send(createSuccessResponse(overview));
    }
  );

  /**
   * GET /api/v1/admin/system/logs/metrics
   * Summary counts and operational health aggregates.
   */
  app.get(
    '/admin/system/logs/metrics',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminSystemLogsService.getLogsMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/system/logs/errors
   * Paginated error occurrences with multi-attribute filtering and bounded search.
   */
  app.get(
    '/admin/system/logs/errors',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemErrorQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid error query parameters');
      }

      const result = await AdminSystemLogsService.listErrors(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/system/logs/errors/:id
   * Detailed occurrence telemetry with sanitized stack traces.
   */
  app.get(
    '/admin/system/logs/errors/:id',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = systemErrorParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid error occurrence ID');
      }

      const detail = await AdminSystemLogsService.getErrorDetail(params.data.id);
      return reply.status(200).send(createSuccessResponse({ error: detail }));
    }
  );

  /**
   * GET /api/v1/admin/system/logs/events
   * Paginated operational and audit event stream.
   */
  app.get(
    '/admin/system/logs/events',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemEventQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid event query parameters');
      }

      const result = await AdminSystemLogsService.listEvents(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/system/logs/gateway
   * Paginated gateway diagnostics and device connection sessions.
   */
  app.get(
    '/admin/system/logs/gateway',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = gatewayDiagnosticsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid gateway diagnostic query parameters');
      }

      const result = await AdminSystemLogsService.getGatewayDiagnostics(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/system/logs/incidents
   * Paginated error incidents with linked fingerprint aggregates.
   */
  app.get(
    '/admin/system/logs/incidents',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemIncidentQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid incident query parameters');
      }

      const result = await AdminSystemLogsService.listIncidents(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/system/logs/export
   * Generates a controlled, bounded, sanitized export (CSV or JSON).
   */
  app.get(
    '/admin/system/logs/export',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemLogsExportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid export query parameters');
      }

      const context = await resolveOperationContext(request);
      const result = await AdminSystemLogsService.exportLogs(parsed.data as any, context);

      reply.header('Content-Type', result.mimeType);
      reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
      return reply.status(200).send(result.data);
    }
  );

  /**
   * Phase 17 Batch 17.6 Canonical Routes — Background Jobs & Operations
   */

  // GET /api/v1/admin/system/jobs/metrics
  app.get(
    '/admin/system/jobs/metrics',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminBackgroundJobsService.getJobsMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  // GET /api/v1/admin/system/jobs/queues
  app.get(
    '/admin/system/jobs/queues',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queues = await AdminBackgroundJobsService.listQueues();
      return reply.status(200).send(createSuccessResponse({ queues }));
    }
  );

  // GET /api/v1/admin/system/jobs/workers
  app.get(
    '/admin/system/jobs/workers',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workers = AdminBackgroundJobsService.listWorkers();
      return reply.status(200).send(createSuccessResponse({ workers }));
    }
  );

  // GET /api/v1/admin/system/jobs
  app.get(
    '/admin/system/jobs',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = backgroundJobQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid job query parameters');
      }
      const result = await AdminBackgroundJobsService.listJobs(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  // GET /api/v1/admin/system/jobs/failed
  app.get(
    '/admin/system/jobs/failed',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = failedJobQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid failed job query parameters');
      }
      const result = await AdminBackgroundJobsService.listFailedJobs(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  // GET /api/v1/admin/system/jobs/:jobId
  app.get(
    '/admin/system/jobs/:jobId',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = backgroundJobParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid job ID parameter');
      }
      const job = await AdminBackgroundJobsService.getJobDetail(params.data.jobId);
      return reply.status(200).send(createSuccessResponse({ job }));
    }
  );

  // POST /api/v1/admin/system/jobs/:jobId/retry
  app.post(
    '/admin/system/jobs/:jobId/retry',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = backgroundJobParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid job ID parameter');
      }
      const context = await resolveOperationContext(request);
      const result = await AdminBackgroundJobsService.retryJob(params.data.jobId, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );


  // POST /api/v1/admin/system/jobs/export
  app.post(
    '/admin/system/jobs/export',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = backgroundJobsExportQuerySchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid export parameters');
      }
      const context = await resolveOperationContext(request);
      const result = await AdminBackgroundJobsService.exportJobs(parsed.data as any, context);

      reply.header('Content-Type', result.mimeType);
      reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
      return reply.status(200).send(result.data);
    }
  );

  /**
   * Phase 17 Batch 17.7 Canonical Routes — System Configuration & Feature Flags
   */

  // GET /api/v1/admin/system/config
  app.get(
    '/admin/system/config',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const overview = await AdminSystemConfigService.getConfigOverview();
      return reply.status(200).send(createSuccessResponse(overview));
    }
  );

  // GET /api/v1/admin/system/config/settings
  app.get(
    '/admin/system/config/settings',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemConfigQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid config query parameters');
      }
      const result = await AdminSystemConfigService.listSettings(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  // GET /api/v1/admin/system/config/settings/:key
  app.get(
    '/admin/system/config/settings/:key',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = systemSettingParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid setting key parameter');
      }
      const setting = await AdminSystemConfigService.getSetting(params.data.key);
      return reply.status(200).send(createSuccessResponse({ setting }));
    }
  );

  // PUT /api/v1/admin/system/config/settings/:key
  app.put(
    '/admin/system/config/settings/:key',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = systemSettingParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid setting key parameter');
      }
      const body = updateSystemSettingSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid setting update payload');
      }
      const context = await resolveOperationContext(request);
      const result = await AdminSystemConfigService.updateSetting(params.data.key, body.data, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  // GET /api/v1/admin/system/config/flags
  app.get(
    '/admin/system/config/flags',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await AdminSystemConfigService.listFeatureFlags();
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  // PUT /api/v1/admin/system/config/flags/:key
  app.put(
    '/admin/system/config/flags/:key',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = featureFlagParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid feature flag key parameter');
      }
      const body = updateFeatureFlagSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid feature flag update payload');
      }
      const context = await resolveOperationContext(request);
      const result = await AdminSystemConfigService.updateFeatureFlag(params.data.key, body.data, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  // GET /api/v1/admin/system/config/environment
  app.get(
    '/admin/system/config/environment',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const environment = AdminSystemConfigService.getEnvironmentInventory();
      return reply.status(200).send(createSuccessResponse({ environment }));
    }
  );

  /**
   * Phase 17 Batch 17.8 — System Security Controls Canonical Aliases
   */

  // GET /api/v1/admin/system/security/overview
  app.get(
    '/admin/system/security/overview',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const overview = await AdminSystemSecurityService.getSecurityOverview();
      return reply.status(200).send(createSuccessResponse(overview));
    }
  );

  // GET /api/v1/admin/system/security/sessions
  app.get(
    '/admin/system/security/sessions',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
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

  // POST /api/v1/admin/system/security/sessions/:sessionId/revoke
  app.post(
    '/admin/system/security/sessions/:sessionId/revoke',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.write')]
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

  // POST /api/v1/admin/system/security/sessions/admins/:adminId/revoke-all
  app.post(
    '/admin/system/security/sessions/admins/:adminId/revoke-all',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.write')]
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

  // GET /api/v1/admin/system/security/lockouts
  app.get(
    '/admin/system/security/lockouts',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const lockouts = await AdminSystemSecurityService.listLockouts();
      return reply.status(200).send(createSuccessResponse({ items: lockouts, total: lockouts.length }));
    }
  );

  // POST /api/v1/admin/system/security/lockouts/unlock
  app.post(
    '/admin/system/security/lockouts/unlock',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.write')]
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

  // GET /api/v1/admin/system/security/events
  app.get(
    '/admin/system/security/events',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
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

  // GET /api/v1/admin/system/security/events/:eventId
  app.get(
    '/admin/system/security/events/:eventId',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
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

  // GET /api/v1/admin/system/security/rbac
  app.get(
    '/admin/system/security/rbac',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const inventory = await AdminSystemSecurityService.getRbacInventory();
      return reply.status(200).send(createSuccessResponse(inventory));
    }
  );

  // GET /api/v1/admin/system/security/credentials
  app.get(
    '/admin/system/security/credentials',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const posture = await AdminSystemSecurityService.getCredentialPosture();
      return reply.status(200).send(createSuccessResponse({ items: posture, total: posture.length }));
    }
  );
}
