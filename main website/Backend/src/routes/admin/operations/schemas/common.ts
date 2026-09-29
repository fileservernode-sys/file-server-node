import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

// UUID validation schema (v4 style, 36 characters)
export const uuidSchema = z
  .string()
  .trim()
  .uuid({ message: 'Invalid UUID identifier format' });

// CUID validation schema (24-32 alphanumeric chars starting with c)
export const cuidSchema = z
  .string()
  .trim()
  .min(10, 'CUID identifier too short')
  .max(36, 'CUID identifier too long')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid CUID identifier format');

// Generic safe resource identifier schema
export const resourceIdSchema = z
  .string()
  .trim()
  .min(1, 'Resource identifier cannot be empty')
  .max(64, 'Resource identifier too long')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Resource identifier contains invalid characters');

// Safe standard pagination schema
export const paginationQuerySchema = z.object({
  page: z.coerce
    .number()
    .int({ message: 'Page must be an integer' })
    .min(1, { message: 'Page must be at least 1' })
    .default(1),
  pageSize: z.coerce
    .number()
    .int({ message: 'Page size must be an integer' })
    .min(1, { message: 'Page size must be at least 1' })
    .max(MAX_PAGE_SIZE, { message: `Page size cannot exceed ${MAX_PAGE_SIZE}` })
    .default(DEFAULT_PAGE_SIZE),
  search: z
    .string()
    .trim()
    .max(128, 'Search query cannot exceed 128 characters')
    .optional(),
  sortBy: z
    .string()
    .trim()
    .max(32, 'Sort field name too long')
    .regex(/^[a-zA-Z0-9_]+$/, 'Invalid sort field')
    .optional(),
  sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).default('desc').transform(v => v.toLowerCase() as 'asc' | 'desc'),
  startDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional())
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
