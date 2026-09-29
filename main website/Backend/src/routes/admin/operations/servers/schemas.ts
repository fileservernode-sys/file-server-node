import { z } from 'zod';
import { paginationQuerySchema, resourceIdSchema } from '../schemas/common.js';

export const serverParamSchema = z.object({
  serverId: resourceIdSchema
});

export const serverListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['STOPPED', 'STARTING', 'RUNNING', 'ERROR']).optional(),
  userId: resourceIdSchema.optional(),
  deviceId: resourceIdSchema.optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'serverName', 'status', 'startedAt', 'lastHeartbeatAt'])
    .default('createdAt'),
  search: z
    .string()
    .trim()
    .max(128, 'Search query cannot exceed 128 characters')
    .optional()
});

export const serverPowerActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(255, 'Action reason cannot exceed 255 characters')
    .optional()
}).strict();

export type ServerListQuery = z.infer<typeof serverListQuerySchema>;
export type ServerPowerActionInput = z.infer<typeof serverPowerActionSchema>;
