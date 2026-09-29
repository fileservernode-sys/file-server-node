import assert from 'node:assert';
import { test, describe } from 'node:test';
import { AdminBillingService } from '../src/routes/admin/operations/billing/service.js';
import {
  AdminSubscriptionListQuerySchema,
  AdminPaymentListQuerySchema,
  AdminRefundListQuerySchema,
  AdminReconciliationRunListQuerySchema,
  AdminDiscrepancyListQuerySchema,
  AdminPlanListQuerySchema,
  AdminCancelSubscriptionSchema,
  AdminExecuteRefundSchema
} from '../src/routes/admin/operations/billing/schemas.js';

describe('Admin Billing Operations Baseline (Phase 9.1, 9.2 & 9.3 Deferred Tests)', () => {
  describe('Validation Schemas', () => {
    test('should validate subscription list query defaults and constraints', () => {
      const parsed = AdminSubscriptionListQuerySchema.parse({
        page: '1',
        pageSize: '25',
        status: 'ACTIVE',
        currency: 'INR'
      });

      assert.strictEqual(parsed.page, 1);
      assert.strictEqual(parsed.pageSize, 25);
      assert.strictEqual(parsed.status, 'ACTIVE');
      assert.strictEqual(parsed.currency, 'INR');
    });

    test('should validate payment list query with date bounds', () => {
      const now = new Date().toISOString();
      const parsed = AdminPaymentListQuerySchema.parse({
        page: 2,
        pageSize: 10,
        status: 'SUCCESS',
        startDate: now
      });

      assert.strictEqual(parsed.page, 2);
      assert.strictEqual(parsed.pageSize, 10);
      assert.strictEqual(parsed.status, 'SUCCESS');
      assert.strictEqual(parsed.startDate, now);
    });

    test('should validate refund list query with reason filter', () => {
      const parsed = AdminRefundListQuerySchema.parse({
        reason: 'DUPLICATE_PAYMENT',
        status: 'PROCESSED'
      });

      assert.strictEqual(parsed.reason, 'DUPLICATE_PAYMENT');
      assert.strictEqual(parsed.status, 'PROCESSED');
    });

    test('should validate reconciliation discrepancy filter schema', () => {
      const parsed = AdminDiscrepancyListQuerySchema.parse({
        status: 'REQUIRES_REVIEW',
        discrepancyType: 'PAYMENT_AMOUNT_MISMATCH'
      });

      assert.strictEqual(parsed.status, 'REQUIRES_REVIEW');
      assert.strictEqual(parsed.discrepancyType, 'PAYMENT_AMOUNT_MISMATCH');
    });

    test('should validate plan catalog query', () => {
      const parsed = AdminPlanListQuerySchema.parse({
        isActive: 'true',
        currency: 'INR'
      });

      assert.strictEqual(parsed.isActive, true);
      assert.strictEqual(parsed.currency, 'INR');
    });

    test('should validate admin subscription cancellation schema (Phase 9.2)', () => {
      const periodEnd = AdminCancelSubscriptionSchema.parse({
        mode: 'PERIOD_END',
        reason: 'Requested by user via support ticket #1234'
      });
      assert.strictEqual(periodEnd.mode, 'PERIOD_END');
      assert.strictEqual(periodEnd.reason, 'Requested by user via support ticket #1234');

      const immediate = AdminCancelSubscriptionSchema.parse({
        mode: 'IMMEDIATE'
      });
      assert.strictEqual(immediate.mode, 'IMMEDIATE');
      assert.strictEqual(immediate.reason, undefined);

      assert.throws(() => {
        AdminCancelSubscriptionSchema.parse({ mode: 'INVALID_MODE' });
      });
    });

    test('should validate admin refund execution schema (Phase 9.3)', () => {
      const fullRefund = AdminExecuteRefundSchema.parse({
        reason: 'ADMIN_APPROVED_EXCEPTION',
        reasonDetails: 'Goodwill refund for user support escalation',
        idempotencyKey: 'idem_refund_test_12345'
      });
      assert.strictEqual(fullRefund.reason, 'ADMIN_APPROVED_EXCEPTION');
      assert.strictEqual(fullRefund.reasonDetails, 'Goodwill refund for user support escalation');
      assert.strictEqual(fullRefund.idempotencyKey, 'idem_refund_test_12345');
      assert.strictEqual(fullRefund.amountMinorUnits, undefined);

      const partialRefund = AdminExecuteRefundSchema.parse({
        amountMinorUnits: 50000,
        reason: 'DUPLICATE_PAYMENT',
        terminateSubscription: false
      });
      assert.strictEqual(partialRefund.amountMinorUnits, 50000);
      assert.strictEqual(partialRefund.reason, 'DUPLICATE_PAYMENT');
      assert.strictEqual(partialRefund.terminateSubscription, false);

      assert.throws(() => {
        AdminExecuteRefundSchema.parse({ amountMinorUnits: -100 });
      });
      assert.throws(() => {
        AdminExecuteRefundSchema.parse({ amountMinorUnits: 0 });
      });
    });
  });

  describe('Safe Projections & DTO Invariants', () => {
    test('should enforce that AdminBillingService is defined and exposes core methods', () => {
      assert.strictEqual(typeof AdminBillingService.getBillingOverview, 'function');
      assert.strictEqual(typeof AdminBillingService.listSubscriptions, 'function');
      assert.strictEqual(typeof AdminBillingService.getSubscriptionDetail, 'function');
      assert.strictEqual(typeof AdminBillingService.getSubscriptionDunningState, 'function');
      assert.strictEqual(typeof AdminBillingService.cancelSubscription, 'function');
      assert.strictEqual(typeof AdminBillingService.inspectProviderSubscription, 'function');
      assert.strictEqual(typeof AdminBillingService.listPayments, 'function');
      assert.strictEqual(typeof AdminBillingService.getPaymentDetail, 'function');
      assert.strictEqual(typeof AdminBillingService.inspectProviderPayment, 'function');
      assert.strictEqual(typeof AdminBillingService.executePaymentRefund, 'function');
      assert.strictEqual(typeof AdminBillingService.listRefunds, 'function');
      assert.strictEqual(typeof AdminBillingService.getRefundDetail, 'function');
      assert.strictEqual(typeof AdminBillingService.inspectProviderRefund, 'function');
      assert.strictEqual(typeof AdminBillingService.listReconciliationRuns, 'function');
      assert.strictEqual(typeof AdminBillingService.listDiscrepancies, 'function');
      assert.strictEqual(typeof AdminBillingService.listPlans, 'function');
    });
  });
});
