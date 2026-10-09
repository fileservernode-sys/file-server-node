/**
 * Validation Schemas for Admin System Logs & Diagnostics
 * Phase 17 Batch 17.5 — System Logs & Diagnostics
 */

import { z } from 'zod';
import { ErrorSeverity, IncidentStatus, ConnectionStatus } from '@prisma/client';

export const systemErrorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  severity: z.nativeEnum(ErrorSeverity).optional(),
  component: z.string().trim().max(64).optional(),
  errorCode: z.string().trim().max(100).optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  requestId: z.string().trim().max(128).optional(),
  userId: z.string().trim().max(64).optional(),
  deviceId: z.string().trim().max(64).optional(),
  serverInstanceId: z.string().trim().max(64).optional(),
  gatewayNodeId: z.string().trim().max(64).optional(),
  startDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  sortBy: z.enum(['occurredAt', 'severity', 'component', 'errorCode', 'httpStatus']).default('occurredAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const systemErrorParamSchema = z.object({
  id: z.string().trim().min(1, 'Error occurrence ID is required')
});

export const systemEventQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  source: z.enum(['CUSTOMER_AUDIT', 'ADMIN_AUDIT']).optional(),
  eventType: z.string().trim().max(100).optional(),
  userId: z.string().trim().max(64).optional(),
  adminId: z.string().trim().max(64).optional(),
  deviceId: z.string().trim().max(64).optional(),
  startDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  sortBy: z.enum(['createdAt', 'eventType']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const gatewayDiagnosticsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  status: z.nativeEnum(ConnectionStatus).optional(),
  gatewayNodeId: z.string().trim().max(64).optional(),
  deviceId: z.string().trim().max(64).optional(),
  userId: z.string().trim().max(64).optional(),
  startDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  sortBy: z.enum(['connectedAt', 'disconnectedAt', 'lastHeartbeatAt', 'createdAt']).default('connectedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const systemIncidentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(ErrorSeverity).optional(),
  component: z.string().trim().max(64).optional(),
  errorCode: z.string().trim().max(100).optional(),
  startDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  sortBy: z.enum(['lastSeenAt', 'firstSeenAt', 'totalOccurrences', 'severity', 'status', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const systemLogsExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  category: z.enum(['errors', 'events', 'gateway']).default('errors'),
  search: z.string().trim().max(200).optional(),
  severity: z.nativeEnum(ErrorSeverity).optional(),
  component: z.string().trim().max(64).optional(),
  startDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  maxLimit: z.coerce.number().int().min(1).max(1000).default(500)
});
