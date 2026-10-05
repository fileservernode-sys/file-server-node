/**
 * Admin SQL Query Runner Routes
 * Phase 15 Batch 15.1 — Read-Only SQL Foundation
 *
 * Exposes secure, authenticated, authorized, and rate-limited administrative endpoints
 * for executing read-only SQL queries against the ZdexCloud application database.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { adminSqlQueryRateLimitConfig, adminSqlControlledWriteRateLimitConfig, adminSqlDestructiveRateLimitConfig } from '../../middleware/rate_limit_presets.js';
import { SqlRunnerService } from '../../services/admin/sql_runner_service.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError, UnauthorizedError } from '../../errors/app-error.js';
import { resolveClientIp } from '../../utils/ip.js';

const executeSqlQuerySchema = z.object({
  sql: z.string({ required_error: 'SQL query text is required' })
    .trim()
    .min(1, 'SQL query text cannot be empty')
    .max(10000, 'SQL query text exceeds maximum allowed length of 10,000 characters')
}).strict();

const executeControlledWriteSqlSchema = z.object({
  sql: z.string({ required_error: 'SQL write text is required' })
    .trim()
    .min(1, 'SQL write text cannot be empty')
    .max(10000, 'SQL write text exceeds maximum allowed length of 10,000 characters'),
  confirmed: z.boolean({ required_error: 'Confirmation flag is required' })
    .refine(val => val === true, 'Explicit confirmation (confirmed: true) is required to execute write operations')
}).strict();

const executeDestructiveSqlSchema = z.object({
  sql: z.string({ required_error: 'SQL query text is required' })
    .trim()
    .min(1, 'SQL query text cannot be empty')
    .max(10000, 'SQL query text exceeds maximum allowed length of 10,000 characters'),
  confirmed: z.boolean({ required_error: 'Confirmation flag is required' })
    .refine(val => val === true, 'Explicit confirmation (confirmed: true) is required to execute destructive operations')
}).strict();

export async function adminSqlRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/admin/sql/query
   * Executes a read-only SQL query on behalf of an authenticated Super Admin.
   * Enforces:
   * - Admin Authentication (Session token in Bearer or HttpOnly cookie)
   * - Anti-CSRF on cookie-authenticated requests
   * - RBAC: requires 'sql.query.read'
   * - SQL Safety Guard: strict read-only parser, no multi-statements, no mutations/locking
   * - Bounded resource limits (5s timeout, 500 rows ceiling, sensitive column masking)
   * - Comprehensive security and administrative audit logging
   */
  app.post(
    '/admin/sql/query',
    {
      config: {
        rateLimit: adminSqlQueryRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('sql.query.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const bodyParsed = executeSqlQuerySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        const firstError = bodyParsed.error.errors[0]?.message || 'Invalid SQL query request body';
        throw new ValidationError(firstError);
      }

      const { sql } = bodyParsed.data;
      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;
      const requestId = (request as any)?.id || 'req_untracked';

      const result = await SqlRunnerService.executeReadOnlyQuery({
        sql,
        admin: {
          id: admin.id,
          email: admin.email,
          isSuperAdmin: admin.isSuperAdmin
        },
        requestId,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/sql/write
   * Executes a controlled write SQL query (INSERT/UPDATE) on behalf of an authorized Admin.
   * Enforces:
   * - Admin Authentication
   * - Anti-CSRF on cookie-authenticated requests
   * - RBAC: requires 'sql.query.write'
   * - Strict rate limiting (10 req/min)
   * - SQL Safety Guard: strict INSERT/UPDATE validation, no DDL/DCL, no DELETE, mandatory non-trivial WHERE
   * - Transactional safety: automatic rollback if affected rows > 50
   * - Comprehensive dual security and administrative audit logging
   */
  app.post(
    '/admin/sql/write',
    {
      config: {
        rateLimit: adminSqlControlledWriteRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('sql.query.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const bodyParsed = executeControlledWriteSqlSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        const firstError = bodyParsed.error.errors[0]?.message || 'Invalid write SQL request body';
        throw new ValidationError(firstError);
      }

      const { sql, confirmed } = bodyParsed.data;
      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;
      const requestId = (request as any)?.id || 'req_untracked';

      const result = await SqlRunnerService.executeControlledWriteQuery({
        sql,
        confirmed,
        admin: {
          id: admin.id,
          email: admin.email,
          isSuperAdmin: admin.isSuperAdmin
        },
        requestId,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/sql/destructive
   * Executes a controlled destructive SQL query (single-statement DELETE) on behalf of an authorized Admin.
   * Enforces:
   * - Admin Authentication
   * - Anti-CSRF on cookie-authenticated requests
   * - RBAC: requires 'sql.query.destructive'
   * - Strict rate limiting (5 req/min)
   * - SQL Safety Guard: strict DELETE validation, no DDL/DCL, no TRUNCATE/DROP, mandatory non-trivial WHERE
   * - Transactional safety: automatic rollback if affected rows > 50
   * - Comprehensive dual security and administrative audit logging
   */
  app.post(
    '/admin/sql/destructive',
    {
      config: {
        rateLimit: adminSqlDestructiveRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('sql.query.destructive')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const bodyParsed = executeDestructiveSqlSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        const firstError = bodyParsed.error.errors[0]?.message || 'Invalid destructive SQL request body';
        throw new ValidationError(firstError);
      }

      const { sql, confirmed } = bodyParsed.data;
      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;
      const requestId = (request as any)?.id || 'req_untracked';

      const result = await SqlRunnerService.executeDestructiveQuery({
        sql,
        confirmed,
        admin: {
          id: admin.id,
          email: admin.email,
          isSuperAdmin: admin.isSuperAdmin
        },
        requestId,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
