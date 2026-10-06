/**
 * Phase 17 Batch 17.8 — System Security Controls Zod Schemas
 */

import { z } from 'zod';

export const adminSessionQuerySchema = z.object({
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val ? Number(val) : 25), z.number().int().min(1).max(100).default(25)),
  adminId: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED', 'ALL']).optional().default('ALL'),
  search: z.string().trim().max(100).optional()
});

export const revokeSessionParamSchema = z.object({
  sessionId: z.string().trim().min(1, 'Session ID is required')
});

export const revokeSessionBodySchema = z.object({
  reason: z.string().trim().max(255).optional().default('ADMINISTRATIVE_REVOCATION')
});

export const revokeAllAdminSessionsParamSchema = z.object({
  adminId: z.string().trim().min(1, 'Admin ID is required')
});

export const revokeAllAdminSessionsBodySchema = z.object({
  reason: z.string().trim().max(255).optional().default('ADMINISTRATIVE_BULK_REVOCATION')
});

export const unlockLockoutBodySchema = z.object({
  key: z.string().trim().optional(),
  ip: z.string().trim().optional(),
  email: z.string().trim().optional()
}).refine(data => !!(data.key || (data.ip && data.email) || data.email), {
  message: 'Lockout identifier (key, email, or ip + email) must be provided'
});

export const securityEventQuerySchema = z.object({
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val ? Number(val) : 25), z.number().int().min(1).max(100).default(25)),
  action: z.string().trim().optional(),
  status: z.string().trim().optional(),
  adminId: z.string().trim().optional(),
  ipAddress: z.string().trim().optional(),
  startDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional()),
  endDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional()),
  search: z.string().trim().max(100).optional()
});

export const securityEventParamSchema = z.object({
  eventId: z.string().trim().min(1, 'Event ID is required')
});

export type AdminSessionQuery = z.infer<typeof adminSessionQuerySchema>;
export type RevokeSessionParam = z.infer<typeof revokeSessionParamSchema>;
export type RevokeSessionBody = z.infer<typeof revokeSessionBodySchema>;
export type RevokeAllAdminSessionsParam = z.infer<typeof revokeAllAdminSessionsParamSchema>;
export type RevokeAllAdminSessionsBody = z.infer<typeof revokeAllAdminSessionsBodySchema>;
export type UnlockLockoutBody = z.infer<typeof unlockLockoutBodySchema>;
export type SecurityEventQuery = z.infer<typeof securityEventQuerySchema>;
export type SecurityEventParam = z.infer<typeof securityEventParamSchema>;
