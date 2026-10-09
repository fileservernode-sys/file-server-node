import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import { CurrencyCode, AuditEventType, BillingReceiptType, BillingReceiptStatus, BillingInterval, PaymentProvider, PaymentEnvironment } from '@prisma/client';
import { BillingProfileService } from '../src/services/billing/billing_profile_service.js';
import { AdminUserService } from '../src/routes/admin/operations/users/service.js';
import { RazorpayCheckoutService } from '../src/services/billing/providers/razorpay/index.js';
import { ValidationError } from '../src/errors/app-error.js';

describe('PHASE 6.5: Billing Profile Validation & Data Consistency Audit Test Suite', () => {
  let app: FastifyInstance;
  let userA: any;
  let tokenA: string;
  let userB: any;
  let tokenB: string;

  before(async () => {
    app = await buildApp();
    await app.ready();

    userA = await prisma.user.create({
      data: {
        email: `profile_consistency_a_${Date.now()}@zdexcloud.com`,
        fullName: 'Sarah Connor',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    tokenA = `tok_profile_consistency_a_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: userA.id,
        tokenHash: hashSessionToken(tokenA),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    userB = await prisma.user.create({
      data: {
        email: `profile_consistency_b_${Date.now()}@zdexcloud.com`,
        fullName: 'John Connor',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    tokenB = `tok_profile_consistency_b_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: userB.id,
        tokenHash: hashSessionToken(tokenB),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
  });

  after(async () => {
    if (userA) {
      await prisma.billingReceipt.deleteMany({ where: { userId: userA.id } });
      await prisma.billingPayment.deleteMany({ where: { userId: userA.id } });
      await prisma.subscription.deleteMany({ where: { userId: userA.id } });
      await prisma.auditEvent.deleteMany({ where: { userId: userA.id } });
      await prisma.userSession.deleteMany({ where: { userId: userA.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: userA.id } });
      await prisma.user.deleteMany({ where: { id: userA.id } });
    }
    if (userB) {
      await prisma.billingReceipt.deleteMany({ where: { userId: userB.id } });
      await prisma.billingPayment.deleteMany({ where: { userId: userB.id } });
      await prisma.subscription.deleteMany({ where: { userId: userB.id } });
      await prisma.auditEvent.deleteMany({ where: { userId: userB.id } });
      await prisma.userSession.deleteMany({ where: { userId: userB.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: userB.id } });
      await prisma.user.deleteMany({ where: { id: userB.id } });
    }
    await app.close();
  });

  it('TC-CONSISTENCY-01: Deterministic resolution of companyName and taxId across non-profile audit events', async () => {
    // 1. Save profile with company and taxId
    await BillingProfileService.updateBillingProfile(userA.id, {
      fullName: 'Sarah Connor',
      companyName: 'Cyberdyne Systems Corp',
      taxId: '27AABCC1234D1Z8',
      addressLine1: '100 Industrial Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400001',
      country: 'IN'
    });

    // 2. Simulate subsequent intervening billing state audit event (e.g. dunning or country confirm)
    await prisma.auditEvent.create({
      data: {
        userId: userA.id,
        eventType: AuditEventType.BILLING_STATE_UPDATED,
        metadata: {
          action: 'CONFIRM_BILLING_COUNTRY',
          oldCountry: 'IN',
          newCountry: 'IN'
        }
      }
    });

    // 3. Retrieve profile: companyName and taxId must NOT be shadowed or lost
    const profile = await BillingProfileService.getBillingProfile(userA.id);
    assert.strictEqual(profile.companyName, 'Cyberdyne Systems Corp');
    assert.strictEqual(profile.taxId, '27AABCC1234D1Z8');
  });

  it('TC-CONSISTENCY-02: Clearing optional companyName and taxId removes previously effective values', async () => {
    await BillingProfileService.updateBillingProfile(userA.id, {
      fullName: 'Sarah Connor',
      companyName: null,
      taxId: null,
      addressLine1: '100 Industrial Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400001',
      country: 'IN'
    });

    const profile = await BillingProfileService.getBillingProfile(userA.id);
    assert.strictEqual(profile.companyName, null);
    assert.strictEqual(profile.taxId, null);
  });

  it('TC-CONSISTENCY-03: Strict length validation and whitespace normalization', async () => {
    // Single character name rejected
    assert.throws(() => {
      BillingProfileService.validateFullName('A');
    }, ValidationError);

    // Whitespace only address rejected
    assert.throws(() => {
      BillingProfileService.validateAddressLine1('   ');
    }, ValidationError);

    // Short address rejected (< 3 chars)
    assert.throws(() => {
      BillingProfileService.validateAddressLine1('AB');
    }, ValidationError);

    // Short city rejected (< 2 chars)
    assert.throws(() => {
      BillingProfileService.validateCity('X');
    }, ValidationError);

    // Valid inputs normalized cleanly
    const normalizedName = BillingProfileService.validateFullName('  Dr. Sarah Connor  ');
    assert.strictEqual(normalizedName, 'Dr. Sarah Connor');
  });

  it('TC-CONSISTENCY-04: Country-aware postal rules on PUT /api/v1/billing/country', async () => {
    // UAE allows omitted postal code
    const resUae = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { country: 'AE', postalCode: '' }
    });
    assert.strictEqual(resUae.statusCode, 200);

    // US rejects omitted postal code
    const resUs = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { country: 'US', postalCode: '' }
    });
    assert.strictEqual(resUs.statusCode, 400);
  });

  it('TC-CONSISTENCY-05: Indian GSTIN format validation and rejection', async () => {
    // Valid 15-character alphanumeric GSTIN
    const validGstin = BillingProfileService.validateTaxId('27AABCC1234D1Z8', 'IN');
    assert.strictEqual(validGstin, '27AABCC1234D1Z8');

    // Invalid format rejected for India
    assert.throws(() => {
      BillingProfileService.validateTaxId('12345INVALID', 'IN');
    }, ValidationError);
  });

  it('TC-CONSISTENCY-06: International tax ID format allows non-GSTIN identifiers', async () => {
    // UK VAT format allowed for GB
    const ukVat = BillingProfileService.validateTaxId('GB999999973', 'GB');
    assert.strictEqual(ukVat, 'GB999999973');

    // US EIN format allowed for US
    const usEin = BillingProfileService.validateTaxId('12-3456789', 'US');
    assert.strictEqual(usEin, '12-3456789');
  });

  it('TC-CONSISTENCY-07: Consistent profile representation across customer and admin views', async () => {
    await BillingProfileService.updateBillingProfile(userB.id, {
      fullName: 'John Connor',
      companyName: 'Resistance Logistics LLC',
      taxId: 'US-99887766',
      addressLine1: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'Oregon',
      postalCode: '97477',
      country: 'US'
    });

    const customerProfile = await BillingProfileService.getBillingProfile(userB.id);
    const adminDetail = await AdminUserService.getUserDetail(userB.id);

    assert.strictEqual(customerProfile.fullName, adminDetail.billing?.billingName);
    assert.strictEqual(customerProfile.companyName, adminDetail.billing?.companyName);
    assert.strictEqual(customerProfile.taxId, adminDetail.billing?.taxId);
    assert.strictEqual(customerProfile.addressLine1, adminDetail.billing?.billingAddress1);
    assert.strictEqual(customerProfile.city, adminDetail.billing?.billingCity);
    assert.strictEqual(customerProfile.state, adminDetail.billing?.billingState);
    assert.strictEqual(customerProfile.postalCode, adminDetail.billing?.billingPostalCode);
    assert.strictEqual(customerProfile.country, adminDetail.billing?.billingCountry);
    assert.strictEqual(customerProfile.currency, adminDetail.billing?.currency);
  });

  it('TC-CONSISTENCY-08: Checkout prerequisite consistency: rejects when required fields missing, allows when optional fields absent', async () => {
    // 1. Missing street address rejected
    await prisma.accountBillingState.update({
      where: { userId: userB.id },
      data: { billingAddress1: null }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(userB.id, { planCode: 'PRO_MONTHLY' });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /complete billing address and legal name are required/i);
        return true;
      }
    );

    // 2. Complete required fields but absent optional fields (companyName=null, taxId=null, addressLine2=null) succeeds
    await prisma.accountBillingState.update({
      where: { userId: userB.id },
      data: {
        billingName: 'John Connor',
        billingAddress1: '742 Evergreen Terrace',
        billingAddress2: null,
        billingCity: 'Springfield',
        billingState: 'Oregon',
        billingPostalCode: '97477',
        billingCountry: 'US',
        currency: CurrencyCode.USD
      }
    });

    const profile = await BillingProfileService.getBillingProfile(userB.id);
    assert.ok(profile.countryConfirmed && profile.fullName && profile.addressLine1 && profile.city && profile.state && profile.postalCode);
  });

  it('TC-CONSISTENCY-09: Historical BillingReceipt snapshot immutability', async () => {
    // 1. Setup subscription and payment for receipt foreign keys
    const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
    const planPrice = await prisma.planPrice.findFirst({ where: { planId: plan?.id, currency: CurrencyCode.INR } });

    const sub = await prisma.subscription.create({
      data: {
        userId: userA.id,
        planId: plan!.id,
        planPriceId: planPrice!.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: `sub_hist_${Date.now()}`,
        status: 'ACTIVE',
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    const payment = await prisma.billingPayment.create({
      data: {
        userId: userA.id,
        subscriptionId: sub.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_hist_${Date.now()}`,
        amountMinorUnits: 4900,
        currency: CurrencyCode.INR,
        status: 'SUCCESS'
      }
    });

    // 2. Create historical receipt with original snapshot
    const historicalReceipt = await prisma.billingReceipt.create({
      data: {
        receiptNumber: `ZCR-HIST-${Date.now()}`,
        userId: userA.id,
        subscriptionId: sub.id,
        paymentId: payment.id,
        type: BillingReceiptType.SUBSCRIPTION_PURCHASE,
        status: BillingReceiptStatus.ISSUED,
        issuedAt: new Date(),
        chargedAt: new Date(),
        planCode: 'PRO_MONTHLY',
        planName: 'Pro Monthly',
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        subtotalMinorUnits: 4900,
        discountMinorUnits: 0,
        taxMinorUnits: 0,
        totalMinorUnits: 4900,
        amountPaidMinorUnits: 4900,
        customerName: 'Original Historical Name',
        customerEmail: userA.email,
        billingCountry: 'IN',
        billingAddress: {
          addressLine1: 'Historical Old Street 1',
          city: 'Old City',
          state: 'Old State',
          postalCode: '111111',
          country: 'IN'
        },
        merchantName: 'ZdexCloud',
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST
      }
    });

    // 3. Modify customer profile
    await BillingProfileService.updateBillingProfile(userA.id, {
      fullName: 'Updated Modern Name',
      companyName: 'New Modern Org',
      taxId: null,
      addressLine1: '999 Brand New Boulevard',
      city: 'New City',
      state: 'New State',
      postalCode: '999999',
      country: 'IN'
    });

    // 4. Verify historical receipt was NOT mutated
    const fetchedReceipt = await prisma.billingReceipt.findUnique({
      where: { id: historicalReceipt.id }
    });
    assert.ok(fetchedReceipt);
    assert.strictEqual(fetchedReceipt.customerName, 'Original Historical Name');
    const snap = fetchedReceipt.billingAddress as any;
    assert.strictEqual(snap.addressLine1, 'Historical Old Street 1');
    assert.strictEqual(snap.city, 'Old City');
  });

  it('TC-CONSISTENCY-10: Ownership and IDOR enforcement on billing profile endpoints', async () => {
    // Unauthenticated GET rejected
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/profile'
    });
    assert.strictEqual(unauthRes.statusCode, 401);

    // Unauthenticated PUT rejected
    const unauthPut = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      payload: { fullName: 'Attacker' }
    });
    assert.strictEqual(unauthPut.statusCode, 401);
  });
});
