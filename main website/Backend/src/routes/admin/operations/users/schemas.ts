import { z } from 'zod';
import { paginationQuerySchema, resourceIdSchema } from '../schemas/common.js';

export const userParamSchema = z.object({
  userId: resourceIdSchema
});

export const userListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']).optional(),
  emailVerified: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .or(z.boolean())
    .optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'email', 'status', 'fullName'])
    .default('createdAt'),
  search: z
    .string()
    .trim()
    .max(128, 'Search query cannot exceed 128 characters')
    .optional()
});

export const userSuspendSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(255, 'Suspension reason cannot exceed 255 characters')
    .optional()
}).strict();

export const userRestoreSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(255, 'Restoration reason cannot exceed 255 characters')
    .optional()
}).strict();

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type UserSuspendInput = z.infer<typeof userSuspendSchema>;
export type UserRestoreInput = z.infer<typeof userRestoreSchema>;
