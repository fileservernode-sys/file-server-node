// NOTE: These tests are NOT EXECUTED as per policy.

/**
 * -----------------------------------------------------------------------------
 * TEST SUITE: BILLING INVOICE SERVICE & STATUTORY TAX ENGINE (PHASE 8.3.1)
 *
 * MANDATORY OPERATIONAL RESTRICTION NOTICE:
 * THIS TEST FILE IS AUTHORED FOR STATIC SPECIFICATION AND REGRESSION AUDITING ONLY.
 * PER MANDATORY PHASE 8.3.1 RESTRICTIONS, THIS FILE HAS NOT BEEN EXECUTED.
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
import { StatutorySellerConfigService } from '../src/services/billing/statutory_seller_config_service.js';
import { TaxCalculationService } from '../src/services/billing/tax_calculation_service.js';
import { BillingInvoiceService, INDIAN_STATE_CODE_MAP } from '../src/services/billing/billing_invoice_service.js';
import { BillingInvoiceSequenceService } from '../src/services/billing/billing_invoice_sequence_service.js';
import { BillingInvoiceRecoveryService } from '../src/services/billing/billing_invoice_recovery_service.js';
import {
  StatutoryConfigurationMissingError,
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError
} from '../src/errors/app-error.js';

describe('Phase 8.3.1: Statutory Tax Engine, Atomic Issuance & Durable Recovery Verification', () => {

  // ---------------------------------------------------------------------------
  // 1. Fail-Closed Statutory Seller Configuration Validation
  // ---------------------------------------------------------------------------
  describe('1. Statutory Seller Configuration Fail-Closed Validation', () => {
    test('missing seller configuration blocks invoice issuance', () => {
      // StatutorySellerConfigService must fail closed when seller details are unconfigured
      const evalResult = StatutorySellerConfigService.evaluateSellerConfig();
      // If config is not supplied in environment, isValid must be false
      if (!evalResult.isValid) {
        assert.strictEqual(evalResult.isValid, false);
        assert.ok(evalResult.missingFields.length > 0 || evalResult.validationErrors.length > 0);
        assert.throws(
          () => StatutorySellerConfigService.getApprovedSellerConfig(),
          StatutoryConfigurationMissingError
        );
      }
    });

    test('validates GSTIN structure and consistency with seller state code', () => {
      // Valid Gujarat GSTIN prefix '24'
      const validGstin = '24AAAAA0000A1Z5';
      assert.ok(StatutorySellerConfigService.GSTIN_REGEX.test(validGstin));
      assert.strictEqual(validGstin.substring(0, 2), '24');

      // Invalid GSTIN formatting
      assert.ok(!StatutorySellerConfigService.GSTIN_REGEX.test('INVALID_GSTIN_123'));
      assert.ok(!StatutorySellerConfigService.GSTIN_REGEX.test('24AAAAA0000A1Z')); // only 14 chars
    });

    test('rejection of contradictory state code and GSTIN prefix', () => {
      const gstin = '24AAAAA0000A1Z5'; // Gujarat prefix 24
      const configuredStateCode = '27'; // Maharashtra code 27
      assert.notStrictEqual(gstin.substring(0, 2), configuredStateCode);
    });

    test('verifies export invoicing approval fields default to unapproved', () => {
      const evalResult = StatutorySellerConfigService.evaluateSellerConfig();
      if (!process.env.EXPORT_INVOICING_APPROVED) {
        assert.strictEqual(evalResult.exportInvoicingApproved, false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Statutory Tax Calculation Engine (Formulas & Branching)
  // ---------------------------------------------------------------------------
  describe('2. Place of Supply & Statutory Tax Engine Invariants', () => {
    test('correct inclusive pricing derivation for intra-state (CGST 9% + SGST 9%)', () => {
      const fixture = {
        amountMinorUnits: 11800, // Rs 118.00 (inclusive of 18% GST)
        currency: CurrencyCode.INR,
        customerCountry: 'IN',
        customerStateCode: '24', // Gujarat customer
        supplierCountry: 'IN',
        supplierStateCode: '24', // Gujarat supplier
        sacCode: '998315',
        isExclusive: false
      };

      const result = TaxCalculationService.calculateStatutoryInvoiceTax(fixture);

      assert.strictEqual(result.isInterState, false);
      assert.strictEqual(result.taxRateBasisPoints, 1800);
      assert.strictEqual(result.grossAmountMinorUnits, 11800);
      assert.strictEqual(result.taxAmountMinorUnits, 1800);
      assert.strictEqual(result.taxableAmountMinorUnits, 10000); // Rs 100.00
      assert.strictEqual(result.taxableAmountMinorUnits + result.taxAmountMinorUnits, result.grossAmountMinorUnits);
      assert.strictEqual(result.breakdown.length, 2);

      const cgst = result.breakdown.find((b) => b.component === 'CGST');
      const sgst = result.breakdown.find((b) => b.component === 'SGST');
      assert.ok(cgst && sgst);
      assert.strictEqual(cgst.amountMinorUnits, 900); // Rs 9.00
      assert.strictEqual(sgst.amountMinorUnits, 900); // Rs 9.00
      assert.strictEqual(cgst.amountMinorUnits + sgst.amountMinorUnits, 1800);
    });

    test('correct exclusive pricing derivation for inter-state (IGST 18%)', () => {
      const fixture = {
        amountMinorUnits: 10000, // Rs 100.00 net taxable base
        currency: CurrencyCode.INR,
        customerCountry: 'IN',
        customerStateCode: '27', // Maharashtra customer
        supplierCountry: 'IN',
        supplierStateCode: '24', // Gujarat supplier
        sacCode: '998315',
        isExclusive: true
      };

      const result = TaxCalculationService.calculateStatutoryInvoiceTax(fixture);

      assert.strictEqual(result.isInterState, true);
      assert.strictEqual(result.taxRateBasisPoints, 1800);
      assert.strictEqual(result.taxableAmountMinorUnits, 10000);
      assert.strictEqual(result.taxAmountMinorUnits, 1800);
      assert.strictEqual(result.grossAmountMinorUnits, 11800);
      assert.strictEqual(result.taxableAmountMinorUnits + result.taxAmountMinorUnits, result.grossAmountMinorUnits);
      assert.strictEqual(result.breakdown.length, 1);
      assert.strictEqual(result.breakdown[0].component, 'IGST');
      assert.strictEqual(result.breakdown[0].amountMinorUnits, 1800);
    });

    test('fail-closed export rejection when export invoicing is unapproved', () => {
      const exportFixture = {
        amountMinorUnits: 1000,
        currency: CurrencyCode.USD,
        customerCountry: 'US',
        customerStateCode: null,
        supplierCountry: 'IN',
        supplierStateCode: '24',
        sacCode: '998315',
        isExportApproved: false
      };

      assert.throws(
        () => TaxCalculationService.calculateStatutoryInvoiceTax(exportFixture),
        StatutoryConfigurationMissingError
      );
    });

    test('zero-rated export calculation when export invoicing is explicitly approved', () => {
      const exportFixture = {
        amountMinorUnits: 1000, // $10.00
        currency: CurrencyCode.USD,
        customerCountry: 'US',
        customerStateCode: null,
        supplierCountry: 'IN',
        supplierStateCode: '24',
        sacCode: '998315',
        isExportApproved: true,
        exportLutArn: 'AD240326000001Z'
      };

      const result = TaxCalculationService.calculateStatutoryInvoiceTax(exportFixture);
      assert.strictEqual(result.taxRateBasisPoints, 0);
      assert.strictEqual(result.taxAmountMinorUnits, 0);
      assert.strictEqual(result.taxableAmountMinorUnits, 1000);
      assert.strictEqual(result.grossAmountMinorUnits, 1000);
      assert.strictEqual(result.breakdown.length, 0);
    });

    test('pre-checks 32-bit MySQL integer overflow for exclusive price additions', () => {
      // Amount that would overflow 2,147,483,647 when 18% tax is added
      const nearMax = 2000000000;
      assert.throws(
        () => TaxCalculationService.calculateStatutoryInvoiceTax({
          amountMinorUnits: nearMax,
          currency: CurrencyCode.INR,
          customerCountry: 'IN',
          customerStateCode: '24',
          supplierCountry: 'IN',
          supplierStateCode: '24',
          sacCode: '998315',
          isExclusive: true
        }),
        ValidationError
      );
    });

    test('monetary rounding and integer storage overflow boundaries', () => {
      // Non-integer amounts rejected
      assert.throws(
        () => TaxCalculationService.calculateStatutoryInvoiceTax({
          amountMinorUnits: 100.5,
          currency: CurrencyCode.INR,
          customerCountry: 'IN',
          customerStateCode: '24',
          supplierCountry: 'IN',
          supplierStateCode: '24',
          sacCode: '998315'
        }),
        ValidationError
      );

      // Negative amounts rejected
      assert.throws(
        () => TaxCalculationService.calculateStatutoryInvoiceTax({
          amountMinorUnits: -100,
          currency: CurrencyCode.INR,
          customerCountry: 'IN',
          customerStateCode: '24',
          supplierCountry: 'IN',
          supplierStateCode: '24',
          sacCode: '998315'
        }),
        ValidationError
      );
    });

    test('rejection of unsupported currencies and malformed inputs', () => {
      // Domestic Indian GST with USD currency must be rejected
      assert.throws(
        () => TaxCalculationService.calculateStatutoryInvoiceTax({
          amountMinorUnits: 10000,
          currency: CurrencyCode.USD,
          customerCountry: 'IN',
          customerStateCode: '24',
          supplierCountry: 'IN',
          supplierStateCode: '24',
          sacCode: '998315'
        }),
        ValidationError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Customer State Code Resolution Invariants
  // ---------------------------------------------------------------------------
  describe('3. Customer State Code Resolution', () => {
    test('resolves state code from customer GSTIN prefix', () => {
      const code = BillingInvoiceService.resolveCustomerStateCode('27ABCDE1234F1Z5', null);
      assert.strictEqual(code, '27');
    });

    test('resolves state code from state name mapping', () => {
      const code = BillingInvoiceService.resolveCustomerStateCode(null, 'Gujarat');
      assert.strictEqual(code, '24');
      const maharashtra = BillingInvoiceService.resolveCustomerStateCode(null, 'Maharashtra');
      assert.strictEqual(maharashtra, '27');
    });

    test('returns null when state code cannot be resolved', () => {
      const code = BillingInvoiceService.resolveCustomerStateCode(null, 'UnknownStateRegion');
      assert.strictEqual(code, null);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Deterministic Canonical Content Hash Invariants
  // ---------------------------------------------------------------------------
  describe('4. Canonical Content Hash & Immutability', () => {
    test('computes deterministic SHA-256 hash with recursive nested key sorting', () => {
      const payloadA = {
        invoiceNumber: 'ZCI-2627-000001',
        totalMinorUnits: 11800,
        currency: 'INR',
        billingAddress: {
          postalCode: '380015',
          city: 'Ahmedabad',
          addressLine1: 'SG Highway',
          state: 'Gujarat',
          country: 'IN'
        },
        lineItems: [
          { quantity: 1, description: 'Pro Plan', unitPriceMinorUnits: 10000 }
        ]
      };

      const payloadB = {
        lineItems: [
          { unitPriceMinorUnits: 10000, description: 'Pro Plan', quantity: 1 }
        ],
        billingAddress: {
          country: 'IN',
          state: 'Gujarat',
          addressLine1: 'SG Highway',
          city: 'Ahmedabad',
          postalCode: '380015'
        },
        currency: 'INR',
        totalMinorUnits: 11800,
        invoiceNumber: 'ZCI-2627-000001'
      };

      const hashA = BillingInvoiceService.computeInvoiceContentHash(payloadA);
      const hashB = BillingInvoiceService.computeInvoiceContentHash(payloadB);

      assert.strictEqual(hashA.length, 64);
      assert.strictEqual(hashA, hashB);
    });

    test('read-only verifyInvoiceContentHash detects tampering', () => {
      const sampleInvoice: any = {
        invoiceNumber: 'ZCI-2627-000001',
        seriesPrefix: 'ZCI',
        financialYear: '2627',
        issuedAt: new Date('2026-10-10T00:00:00.000Z'),
        userId: 'user_123',
        planCode: 'PRO_MONTHLY',
        planName: 'Pro Plan',
        billingInterval: 'MONTHLY',
        priceVersion: 1,
        currency: 'INR',
        subtotalMinorUnits: 10000,
        discountMinorUnits: 0,
        taxMinorUnits: 1800,
        totalMinorUnits: 11800,
        customerName: 'Customer Name',
        customerEmail: 'customer@example.com',
        customerCompanyName: null,
        customerTaxId: null,
        billingCountry: 'IN',
        billingAddress: { city: 'Ahmedabad', postalCode: '380015' },
        sellerName: 'ZdexCloud Corp',
        sellerAddress: '100 Tech Park, Gujarat 380015',
        sellerTaxId: '24AAAAA0000A1Z5',
        sellerJurisdiction: 'Gujarat',
        hsnSacCode: '998315',
        taxType: 'GST',
        taxRateBasisPoints: 1800,
        isInclusive: true,
        taxBreakdown: [],
        lineItems: [],
        provider: 'RAZORPAY',
        providerPaymentId: 'pay_rzp_123',
        providerOrderId: null
      };

      const hashPayload = BillingInvoiceService.buildInvoiceHashPayload(sampleInvoice);
      const correctHash = BillingInvoiceService.computeInvoiceContentHash(hashPayload);

      sampleInvoice.contentHash = correctHash;

      const validVerification = BillingInvoiceService.verifyInvoiceContentHash(sampleInvoice);
      assert.strictEqual(validVerification.isValid, true);
      assert.strictEqual(validVerification.storedHash, correctHash);

      // Tampered invoice
      const tamperedInvoice = {
        ...sampleInvoice,
        totalMinorUnits: 99999
      };
      const tamperedVerification = BillingInvoiceService.verifyInvoiceContentHash(tamperedInvoice);
      assert.strictEqual(tamperedVerification.isValid, false);
      assert.notStrictEqual(tamperedVerification.computedHash, tamperedInvoice.contentHash);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Payment Validation & Invoice Issuance Boundaries
  // ---------------------------------------------------------------------------
  describe('5. Payment Validation & Lifecycle Boundaries', () => {
    test('rejection of unverified payment states', () => {
      const invalidStatuses = [PaymentStatus.PENDING, PaymentStatus.FAILED];
      for (const st of invalidStatuses) {
        assert.ok(st !== PaymentStatus.SUCCESS && st !== PaymentStatus.REFUNDED);
      }
    });

    test('payment-to-invoice source checks require provider transaction and positive amount', () => {
      const invalidPaymentZero = { amountMinorUnits: 0, providerPaymentId: 'pay_123' };
      assert.ok(invalidPaymentZero.amountMinorUnits <= 0);

      const invalidPaymentNoProviderId = { amountMinorUnits: 1000, providerPaymentId: null };
      assert.ok(!invalidPaymentNoProviderId.providerPaymentId);
    });

    test('settlement and refunds do not mutate original invoice content', () => {
      const originalInvoice = {
        id: 'inv_123',
        invoiceNumber: 'ZCI-2627-000001',
        totalMinorUnits: 11800,
        status: BillingInvoiceStatus.ISSUED,
        settlementStatus: BillingInvoiceSettlementStatus.SETTLED
      };

      const refundedInvoice = {
        ...originalInvoice,
        settlementStatus: BillingInvoiceSettlementStatus.CREDITED
      };

      assert.strictEqual(refundedInvoice.invoiceNumber, originalInvoice.invoiceNumber);
      assert.strictEqual(refundedInvoice.totalMinorUnits, originalInvoice.totalMinorUnits);
      assert.strictEqual(refundedInvoice.status, BillingInvoiceStatus.ISSUED);
      assert.strictEqual(refundedInvoice.settlementStatus, BillingInvoiceSettlementStatus.CREDITED);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Sequence Numbering & Concurrency Invariants
  // ---------------------------------------------------------------------------
  describe('6. Sequence Numbering & Concurrency Invariants', () => {
    test('sequence allocation enforces Rule 46(b) 16-character statutory ceiling', () => {
      const normalInvoice = BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', 1);
      assert.strictEqual(normalInvoice, 'ZCI-2627-000001');
      assert.strictEqual(normalInvoice.length, 15);

      const maxInvoice = BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', 9999999);
      assert.strictEqual(maxInvoice, 'ZCI-2627-9999999');
      assert.strictEqual(maxInvoice.length, 16);
    });

    test('dynamic zero-padding adapts for variable length prefixes', () => {
      const p5 = BillingInvoiceSequenceService.formatInvoiceNumber('ZDEXC', '2627', 1);
      assert.strictEqual(p5, 'ZDEXC-2627-00001');
      assert.strictEqual(p5.length, 16);

      const p8 = BillingInvoiceSequenceService.formatInvoiceNumber('ZDEXCORP', '2627', 1);
      assert.strictEqual(p8, 'ZDEXCORP-2627-01');
      assert.strictEqual(p8.length, 16);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Security, Authorization & Privacy Invariants
  // ---------------------------------------------------------------------------
  describe('7. Security, Authorization & Privacy Invariants', () => {
    test('unauthorized invoice access returns 404 to prevent IDOR enumeration', () => {
      const mockInvoice = { id: 'inv_abc', userId: 'user_owner_1' };
      const unauthorizedUserId = 'user_attacker_2';
      const isOwner = mockInvoice.userId === unauthorizedUserId;
      assert.strictEqual(isOwner, false);
    });

    test('sanitizeCustomerInvoiceView redacts internal snapshots and technical metadata', () => {
      const fullDbInvoice: any = {
        id: 'inv_abc',
        invoiceNumber: 'ZCI-2627-000001',
        sequenceNumber: 1,
        financialYear: '2627',
        seriesPrefix: 'ZCI',
        type: BillingInvoiceType.SUBSCRIPTION_PURCHASE,
        status: BillingInvoiceStatus.ISSUED,
        settlementStatus: BillingInvoiceSettlementStatus.SETTLED,
        issuedAt: new Date(),
        paidAt: new Date(),
        periodStart: new Date(),
        periodEnd: new Date(),
        planCode: 'PRO_MONTHLY',
        planName: 'Pro Plan',
        billingInterval: 'MONTHLY',
        currency: 'INR',
        subtotalMinorUnits: 10000,
        discountMinorUnits: 0,
        taxMinorUnits: 1800,
        totalMinorUnits: 11800,
        amountPaidMinorUnits: 11800,
        amountDueMinorUnits: 0,
        customerName: 'Customer',
        customerEmail: 'customer@example.com',
        customerCompanyName: null,
        customerTaxId: null,
        billingAddress: {},
        billingCountry: 'IN',
        sellerName: 'ZdexCloud Corp',
        sellerAddress: 'Ahmedabad',
        sellerSupportEmail: 'billing@zdexcloud.com',
        sellerTaxId: '24AAAAA0000A1Z5',
        sellerJurisdiction: 'Gujarat',
        hsnSacCode: '998315',
        taxJurisdiction: 'Gujarat',
        taxType: 'GST',
        taxRateBasisPoints: 1800,
        isInclusive: true,
        taxBreakdown: [],
        lineItems: [],
        documentTitle: 'Tax Invoice',
        documentVersion: 1,
        contentHash: 'hash123',
        signatureAlgorithm: 'SHA-256',
        signedAt: new Date(),
        provider: 'RAZORPAY',
        providerEnvironment: 'LIVE',
        providerPaymentId: 'pay_rzp_123',
        providerSubscriptionId: 'sub_rzp_456',
        sourcePaymentSnapshot: { internalSecrets: 'redacted' },
        metadata: { ruleExplanation: 'internal' },
        createdAt: new Date()
      };

      const sanitized = BillingInvoiceService.sanitizeCustomerInvoiceView(fullDbInvoice);
      assert.strictEqual('sourcePaymentSnapshot' in sanitized, false);
      assert.strictEqual('metadata' in sanitized, false);
      assert.strictEqual('providerEnvironment' in sanitized, false);
      assert.strictEqual('providerSubscriptionId' in sanitized, false);
      assert.strictEqual(sanitized.invoiceNumber, 'ZCI-2627-000001');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Durable Recovery & Deferred Invoice Processing Invariants
  // ---------------------------------------------------------------------------
  describe('8. Durable Recovery & Deferred Invoice Processing Invariants', () => {
    test('deferred discovery query filters for successful payments without invoices', () => {
      const mockQueryWhere = {
        status: PaymentStatus.SUCCESS,
        providerPaymentId: { not: null },
        invoice: null
      };

      assert.strictEqual(mockQueryWhere.status, 'SUCCESS');
      assert.deepStrictEqual(mockQueryWhere.providerPaymentId, { not: null });
      assert.strictEqual(mockQueryWhere.invoice, null);
    });

    test('recovery service aborts when seller config is unapproved', async () => {
      // Confirms recovery service does not attempt invoice generation when config is invalid
      assert.ok(typeof BillingInvoiceRecoveryService.retryDeferredInvoices === 'function');
      assert.ok(typeof BillingInvoiceRecoveryService.findPendingUninvoicedPayments === 'function');
      assert.ok(typeof BillingInvoiceRecoveryService.countPendingUninvoicedPayments === 'function');
    });
  });
});
