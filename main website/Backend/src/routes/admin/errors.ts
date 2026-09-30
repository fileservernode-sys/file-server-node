import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminErrorService } from '../../services/admin/admin_error_service.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError } from '../../errors/app-error.js';
import { ErrorSeverity, IncidentStatus } from '@prisma/client';

const queryIncidentsSchema = z.object({
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(ErrorSeverity).optional(),
  component: z.string().trim().max(64).optional(),
  errorCode: z.string().trim().max(100).optional(),
  fingerprintId: z.string().trim().optional(),
  fingerprint: z.string().trim().max(128).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  userId: z.string().trim().optional(),
  deviceId: z.string().trim().optional(),
  serverInstanceId: z.string().trim().optional(),
  gatewayNodeId: z.string().trim().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['lastSeenAt', 'firstSeenAt', 'severity', 'status', 'totalOccurrences', 'createdAt', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

const incidentParamsSchema = z.object({
  incidentId: z.string().trim().min(1, 'incidentId is required')
});

const occurrenceParamsSchema = z.object({
  occurrenceId: z.string().trim().min(1, 'occurrenceId is required')
});

const fingerprintParamsSchema = z.object({
  fingerprintId: z.string().trim().min(1, 'fingerprintId is required')
});

const resolveIncidentSchema = z.object({
  resolutionNotes: z.string().trim().max(2000, 'Resolution notes cannot exceed 2000 characters').optional()
});

const muteIncidentSchema = z.object({
  mutedUntil: z.string().optional().nullable(),
  reason: z.string().trim().max(500, 'Mute reason cannot exceed 500 characters').optional()
});

/**
 * Administrative Error Center Routes (/api/v1/admin/errors)
 * Protected by admin authentication and granular RBAC permissions.
 */
export async function adminErrorRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/errors/incidents
   * Queries paginated error incidents with multi-attribute filtering.
   */
  app.get(
    '/admin/errors/incidents',
    {
      preHandler: [adminAuthenticate, requirePermission('errors.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = queryIncidentsSchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminErrorService.listIncidents(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/errors/incidents/:incidentId
   * Retrieves single incident details, fingerprint metadata, and bounded occurrences.
   */
  app.get(
    '/admin/errors/incidents/:incidentId',
    {
      preHandler: [adminAuthenticate, requirePermission('errors.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = incidentParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid incident ID');
      }

      const incident = await AdminErrorService.getIncidentDetail(params.data.incidentId);
      return reply.status(200).send(createSuccessResponse(incident));
    }
  );

  /**
   * GET /api/v1/admin/errors/occurrences/:occurrenceId
   * Retrieves detailed occurrence diagnostic telemetry.
   */
  app.get(
    '/admin/errors/occurrences/:occurrenceId',
    {
      preHandler: [adminAuthenticate, requirePermission('errors.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = occurrenceParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid occurrence ID');
      }

      const occurrence = await AdminErrorService.getOccurrenceDetail(params.data.occurrenceId);
      return reply.status(200).send(createSuccessResponse(occurrence));
    }
  );

  /**
   * GET /api/v1/admin/errors/fingerprints/:fingerprintId
   * Retrieves fingerprint aggregate details and active incidents summary.
   */
  app.get(
    '/admin/errors/fingerprints/:fingerprintId',
    {
      preHandler: [adminAuthenticate, requirePermission('errors.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = fingerprintParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid fingerprint ID');
      }

      const fingerprint = await AdminErrorService.getFingerprintDetail(params.data.fingerprintId);
      return reply.status(200).send(createSuccessResponse(fingerprint));
    }
  );

  /**
   * POST /api/v1/admin/errors/incidents/:incidentId/acknowledge
   * Sets incident status to ACKNOWLEDGED with audit logging.
   */
  app.post(
    '/admin/errors/incidents/:incidentId/acknowledge',
    {
      preHandler: [adminAuthenticate, requirePermission('errors.manage')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = incidentParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid incident ID');
      }

      const result = await AdminErrorService.acknowledgeIncident(
        params.data.incidentId,
        request.admin!,
        request.ip,
        request.headers['user-agent'] as string
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/errors/incidents/:incidentId/resolve
   * Sets incident status to RESOLVED with resolution notes and audit logging.
   */
  app.post(
    '/admin/errors/incidents/:incidentId/resolve',
    {
      preHandler: [adminAuthenticate, requirePermission('errors.manage')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = incidentParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid incident ID');
      }

      const body = resolveIncidentSchema.safeParse(request.body || {});
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid resolution payload');
      }

      const result = await AdminErrorService.resolveIncident(
        params.data.incidentId,
        body.data,
        request.admin!,
        request.ip,
        request.headers['user-agent'] as string
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/errors/incidents/:incidentId/mute
   * Sets incident status to MUTED with duration limit and audit logging.
   */
  app.post(
    '/admin/errors/incidents/:incidentId/mute',
    {
      preHandler: [adminAuthenticate, requirePermission('errors.manage')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = incidentParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid incident ID');
      }

      const body = muteIncidentSchema.safeParse(request.body || {});
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid mute payload');
      }

      const result = await AdminErrorService.muteIncident(
        params.data.incidentId,
        body.data,
        request.admin!,
        request.ip,
        request.headers['user-agent'] as string
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/errors/incidents/:incidentId/unmute
   * Restores active incident triage status with audit logging.
   */
  app.post(
    '/admin/errors/incidents/:incidentId/unmute',
    {
      preHandler: [adminAuthenticate, requirePermission('errors.manage')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = incidentParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError(params.error.errors[0]?.message || 'Invalid incident ID');
      }

      const result = await AdminErrorService.unmuteIncident(
        params.data.incidentId,
        request.admin!,
        request.ip,
        request.headers['user-agent'] as string
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
