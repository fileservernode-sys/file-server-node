/**
 * ZdexCloud Admin Billing Notification Operations Schemas
 * Phase 8.4 Batch E.5 Architecture
 */

import { z } from 'zod';
import {
  InvoiceNotificationOutboxStatus,
  EmailWebhookInboxStatus
} from '@prisma/client';
import { paginationQuerySchema } from '../schemas/common.js';

export const AdminInvoiceNotificationListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(InvoiceNotificationOutboxStatus).optional(),
  invoiceId: z.string().trim().optional(),
  invoiceNumber: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  recipientEmail: z.string().trim().email().optional().or(z.string().trim().optional()),
  startDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional()),
  endDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional())
});

export type AdminInvoiceNotificationListQuery = z.infer<typeof AdminInvoiceNotificationListQuerySchema>;

export const AdminWebhookInboxListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(EmailWebhookInboxStatus).optional(),
  eventType: z.string().trim().optional(),
  providerMessageId: z.string().trim().optional(),
  recipientEmail: z.string().trim().email().optional().or(z.string().trim().optional()),
  startDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional()),
  endDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional())
});

export type AdminWebhookInboxListQuery = z.infer<typeof AdminWebhookInboxListQuerySchema>;

export const AdminForceMarkDispatchedSchema = z.object({
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(1000, 'Reason must not exceed 1000 characters'),
  providerMessageId: z.string().trim().min(3, 'Provider message ID must be at least 3 characters').max(255)
});

export type AdminForceMarkDispatchedInput = z.infer<typeof AdminForceMarkDispatchedSchema>;

export const AdminAuthorizeResendSchema = z.object({
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(1000, 'Reason must not exceed 1000 characters'),
  resetAttemptCount: z.boolean().optional().default(false)
});

export type AdminAuthorizeResendInput = z.infer<typeof AdminAuthorizeResendSchema>;
