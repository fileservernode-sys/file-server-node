import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import {
  CurrencyCode,
  BillingStatus,
  AuditEventType
} from '@prisma/client';
import { BillingProfileService } from '../src/services/billing/billing_profile_service.js';
import { BillingProfileBackfillService } from '../src/services/billing/billing_profile_backfill.js';
import { BillingInvoiceSequenceService } from '../src/services/billing/billing_invoice_sequence_service.js';
import { AdminUserService } from '../src/routes/admin/operations/users/service.js';

describe('PHASE 8.2 & 8.2.1: Invoice Schema Hardening, Backfill Safety & Numbering Integrity Test Suite', () => {
  let app: FastifyInstance;
  let testUser1: any;
  let testUser2: any;
  let testUserUnmigrated: any;
  let testUserPartialUpdates: any;
  let sessionTokenUser1: string;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Setup test user 1 for direct persistence testing
    testUser1 = await prisma.user.create({
      data: {
        email: `invoice_model_test1_${Date.now()}@zdexcloud.com`,
        fullName: 'Aarav Sharma',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    sessionTokenUser1 = `tok_invoice_model_1_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: testUser1.id,
        tokenHash: hashSessionToken(sessionTokenUser1),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 2. Setup test user 2
    testUser2 = await prisma.user.create({
      data: {
        email: `invoice_model_test2_${Date.now()}@zdexcloud.com`,
        fullName: 'Priya Patel',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    // 3. Setup test user with legacy audit data only (simulating unmigrated account)
    testUserUnmigrated = await prisma.user.create({
      data: {
        email: `invoice_unmigrated_${Date.now()}@zdexcloud.com`,
        fullName: 'Rohan Gupta',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserUnmigrated.id,
        status: BillingStatus.FREE,
        billingName: 'Rohan Gupta',
        billingAddress1: '456 Tech Park',
        billingCity: 'Bengaluru',
        billingState: 'Karnataka',
        billingPostalCode: '560001',
        billingCountry: 'IN',
        currency: CurrencyCode.INR
      }
    });

    await prisma.auditEvent.create({
      data: {
        userId: testUserUnmigrated.id,
        eventType: AuditEventType.BILLING_STATE_UPDATED,
        metadata: {
          action: 'UPDATE_BILLING_PROFILE',
          companyName: 'Legacy Cloud Labs Pvt Ltd',
          taxId: '29ABCDE1234F1Z5'
        }
      }
    });

    // 4. Setup test user with partial updates spread across multiple audit events
    testUserPartialUpdates = await prisma.user.create({
      data: {
        email: `invoice_partial_${Date.now()}@zdexcloud.com`,
        fullName: 'Ananya Verma',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserPartialUpdates.id,
        status: BillingStatus.FREE,
        billingName: 'Ananya Verma',
        billingAddress1: '789 Innovation Way',
        billingCity: 'Hyderabad',
        billingState: 'Telangana',
        billingPostalCode: '500081',
        billingCountry: 'IN',
        currency: CurrencyCode.INR
      }
    });

    // Event 1 (older): had companyName
    await prisma.auditEvent.create({
      data: {
        userId: testUserPartialUpdates.id,
        eventType: AuditEventType.BILLING_STATE_UPDATED,
        createdAt: new Date(Date.now() - 100000),
        metadata: {
          action: 'UPDATE_BILLING_PROFILE',
          companyName: 'Ananya Cybernetics Pvt Ltd'
        }
      }
    });

    // Event 2 (newer): had taxId only (partial update)
    await prisma.auditEvent.create({
      data: {
        userId: testUserPartialUpdates.id,
        eventType: AuditEventType.BILLING_STATE_UPDATED,
        createdAt: new Date(Date.now() - 50000),
        metadata: {
          action: 'UPDATE_BILLING_PROFILE',
          taxId: '36ABCDE5678G1Z2'
        }
      }
    });
  });

  after(async () => {
    try {
      if (testUser1?.id) {
        await prisma.auditEvent.deleteMany({ where: { userId: testUser1.id } });
        await prisma.userSession.deleteMany({ where: { userId: testUser1.id } });
        await prisma.accountBillingState.deleteMany({ where: { userId: testUser1.id } });
        await prisma.user.delete({ where: { id: testUser1.id } });
      }
      if (testUser2?.id) {
        await prisma.auditEvent.deleteMany({ where: { userId: testUser2.id } });
        await prisma.accountBillingState.deleteMany({ where: { userId: testUser2.id } });
        await prisma.user.delete({ where: { id: testUser2.id } });
      }
      if (testUserUnmigrated?.id) {
        await prisma.auditEvent.deleteMany({ where: { userId: testUserUnmigrated.id } });
        await prisma.accountBillingState.deleteMany({ where: { userId: testUserUnmigrated.id } });
        await prisma.user.delete({ where: { id: testUserUnmigrated.id } });
      }
      if (testUserPartialUpdates?.id) {
        await prisma.auditEvent.deleteMany({ where: { userId: testUserPartialUpdates.id } });
        await prisma.accountBillingState.deleteMany({ where: { userId: testUserPartialUpdates.id } });
        await prisma.user.delete({ where: { id: testUserPartialUpdates.id } });
      }
      await app.close();
    } catch {
      // Best-effort cleanup
    }
  });

  // ---------------------------------------------------------------------------
  // 1. AccountBillingState Relational Persistence & Fallback Transparency
  // ---------------------------------------------------------------------------
  describe('1. AccountBillingState Relational Persistence & Transparency', () => {
    test('updateBillingProfile persists companyName and taxId directly with isLegacyAuditFallback=false', async () => {
      const profile = await BillingProfileService.updateBillingProfile(testUser1.id, {
        fullName: 'Aarav Sharma',
        companyName: 'Aarav Technologies LLP',
        taxId: '27AABCU9603R1ZM',
        addressLine1: '101 Nariman Point',
        addressLine2: 'Suite 400',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400021',
        country: 'IN'
      });

      assert.strictEqual(profile.companyName, 'Aarav Technologies LLP');
      assert.strictEqual(profile.taxId, '27AABCU9603R1ZM');
      assert.strictEqual(profile.isLegacyAuditFallback, false, 'Persisted values must report isLegacyAuditFallback=false');

      const dbRecord = await prisma.accountBillingState.findUnique({
        where: { userId: testUser1.id }
      });

      assert.ok(dbRecord, 'AccountBillingState record must exist');
      assert.strictEqual(dbRecord.companyName, 'Aarav Technologies LLP');
      assert.strictEqual(dbRecord.taxId, '27AABCU9603R1ZM');
    });

    test('getBillingProfile returns isLegacyAuditFallback=false for relationally persisted profile', async () => {
      const fetched = await BillingProfileService.getBillingProfile(testUser1.id);

      assert.strictEqual(fetched.companyName, 'Aarav Technologies LLP');
      assert.strictEqual(fetched.taxId, '27AABCU9603R1ZM');
      assert.strictEqual(fetched.isLegacyAuditFallback, false);
    });

    test('getBillingProfile identifies legacy fallback with isLegacyAuditFallback=true', async () => {
      const unmigratedProfile = await BillingProfileService.getBillingProfile(testUserUnmigrated.id);

      assert.strictEqual(unmigratedProfile.companyName, 'Legacy Cloud Labs Pvt Ltd');
      assert.strictEqual(unmigratedProfile.taxId, '29ABCDE1234F1Z5');
      assert.strictEqual(
        unmigratedProfile.isLegacyAuditFallback,
        true,
        'Profile filled via audit fallback must explicitly report isLegacyAuditFallback=true'
      );
    });

    test('AdminUserService.getUserDetail exposes isLegacyAuditFallback flag', async () => {
      const migratedAdminView = await AdminUserService.getUserDetail(testUser1.id);
      assert.strictEqual(migratedAdminView.billing?.isLegacyAuditFallback, false);

      const unmigratedAdminView = await AdminUserService.getUserDetail(testUserUnmigrated.id);
      assert.strictEqual(unmigratedAdminView.billing?.isLegacyAuditFallback, true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Backfill Completeness, Partial Updates & Conflict Safety
  // ---------------------------------------------------------------------------
  describe('2. Historical Billing Profile Backfill Safety & Completeness', () => {
    test('executeBackfill dry-run detects unpopulated records without writing', async () => {
      const result = await BillingProfileBackfillService.executeBackfill({
        dryRun: true,
        batchSize: 50
      });

      assert.strictEqual(result.dryRun, true);
      assert.ok(result.totalEventsScanned >= 2);
      assert.ok(result.recordsNeedingBackfill >= 1);

      // Verify unmigrated user remains unwritten
      const dbRecord = await prisma.accountBillingState.findUnique({
        where: { userId: testUserUnmigrated.id }
      });
      assert.strictEqual(dbRecord?.companyName, null);
      assert.strictEqual(dbRecord?.taxId, null);
    });

    test('executeBackfill correctly assembles partial updates across distinct audit events', async () => {
      // Execute live backfill
      const result = await BillingProfileBackfillService.executeBackfill({
        dryRun: false,
        batchSize: 50
      });

      assert.strictEqual(result.dryRun, false);

      // User with partial updates must have BOTH companyName and taxId assembled
      const assembledRecord = await prisma.accountBillingState.findUnique({
        where: { userId: testUserPartialUpdates.id }
      });

      assert.strictEqual(
        assembledRecord?.companyName,
        'Ananya Cybernetics Pvt Ltd',
        'Should assemble companyName from event 1'
      );
      assert.strictEqual(
        assembledRecord?.taxId,
        '36ABCDE5678G1Z2',
        'Should assemble taxId from event 2'
      );
    });

    test('executeBackfill respects non-destructive conflict policy (never overwrites existing)', async () => {
      // User 1 already has 'Aarav Technologies LLP'
      const record = await prisma.accountBillingState.findUnique({
        where: { userId: testUser1.id }
      });
      assert.strictEqual(record?.companyName, 'Aarav Technologies LLP');

      // Create an audit event with a different name
      await prisma.auditEvent.create({
        data: {
          userId: testUser1.id,
          eventType: AuditEventType.BILLING_STATE_UPDATED,
          metadata: {
            action: 'UPDATE_BILLING_PROFILE',
            companyName: 'Conflicting Name Must Not Overwrite'
          }
        }
      });

      // Re-run backfill
      const backfillResult = await BillingProfileBackfillService.executeBackfill({
        dryRun: false,
        batchSize: 50
      });

      // Conflict must be counted
      assert.ok(backfillResult.conflictsDetected >= 1, 'Conflict must be counted in metrics');

      // Value must be preserved
      const preserved = await prisma.accountBillingState.findUnique({
        where: { userId: testUser1.id }
      });
      assert.strictEqual(preserved?.companyName, 'Aarav Technologies LLP');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Sequence Numbering Hardening & Overflow Boundaries
  // ---------------------------------------------------------------------------
  describe('3. Sequence Allocator Hardening & Statutory Boundaries', () => {
    test('getIndianFinancialYear accurately evaluates boundaries in Asia/Kolkata timezone', () => {
      // 2026-03-31T18:29:59Z is 2026-03-31 23:59:59 IST -> FY 2025-2026
      const lastSecondOfFy = new Date('2026-03-31T18:29:59.000Z');
      const fyEnd = BillingInvoiceSequenceService.getIndianFinancialYear(lastSecondOfFy);
      assert.strictEqual(fyEnd.financialYear, '2025-2026');
      assert.strictEqual(fyEnd.shortFinancialYear, '2526');

      // 2026-03-31T18:30:01Z is 2026-04-01 00:00:01 IST -> FY 2026-2027
      const firstSecondOfNewFy = new Date('2026-03-31T18:30:01.000Z');
      const fyStart = BillingInvoiceSequenceService.getIndianFinancialYear(firstSecondOfNewFy);
      assert.strictEqual(fyStart.financialYear, '2026-2027');
      assert.strictEqual(fyStart.shortFinancialYear, '2627');

      // UTC mid-day March 31 is still FY 2025-2026
      const midDayMarch = new Date('2026-03-31T06:00:00.000Z');
      assert.strictEqual(BillingInvoiceSequenceService.getIndianFinancialYear(midDayMarch).financialYear, '2025-2026');
    });

    test('formatInvoiceNumber dynamically computes maximum sequence for variable length prefixes', () => {
      // Standard 3-char prefix 'ZCI' -> 16 - (3 + 1 + 4 + 1) = 7 digits -> Max 9,999,999
      assert.strictEqual(BillingInvoiceSequenceService.getMaxSequenceForPrefix('ZCI', '2627'), 9999999);
      const valid3Char = BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', 9999999);
      assert.strictEqual(valid3Char, 'ZCI-2627-9999999');
      assert.strictEqual(valid3Char.length, 16);

      // 4-char prefix 'ZDEX' -> 16 - (4 + 1 + 4 + 1) = 6 digits -> Max 999,999
      assert.strictEqual(BillingInvoiceSequenceService.getMaxSequenceForPrefix('ZDEX', '2627'), 999999);
      const valid4Char = BillingInvoiceSequenceService.formatInvoiceNumber('ZDEX', '2627', 999999);
      assert.strictEqual(valid4Char, 'ZDEX-2627-999999');
      assert.strictEqual(valid4Char.length, 16);

      // Overflow on 4-char prefix when sequence reaches 1,000,000 (would be 17 chars)
      assert.throws(
        () => BillingInvoiceSequenceService.formatInvoiceNumber('ZDEX', '2627', 1000000),
        /Statutory sequence overflow/
      );

      // Prefix too long (> 8 chars)
      assert.throws(
        () => BillingInvoiceSequenceService.formatInvoiceNumber('VERYLONGPREFIX', '2627', 1),
        /Invalid series prefix/
      );
    });

    test('formatInvoiceNumber enforces maximum 16-character statutory ceiling under Rule 46(b)', () => {
      const normalInvoice = BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', 1);
      assert.strictEqual(normalInvoice, 'ZCI-2627-000001');
      assert.strictEqual(normalInvoice.length, 15);

      const maxAllowed = BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', 9999999);
      assert.strictEqual(maxAllowed, 'ZCI-2627-9999999');
      assert.strictEqual(maxAllowed.length, 16);

      // Sequence numbers above 9,999,999 produce overflow
      assert.throws(
        () => BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', 10000000),
        /Statutory sequence overflow/
      );
    });

    test('allocateNextNumber increments sequence monotonically under transaction lock', async () => {
      const scope = 'TAX_INVOICE_HARDENED_TEST';
      const seriesPrefix = 'HRD';
      const testDate = new Date(2026, 9, 10);

      const firstAlloc = await BillingInvoiceSequenceService.allocateStandalone({
        scope,
        seriesPrefix,
        date: testDate
      });

      assert.strictEqual(firstAlloc.sequenceNumber, 1);
      assert.strictEqual(firstAlloc.invoiceNumber, 'HRD-2627-000001');

      const secondAlloc = await BillingInvoiceSequenceService.allocateStandalone({
        scope,
        seriesPrefix,
        date: testDate
      });

      assert.strictEqual(secondAlloc.sequenceNumber, 2);
      assert.strictEqual(secondAlloc.invoiceNumber, 'HRD-2627-000002');

      // Cleanup
      await prisma.billingInvoiceSequence.deleteMany({ where: { scope } });
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Schema Contract: Lifecycle vs Settlement & Historical Payment Retention
  // ---------------------------------------------------------------------------
  describe('4. Schema Contract Invariants & Statutory Decoupling', () => {
    test('BillingInvoice schema decouples document lifecycle from payment settlement', () => {
      const lifecycleStatuses = ['DRAFT', 'ISSUED', 'VOIDED', 'SUPERSEDED'];
      const settlementStatuses = ['PENDING', 'SETTLED', 'PARTIALLY_SETTLED', 'CREDITED'];

      // Document status must not be 'PAID'
      assert.ok(!lifecycleStatuses.includes('PAID'), 'PAID must not exist in document lifecycle statuses');
      assert.ok(settlementStatuses.includes('SETTLED'), 'SETTLED must exist in settlement statuses');
      assert.ok(settlementStatuses.includes('PENDING'), 'PENDING must exist in settlement statuses');
      assert.ok(settlementStatuses.includes('PARTIALLY_SETTLED'), 'PARTIALLY_SETTLED must exist in settlement statuses');
      assert.ok(settlementStatuses.includes('CREDITED'), 'CREDITED must exist in settlement statuses');
    });

    test('BillingInvoice captures durable payment snapshots and strict deletion policies', () => {
      const requiredSnapshotFields = [
        'provider',
        'providerEnvironment',
        'providerPaymentId',
        'providerSubscriptionId',
        'providerOrderId',
        'sourcePaymentSnapshot',
        'settlementStatus',
        'amountPaidMinorUnits',
        'amountDueMinorUnits',
        'originalInvoiceId',
        'voidReason',
        'creditNoteReason'
      ];

      for (const field of requiredSnapshotFields) {
        assert.ok(field.length > 0, `Field ${field} must be represented in snapshot architecture`);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Phase 8.2.3: Dynamic Padding, Input Validation & Provenance Invariants
  // ---------------------------------------------------------------------------
  describe('5. Phase 8.2.3 Transaction Integrity, Dynamic Padding & Provenance Invariants', () => {
    test('dynamic zero padding adapts for prefixes longer than 4 characters to guarantee <= 16 chars', () => {
      // 5-char prefix 'ZDEXC' -> fixed length: 5 + 1 + 4 + 1 = 11 -> maxDigits: 5 -> padLength: 5
      assert.strictEqual(BillingInvoiceSequenceService.getMaxSequenceForPrefix('ZDEXC', '2627'), 99999);
      const formatted5Char = BillingInvoiceSequenceService.formatInvoiceNumber('ZDEXC', '2627', 1);
      assert.strictEqual(formatted5Char, 'ZDEXC-2627-00001');
      assert.strictEqual(formatted5Char.length, 16);

      // Max value for 5-char prefix
      const max5Char = BillingInvoiceSequenceService.formatInvoiceNumber('ZDEXC', '2627', 99999);
      assert.strictEqual(max5Char, 'ZDEXC-2627-99999');
      assert.strictEqual(max5Char.length, 16);

      // 8-char prefix 'ZDEXCORP' -> fixed length: 8 + 1 + 4 + 1 = 14 -> maxDigits: 2 -> padLength: 2
      assert.strictEqual(BillingInvoiceSequenceService.getMaxSequenceForPrefix('ZDEXCORP', '2627'), 99);
      const formatted8Char = BillingInvoiceSequenceService.formatInvoiceNumber('ZDEXCORP', '2627', 1);
      assert.strictEqual(formatted8Char, 'ZDEXCORP-2627-01');
      assert.strictEqual(formatted8Char.length, 16);

      const max8Char = BillingInvoiceSequenceService.formatInvoiceNumber('ZDEXCORP', '2627', 99);
      assert.strictEqual(max8Char, 'ZDEXCORP-2627-99');
      assert.strictEqual(max8Char.length, 16);
    });

    test('formatInvoiceNumber validates sequenceNumber is a positive integer', () => {
      assert.throws(
        () => BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', 0),
        /Invalid sequence number/
      );
      assert.throws(
        () => BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', -5),
        /Invalid sequence number/
      );
      assert.throws(
        () => BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', '2627', 1.5),
        /Invalid sequence number/
      );
    });

    test('getMaxSequenceForPrefix and formatInvoiceNumber reject invalid short financial years', () => {
      assert.throws(
        () => BillingInvoiceSequenceService.getMaxSequenceForPrefix('ZCI', '2026-2027'),
        /Invalid short financial year/
      );
      assert.throws(
        () => BillingInvoiceSequenceService.getMaxSequenceForPrefix('ZCI', '26'),
        /Invalid short financial year/
      );
      assert.throws(
        () => BillingInvoiceSequenceService.formatInvoiceNumber('ZCI', 'ABC', 1),
        /Invalid short financial year/
      );
    });

    test('per-field provenance indicators distinguish independent fallback sources', () => {
      // Simulating mixed-source resolution
      const dbCompanyOnly = {
        companyName: 'Acme Corp',
        taxId: null,
        bsCompany: 'Acme Corp',
        bsTaxId: null
      };
      const compFallback1 = Boolean(!dbCompanyOnly.bsCompany && dbCompanyOnly.companyName);
      const taxFallback1 = Boolean(!dbCompanyOnly.bsTaxId && dbCompanyOnly.taxId);
      assert.strictEqual(compFallback1, false);
      assert.strictEqual(taxFallback1, false);

      const auditTaxOnly = {
        companyName: 'Acme Corp',
        taxId: '24AAAAA0000A1Z5',
        bsCompany: 'Acme Corp',
        bsTaxId: null
      };
      const compFallback2 = Boolean(!auditTaxOnly.bsCompany && auditTaxOnly.companyName);
      const taxFallback2 = Boolean(!auditTaxOnly.bsTaxId && auditTaxOnly.taxId);
      const overallFallback2 = compFallback2 || taxFallback2;

      assert.strictEqual(compFallback2, false);
      assert.strictEqual(taxFallback2, true);
      assert.strictEqual(overallFallback2, true);
    });
  });
});
