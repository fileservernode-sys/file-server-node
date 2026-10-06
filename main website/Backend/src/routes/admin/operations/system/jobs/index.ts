/**
 * Fastify Operations Routes for Admin Background Jobs & Operations
 * Phase 17 Batch 17.6 — Background Jobs & Operations
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../../middleware/admin-auth.js';
import { requireOperationPermission, resolveOperationContext } from '../../middleware/require_operation_permission.js';
import { createSuccessResponse } from '../../../../../schemas/response.js';
import { ValidationError } from '../../../../../errors/app-error.js';
import { adminOperationsRateLimitConfig, highCapacityHealthRateLimitConfig } from '../../../../../middleware/rate_limit_presets.js';
import { AdminBackgroundJobsService } from './service.js';
import {
  backgroundJobQuerySchema,
  failedJobQuerySchema,
  backgroundJobParamSchema,
  backgroundJobsExportQuerySchema
} from './schemas.js';

export async function adminBackgroundJobsOperationsRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/admin/operations/system/jobs/metrics
   * Aggregate metrics across all queues and workers.
   */
  app.get(
    '/admin/operations/system/jobs/metrics',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminBackgroundJobsService.getJobsMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/jobs/queues
   * List all background queues and current depth/latencies.
   */
  app.get(
    '/admin/operations/system/jobs/queues',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queues = await AdminBackgroundJobsService.listQueues();
      return reply.status(200).send(createSuccessResponse({ queues }));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/jobs/workers
   * Authoritative worker telemetry and health.
   */
  app.get(
    '/admin/operations/system/jobs/workers',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workers = AdminBackgroundJobsService.listWorkers();
      return reply.status(200).send(createSuccessResponse({ workers }));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/jobs
   * Paginated, searchable background jobs listing.
   */
  app.get(
    '/admin/operations/system/jobs',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
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

  /**
   * GET /api/v1/admin/operations/system/jobs/failed
   * Dedicated failed / retrying jobs triage queue.
   */
  app.get(
    '/admin/operations/system/jobs/failed',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = failedJobQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid failed jobs query parameters');
      }

      const result = await AdminBackgroundJobsService.listFailedJobs(parsed.data as any);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/jobs/:jobId
   * Deep single-job inspection with sanitized payload and attempt history.
   */
  app.get(
    '/admin/operations/system/jobs/:jobId',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
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

  /**
   * POST /api/v1/admin/operations/system/jobs/:jobId/retry
   * Re-enqueue a failed or retrying job for processing.
   */
  app.post(
    '/admin/operations/system/jobs/:jobId/retry',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.write')]
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


  /**
   * POST /api/v1/admin/operations/system/jobs/export
   * Export jobs in CSV or JSON format with SHA-256 audit logging.
   */
  app.post(
    '/admin/operations/system/jobs/export',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
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
}
