/**
 * Phase 17 Batch 17.7 — System Configuration Zod Schemas
 */

import { z } from 'zod';

export const systemConfigQuerySchema = z.object({
  category: z.enum([
    'LOGGING_DIAGNOSTICS',
    'AUTHENTICATION_OTP',
    'NOTIFICATION_DELIVERY',
    'RETENTION_CLEANUP',
    'PLATFORM_GENERAL',
    'ENVIRONMENT_DEPLOYMENT'
  ]).optional(),
  editableOnly: z.preprocess(
    (val) => (val === 'true' || val === true ? true : val === 'false' || val === false ? false : undefined),
    z.boolean().optional()
  ),
  search: z.string().trim().max(100).optional()
});

export const systemSettingParamSchema = z.object({
  key: z.string().trim().min(1, 'Setting key is required').max(100)
});

export const updateSystemSettingSchema = z.object({
  value: z.union([
    z.string().max(1000),
    z.number(),
    z.boolean()
  ]),
  expectedVersion: z.number().int().min(1).optional()
});

export const featureFlagParamSchema = z.object({
  key: z.string().trim().min(1, 'Feature flag key is required').max(100)
});

export const updateFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  expectedVersion: z.number().int().min(1).optional()
});

export type SystemConfigQuery = z.infer<typeof systemConfigQuerySchema>;
export type SystemSettingParam = z.infer<typeof systemSettingParamSchema>;
export type UpdateSystemSettingPayload = z.infer<typeof updateSystemSettingSchema>;
export type FeatureFlagParam = z.infer<typeof featureFlagParamSchema>;
export type UpdateFeatureFlagPayload = z.infer<typeof updateFeatureFlagSchema>;
