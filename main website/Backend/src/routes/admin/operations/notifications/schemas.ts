/**
 * Zod Validation Schemas for Admin Notification Operations
 * Phase 17 Batch 17.4 — Notifications & Communication Management
 */

import { z } from 'zod';
import {
  NotificationRecordStatus,
  PushPlatform
} from '@prisma/client';

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.nativeEnum(NotificationRecordStatus).optional(),
  channel: z.string().trim().max(32).optional(),
  category: z.string().trim().max(64).optional(),
  severity: z.string().trim().max(32).optional(),
  userId: z.string().trim().optional(),
  deviceId: z.string().trim().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.enum(['createdAt', 'occurredAt', 'title', 'status', 'category', 'severity']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const failedDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  channel: z.string().trim().max(32).optional(),
  failureCategory: z.string().trim().max(64).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.enum(['createdAt', 'lastAttemptAt', 'failedAt', 'attemptCount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const pushTokensQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  platform: z.nativeEnum(PushPlatform).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  userId: z.string().trim().optional(),
  deviceId: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'lastSeenAt']).default('lastSeenAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const notificationParamSchema = z.object({
  notificationId: z.string().trim().min(1, 'notificationId is required')
});

export const deliveryRetryParamSchema = z.object({
  deliveryId: z.string().trim().min(1, 'deliveryId is required')
});

export const deliveryRetryBodySchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500, 'Reason cannot exceed 500 characters').optional()
});

export const tokenRevokeParamSchema = z.object({
  tokenId: z.string().trim().min(1, 'tokenId is required')
});

export const tokenRevokeBodySchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500, 'Reason cannot exceed 500 characters').optional()
});
