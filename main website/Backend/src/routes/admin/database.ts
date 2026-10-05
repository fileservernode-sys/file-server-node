/**
 * Administrative Database Management API Routes (/api/v1/admin/database)
 * Phase 15 Batch 15.1 & Batch 15.2 — Database Management Foundation & Professional Data Grid
 *
 * Protected by admin authentication and 'database.management.view' RBAC permission.
 * Exposes secure, read-only metadata endpoints for schema inspection, table topology,
 * bounded data browsing, and professional server-side paginated/sorted/filtered data grid.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { DatabaseMetadataService, TableFilterRule } from '../../services/admin/database_metadata_service.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError, UnauthorizedError } from '../../errors/app-error.js';

const tableNameParamSchema = z.object({
  tableName: z.string({ required_error: 'Table name parameter is required' })
    .trim()
    .min(1, 'Table name cannot be empty')
    .max(64, 'Table name exceeds maximum length')
    .regex(/^[a-zA-Z0-9_]+$/, 'Invalid table identifier format')
});

const previewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

const filterRuleSchema = z.object({
  column: z.string({ required_error: 'Filter column is required' })
    .trim()
    .min(1, 'Filter column cannot be empty')
    .max(64, 'Filter column exceeds maximum length')
    .regex(/^[a-zA-Z0-9_]+$/, 'Invalid filter column identifier format'),
  operator: z.enum([
    'contains', 'notContains', 'not_contains',
    'equals', 'notEquals', 'not_equals',
    'startsWith', 'starts_with',
    'endsWith', 'ends_with',
    'isEmpty', 'is_empty',
    'isNotEmpty', 'is_not_empty',
    'greaterThan', 'gt',
    'greaterThanOrEqual', 'gte',
    'lessThan', 'lt',
    'lessThanOrEqual', 'lte',
    'between',
    'before',
    'after',
    'isTrue', 'is_true',
    'isFalse', 'is_false',
    'isNull', 'is_null',
    'isNotNull', 'is_not_null'
  ], { required_error: 'Filter operator is required' }),
  value: z.union([
    z.string().max(256),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string().max(256), z.number(), z.boolean()]))
  ]).optional().nullable(),
  value2: z.union([
    z.string().max(256),
    z.number(),
    z.boolean()
  ]).optional().nullable()
});

const insertRowBodySchema = z.object({
  values: z.record(z.any(), { required_error: 'values object is required' })
});

const updateRowBodySchema = z.object({
  primaryKey: z.record(z.any(), { required_error: 'primaryKey object is required' }),
  values: z.record(z.any(), { required_error: 'values object is required' }),
  concurrencyValue: z.union([z.string(), z.number()]).optional().nullable()
});

const deleteRowBodySchema = z.object({
  primaryKey: z.record(z.any(), { required_error: 'primaryKey object is required' })
});

const bulkDeleteRowsBodySchema = z.object({
  rows: z.array(z.record(z.any()), { required_error: 'rows array is required' })
    .min(1, 'At least 1 row identity must be provided')
    .max(50, 'Maximum of 50 records allowed per bulk delete request')
});

const rowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/).optional(),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().trim().max(256).optional(),
  filters: z.string().optional().transform((val, ctx) => {
    if (!val || val.trim() === '') return undefined;
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'filters parameter must be a JSON array' });
        return z.NEVER;
      }
      if (parsed.length > 10) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Maximum of 10 filters allowed per query' });
        return z.NEVER;
      }
      return z.array(filterRuleSchema).parse(parsed);
    } catch (e: any) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: e?.message || 'Invalid JSON format for filters' });
      return z.NEVER;
    }
  })
});

export async function adminDatabaseRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/admin/database/overview
   * Returns schema-level topology metrics, table counts, estimated row volume, and classification breakdown.
   */
  app.get(
    '/admin/database/overview',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const overview = await DatabaseMetadataService.getDatabaseOverview();

      return reply.status(200).send(createSuccessResponse(overview));
    }
  );

  /**
   * GET /api/v1/admin/database/tables
   * Returns list of all physical tables with row count estimates, column counts, primary keys, and classifications.
   */
  app.get(
    '/admin/database/tables',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const tables = await DatabaseMetadataService.getTableList();

      return reply.status(200).send(createSuccessResponse(tables));
    }
  );

  /**
   * GET /api/v1/admin/database/tables/:tableName
   * Returns detailed column definitions, indexes, constraints, and relationships for a specific table.
   */
  app.get(
    '/admin/database/tables/:tableName',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const paramsResult = tableNameParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        throw new ValidationError(paramsResult.error.errors[0]?.message || 'Invalid table name parameter');
      }

      const details = await DatabaseMetadataService.getTableDetails(paramsResult.data.tableName);

      return reply.status(200).send(createSuccessResponse(details));
    }
  );

  /**
   * GET /api/v1/admin/database/tables/:tableName/preview
   * Returns bounded read-only preview of rows (max 50 rows) with sensitive column masking.
   */
  app.get(
    '/admin/database/tables/:tableName/preview',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const paramsResult = tableNameParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        throw new ValidationError(paramsResult.error.errors[0]?.message || 'Invalid table name parameter');
      }

      const queryResult = previewQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        throw new ValidationError(queryResult.error.errors[0]?.message || 'Invalid pagination query parameters');
      }

      const previewData = await DatabaseMetadataService.getTablePreviewData(
        paramsResult.data.tableName,
        queryResult.data
      );

      return reply.status(200).send(createSuccessResponse(previewData));
    }
  );

  /**
   * GET /api/v1/admin/database/tables/:tableName/rows
   * Phase 15 Batch 15.2: Professional Database Data Grid
   * Returns securely validated, server-side paginated, stably sorted, searchable, and filtered rows.
   */
  app.get(
    '/admin/database/tables/:tableName/rows',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.view')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const paramsResult = tableNameParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        throw new ValidationError(paramsResult.error.errors[0]?.message || 'Invalid table name parameter');
      }

      const queryResult = rowsQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        throw new ValidationError(queryResult.error.errors[0]?.message || 'Invalid query parameters');
      }

      const rowsResult = await DatabaseMetadataService.getTableRows(
        paramsResult.data.tableName,
        queryResult.data as {
          page?: number;
          pageSize?: number;
          sortBy?: string;
          sortDirection?: 'asc' | 'desc';
          search?: string;
          filters?: TableFilterRule[];
        }
      );

      return reply.status(200).send(createSuccessResponse(rowsResult));
    }
  );

  /**
   * POST /api/v1/admin/database/tables/:tableName/rows
   * Phase 15 Batch 15.4: Add / Insert Records
   * Safely inserts a single record into an authorized database table.
   */
  app.post(
    '/admin/database/tables/:tableName/rows',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.insert')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const paramsResult = tableNameParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        throw new ValidationError(paramsResult.error.errors[0]?.message || 'Invalid table name parameter');
      }

      const bodyResult = insertRowBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        throw new ValidationError(bodyResult.error.errors[0]?.message || 'Invalid request payload: values object is required');
      }

      const result = await DatabaseMetadataService.insertTableRow({
        adminId: admin.id,
        tableName: paramsResult.data.tableName,
        values: bodyResult.data.values,
        ipAddress: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined
      });

      return reply.status(201).send(createSuccessResponse(result));
    }
  );

  /**
   * PUT /api/v1/admin/database/tables/:tableName/rows
   * Phase 15 Batch 15.5: Edit / Update Records
   * Safely updates a single record in an authorized database table by primary key.
   */
  app.put(
    '/admin/database/tables/:tableName/rows',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.update')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const paramsResult = tableNameParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        throw new ValidationError(paramsResult.error.errors[0]?.message || 'Invalid table name parameter');
      }

      const bodyResult = updateRowBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        throw new ValidationError(bodyResult.error.errors[0]?.message || 'Invalid request payload: primaryKey and values objects are required');
      }

      const result = await DatabaseMetadataService.updateTableRow({
        adminId: admin.id,
        tableName: paramsResult.data.tableName,
        primaryKey: bodyResult.data.primaryKey,
        values: bodyResult.data.values,
        concurrencyValue: bodyResult.data.concurrencyValue,
        ipAddress: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * DELETE /api/v1/admin/database/tables/:tableName/rows
   * Phase 15 Batch 15.6: Delete Single Database Record
   * Safely deletes a single record in an authorized database table by authoritative primary key.
   */
  app.delete(
    '/admin/database/tables/:tableName/rows',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.delete')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const paramsResult = tableNameParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        throw new ValidationError(paramsResult.error.errors[0]?.message || 'Invalid table name parameter');
      }

      const bodyResult = deleteRowBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        throw new ValidationError(bodyResult.error.errors[0]?.message || 'Invalid request payload: primaryKey object is required');
      }

      const result = await DatabaseMetadataService.deleteTableRow({
        adminId: admin.id,
        tableName: paramsResult.data.tableName,
        primaryKey: bodyResult.data.primaryKey,
        ipAddress: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * DELETE /api/v1/admin/database/tables/:tableName/bulk-rows
   * Phase 15 Batch 15.6: Bulk Delete Database Records
   * Safely deletes a bounded set of records (max 50) in an authorized database table with complete preflight checks.
   */
  app.delete(
    '/admin/database/tables/:tableName/bulk-rows',
    {
      preHandler: [adminAuthenticate, requirePermission('database.management.delete')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin;
      if (!admin) {
        throw new UnauthorizedError('Admin authentication required');
      }

      const paramsResult = tableNameParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        throw new ValidationError(paramsResult.error.errors[0]?.message || 'Invalid table name parameter');
      }

      const bodyResult = bulkDeleteRowsBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        throw new ValidationError(bodyResult.error.errors[0]?.message || 'Invalid request payload: rows array is required (1-50 items)');
      }

      const result = await DatabaseMetadataService.bulkDeleteTableRows({
        adminId: admin.id,
        tableName: paramsResult.data.tableName,
        rows: bodyResult.data.rows,
        ipAddress: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}

