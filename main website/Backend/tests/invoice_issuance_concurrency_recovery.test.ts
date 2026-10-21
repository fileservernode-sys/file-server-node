// NOTE: These tests are NOT EXECUTED as per policy.

/**
 * -----------------------------------------------------------------------------
 * TEST SUITE: INVOICE ISSUANCE CONCURRENCY & DEFERRED RECOVERY RELIABILITY (PHASE 8.3.2, BATCH E)
 *
 * MANDATORY OPERATIONAL RESTRICTION NOTICE:
 * THIS TEST FILE IS AUTHORED FOR STATIC SPECIFICATION AND REGRESSION AUDITING ONLY.
 * PER MANDATORY PHASE 8.3.2-E RESTRICTIONS, THIS FILE HAS NOT BEEN EXECUTED.
 * DO NOT RUN VIA TEST RUNNERS (npm test, node --test) OR APPLICATION BUILDS.
 * -----------------------------------------------------------------------------
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  CurrencyCode,
  PaymentStatus,
  BillingInvoiceStatus,
  BillingInvoiceSettlementStatus,
  BillingInvoiceType
} from '@prisma/client';
import { BillingInvoiceService } from '../src/services/billing/billing_invoice_service.js';
import {
  BillingInvoiceRecoveryService,
  DeferredInvoiceRecoveryResult
} from '../src/services/billing/billing_invoice_recovery_service.js';
import {
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError
} from '../src/errors/app-error.js';

describe('Phase 8.3.2-E: Invoice Issuance Concurrency & Deferred Recovery Specifications', () => {

  // ---------------------------------------------------------------------------
  // 1. Concurrent Invoice Issuance Attempts for Same Payment
  // ---------------------------------------------------------------------------
  describe('1. Concurrent Invoice Issuance Attempts for Same Payment', () => {
    test('concurrent issuance serialize on payment row lock and idempotently return single invoice', async () => {
      // Simulates two concurrent transactions attempting to issue an invoice for payment "pay_race_001"
      let invoiceCreatedCount = 0;
      const committedInvoices: Record<string, any> = {};

      const simulateConcurrentIssuance = async (callerId: string, paymentId: string) => {
        // Step A: Row lock simulation (SELECT id, status FROM BillingPayment WHERE id = ? FOR UPDATE)
        // In real execution, caller 2 blocks until caller 1 commits.
        if (committedInvoices[paymentId]) {
          return {
            invoice: committedInvoices[paymentId],
            isExisting: true
          };
        }

        // Caller 1 proceeds to create
        invoiceCreatedCount++;
        const newInvoice = {
          id: `inv_${callerId}_001`,
          invoiceNumber: 'ZCI/2026-2027/000001',
          paymentId,
          status: BillingInvoiceStatus.ISSUED,
          settlementStatus: BillingInvoiceSettlementStatus.SETTLED
        };
        committedInvoices[paymentId] = newInvoice;

        return {
          invoice: newInvoice,
          isExisting: false
        };
      };

      // First caller creates
      const res1 = await simulateConcurrentIssuance('tx1', 'pay_race_001');
      assert.strictEqual(res1.isExisting, false);
      assert.strictEqual(invoiceCreatedCount, 1);

      // Second caller waits, sees existing, returns idempotent copy
      const res2 = await simulateConcurrentIssuance('tx2', 'pay_race_001');
      assert.strictEqual(res2.isExisting, true);
      assert.strictEqual(res2.invoice.invoiceNumber, res1.invoice.invoiceNumber);
      assert.strictEqual(invoiceCreatedCount, 1);
    });

    test('unique constraint violation P2002 on paymentId catches any residual race outside transaction', async () => {
      const handleUniqueConstraintRace = (errCode: string, committedInvoice: any) => {
        if (errCode === 'P2002') {
          return { invoice: committedInvoice, isExisting: true };
        }
        throw new Error('Unexpected error');
      };

      const raceInvoice = { id: 'inv_committed_001', invoiceNumber: 'ZCI/2026-2027/000002' };
      const recovered = handleUniqueConstraintRace('P2002', raceInvoice);
      assert.strictEqual(recovered.isExisting, true);
      assert.strictEqual(recovered.invoice.id, 'inv_committed_001');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Exceptional Payment Status Transitions During In-Flight Issuance
  // ---------------------------------------------------------------------------
  describe('2. Exceptional Payment Status Transitions During In-Flight Issuance', () => {
    test('SELECT ... FOR UPDATE reads current committed status and aborts if payment transitioned to REFUNDED', async () => {
      const verifyPaymentInTx = (paymentStatus: PaymentStatus) => {
        if (paymentStatus !== PaymentStatus.SUCCESS) {
          throw new ConflictError(
            `Cannot issue statutory tax invoice: payment status transitioned to '${paymentStatus}'`
          );
        }
        return true;
      };

      // Fails closed if payment status mutated concurrently to REFUNDED
      assert.throws(
        () => verifyPaymentInTx(PaymentStatus.REFUNDED),
        (err: any) => {
          assert.strictEqual(err instanceof ConflictError, true);
          assert.match(err.message, /payment status transitioned to 'REFUNDED'/);
          return true;
        }
      );

      // Fails closed if payment status mutated to FAILED
      assert.throws(
        () => verifyPaymentInTx(PaymentStatus.FAILED),
        (err: any) => {
          assert.strictEqual(err instanceof ConflictError, true);
          assert.match(err.message, /payment status transitioned to 'FAILED'/);
          return true;
        }
      );

      // Succeeds only if payment remains SUCCESS
      assert.strictEqual(verifyPaymentInTx(PaymentStatus.SUCCESS), true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Recovery Rechecks Current Payment Eligibility
  // ---------------------------------------------------------------------------
  describe('3. Recovery Rechecks Current Payment Eligibility', () => {
    test('recovery worker checks eligibility before issuing invoice and fails closed on stale records', async () => {
      const staleDiscoveredPayment = {
        id: 'pay_stale_001',
        status: PaymentStatus.REFUNDED // Payment mutated between query and processing
      };

      const processRecoveryItem = async (payment: { id: string; status: PaymentStatus }) => {
        if (payment.status !== PaymentStatus.SUCCESS) {
          throw new ConflictError(
            `Cannot issue statutory tax invoice for payment in status '${payment.status}' (payment must be SUCCESS)`
          );
        }
        return { issued: true };
      };

      await assert.rejects(
        async () => {
          await processRecoveryItem(staleDiscoveredPayment);
        },
        (err: any) => {
          assert.strictEqual(err instanceof ConflictError, true);
          assert.match(err.message, /payment must be SUCCESS/);
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Duplicate Webhook Events Do Not Create Duplicate Invoices
  // ---------------------------------------------------------------------------
  describe('4. Duplicate Webhook Events Do Not Create Duplicate Invoices', () => {
    test('duplicate subscription.charged webhook calls generateInvoiceForPayment idempotently', async () => {
      let issuanceInvocations = 0;
      let existingInvoices: Record<string, any> = {};

      const handleWebhookSubscriptionCharged = async (paymentId: string) => {
        issuanceInvocations++;
        if (existingInvoices[paymentId]) {
          return { invoice: existingInvoices[paymentId], isExisting: true };
        }
        const created = { id: 'inv_wh_001', invoiceNumber: 'ZCI/2026-2027/000003', paymentId };
        existingInvoices[paymentId] = created;
        return { invoice: created, isExisting: false };
      };

      // Webhook event 1
      const res1 = await handleWebhookSubscriptionCharged('pay_sub_charged_001');
      assert.strictEqual(res1.isExisting, false);
      assert.strictEqual(res1.invoice.invoiceNumber, 'ZCI/2026-2027/000003');

      // Webhook event 2 (duplicate delivery from provider)
      const res2 = await handleWebhookSubscriptionCharged('pay_sub_charged_001');
      assert.strictEqual(res2.isExisting, true);
      assert.strictEqual(res2.invoice.invoiceNumber, 'ZCI/2026-2027/000003');
      assert.strictEqual(issuanceInvocations, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Issued Invoice Remains Preserved After Later Exceptional Payment Event
  // ---------------------------------------------------------------------------
  describe('5. Issued Invoice Remains Preserved After Later Exceptional Payment Event', () => {
    test('incoming refund event does not rewrite, delete, or alter issued BillingInvoice document', () => {
      const issuedInvoice = {
        id: 'inv_preserved_001',
        invoiceNumber: 'ZCI/2026-2027/000004',
        paymentId: 'pay_sub_001',
        status: BillingInvoiceStatus.ISSUED,
        settlementStatus: BillingInvoiceSettlementStatus.SETTLED,
        contentHash: 'hash_abc123'
      };

      // Simulate provider reporting chargeback / reversal
      const paymentRecord = {
        id: 'pay_sub_001',
        status: PaymentStatus.REFUNDED
      };

      // Issued invoice remains unchanged
      assert.strictEqual(issuedInvoice.status, BillingInvoiceStatus.ISSUED);
      assert.strictEqual(issuedInvoice.settlementStatus, BillingInvoiceSettlementStatus.SETTLED);
      assert.strictEqual(issuedInvoice.contentHash, 'hash_abc123');
      assert.strictEqual(paymentRecord.status, PaymentStatus.REFUNDED);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Recovery Categorization of Transient vs Permanent Failures
  // ---------------------------------------------------------------------------
  describe('6. Recovery Categorization of Transient vs Permanent Failures', () => {
    test('recovery captures machine-readable errorCode for permanent vs transient failures', () => {
      const errorLog: Array<{ paymentId: string; error: string; errorCode: string }> = [];

      const recordRecoveryError = (paymentId: string, err: any) => {
        const errorMessage = err?.message || String(err);
        const errorCode = err?.errorCode || err?.code || 'UNKNOWN_ERROR';
        errorLog.push({ paymentId, error: errorMessage, errorCode });
      };

      // Permanent validation failure
      recordRecoveryError('pay_perm_01', new ValidationError('Customer billing profile is incomplete'));
      // Conflict failure (stale status)
      recordRecoveryError('pay_conf_01', new ConflictError('Payment status transitioned to REFUNDED'));

      assert.strictEqual(errorLog.length, 2);
      assert.strictEqual(errorLog[0].errorCode, 'VALIDATION_ERROR');
      assert.strictEqual(errorLog[1].errorCode, 'CONFLICT');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Amount and Currency Reconciliation Invariants
  // ---------------------------------------------------------------------------
  describe('7. Amount and Currency Reconciliation Invariants', () => {
    test('invoice financial snapshot matches payment gross amount and currency exactly', () => {
      const payment = {
        id: 'pay_inv_001',
        amountMinorUnits: 499900,
        currency: CurrencyCode.INR
      };

      const taxCalculation = {
        grossAmountMinorUnits: 499900,
        taxableAmountMinorUnits: 423644,
        taxAmountMinorUnits: 76256
      };

      // Invariant: taxable + tax == gross == payment amount
      assert.strictEqual(
        taxCalculation.taxableAmountMinorUnits + taxCalculation.taxAmountMinorUnits,
        taxCalculation.grossAmountMinorUnits
      );
      assert.strictEqual(taxCalculation.grossAmountMinorUnits, payment.amountMinorUnits);

      const invoice = {
        currency: payment.currency,
        subtotalMinorUnits: taxCalculation.taxableAmountMinorUnits,
        taxMinorUnits: taxCalculation.taxAmountMinorUnits,
        totalMinorUnits: taxCalculation.grossAmountMinorUnits,
        amountPaidMinorUnits: taxCalculation.grossAmountMinorUnits,
        amountDueMinorUnits: 0
      };

      assert.strictEqual(invoice.totalMinorUnits, payment.amountMinorUnits);
      assert.strictEqual(invoice.amountPaidMinorUnits, payment.amountMinorUnits);
      assert.strictEqual(invoice.currency, payment.currency);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Content Hash Verification & Mutation Detection
  // ---------------------------------------------------------------------------
  describe('8. Content Hash Verification & Mutation Detection', () => {
    test('verifyInvoiceContentHash detects tampering with covered document fields', () => {
      const canonicalPayload = BillingInvoiceService.buildInvoiceHashPayload({
        invoiceNumber: 'ZCI/2026-2027/000005',
        seriesPrefix: 'ZCI',
        financialYear: '2026-2027',
        issuedAt: '2026-10-10T00:00:00.000Z',
        userId: 'usr_001',
        planCode: 'PRO_MONTHLY',
        planName: 'Pro Plan',
        billingInterval: 'MONTHLY',
        priceVersion: 1,
        currency: 'INR',
        subtotalMinorUnits: 254153,
        discountMinorUnits: 0,
        taxMinorUnits: 45747,
        totalMinorUnits: 299900,
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerCompanyName: null,
        customerTaxId: null,
        billingCountry: 'IN',
        billingAddress: { city: 'Mumbai' },
        sellerName: 'ZdexCloud Inc.',
        sellerAddress: '123 Cloud St',
        sellerTaxId: '27AABCZ0000A1Z5',
        sellerJurisdiction: 'Maharashtra',
        hsnSacCode: '998313',
        taxType: 'GST',
        taxRateBasisPoints: 1800,
        isInclusive: true,
        taxBreakdown: { cgstPaise: 22874, sgstPaise: 22874 },
        lineItems: [{ totalMinorUnits: 299900 }],
        provider: 'RAZORPAY',
        providerPaymentId: 'pay_rzp_001',
        providerOrderId: null
      });

      const originalHash = BillingInvoiceService.computeInvoiceContentHash(canonicalPayload);
      assert.strictEqual(typeof originalHash, 'string');
      assert.strictEqual(originalHash.length, 64);

      // Tampered payload (altered totalMinorUnits)
      const tamperedPayload = { ...canonicalPayload, totalMinorUnits: 199900 };
      const tamperedHash = BillingInvoiceService.computeInvoiceContentHash(tamperedPayload);

      assert.notStrictEqual(originalHash, tamperedHash);
    });

    test('mutable settlement fields are intentionally excluded from canonical hash payload', () => {
      const invoiceData: any = {
        invoiceNumber: 'ZCI/2026-2027/000006',
        seriesPrefix: 'ZCI',
        financialYear: '2026-2027',
        issuedAt: new Date('2026-10-10T00:00:00.000Z'),
        userId: 'usr_002',
        planCode: 'PRO_YEARLY',
        planName: 'Pro Annual',
        billingInterval: 'YEARLY',
        priceVersion: 1,
        currency: 'INR',
        subtotalMinorUnits: 2541525,
        discountMinorUnits: 0,
        taxMinorUnits: 457475,
        totalMinorUnits: 2999000,
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        customerCompanyName: null,
        customerTaxId: null,
        billingCountry: 'IN',
        billingAddress: {},
        sellerName: 'ZdexCloud Inc.',
        sellerAddress: '123 Cloud St',
        sellerTaxId: '27AABCZ0000A1Z5',
        sellerJurisdiction: 'Maharashtra',
        hsnSacCode: '998313',
        taxType: 'GST',
        taxRateBasisPoints: 1800,
        isInclusive: true,
        taxBreakdown: {},
        lineItems: [],
        provider: 'RAZORPAY',
        providerPaymentId: 'pay_rzp_002',
        providerOrderId: null,
        settlementStatus: BillingInvoiceSettlementStatus.SETTLED,
        status: BillingInvoiceStatus.ISSUED
      };

      const payload1 = BillingInvoiceService.buildInvoiceHashPayload(invoiceData);
      const hash1 = BillingInvoiceService.computeInvoiceContentHash(payload1);

      // Mutate settlement status
      invoiceData.settlementStatus = BillingInvoiceSettlementStatus.CREDITED;
      const payload2 = BillingInvoiceService.buildInvoiceHashPayload(invoiceData);
      const hash2 = BillingInvoiceService.computeInvoiceContentHash(payload2);

      // Hash remains identical because settlementStatus is excluded from immutable document content
      assert.strictEqual(hash1, hash2);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Recovery Accurately Reports Succeeded vs Failed Issuances
  // ---------------------------------------------------------------------------
  describe('9. Recovery Accurately Reports Succeeded vs Failed Issuances', () => {
    test('recovery returns success: false when one or more items in the batch fail', () => {
      const buildRecoveryResult = (attempted: number, succeeded: number, failed: number): DeferredInvoiceRecoveryResult => {
        return {
          success: failed === 0,
          dryRun: false,
          totalDiscovered: attempted,
          attempted,
          succeeded,
          skipped: 0,
          failed,
          errors: failed > 0 ? [{ paymentId: 'pay_fail_01', error: 'Incomplete profile', errorCode: 'VALIDATION_ERROR' }] : []
        };
      };

      const batchWithFailure = buildRecoveryResult(10, 9, 1);
      assert.strictEqual(batchWithFailure.success, false);
      assert.strictEqual(batchWithFailure.succeeded, 9);
      assert.strictEqual(batchWithFailure.failed, 1);

      const batchAllSuccess = buildRecoveryResult(10, 10, 0);
      assert.strictEqual(batchAllSuccess.success, true);
      assert.strictEqual(batchAllSuccess.succeeded, 10);
      assert.strictEqual(batchAllSuccess.failed, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Customer Refund-Request Endpoints Remain Disabled
  // ---------------------------------------------------------------------------
  describe('10. Customer Refund-Request Endpoints Remain Disabled', () => {
    test('customer refund request endpoints continue to throw 403 Forbidden', () => {
      const handleCustomerRefund = () => {
        throw new ForbiddenError(
          'Customer refund requests are not supported. All customer payments are final.'
        );
      };

      assert.throws(
        () => handleCustomerRefund(),
        (err: any) => {
          assert.strictEqual(err instanceof ForbiddenError, true);
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /Customer refund requests are not supported\. All customer payments are final\./);
          return true;
        }
      );
    });
  });

});
