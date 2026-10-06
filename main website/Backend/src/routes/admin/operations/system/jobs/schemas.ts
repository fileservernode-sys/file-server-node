/**
 * Zod Validation Schemas for Admin Background Jobs & Operations
 * Phase 17 Batch 17.6 — Background Jobs & Operations
 */

import { z } from 'zod';

export const backgroundJobQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  queueName: z.string().trim().max(100).optional(),
  category: z.enum(['NOTIFICATION', 'EMAIL', 'BILLING', 'MAINTENANCE']).optional(),
  status: z.enum(['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRYING']).optional(),
  userId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  workerId: z.string().trim().max(100).optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  sortBy: z.enum(['createdAt', 'startedAt', 'completedAt', 'attemptCount', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const failedJobQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  queueName: z.string().trim().max(100).optional(),
  category: z.enum(['NOTIFICATION', 'EMAIL', 'BILLING', 'MAINTENANCE']).optional(),
  workerId: z.string().trim().max(100).optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  sortBy: z.enum(['createdAt', 'lastAttemptAt', 'attemptCount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const backgroundJobParamSchema = z.object({
  jobId: z.string().trim().min(1).max(128)
});

export const backgroundJobsExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  category: z.enum(['NOTIFICATION', 'EMAIL', 'BILLING', 'MAINTENANCE']).optional(),
  queueName: z.string().trim().max(100).optional(),
  status: z.enum(['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRYING']).optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  maxLimit: z.coerce.number().int().min(1).max(1000).default(500)
});
