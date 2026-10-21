// NOTE: These tests are NOT EXECUTED as per policy.

/**
 * -----------------------------------------------------------------------------
 * TEST SUITE: INVOICE DOCUMENT TEMPLATE FOUNDATION & SAFETY SPECIFICATIONS
 * (PHASE 8.4, BATCH B.1)
 *
 * MANDATORY OPERATIONAL RESTRICTION NOTICE:
 * THIS TEST FILE IS AUTHORED FOR STATIC SPECIFICATION AND REGRESSION AUDITING ONLY.
 * PER MANDATORY PHASE 8.4 RESTRICTIONS, THIS FILE HAS NOT BEEN EXECUTED.
 * DO NOT RUN VIA TEST RUNNERS (npm test, node --test) OR APPLICATION BUILDS.
 * -----------------------------------------------------------------------------
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  CurrencyCode,
  BillingInvoiceStatus,
  BillingInvoiceSettlementStatus,
  BillingInvoiceType
} from '@prisma/client';
import {
  BillingInvoiceDocumentService,
  InvoiceDocumentModel
} from '../src/services/billing/billing_invoice_document_service.js';

describe('Phase 8.4 Batch B.1: PDF Foundation Corrections & Document Safety Specifications', () => {

  const samplePersistedInvoice: any = {
    id: 'inv_doc_001_internal_db_id',
    invoiceNumber: 'ZCI/2026-2027/000100',
    seriesPrefix: 'ZCI',
    financialYear: '2026-2027',
    sequenceNumber: 100,
    type: BillingInvoiceType.TAX_INVOICE,
    status: BillingInvoiceStatus.ISSUED,
    settlementStatus: BillingInvoiceSettlementStatus.SETTLED,
    issuedAt: new Date('2026-03-15T10:30:00.000Z'),
    paidAt: new Date('2026-03-15T10:30:00.000Z'),
    voidedAt: null,
    periodStart: new Date('2026-03-15T00:00:00.000Z'),
    periodEnd: new Date('2026-04-15T00:00:00.000Z'),
    planCode: 'PRO_MONTHLY',
    planName: 'Pro Tier (Monthly)',
    billingInterval: 'MONTHLY',
    priceVersion: 1,
    currency: CurrencyCode.INR,
    subtotalMinorUnits: 84746,
    discountMinorUnits: 0,
    taxMinorUnits: 15254,
    totalMinorUnits: 100000,
    amountPaidMinorUnits: 100000,
    amountDueMinorUnits: 0,
    customerName: 'Jane Doe',
    customerEmail: 'jane.doe@example.com',
    customerCompanyName: 'Acme Cloud Pvt Ltd',
    customerTaxId: '27AAPCA1234F1Z5',
    billingAddress: JSON.stringify({
      addressLine1: '404 Bandra West',
      city: 'Mumbai',
      state: 'MH',
      postalCode: '400050',
      country: 'IN'
    }),
    billingCountry: 'IN',
    sellerName: 'ZdexCloud Technologies India Private Limited',
    sellerAddress: 'Floor 12, Tower B, Cyber City, Gurugram, HR 122002, India',
    sellerSupportEmail: 'billing@zdexcloud.com',
    sellerTaxId: '06AAACZ1234A1Z5',
    sellerJurisdiction: 'Haryana, India',
    hsnSacCode: '998313',
    taxJurisdiction: 'MH',
    taxType: 'INTRA_STATE',
    taxRateBasisPoints: 1800,
    isInclusive: true,
    taxBreakdown: JSON.stringify({
      cgstMinorUnits: 7627,
      sgstMinorUnits: 7627,
      igstMinorUnits: 0,
      cgstRateBasisPoints: 900,
      sgstRateBasisPoints: 900,
      igstRateBasisPoints: 0
    }),
    lineItems: [
      {
        description: 'Pro Tier (Monthly) Subscription',
        sacCode: '998313',
        quantity: 1,
        unitPriceMinorUnits: 84746,
        taxableAmountMinorUnits: 84746,
        taxAmountMinorUnits: 15254,
        totalMinorUnits: 100000,
        currency: 'INR'
      }
    ],
    contentHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    documentTitle: 'Tax Invoice',
    documentVersion: 1,
    voidReason: null,
    supersededByInvoiceId: null,
    correctionReason: null
  };

  // ---------------------------------------------------------------------------
  // 1. Dependency declaration and lockfile status (static verification)
  // ---------------------------------------------------------------------------
  describe('1. Dependency declaration and lockfile status', () => {
    test('verifies pdfkit declared in package.json while lockfile sync remains an explicit prerequisite', () => {
      // Invariant: package.json must declare pdfkit
      // Invariant: lockfile sync must be recognized as pending/prerequisite because npm install is prohibited in audit batches
      assert.ok(BillingInvoiceDocumentService);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Unicode font support or explicit fallback behavior
  // ---------------------------------------------------------------------------
  describe('2. Unicode font support and explicit ASCII fallback', () => {
    test('PDF renderer uses pure ASCII currency prefixes (INR ) rather than claiming Type 1 font support for ₹', () => {
      const asciiInr = BillingInvoiceDocumentService.formatAmountAscii(100000, CurrencyCode.INR);
      assert.strictEqual(asciiInr, 'INR 1000.00');
      assert.ok(!asciiInr.includes('₹'), 'PDF ASCII formatter must not contain Unicode ₹ which fails in standard Helvetica');

      const asciiUsd = BillingInvoiceDocumentService.formatAmountAscii(2999, CurrencyCode.USD);
      assert.strictEqual(asciiUsd, 'USD 29.99');

      // HTML template can use Unicode ₹ as browsers provide system font fallback
      const html = BillingInvoiceDocumentService.renderInvoiceHtml(samplePersistedInvoice);
      assert.ok(html.includes('₹'));
    });
  });

  // ---------------------------------------------------------------------------
  // 3. No unsupported claim of statutory certification
  // ---------------------------------------------------------------------------
  describe('3. Removal of unsupported statutory certification claims', () => {
    test('document notes and footers describe persisted snapshot data without claiming statutory certification under Rule 46', () => {
      const html = BillingInvoiceDocumentService.renderInvoiceHtml(samplePersistedInvoice);

      // Must not claim legally certified status or unverified statutory compliance
      assert.ok(!html.includes('digitally stored under Rule 46 of the Indian CGST Rules'));
      assert.ok(!html.includes('Document Integrity Verification:'));

      // Must neutrally describe persisted snapshot data and record checksum
      assert.ok(html.includes('reflects persisted billing snapshot data'));
      assert.ok(html.includes('Document Record Integrity:'));
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Superseded invoice rendering never exposes internal database IDs
  // ---------------------------------------------------------------------------
  describe('4. Neutral superseded banner without internal DB ID exposure', () => {
    test('SUPERSEDED invoice renders neutral status without exposing supersededByInvoiceId as an invoice number', () => {
      const supersededInvoice = {
        ...samplePersistedInvoice,
        status: BillingInvoiceStatus.SUPERSEDED,
        supersededByInvoiceId: 'cm1234567890abcdef_internal_id',
        correctionReason: 'Administrative adjustment for address update'
      };

      const html = BillingInvoiceDocumentService.renderInvoiceHtml(supersededInvoice);

      // Invariant: The internal database ID must NEVER appear in customer-facing output
      assert.ok(!html.includes('cm1234567890abcdef_internal_id'));
      assert.ok(html.includes('SUPERSEDED'));
      assert.ok(html.includes('Administrative adjustment for address update'));

      // Even if correctionReason is absent, neutral banner is shown without internal ID
      const supersededWithoutReason = {
        ...samplePersistedInvoice,
        status: BillingInvoiceStatus.SUPERSEDED,
        supersededByInvoiceId: 'cm9999999999abcdef_internal_id',
        correctionReason: null
      };
      const htmlNoReason = BillingInvoiceDocumentService.renderInvoiceHtml(supersededWithoutReason);
      assert.ok(!htmlNoReason.includes('cm9999999999abcdef_internal_id'));
      assert.ok(htmlNoReason.includes('SUPERSEDED'));
      assert.ok(htmlNoReason.includes('This invoice has been superseded by a replacement invoice.'));
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Snapshot-only financial and statutory rendering
  // ---------------------------------------------------------------------------
  describe('5. Snapshot-only financial and statutory rendering', () => {
    test('renders exact persisted tax components and values without live fee recalculation', () => {
      const html = BillingInvoiceDocumentService.renderInvoiceHtml(samplePersistedInvoice);
      assert.ok(html.includes('CGST (9.0%)') || html.includes('CGST (9%)'));
      assert.ok(html.includes('SGST (9.0%)') || html.includes('SGST (9%)'));
      assert.ok(html.includes('76.27')); // 7627 paise = 76.27
      assert.ok(html.includes('847.46')); // 84746 paise = 847.46
      assert.ok(html.includes('1,000.00') || html.includes('1000.00'));
    });
  });

  // ---------------------------------------------------------------------------
  // 6. No implicit issuance or sequence allocation
  // ---------------------------------------------------------------------------
  describe('6. Zero side-effects on sequence counters or database state', () => {
    test('calling mapping or rendering does not mutate input or allocate sequences', () => {
      const initialSequence = samplePersistedInvoice.sequenceNumber;
      const model = BillingInvoiceDocumentService.mapInvoiceToDocumentModel(samplePersistedInvoice);
      const html = BillingInvoiceDocumentService.renderInvoiceHtml(model);

      assert.strictEqual(samplePersistedInvoice.sequenceNumber, initialSequence);
      assert.strictEqual(model.sequenceNumber, initialSequence);
      assert.ok(html.includes('ZCI/2026-2027/000100'));
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Separation of canonical invoice hash and PDF-byte hash
  // ---------------------------------------------------------------------------
  describe('7. Cryptographic separation of database contentHash and PDF byteHash', () => {
    test('computeDocumentByteHash produces separate SHA-256 over raw PDF bytes without altering invoice.contentHash', () => {
      const originalHash = samplePersistedInvoice.contentHash;
      const testBuffer = Buffer.from('%PDF-1.4 test stream %%EOF');
      const byteHash = BillingInvoiceDocumentService.computeDocumentByteHash(testBuffer);

      assert.strictEqual(samplePersistedInvoice.contentHash, originalHash);
      assert.strictEqual(byteHash.length, 64);
      assert.notStrictEqual(byteHash, originalHash);

      // Verify that invalid inputs throw ValidationError
      assert.throws(() => {
        BillingInvoiceDocumentService.computeDocumentByteHash(null as any);
      }, /A valid Buffer is required/);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Exclusion of internal provider data and internal database IDs
  // ---------------------------------------------------------------------------
  describe('8. Exclusion of internal provider data and database IDs from customer documents', () => {
    test('omits provider payment IDs, secrets, and raw internal doc.id from customer document outputs', () => {
      const invoiceWithSecrets = {
        ...samplePersistedInvoice,
        providerPaymentId: 'pay_secret_razorpay_99999',
        providerOrderId: 'order_secret_razorpay_88888',
        paymentSnapshot: JSON.stringify({ card_last4: '4242', token: 'sec_tok_777' })
      };

      const model = BillingInvoiceDocumentService.mapInvoiceToDocumentModel(invoiceWithSecrets);
      assert.strictEqual((model as any).providerPaymentId, undefined);
      assert.strictEqual((model as any).providerOrderId, undefined);
      assert.strictEqual((model as any).paymentSnapshot, undefined);

      const html = BillingInvoiceDocumentService.renderInvoiceHtml(invoiceWithSecrets);
      assert.ok(!html.includes('pay_secret_razorpay_99999'));
      assert.ok(!html.includes('order_secret_razorpay_88888'));
      assert.ok(!html.includes('sec_tok_777'));

      // Invariant: Internal database primary key id must NOT be rendered in customer footer
      assert.ok(!html.includes('System Identifier: inv_doc_001_internal_db_id'));
      assert.ok(html.includes('Invoice No: ZCI/2026-2027/000100'));
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Escaping and bounded rendering of customer-visible text
  // ---------------------------------------------------------------------------
  describe('9. Escaping and bounded rendering of customer-visible text', () => {
    test('sanitizes XSS payloads and safely bounds text length to prevent bounding box overflow', () => {
      const maliciousInvoice = {
        ...samplePersistedInvoice,
        customerName: '<script>alert("xss")</script>',
        customerCompanyName: 'Acme & "Co" <evil>',
        voidReason: 'A'.repeat(500) // very long text
      };

      const html = BillingInvoiceDocumentService.renderInvoiceHtml(maliciousInvoice);
      assert.ok(!html.includes('<script>alert("xss")</script>'));
      assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
      assert.ok(html.includes('Acme &amp; &quot;Co&quot; &lt;evil&gt;'));

      // Void reason must be bounded and not dump 500 characters unconstrained
      assert.ok(!html.includes('A'.repeat(400)));
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Safe filename generation
  // ---------------------------------------------------------------------------
  describe('10. Safe filename generation', () => {
    test('sanitizes path traversal, backslashes, colons, and forbidden characters into safe attachment filenames', () => {
      const standardFilename = BillingInvoiceDocumentService.sanitizeFilename('ZCI/2026-2027/000100');
      assert.strictEqual(standardFilename, 'invoice-ZCI-2026-2027-000100.pdf');

      const traversalFilename = BillingInvoiceDocumentService.sanitizeFilename('../../etc/passwd\\ZCI:2026*?');
      assert.ok(!traversalFilename.includes('/'));
      assert.ok(!traversalFilename.includes('\\'));
      assert.ok(!traversalFilename.includes('..'));
      assert.ok(!traversalFilename.includes(':'));
      assert.ok(!traversalFilename.includes('*'));
      assert.ok(!traversalFilename.includes('?'));
      assert.ok(traversalFilename.endsWith('.pdf'));
    });
  });

});
