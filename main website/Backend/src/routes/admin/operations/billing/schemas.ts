import { z } from 'zod';
import {
  BillingStatus,
  CurrencyCode,
  PaymentStatus,
  RefundStatus,
  RefundReason,
  ReconciliationStatus,
  ReconciliationDiscrepancyType,
  ReconciliationRunStatus,
  ReconciliationEntityType,
  PaymentProvider,
  PaymentEnvironment,
  WebhookEventStatus
} from '@prisma/client';
import { paginationQuerySchema } from '../schemas/common.js';

export const AdminSubscriptionListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(BillingStatus).optional(),
  planCode: z.string().trim().optional(),
  currency: z.nativeEnum(CurrencyCode).optional(),
  userId: z.string().trim().optional(),
  cancelAtPeriodEnd: z.preprocess((val) => {
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return undefined;
  }, z.boolean().optional())
});

export type AdminSubscriptionListQuery = z.infer<typeof AdminSubscriptionListQuerySchema>;

export const AdminPaymentListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(PaymentStatus).optional(),
  currency: z.nativeEnum(CurrencyCode).optional(),
  userId: z.string().trim().optional(),
  subscriptionId: z.string().trim().optional(),
  providerPaymentId: z.string().trim().optional(),
  startDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional()),
  endDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional())
});

export type AdminPaymentListQuery = z.infer<typeof AdminPaymentListQuerySchema>;

export const AdminRefundListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(RefundStatus).optional(),
  reason: z.nativeEnum(RefundReason).optional(),
  userId: z.string().trim().optional(),
  paymentId: z.string().trim().optional(),
  providerRefundId: z.string().trim().optional(),
  startDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional()),
  endDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional())
});

export type AdminRefundListQuery = z.infer<typeof AdminRefundListQuerySchema>;

export const AdminReconciliationRunListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(ReconciliationRunStatus).optional(),
  provider: z.nativeEnum(PaymentProvider).optional(),
  environment: z.nativeEnum(PaymentEnvironment).optional(),
  startDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional()),
  endDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional())
});

export type AdminReconciliationRunListQuery = z.infer<typeof AdminReconciliationRunListQuerySchema>;

export const AdminDiscrepancyListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(ReconciliationStatus).optional(),
  discrepancyType: z.nativeEnum(ReconciliationDiscrepancyType).optional(),
  entityType: z.nativeEnum(ReconciliationEntityType).optional(),
  runId: z.string().trim().optional(),
  providerEntityId: z.string().trim().optional()
});

export type AdminDiscrepancyListQuery = z.infer<typeof AdminDiscrepancyListQuerySchema>;

export const AdminWebhookEventListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(WebhookEventStatus).optional(),
  eventType: z.string().trim().optional(),
  providerEventId: z.string().trim().optional(),
  startDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional()),
  endDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional())
});

export type AdminWebhookEventListQuery = z.infer<typeof AdminWebhookEventListQuerySchema>;

export const AdminPlanListQuerySchema = paginationQuerySchema.extend({
  isActive: z.preprocess((val) => {
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return undefined;
  }, z.boolean().optional()),
  currency: z.nativeEnum(CurrencyCode).optional()
});

export type AdminPlanListQuery = z.infer<typeof AdminPlanListQuerySchema>;

export const AdminCancelSubscriptionSchema = z.object({
  mode: z.enum(['PERIOD_END', 'IMMEDIATE']).default('PERIOD_END'),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(255, 'Reason cannot exceed 255 characters').optional()
});

export type AdminCancelSubscriptionInput = z.infer<typeof AdminCancelSubscriptionSchema>;

