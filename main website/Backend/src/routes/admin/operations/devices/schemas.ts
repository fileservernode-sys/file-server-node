import { z } from 'zod';
import { paginationQuerySchema, resourceIdSchema } from '../schemas/common.js';

export const deviceParamSchema = z.object({
  deviceId: resourceIdSchema
});

export const deviceListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ONLINE', 'OFFLINE', 'CONNECTING', 'RECONNECTING']).optional(),
  platform: z.string().trim().max(64).optional(),
  userId: resourceIdSchema.optional(),
  installationId: z.string().trim().max(128).optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'deviceName', 'status', 'lastSeenAt'])
    .default('createdAt'),
  search: z
    .string()
    .trim()
    .max(128, 'Search query cannot exceed 128 characters')
    .optional()
});

export const deviceDisconnectSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(255, 'Disconnection reason cannot exceed 255 characters')
    .optional()
}).strict();

export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;
export type DeviceDisconnectInput = z.infer<typeof deviceDisconnectSchema>;
