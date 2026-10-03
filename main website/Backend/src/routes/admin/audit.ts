import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminAuditService, MAX_QUERY_LIMIT } from '../../services/admin/admin_audit_service.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError } from '../../errors/app-error.js';
import { AdminAuditAction } from '@prisma/client';
import { resolveClientIp } from '../../utils/ip.js';
import {
  adminOperationsRateLimitConfig,
  adminHeavyQueryRateLimitConfig
} from '../../middleware/rate_limit_presets.js';

const auditQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  adminId: z.string().trim().optional(),
  action: z.nativeEnum(AdminAuditAction).optional(),
  status: z.string().trim().optional(),
  ipAddress: z.string().trim().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_QUERY_LIMIT).default(25)
});

const auditExportSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  adminId: z.string().trim().optional(),
  action: z.nativeEnum(AdminAuditAction).optional(),
  status: z.string().trim().optional(),
  ipAddress: z.string().trim().optional(),
  format: z.enum(['csv', 'json']).default('csv')
});

export async function adminAuditRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/audit-logs
   * Queries administrative audit logs with filtering and pagination.
   */
  app.get(
    '/admin/audit-logs',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('audit.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = auditQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminAuditService.queryAuditLogs(
        parsed.data,
        request.admin?.id,
        resolveClientIp(request)
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/audit-logs/export
   * Bounded CSV/JSON export of administrative audit records.
   */
  app.get(
    '/admin/audit-logs/export',
    {
      config: {
        rateLimit: adminHeavyQueryRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('audit.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = auditExportSchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid export parameters');
      }

      const { format, ...filters } = parsed.data;

      const exportResult = await AdminAuditService.exportAuditLogs(
        filters,
        format,
        request.admin?.id,
        resolveClientIp(request)
      );

      reply.header('Content-Type', exportResult.contentType);
      reply.header('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
      return reply.status(200).send(exportResult.content);
    }
  );

  /**
   * POST /api/v1/admin/audit-logs/verify-integrity
   * Cryptographically verifies the audit log chain from Genesis to latest.
   */
  app.post(
    '/admin/audit-logs/verify-integrity',
    {
      config: {
        rateLimit: adminHeavyQueryRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await AdminAuditService.verifyIntegrity(
        request.admin?.id,
        resolveClientIp(request)
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
