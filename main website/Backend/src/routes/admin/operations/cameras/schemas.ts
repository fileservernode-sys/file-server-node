import { z } from 'zod';
import {
  CameraStatus,
  CameraStreamSessionStatus,
  CameraAuditEventType,
  CameraUsageCategory
} from '@prisma/client';
import { paginationQuerySchema, resourceIdSchema } from '../schemas/common.js';

export const cameraParamSchema = z.object({
  cameraId: resourceIdSchema
});

export const cameraListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(CameraStatus).optional(),
  userId: resourceIdSchema.optional(),
  deviceId: resourceIdSchema.optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'cameraName', 'status', 'lastSeenAt'])
    .default('createdAt'),
  search: z
    .string()
    .trim()
    .max(128, 'Search query cannot exceed 128 characters')
    .optional()
});

export const cameraSessionListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(CameraStreamSessionStatus).optional(),
  viewerUserId: resourceIdSchema.optional(),
  sortBy: z
    .enum(['createdAt', 'startedAt', 'endedAt', 'expiresAt', 'status', 'durationSeconds'])
    .default('createdAt')
});

export const cameraAuditListQuerySchema = paginationQuerySchema.extend({
  eventType: z.nativeEnum(CameraAuditEventType).optional(),
  action: z
    .string()
    .trim()
    .max(64, 'Action filter cannot exceed 64 characters')
    .optional(),
  result: z.enum(['SUCCESS', 'FAILED', 'DENIED']).optional(),
  actorType: z
    .string()
    .trim()
    .max(32, 'Actor type cannot exceed 32 characters')
    .optional(),
  sortBy: z.enum(['createdAt']).default('createdAt')
});

export const cameraUsageListQuerySchema = paginationQuerySchema.extend({
  category: z.nativeEnum(CameraUsageCategory).optional(),
  sortBy: z
    .enum(['periodStart', 'periodEnd', 'createdAt', 'quantity'])
    .default('periodStart')
});

export type CameraParam = z.infer<typeof cameraParamSchema>;
export type CameraListQuery = z.infer<typeof cameraListQuerySchema>;
export type CameraSessionListQuery = z.infer<typeof cameraSessionListQuerySchema>;
export type CameraAuditListQuery = z.infer<typeof cameraAuditListQuerySchema>;
export type CameraUsageListQuery = z.infer<typeof cameraUsageListQuerySchema>;
