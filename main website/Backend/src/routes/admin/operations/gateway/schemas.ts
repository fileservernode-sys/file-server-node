import { z } from 'zod';
import { paginationQuerySchema, resourceIdSchema } from '../schemas/common.js';

export const gatewayNodeParamSchema = z.object({
  gatewayNodeId: resourceIdSchema
});

export const gatewayNodeListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).optional(),
  region: z.string().trim().max(64).optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'hostname', 'status', 'lastHeartbeatAt', 'region'])
    .default('createdAt'),
  search: z
    .string()
    .trim()
    .max(128, 'Search query cannot exceed 128 characters')
    .optional()
});

export const gatewayConnectionListQuerySchema = paginationQuerySchema.extend({
  gatewayNodeId: resourceIdSchema.optional(),
  deviceId: resourceIdSchema.optional(),
  status: z.enum(['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'FAILED']).optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'connectedAt', 'lastHeartbeatAt', 'status'])
    .default('createdAt'),
  search: z
    .string()
    .trim()
    .max(128, 'Search query cannot exceed 128 characters')
    .optional()
});

export const gatewayMutationActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(255, 'Action reason cannot exceed 255 characters')
    .optional()
}).strict();

export type GatewayNodeListQuery = z.infer<typeof gatewayNodeListQuerySchema>;
export type GatewayConnectionListQuery = z.infer<typeof gatewayConnectionListQuerySchema>;
export type GatewayMutationActionInput = z.infer<typeof gatewayMutationActionSchema>;
