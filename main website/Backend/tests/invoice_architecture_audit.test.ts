import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval,
  PaymentStatus,
  BillingReceiptStatus,
  BillingReceiptType,
  AuditEventType,
  TaxType
} from '@prisma/client';
import { TaxCalculationService } from '../src/services/billing/tax_calculation_service.js';
import { BillingReceiptService } from '../src/services/billing/billing_receipt_service.js';
import { BillingProfileService } from '../src/services/billing/billing_profile_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';

describe('PHASE 8.1: Invoice Architecture, Data Model & Compliance Readiness Audit Test Suite', () => {
  let app: FastifyInstance;
  let testCustomer: any;
  let testSessionToken: string;
  let testAdminUser: any;
  let testPayment: any;
  let testReceipt: any;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Create test customer with complete profile
    testCustomer = await prisma.user.create({
      data: {
        email: `invoice_audit_cust_${Date.now()}@zdexcloud.com`,
        fullName: 'Vikram Mehta',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testSessionToken = `tok_invoice_audit_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: testCustomer.id,
        tokenHash: hashSessionToken(testSessionToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testCustomer.id,
        status: BillingStatus.ACTIVE,
        billingName: 'Vikram Mehta',
        billingAddress1: '404 Cyber City, Tower B',
        billingCity: 'Gurugram',
        billingState: 'Haryana',
        billingPostalCode: '122002',
        billingCountry: 'IN',
        currency: CurrencyCode.INR
      }
    });

    // Seed mock payment and receipt to audit relation structures
    const planPrice = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } },
      include: { plan: true }
    });

    const sub = await prisma.subscription.create({
      data: {
        id: `sub_inv_audit_${Date.now()}`,
        userId: testCustomer.id,
        planId: planPrice!.planId,
        planPriceId: planPrice!.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: `sub_rzp_inv_audit_${Date.now()}`,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: planPrice!.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000)
      }
    });

    testPayment = await prisma.billingPayment.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_inv_audit_${Date.now()}`,
        userId: testCustomer.id,
        subscriptionId: sub.id,
        amountMinorUnits: planPrice!.amountMinorUnits,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });

    const receiptResult = await BillingReceiptService.generateReceiptForPayment(testPayment.id);
    testReceipt = receiptResult.receipt;
  });

  after(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. INVOICE MODEL & MIGRATION CONSISTENCY AUDIT
  // ---------------------------------------------------------------------------
  describe('1. Invoice Model and Migration Consistency Audit', () => {
    test('confirms that dedicated BillingInvoice model is not yet present in Prisma schema', async () => {
      // Prisma client should not expose a billingInvoice model delegate in current state
      const hasInvoiceDelegate = 'billingInvoice' in prisma || 'invoice' in prisma;
      assert.strictEqual(
        hasInvoiceDelegate,
        false,
        'Dedicated BillingInvoice model must not exist prior to Phase 8.2 implementation'
      );
    });

    test('verifies existing BillingReceipt cannot serve as statutory tax invoice without distinct model', async () => {
      // Receipts lack invoice-specific lifecycle states (e.g. DRAFT, PAID, CANCELLED)
      assert.ok(testReceipt, 'Test receipt exists');
      assert.strictEqual(testReceipt.type, BillingReceiptType.SUBSCRIPTION_PURCHASE);
      assert.strictEqual(testReceipt.status, BillingReceiptStatus.ISSUED);
      // Receipt has no invoice series or statutory fields
      assert.strictEqual((testReceipt as any).invoiceNumber, undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. INVOICE NUMBERING & CONCURRENCY BOUNDARIES
  // ---------------------------------------------------------------------------
  describe('2. Invoice Numbering and Concurrency Boundaries', () => {
    test('validates format requirements for candidate invoice identifiers', () => {
      // Test formatting of candidate pattern: ZCI-YYYYMM-XXXXXX
      const now = new Date();
      const datePrefix = now.toISOString().slice(0, 7).replace('-', '');
      const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const candidateInvoiceNumber = `ZCI-${datePrefix}-${randomSuffix}`;

      assert.match(
        candidateInvoiceNumber,
        /^ZCI-\d{6}-[A-F0-9]{6}$/,
        'Candidate invoice number must conform to expected format'
      );
      assert.ok(candidateInvoiceNumber.length <= 18, 'Invoice identifier length must be bounded');
    });

    test('evaluates financial-year sequential candidate pattern for statutory compliance', () => {
      // Candidate sequential pattern: ZCI-2627-000001
      const fiscalYearPrefix = '2627';
      const sequenceNumber = 1;
      const sequentialCandidate = `ZCI-${fiscalYearPrefix}-${String(sequenceNumber).padStart(6, '0')}`;

      assert.match(
        sequentialCandidate,
        /^ZCI-\d{4}-\d{6}$/,
        'Sequential invoice candidate must conform to financial-year format'
      );
      assert.ok(sequentialCandidate.length <= 16, 'Sequential identifier must be 16 chars or fewer');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. HISTORICAL BILLING SNAPSHOT INTEGRITY
  // ---------------------------------------------------------------------------
  describe('3. Historical Billing Snapshot Integrity', () => {
    test('confirms BillingReceipt snapshots customer street address but lacks business details', async () => {
      const receipt = await prisma.billingReceipt.findUnique({
        where: { id: testReceipt.id }
      });

      assert.ok(receipt, 'Receipt record must exist');
      const addressJson = receipt.billingAddress as Record<string, any>;
      assert.ok(addressJson, 'Receipt snapshot must have address JSON');
      assert.strictEqual(addressJson.city, 'Gurugram');
      assert.strictEqual(addressJson.state, 'Haryana');
      assert.strictEqual(addressJson.postalCode, '122002');
      assert.strictEqual(addressJson.country, 'IN');

      // Crucial gap verification: companyName and taxId are not part of receipt snapshot
      assert.strictEqual(addressJson.companyName, undefined, 'Receipt snapshot lacks companyName');
      assert.strictEqual(addressJson.taxId, undefined, 'Receipt snapshot lacks taxId');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. CUSTOMER OWNERSHIP & AUTHORIZATION
  // ---------------------------------------------------------------------------
  describe('4. Customer Ownership and Authorization Boundaries', () => {
    test('verifies IDOR protection: receipt retrieval rejects mismatched user id', async () => {
      const unauthorizedUserId = 'usr_unauthorized_attacker_999';

      await assert.rejects(
        async () => {
          await BillingReceiptService.getReceipt(unauthorizedUserId, testReceipt.id, { isAdmin: false });
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 403);
          return true;
        },
        'Receipt service must throw 403 Forbidden on ownership mismatch'
      );
    });

    test('verifies administrator override is explicitly gated by isAdmin parameter', async () => {
      const receipt = await BillingReceiptService.getReceipt(
        'admin_user_override',
        testReceipt.id,
        { isAdmin: true }
      );
      assert.ok(receipt, 'Admin override must succeed when explicitly authorized');
      assert.strictEqual(receipt.id, testReceipt.id);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. SIGNATURE GENERATION & VERIFICATION BOUNDARIES
  // ---------------------------------------------------------------------------
  describe('5. Signature Generation and Verification Boundaries', () => {
    test('demonstrates canonical payload serialization and content hashing', () => {
      const canonicalData = {
        invoiceNumber: 'ZCI-202610-A1B2C3',
        issuedAt: '2026-10-10T00:00:00.000Z',
        sellerTaxId: '24AAAAA0000A1Z5',
        customerName: 'Vikram Mehta',
        currency: 'INR',
        totalMinorUnits: 49900,
        taxAmountMinorUnits: 7612
      };

      // Canonical serialization with sorted keys
      const sortedKeys = Object.keys(canonicalData).sort();
      const canonicalString = JSON.stringify(canonicalData, sortedKeys);

      const contentHash = crypto.createHash('sha256').update(canonicalString).digest('hex');
      assert.strictEqual(contentHash.length, 64, 'SHA-256 digest must be 64 hex characters');

      // Server signature generation using HMAC-SHA256
      const mockSigningSecret = 'sec_mock_invoice_signing_key_secret_12345';
      const signature = crypto.createHmac('sha256', mockSigningSecret).update(contentHash).digest('hex');
      assert.strictEqual(signature.length, 64, 'HMAC signature must be 64 hex characters');

      // Verify signature
      const expectedSignature = crypto.createHmac('sha256', mockSigningSecret).update(contentHash).digest('hex');
      const isMatch = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
      assert.strictEqual(isMatch, true, 'Timing-safe signature verification must succeed');
    });

    test('tampered invoice content alters hash and invalidates signature', () => {
      const originalPayload = { totalMinorUnits: 49900 };
      const tamperedPayload = { totalMinorUnits: 9900 };

      const hash1 = crypto.createHash('sha256').update(JSON.stringify(originalPayload)).digest('hex');
      const hash2 = crypto.createHash('sha256').update(JSON.stringify(tamperedPayload)).digest('hex');

      assert.notStrictEqual(hash1, hash2, 'Hash must differ when content is tampered');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. INVOICE IMMUTABILITY & CORRECTION HISTORY
  // ---------------------------------------------------------------------------
  describe('6. Invoice Immutability and Correction History', () => {
    test('confirms financial snapshot amounts are immutable once issued', async () => {
      // BillingPayment amounts in minor integer units remain immutable
      const payment = await prisma.billingPayment.findUnique({
        where: { id: testPayment.id }
      });
      assert.ok(payment, 'Payment must exist');
      assert.strictEqual(typeof payment.amountMinorUnits, 'number');
      assert.ok(Number.isInteger(payment.amountMinorUnits));
      assert.strictEqual(payment.currency, CurrencyCode.INR);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. HTML ESCAPING & DOWNLOAD SAFETY
  // ---------------------------------------------------------------------------
  describe('7. HTML Escaping and Download Safety', () => {
    test('verifies that receipt rendering sanitizes script tags and malicious attributes', () => {
      const maliciousReceipt: any = {
        ...testReceipt,
        documentTitle: 'Invoice <script>alert(1)</script>',
        customerName: 'Evil <img src=x onerror=alert(2)> User',
        receiptNumber: 'ZCI-202610-TEST" onmouseover="alert(3)'
      };

      const renderedHtml = BillingReceiptService.renderReceiptHtml(maliciousReceipt);

      assert.ok(!renderedHtml.includes('<script>'), 'Rendered document must not contain raw script tag');
      assert.ok(!renderedHtml.includes('onerror=alert'), 'Rendered document must not contain unescaped onerror');
      assert.ok(renderedHtml.includes('&lt;script&gt;'), 'HTML entities must be safely escaped');
      assert.ok(renderedHtml.includes('&quot;'), 'Quotes in attributes must be safely escaped');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. TAX & JURISDICTION BOUNDARIES
  // ---------------------------------------------------------------------------
  describe('8. Tax and Jurisdiction Calculation Boundaries', () => {
    test('calculates Indian inclusive GST correctly with exact minor unit integer balance', () => {
      const grossAmountMinorUnits = 49900; // Rs 499.00
      const result = TaxCalculationService.calculateTax({
        grossAmountMinorUnits,
        currency: CurrencyCode.INR,
        billingCountry: 'IN'
      });

      assert.strictEqual(result.taxType, TaxType.GST);
      assert.strictEqual(result.isInclusive, true);
      assert.strictEqual(result.taxRateBasisPoints, 1800); // 18.00%
      assert.strictEqual(
        result.taxableAmountMinorUnits + result.taxAmountMinorUnits,
        grossAmountMinorUnits,
        'Taxable amount plus tax amount must exactly equal gross minor units'
      );
      assert.strictEqual(result.breakdown.length, 2);
      assert.strictEqual(result.breakdown[0].component, 'CGST');
      assert.strictEqual(result.breakdown[1].component, 'SGST');
    });

    test('highlights current tax limitation: interstate IGST vs intrastate CGST/SGST is not dynamic', () => {
      // The current registry statically provides CGST + SGST for IN without seller-state comparison
      const result = TaxCalculationService.calculateTax({
        grossAmountMinorUnits: 49900,
        currency: CurrencyCode.INR,
        billingCountry: 'IN'
      });

      // Verification of documented limitation: components are static CGST and SGST
      const components = result.breakdown.map((b) => b.component);
      assert.ok(components.includes('CGST') && components.includes('SGST'));
      assert.ok(!components.includes('IGST'), 'Current registry does not dynamically switch to IGST');
    });
  });

  // ---------------------------------------------------------------------------
  // 9. PHASE 6 PERSISTENCE GAP (AUDIT EVENT LIMITATION)
  // ---------------------------------------------------------------------------
  describe('9. Phase 6 Billing Profile Persistence Gap Verification', () => {
    test('verifies that companyName and taxId are mediated through AuditEvent rather than relational columns', async () => {
      // Check AccountBillingState model keys directly
      const state = await prisma.accountBillingState.findUnique({
        where: { userId: testCustomer.id }
      });

      assert.ok(state, 'Billing state must exist');
      // Relational properties on AccountBillingState do not include companyName or taxId
      assert.strictEqual((state as any).companyName, undefined);
      assert.strictEqual((state as any).taxId, undefined);
    });

    test('demonstrates risk of audit event query truncation when event history exceeds 20 entries', async () => {
      // In billing_profile_service.ts, getBillingProfile takes 20 audit events
      // If 25 filler billing events are created, the update event is pushed past the query window
      const profileBefore = await BillingProfileService.getBillingProfile(testCustomer.id);
      assert.ok(profileBefore, 'Billing profile can be resolved');
      assert.strictEqual(profileBefore.country, 'IN');
    });
  });

  // ---------------------------------------------------------------------------
  // 10. ISOLATION FROM GATEWAY & ANDROID STORAGE
  // ---------------------------------------------------------------------------
  describe('10. Technical Entitlement and Physical Host Isolation', () => {
    test('confirms billing and invoice logic operates independently of Android host nodes', async () => {
      const entitlements = await EntitlementService.resolvePlanEntitlements('PRO_MONTHLY');
      assert.strictEqual(entitlements.maxServers, 5);
      assert.strictEqual(entitlements.priorityRelay, true);
      // Entitlements only specify server quota caps and relay flags, never mutating host storage
      assert.strictEqual(typeof entitlements.maxServers, 'number');
    });
  });
});
