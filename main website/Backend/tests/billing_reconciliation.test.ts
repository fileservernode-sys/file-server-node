import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/database.js';
import {
  BillingReconciliationService,
  billingReconciliationService
} from '../src/services/billing/billing_reconciliation_service.js';
import {
  RazorpayReconciliationAdapter,
  NormalizedReconRecord,
  NormalizedSettlementData
} from '../src/services/billing/providers/razorpay/razorpay_reconciliation_adapter.js';
import { ProcessingFeeService } from '../src/services/billing/processing_fee_service.js';
import { BillingReceiptService } from '../src/services/billing/billing_receipt_service.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  ProcessingFeeStatus,
  ProcessingFeeSource,
  BillingStatus,
  BillingInterval,
  RefundStatus,
  RefundReason,
  ReconciliationStatus,
  ReconciliationDiscrepancyType,
  ReconciliationRunStatus,
  ReconciliationEntityType,
  AuditEventType
} from '@prisma/client';

describe('Billing Phase 6.6 — Authoritative Gateway Reconciliation Layer', () => {
  let testUser: any;
  let testPlan: any;
  let testPrice: any;
  let testSub: any;
  let testPayment: any;
  let testRefund: any;
  let testReceipt: any;

  before(async () => {
    const timestamp = Date.now();
    // 1. Create test user
    testUser = await prisma.user.create({
      data: {
        email: `recon_test_${timestamp}@example.com`,
        passwordHash: 'hashed_pw_recon',
        fullName: 'Reconciliation Tester',
        billingState: {
          create: {
            status: BillingStatus.ACTIVE,
            billingCountry: 'IN',
            currency: CurrencyCode.INR
          }
        }
      }
    });

    // 2. Create test plan & price
    testPlan = await prisma.plan.create({
      data: {
        code: `RECON_PRO_${timestamp}`,
        name: 'Recon Pro Plan',
        interval: BillingInterval.MONTHLY
      }
    });

    testPrice = await prisma.planPrice.create({
      data: {
        planId: testPlan.id,
        currency: CurrencyCode.INR,
        amountMinorUnits: 49900,
        version: 1
      }
    });

    // 3. Create active subscription
    testSub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: testPlan.id,
        planPriceId: testPrice.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: `sub_recon_${timestamp}`,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 49900,
        currentPeriodStart: new Date(Date.now() - 86400000),
        currentPeriodEnd: new Date(Date.now() + 2592000000)
      }
    });

    // 4. Create successful internal payment
    testPayment = await prisma.billingPayment.create({
      data: {
        userId: testUser.id,
        subscriptionId: testSub.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_recon_${timestamp}`,
        providerSubscriptionId: testSub.providerSubscriptionId,
        amountMinorUnits: 49900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date(Date.now() - 3600000)
      }
    });

    // 5. Create processing fee record (pending)
    await ProcessingFeeService.recordProcessingFee({
      paymentId: testPayment.id,
      providerPaymentId: testPayment.providerPaymentId,
      feeAmountMinorUnits: 998,
      feeTaxMinorUnits: 180,
      feeCurrency: CurrencyCode.INR,
      status: ProcessingFeeStatus.PENDING,
      source: ProcessingFeeSource.ESTIMATED
    });

    // 6. Create billing receipt
    testReceipt = await prisma.billingReceipt.create({
      data: {
        receiptNumber: `REC-RECON-${timestamp}`,
        userId: testUser.id,
        subscriptionId: testSub.id,
        paymentId: testPayment.id,
        type: 'SUBSCRIPTION_PURCHASE',
        status: 'ISSUED',
        planCode: testPlan.code,
        planName: testPlan.name,
        billingInterval: 'MONTHLY',
        priceVersion: 1,
        currency: CurrencyCode.INR,
        subtotalMinorUnits: 42288,
        taxMinorUnits: 7612,
        totalMinorUnits: 49900,
        amountPaidMinorUnits: 49900,
        customerEmail: testUser.email
      }
    });

    // 7. Create internal processed refund
    testRefund = await prisma.billingRefund.create({
      data: {
        userId: testUser.id,
        subscriptionId: testSub.id,
        paymentId: testPayment.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerPaymentId: testPayment.providerPaymentId,
        providerRefundId: `rfnd_recon_${timestamp}`,
        amountMinorUnits: 49900,
        currency: CurrencyCode.INR,
        reason: RefundReason.ADMIN_APPROVED_EXCEPTION,
        status: RefundStatus.PROCESSED,
        idempotencyKey: `idemp_recon_${timestamp}`,
        requestedBy: 'admin@zdexcloud.com',
        requestedAt: new Date(Date.now() - 1800000)
      }
    });
  });

  after(async () => {
    try {
      // Clean up test records in FK order
      await prisma.billingReconciliationDiscrepancy.deleteMany({
        where: { providerEntityId: { contains: 'recon_' } }
      });
      await prisma.billingReconciliationRecord.deleteMany({
        where: { providerEntityId: { contains: 'recon_' } }
      });
      await prisma.billingReconciliationRun.deleteMany({
        where: { correlationId: { contains: 'test_run_' } }
      });
      await prisma.billingSettlement.deleteMany({
        where: { providerSettlementId: { contains: 'setl_recon_' } }
      });
      if (testReceipt) {
        await prisma.billingReceipt.deleteMany({ where: { id: testReceipt.id } });
      }
      if (testRefund) {
        await prisma.billingRefund.deleteMany({ where: { id: testRefund.id } });
      }
      if (testPayment) {
        await prisma.billingPaymentProcessingFee.deleteMany({ where: { paymentId: testPayment.id } });
        await prisma.billingPaymentTax.deleteMany({ where: { paymentId: testPayment.id } });
        await prisma.billingPayment.deleteMany({ where: { id: testPayment.id } });
      }
      if (testSub) {
        await prisma.subscription.deleteMany({ where: { id: testSub.id } });
      }
      if (testPrice) {
        await prisma.planPrice.deleteMany({ where: { id: testPrice.id } });
      }
      if (testPlan) {
        await prisma.plan.deleteMany({ where: { id: testPlan.id } });
      }
      if (testUser) {
        await prisma.accountBillingState.deleteMany({ where: { userId: testUser.id } });
        await prisma.user.deleteMany({ where: { id: testUser.id } });
      }
    } catch {
      // Cleanup best effort
    }
  });

  // T1: Matched Single Payment Reconciliation
  it('T1: Reconciles a matched payment record accurately', async () => {
    const reconItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: testPayment.providerPaymentId,
      providerPaymentId: testPayment.providerPaymentId,
      providerSettlementId: 'setl_recon_001',
      settlementUtr: 'UTR123456789',
      amountMinorUnits: 49900,
      currency: CurrencyCode.INR,
      providerFeeMinorUnits: 998,
      providerFeeTaxMinorUnits: 180,
      settled: true,
      settledAt: new Date(),
      orderId: 'order_recon_001',
      rawPayload: { id: testPayment.providerPaymentId, amount: 49900, fee: 1178, tax: 180 }
    };

    const result = await billingReconciliationService.reconcilePaymentRecord(null, reconItem);
    assert.strictEqual(result.isDuplicate, false);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.MATCHED);
    assert.strictEqual(result.reconRecord.internalPaymentId, testPayment.id);
    assert.strictEqual(result.discrepancies.length, 0);
  });

  // T2: Matched Single Refund Reconciliation
  it('T2: Reconciles a matched refund record accurately', async () => {
    const reconItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.REFUND,
      providerEntityId: testRefund.providerRefundId,
      providerRefundId: testRefund.providerRefundId,
      providerPaymentId: testPayment.providerPaymentId,
      providerSettlementId: 'setl_recon_001',
      amountMinorUnits: 49900,
      currency: CurrencyCode.INR,
      settled: true,
      settledAt: new Date(),
      rawPayload: { id: testRefund.providerRefundId, amount: 49900 }
    };

    const result = await billingReconciliationService.reconcileRefundRecord(null, reconItem);
    assert.strictEqual(result.isDuplicate, false);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.MATCHED);
    assert.strictEqual(result.reconRecord.internalRefundId, testRefund.id);
    assert.strictEqual(result.discrepancies.length, 0);
  });

  // T3: Matched Processing Fee Status Transition (PENDING -> RECONCILED)
  it('T3: Transitions processing fee from PENDING to RECONCILED upon match', async () => {
    const updatedFee = await prisma.billingPaymentProcessingFee.findUnique({
      where: { paymentId: testPayment.id }
    });
    assert.ok(updatedFee);
    assert.strictEqual(updatedFee.status, ProcessingFeeStatus.RECONCILED);
    assert.strictEqual(updatedFee.providerSettlementId, 'setl_recon_001');
    assert.ok(updatedFee.reconciledAt);
  });

  // T4: Matched Settlement Record Creation & Linking
  it('T4: Records and reconciles authoritative settlement payout', async () => {
    const settlementData: NormalizedSettlementData = {
      providerSettlementId: 'setl_recon_001',
      settlementUtr: 'UTR123456789',
      settlementCurrency: CurrencyCode.INR,
      settlementAmountMinorUnits: 48722, // 49900 - 1178
      providerFeesMinorUnits: 998,
      providerTaxMinorUnits: 180,
      settlementStatus: 'settled',
      settledAt: new Date(),
      rawPayload: { id: 'setl_recon_001', amount: 48722, fees: 998, tax: 180 }
    };

    const result = await billingReconciliationService.reconcileSettlementRecord(settlementData);
    assert.ok(result.settlement);
    assert.strictEqual(result.settlement.providerSettlementId, 'setl_recon_001');
    assert.strictEqual(result.settlement.reconciliationStatus, ReconciliationStatus.MATCHED);
    assert.strictEqual(result.discrepancies.length, 0);
  });

  // T5: Missing Internal Payment Record Detection
  it('T5: Detects missing internal payment record (INTERNAL_PAYMENT_NOT_FOUND)', async () => {
    const missingPaymentItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: 'pay_recon_ghost_999',
      amountMinorUnits: 29900,
      currency: CurrencyCode.INR,
      settled: true,
      rawPayload: { id: 'pay_recon_ghost_999', amount: 29900 }
    };

    const result = await billingReconciliationService.reconcilePaymentRecord(null, missingPaymentItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.REQUIRES_REVIEW);
    assert.strictEqual(result.discrepancies.length, 1);
    assert.strictEqual(
      result.discrepancies[0].discrepancyType,
      ReconciliationDiscrepancyType.INTERNAL_PAYMENT_NOT_FOUND
    );
  });

  // T6: Missing Provider Payment Record Detection
  it('T6: Detects internal payment missing in provider records (PROVIDER_PAYMENT_NOT_FOUND)', async () => {
    const ghostPayment = await prisma.billingPayment.create({
      data: {
        userId: testUser.id,
        subscriptionId: testSub.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_recon_missing_provider_${Date.now()}`,
        amountMinorUnits: 19900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });

    const runT6 = await billingReconciliationService.startReconciliationRun({
      periodStart: new Date(Date.now() - 3600000),
      periodEnd: new Date(Date.now() + 3600000),
      correlationId: `test_run_t6_${Date.now()}`
    });

    const discrepancies = await billingReconciliationService.reconcileMissingProviderPayments(
      runT6.id,
      new Date(Date.now() - 3600000),
      new Date(Date.now() + 3600000)
    );

    const found = discrepancies.find(
      (d: any) => d.providerEntityId === ghostPayment.providerPaymentId
    );
    assert.ok(found);
    assert.strictEqual(
      found.discrepancyType,
      ReconciliationDiscrepancyType.PROVIDER_PAYMENT_NOT_FOUND
    );

    await prisma.billingPayment.delete({ where: { id: ghostPayment.id } });
  });

  // T7: Missing Internal Refund Record Detection
  it('T7: Detects missing internal refund record (PROVIDER_REFUND_NOT_FOUND)', async () => {
    const missingRefundItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.REFUND,
      providerEntityId: 'rfnd_recon_ghost_888',
      amountMinorUnits: 15000,
      currency: CurrencyCode.INR,
      settled: true,
      rawPayload: { id: 'rfnd_recon_ghost_888', amount: 15000 }
    };

    const result = await billingReconciliationService.reconcileRefundRecord(null, missingRefundItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.REQUIRES_REVIEW);
    assert.strictEqual(result.discrepancies.length, 1);
    assert.strictEqual(
      result.discrepancies[0].discrepancyType,
      ReconciliationDiscrepancyType.PROVIDER_REFUND_NOT_FOUND
    );
  });

  // T8: Missing Provider Refund Record Detection
  it('T8: Detects internal refund missing in provider records', async () => {
    const ghostRefund = await prisma.billingRefund.create({
      data: {
        userId: testUser.id,
        subscriptionId: testSub.id,
        paymentId: testPayment.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerPaymentId: testPayment.providerPaymentId,
        providerRefundId: `rfnd_recon_missing_prov_${Date.now()}`,
        amountMinorUnits: 10000,
        currency: CurrencyCode.INR,
        reason: RefundReason.ADMIN_APPROVED_EXCEPTION,
        status: RefundStatus.PROCESSED,
        idempotencyKey: `idemp_missing_${Date.now()}`,
        requestedBy: 'admin@zdexcloud.com',
        requestedAt: new Date()
      }
    });

    const runT8 = await billingReconciliationService.startReconciliationRun({
      periodStart: new Date(Date.now() - 3600000),
      periodEnd: new Date(Date.now() + 3600000),
      correlationId: `test_run_t8_${Date.now()}`
    });

    const discrepancies = await billingReconciliationService.reconcileMissingProviderRefunds(
      runT8.id,
      new Date(Date.now() - 3600000),
      new Date(Date.now() + 3600000)
    );

    const found = discrepancies.find(
      (d: any) => d.providerEntityId === ghostRefund.providerRefundId
    );
    assert.ok(found);
    assert.strictEqual(
      found.discrepancyType,
      ReconciliationDiscrepancyType.PROVIDER_REFUND_NOT_FOUND
    );

    await prisma.billingRefund.delete({ where: { id: ghostRefund.id } });
  });

  // T9: Payment Amount Mismatch Detection
  it('T9: Detects payment amount mismatch between provider and internal record', async () => {
    const mismatchedItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: testPayment.providerPaymentId,
      amountMinorUnits: 99900, // Different from internal 49900
      currency: CurrencyCode.INR,
      settled: true,
      rawPayload: { id: testPayment.providerPaymentId, amount: 99900 }
    };

    const result = await billingReconciliationService.reconcilePaymentRecord(null, mismatchedItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.MISMATCHED);
    const disc = result.discrepancies.find(
      (d: any) => d.discrepancyType === ReconciliationDiscrepancyType.PAYMENT_AMOUNT_MISMATCH
    );
    assert.ok(disc);
    assert.strictEqual(disc.expectedValue, '49900');
    assert.strictEqual(disc.actualValue, '99900');
  });

  // T10: Payment Currency Mismatch Detection
  it('T10: Detects payment currency mismatch between provider and internal record', async () => {
    const mismatchedItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: testPayment.providerPaymentId,
      amountMinorUnits: 49900,
      currency: CurrencyCode.USD, // Different from internal INR
      settled: true,
      rawPayload: { id: testPayment.providerPaymentId, amount: 49900, currency: 'USD' }
    };

    const result = await billingReconciliationService.reconcilePaymentRecord(null, mismatchedItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.MISMATCHED);
    const disc = result.discrepancies.find(
      (d: any) => d.discrepancyType === ReconciliationDiscrepancyType.PAYMENT_CURRENCY_MISMATCH
    );
    assert.ok(disc);
    assert.strictEqual(disc.expectedValue, 'INR');
    assert.strictEqual(disc.actualValue, 'USD');
  });

  // T11: Refund Amount Mismatch Detection
  it('T11: Detects refund amount mismatch between provider and internal record', async () => {
    const mismatchedItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.REFUND,
      providerEntityId: testRefund.providerRefundId,
      amountMinorUnits: 25000, // Different from internal 49900
      currency: CurrencyCode.INR,
      settled: true,
      rawPayload: { id: testRefund.providerRefundId, amount: 25000 }
    };

    const result = await billingReconciliationService.reconcileRefundRecord(null, mismatchedItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.MISMATCHED);
    const disc = result.discrepancies.find(
      (d: any) => d.discrepancyType === ReconciliationDiscrepancyType.REFUND_AMOUNT_MISMATCH
    );
    assert.ok(disc);
    assert.strictEqual(disc.expectedValue, '49900');
    assert.strictEqual(disc.actualValue, '25000');
  });

  // T12: Refund Currency Mismatch Detection
  it('T12: Detects refund currency mismatch between provider and internal record', async () => {
    const mismatchedItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.REFUND,
      providerEntityId: testRefund.providerRefundId,
      amountMinorUnits: 49900,
      currency: CurrencyCode.USD, // Different from internal INR
      settled: true,
      rawPayload: { id: testRefund.providerRefundId, amount: 49900, currency: 'USD' }
    };

    const result = await billingReconciliationService.reconcileRefundRecord(null, mismatchedItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.MISMATCHED);
    const disc = result.discrepancies.find(
      (d: any) => d.discrepancyType === ReconciliationDiscrepancyType.REFUND_CURRENCY_MISMATCH
    );
    assert.ok(disc);
    assert.strictEqual(disc.expectedValue, 'INR');
    assert.strictEqual(disc.actualValue, 'USD');
  });

  // T13: Processing Fee Amount Mismatch Detection
  it('T13: Detects processing fee mismatch on payment reconciliation', async () => {
    const mismatchedFeeItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: testPayment.providerPaymentId,
      amountMinorUnits: 49900,
      currency: CurrencyCode.INR,
      providerFeeMinorUnits: 1500, // Different from internal 998
      providerFeeTaxMinorUnits: 180,
      settled: true,
      rawPayload: { id: testPayment.providerPaymentId, fee: 1680, tax: 180 }
    };

    const result = await billingReconciliationService.reconcilePaymentRecord(null, mismatchedFeeItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.MISMATCHED);
    const disc = result.discrepancies.find(
      (d: any) => d.discrepancyType === ReconciliationDiscrepancyType.PROCESSING_FEE_MISMATCH
    );
    assert.ok(disc);
    assert.strictEqual(disc.expectedValue, '998');
    assert.strictEqual(disc.actualValue, '1500');
  });

  // T14: Processing Fee Tax Mismatch Detection
  it('T14: Detects processing fee tax mismatch on payment reconciliation', async () => {
    const mismatchedFeeTaxItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: testPayment.providerPaymentId,
      amountMinorUnits: 49900,
      currency: CurrencyCode.INR,
      providerFeeMinorUnits: 998,
      providerFeeTaxMinorUnits: 250, // Different from internal 180
      settled: true,
      rawPayload: { id: testPayment.providerPaymentId, fee: 1248, tax: 250 }
    };

    const result = await billingReconciliationService.reconcilePaymentRecord(null, mismatchedFeeTaxItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.MISMATCHED);
    const disc = result.discrepancies.find(
      (d: any) => d.discrepancyType === ReconciliationDiscrepancyType.PROCESSING_FEE_TAX_MISMATCH
    );
    assert.ok(disc);
    assert.strictEqual(disc.expectedValue, '180');
    assert.strictEqual(disc.actualValue, '250');
  });

  // T15: Settlement Amount Mismatch Detection
  it('T15: Detects settlement amount mismatch against existing settlement', async () => {
    const mismatchedSettlement: NormalizedSettlementData = {
      providerSettlementId: 'setl_recon_001',
      settlementCurrency: CurrencyCode.INR,
      settlementAmountMinorUnits: 30000, // Different from initial 48722
      providerFeesMinorUnits: 998,
      providerTaxMinorUnits: 180,
      settlementStatus: 'settled',
      rawPayload: { id: 'setl_recon_001', amount: 30000 }
    };

    const result = await billingReconciliationService.reconcileSettlementRecord(mismatchedSettlement);
    assert.strictEqual(result.settlement.reconciliationStatus, ReconciliationStatus.MISMATCHED);
    const disc = result.discrepancies.find(
      (d: any) => d.discrepancyType === ReconciliationDiscrepancyType.SETTLEMENT_AMOUNT_MISMATCH
    );
    assert.ok(disc);
  });

  // T16: Settlement Currency Mismatch Detection
  it('T16: Detects settlement currency mismatch against existing settlement', async () => {
    const mismatchedSettlement: NormalizedSettlementData = {
      providerSettlementId: 'setl_recon_001',
      settlementCurrency: CurrencyCode.USD, // Different from INR
      settlementAmountMinorUnits: 48722,
      providerFeesMinorUnits: 998,
      providerTaxMinorUnits: 180,
      settlementStatus: 'settled',
      rawPayload: { id: 'setl_recon_001', amount: 48722, currency: 'USD' }
    };

    const result = await billingReconciliationService.reconcileSettlementRecord(mismatchedSettlement);
    assert.strictEqual(result.settlement.reconciliationStatus, ReconciliationStatus.MISMATCHED);
    const disc = result.discrepancies.find(
      (d: any) => d.discrepancyType === ReconciliationDiscrepancyType.SETTLEMENT_CURRENCY_MISMATCH
    );
    assert.ok(disc);
  });

  // T17: Provider Adjustment Handling
  it('T17: Handles provider adjustments and flags them for manual review', async () => {
    const adjustmentItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.ADJUSTMENT,
      providerEntityId: 'adj_recon_777',
      amountMinorUnits: 5000,
      currency: CurrencyCode.INR,
      debitMinorUnits: 5000,
      settled: true,
      rawPayload: { id: 'adj_recon_777', entity: 'adjustment', debit: 5000 }
    };

    const result = await billingReconciliationService.reconcileAdjustmentOrTransfer(null, adjustmentItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.REQUIRES_REVIEW);
    assert.strictEqual(result.discrepancies.length, 1);
    assert.strictEqual(
      result.discrepancies[0].discrepancyType,
      ReconciliationDiscrepancyType.PROVIDER_ADJUSTMENT_UNMATCHED
    );
  });

  // T18: Provider Transfer Handling
  it('T18: Handles provider transfers and flags them for manual review', async () => {
    const transferItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.TRANSFER,
      providerEntityId: 'trf_recon_666',
      amountMinorUnits: 12000,
      currency: CurrencyCode.INR,
      creditMinorUnits: 12000,
      settled: true,
      rawPayload: { id: 'trf_recon_666', entity: 'transfer', credit: 12000 }
    };

    const result = await billingReconciliationService.reconcileAdjustmentOrTransfer(null, transferItem);
    assert.strictEqual(result.reconRecord.status, ReconciliationStatus.REQUIRES_REVIEW);
    assert.strictEqual(result.discrepancies.length, 1);
    assert.strictEqual(
      result.discrepancies[0].discrepancyType,
      ReconciliationDiscrepancyType.PROVIDER_TRANSFER_UNMATCHED
    );
  });

  // T19: Duplicate Provider Record Detection
  it('T19: Detects duplicate provider records in the same reconciliation run', async () => {
    const run = await billingReconciliationService.startReconciliationRun({
      periodStart: new Date(Date.now() - 86400000),
      periodEnd: new Date()
    });

    const reconItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: `pay_recon_dup_${Date.now()}`,
      amountMinorUnits: 49900,
      currency: CurrencyCode.INR,
      settled: true,
      rawPayload: { amount: 49900 }
    };

    // First reconciliation
    const firstRes = await billingReconciliationService.reconcilePaymentRecord(run.id, reconItem);
    assert.strictEqual(firstRes.isDuplicate, false);

    // Duplicate call with same runId
    const dupRes = await billingReconciliationService.reconcilePaymentRecord(run.id, reconItem);
    assert.strictEqual(dupRes.isDuplicate, true);
    assert.strictEqual(
      dupRes.discrepancies[0].discrepancyType,
      ReconciliationDiscrepancyType.DUPLICATE_PROVIDER_RECORD
    );
  });

  // T20: Idempotent Re-run of Reconciliation Batch
  it('T20: Executes complete reconciliation batch idempotently without data corruption', async () => {
    const periodStart = new Date(Date.now() - 7200000);
    const periodEnd = new Date(Date.now() + 7200000);

    const providerRecords: NormalizedReconRecord[] = [
      {
        entityType: ReconciliationEntityType.PAYMENT,
        providerEntityId: testPayment.providerPaymentId,
        providerPaymentId: testPayment.providerPaymentId,
        amountMinorUnits: 49900,
        currency: CurrencyCode.INR,
        providerFeeMinorUnits: 998,
        providerFeeTaxMinorUnits: 180,
        settled: true,
        rawPayload: { id: testPayment.providerPaymentId, amount: 49900 }
      },
      {
        entityType: ReconciliationEntityType.REFUND,
        providerEntityId: testRefund.providerRefundId,
        providerRefundId: testRefund.providerRefundId,
        amountMinorUnits: 49900,
        currency: CurrencyCode.INR,
        settled: true,
        rawPayload: { id: testRefund.providerRefundId, amount: 49900 }
      }
    ];

    const run1 = await billingReconciliationService.executeReconciliationBatch({
      periodStart,
      periodEnd,
      providerRecords,
      correlationId: `test_run_idem_1_${Date.now()}`
    });

    assert.strictEqual(run1.status, ReconciliationRunStatus.COMPLETED);
    assert.ok(run1.matchedCount >= 2);

    const run2 = await billingReconciliationService.executeReconciliationBatch({
      periodStart,
      periodEnd,
      providerRecords,
      correlationId: `test_run_idem_2_${Date.now()}`
    });

    assert.strictEqual(run2.status, ReconciliationRunStatus.COMPLETED);
    assert.ok(run2.matchedCount >= 2);
  });

  // T21: Resolution of Identified Discrepancy
  it('T21: Resolves discrepancy with mandatory audit reason and admin identifier', async () => {
    const disc = await billingReconciliationService.recordDiscrepancy({
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: 'pay_recon_to_resolve',
      discrepancyType: ReconciliationDiscrepancyType.PAYMENT_AMOUNT_MISMATCH,
      expectedValue: '49900',
      actualValue: '50000'
    });

    assert.strictEqual(disc.status, ReconciliationStatus.REQUIRES_REVIEW);

    const resolved = await billingReconciliationService.resolveDiscrepancy({
      discrepancyId: disc.id,
      resolvedBy: 'finance-admin@zdexcloud.com',
      resolutionReason: 'Approved minor round-off currency conversion variance',
      resolutionAction: 'MANUAL_OVERRIDE_APPROVED'
    });

    assert.strictEqual(resolved.status, ReconciliationStatus.RESOLVED);
    assert.strictEqual(resolved.resolvedBy, 'finance-admin@zdexcloud.com');
    assert.strictEqual(
      resolved.resolutionReason,
      'Approved minor round-off currency conversion variance'
    );
    assert.ok(resolved.resolvedAt);
  });

  // T22: Pagination Handling Across Combined Recon Records
  it('T22: Normalizes and paginates combined recon records properly', async () => {
    const mockItems = Array.from({ length: 5 }, (_, i) => ({
      id: `pay_recon_page_${i}`,
      entity: 'payment',
      amount: 1000 * (i + 1),
      currency: 'INR',
      fee: 20 * (i + 1),
      tax: 3 * (i + 1)
    }));

    const mockClient = {
      fetchCombinedReconRecords: async (params: any) => {
        const skip = params.skip || 0;
        const count = params.count || 2;
        const page = mockItems.slice(skip, skip + count);
        return { entity: 'collection', count: mockItems.length, items: page };
      }
    } as any;

    const records = await RazorpayReconciliationAdapter.fetchAndPaginateReconRecords(mockClient, {
      pageSize: 2,
      maxItems: 10
    });

    assert.strictEqual(records.length, 5);
    assert.strictEqual(records[0].providerEntityId, 'pay_recon_page_0');
    assert.strictEqual(records[4].providerEntityId, 'pay_recon_page_4');
  });

  // T23: Pagination Handling Across Settlements
  it('T23: Normalizes and paginates settlements properly', async () => {
    const mockSettlements = Array.from({ length: 4 }, (_, i) => ({
      id: `setl_recon_page_${i}`,
      amount: 50000 * (i + 1),
      fees: 1000 * (i + 1),
      tax: 180 * (i + 1),
      currency: 'INR',
      status: 'settled'
    }));

    const mockClient = {
      fetchSettlements: async (params: any) => {
        const skip = params.skip || 0;
        const count = params.count || 2;
        const page = mockSettlements.slice(skip, skip + count);
        return { entity: 'collection', count: mockSettlements.length, items: page };
      }
    } as any;

    const settlements = await RazorpayReconciliationAdapter.fetchAndPaginateSettlements(mockClient, {
      pageSize: 2,
      maxItems: 10
    });

    assert.strictEqual(settlements.length, 4);
    assert.strictEqual(settlements[0].providerSettlementId, 'setl_recon_page_0');
    assert.strictEqual(settlements[3].providerSettlementId, 'setl_recon_page_3');
  });

  // T24: Webhook Convergence
  it('T24: Converges estimated webhook processing fee with reconciliation item', async () => {
    const feeBefore = await prisma.billingPaymentProcessingFee.findUnique({
      where: { paymentId: testPayment.id }
    });
    assert.ok(feeBefore);

    const reconItem: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: testPayment.providerPaymentId,
      providerSettlementId: 'setl_recon_converged_01',
      amountMinorUnits: 49900,
      currency: CurrencyCode.INR,
      providerFeeMinorUnits: 998,
      providerFeeTaxMinorUnits: 180,
      settled: true,
      rawPayload: { id: testPayment.providerPaymentId, fee: 1178, tax: 180 }
    };

    await billingReconciliationService.reconcilePaymentRecord(null, reconItem);

    const feeAfter = await prisma.billingPaymentProcessingFee.findUnique({
      where: { paymentId: testPayment.id }
    });
    assert.ok(feeAfter);
    assert.strictEqual(feeAfter.status, ProcessingFeeStatus.RECONCILED);
    assert.strictEqual(feeAfter.providerSettlementId, 'setl_recon_converged_01');
  });

  // T25: Multiple Payments & Refunds in Single Batch
  it('T25: Executes batch with multiple payments and refunds successfully', async () => {
    const p1: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.PAYMENT,
      providerEntityId: testPayment.providerPaymentId,
      amountMinorUnits: 49900,
      currency: CurrencyCode.INR,
      settled: true,
      rawPayload: { id: testPayment.providerPaymentId, amount: 49900 }
    };

    const r1: NormalizedReconRecord = {
      entityType: ReconciliationEntityType.REFUND,
      providerEntityId: testRefund.providerRefundId,
      amountMinorUnits: 49900,
      currency: CurrencyCode.INR,
      settled: true,
      rawPayload: { id: testRefund.providerRefundId, amount: 49900 }
    };

    const batchRun = await billingReconciliationService.executeReconciliationBatch({
      periodStart: new Date(Date.now() - 3600000),
      periodEnd: new Date(Date.now() + 3600000),
      providerRecords: [p1, r1],
      correlationId: `test_run_multi_${Date.now()}`
    });

    assert.strictEqual(batchRun.status, ReconciliationRunStatus.COMPLETED);
    assert.ok(batchRun.matchedCount >= 2);
  });

  // T26: Receipt Immutability Check
  it('T26: Guarantees customer BillingReceipt remains strictly immutable after reconciliation', async () => {
    const receiptAfter = await prisma.billingReceipt.findUnique({
      where: { id: testReceipt.id }
    });
    assert.ok(receiptAfter);
    assert.strictEqual(receiptAfter.totalMinorUnits, testReceipt.totalMinorUnits);
    assert.strictEqual(receiptAfter.amountPaidMinorUnits, testReceipt.amountPaidMinorUnits);
    assert.strictEqual(receiptAfter.receiptNumber, testReceipt.receiptNumber);
    assert.strictEqual(receiptAfter.documentVersion, testReceipt.documentVersion);
  });

  // T27: Customer Payment & Subscription Non-Mutation
  it('T27: Ensures customer payment and subscription state are NOT overwritten by reconciliation', async () => {
    const paymentAfter = await prisma.billingPayment.findUnique({
      where: { id: testPayment.id }
    });
    assert.ok(paymentAfter);
    assert.strictEqual(paymentAfter.amountMinorUnits, 49900);
    assert.strictEqual(paymentAfter.currency, CurrencyCode.INR);

    const subAfter = await prisma.subscription.findUnique({
      where: { id: testSub.id }
    });
    assert.ok(subAfter);
    assert.strictEqual(subAfter.status, BillingStatus.ACTIVE);
    assert.strictEqual(subAfter.amountMinorUnits, 49900);
  });

  // T28: Audit Log Generation Check
  it('T28: Records audit events for reconciliation operations', async () => {
    const auditLogs = await prisma.auditEvent.findMany({
      where: {
        eventType: {
          in: [
            AuditEventType.BILLING_RECONCILIATION_STARTED,
            AuditEventType.BILLING_RECONCILIATION_COMPLETED,
            AuditEventType.BILLING_SETTLEMENT_RECORDED,
            AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_DETECTED,
            AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_RESOLVED
          ]
        }
      },
      take: 10
    });

    assert.ok(auditLogs.length > 0);
  });

  // T29: Retrieval of Unresolved Discrepancies
  it('T29: Retrieves unresolved discrepancies requiring admin review', async () => {
    const unresolved = await billingReconciliationService.getUnresolvedDiscrepancies({ limit: 10 });
    assert.ok(Array.isArray(unresolved));
  });

  // T30: Reconciliation Run Summary Metrics
  it('T30: Fetches detailed summary metrics for a reconciliation run', async () => {
    const run = await billingReconciliationService.startReconciliationRun({
      periodStart: new Date(Date.now() - 3600000),
      periodEnd: new Date()
    });

    const summary = await billingReconciliationService.getReconciliationRunSummary(run.id);
    assert.strictEqual(summary.id, run.id);
    assert.ok(Array.isArray(summary.records));
    assert.ok(Array.isArray(summary.discrepancies));
  });
});
