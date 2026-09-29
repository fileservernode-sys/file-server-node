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

export const AdminExecuteRefundSchema = z.object({
  amountMinorUnits: z.number().int().positive('Refund amount must be positive integer').optional(),
  reason: z.nativeEnum(RefundReason).default(RefundReason.ADMIN_APPROVED_EXCEPTION),
  reasonDetails: z.string().trim().max(500, 'Reason details cannot exceed 500 characters').optional(),
  idempotencyKey: z.string().trim().min(5, 'Idempotency key must be at least 5 characters').max(128).optional(),
  terminateSubscription: z.boolean().optional(),
  correlationId: z.string().trim().max(128).optional()
});

export type AdminExecuteRefundInput = z.infer<typeof AdminExecuteRefundSchema>;

export const AdminStartReconciliationRunSchema = z.object({
  scope: z.enum(['DATE_RANGE', 'PAYMENTS', 'REFUNDS', 'SETTLEMENTS', 'FULL_BILLING']).default('FULL_BILLING'),
  startDate: z.string().trim().datetime({ offset: true }).or(z.string().datetime()).optional(),
  endDate: z.string().trim().datetime({ offset: true }).or(z.string().datetime()).optional(),
  provider: z.nativeEnum(PaymentProvider).default(PaymentProvider.RAZORPAY),
  environment: z.nativeEnum(PaymentEnvironment).optional(),
  idempotencyKey: z.string().trim().min(5).max(128).optional(),
  dryRun: z.boolean().optional(),
  notes: z.string().trim().max(500).optional()
});

export type AdminStartReconciliationRunInput = z.infer<typeof AdminStartReconciliationRunSchema>;

export const AdminResolveDiscrepancySchema = z.object({
  action: z.enum(['ACKNOWLEDGE', 'RETRY_PROVIDER_LOOKUP', 'MARK_RESOLVED', 'SYNC_PROVIDER_REFERENCE']),
  resolutionReason: z.string().trim().min(3, 'Resolution reason must be at least 3 characters').max(500, 'Resolution reason cannot exceed 500 characters').optional(),
  notes: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: z.string().trim().min(5).max(128).optional()
}).refine(data => !!(data.resolutionReason || data.notes), {
  message: 'Either resolutionReason or notes must be provided (min 3 characters)',
  path: ['notes']
});

export type AdminResolveDiscrepancyInput = z.infer<typeof AdminResolveDiscrepancySchema>;

export const AdminSettlementListQuerySchema = paginationQuerySchema.extend({
  reconciliationStatus: z.nativeEnum(ReconciliationStatus).optional(),
  settlementStatus: z.string().trim().optional(),
  providerSettlementId: z.string().trim().optional(),
  settlementUtr: z.string().trim().optional(),
  startDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional()),
  endDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional())
});

export type AdminSettlementListQuery = z.infer<typeof AdminSettlementListQuerySchema>;

export const AdminBillingSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search query must be at least 2 characters').max(128, 'Search query cannot exceed 128 characters')
});

export type AdminBillingSearchQuery = z.infer<typeof AdminBillingSearchQuerySchema>;

export const AdminBillingAuditListQuerySchema = paginationQuerySchema.extend({
  targetResourceType: z.enum([
    'billing_payment',
    'billing_refund',
    'subscription',
    'billing_reconciliation_run',
    'billing_reconciliation_discrepancy',
    'billing_settlement'
  ]).optional(),
  action: z.string().trim().optional(),
  adminId: z.string().trim().optional(),
  startDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional()),
  endDate: z.string().trim().datetime({ offset: true }).optional().or(z.string().datetime().optional())
});

export type AdminBillingAuditListQuery = z.infer<typeof AdminBillingAuditListQuerySchema>;



