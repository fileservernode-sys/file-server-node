import assert from 'node:assert';
import { test, describe } from 'node:test';
import { AdminBillingService } from '../src/routes/admin/operations/billing/service.js';
import {
  AdminSubscriptionListQuerySchema,
  AdminPaymentListQuerySchema,
  AdminRefundListQuerySchema,
  AdminReconciliationRunListQuerySchema,
  AdminDiscrepancyListQuerySchema,
  AdminPlanListQuerySchema
} from '../src/routes/admin/operations/billing/schemas.js';

describe('Admin Billing Operations Baseline (Phase 9.1 Deferred Tests)', () => {
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
  });

  describe('Safe Projections & DTO Invariants', () => {
    test('should enforce that AdminBillingService is defined and exposes core methods', () => {
      assert.strictEqual(typeof AdminBillingService.getBillingOverview, 'function');
      assert.strictEqual(typeof AdminBillingService.listSubscriptions, 'function');
      assert.strictEqual(typeof AdminBillingService.getSubscriptionDetail, 'function');
      assert.strictEqual(typeof AdminBillingService.listPayments, 'function');
      assert.strictEqual(typeof AdminBillingService.getPaymentDetail, 'function');
      assert.strictEqual(typeof AdminBillingService.listRefunds, 'function');
      assert.strictEqual(typeof AdminBillingService.getRefundDetail, 'function');
      assert.strictEqual(typeof AdminBillingService.listReconciliationRuns, 'function');
      assert.strictEqual(typeof AdminBillingService.listDiscrepancies, 'function');
      assert.strictEqual(typeof AdminBillingService.listPlans, 'function');
    });
  });
});
