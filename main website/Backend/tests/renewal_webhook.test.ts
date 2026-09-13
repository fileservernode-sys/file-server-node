import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import {
  RazorpayWebhookService,
  verifyRazorpayWebhookSignature
} from '../src/services/billing/providers/razorpay/index.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval,
  PaymentStatus,
  AuditEventType,
  WebhookEventStatus
} from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('ZC-BILLING-5.2 Recurring Charge & Renewal Foundation Test Suite', () => {
  let app: FastifyInstance;
  let testUserIn: any;
  let testUserUs: any;
  let proMonthlyInrPrice: any;
  let proYearlyInrPrice: any;
  let proMonthlyUsdPrice: any;
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_renewal_1234567890';

  let idCounter = 0;
  function uniqueId(prefix = 'id'): string {
    idCounter += 1;
    return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).substring(2, 7)}`;
  }

  // Helper to compute valid HMAC SHA256 signature
  function computeSignature(payload: string | Buffer, secret: string = mockWebhookSecret): string {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  // Helper to generate sample Razorpay subscription.charged webhook payload
  function createSampleChargedPayload(options: {
    subscriptionId: string;
    planId: string;
    paymentId?: string;
    amount?: number;
    currency?: string;
    paymentStatus?: string;
    currentStart?: number;
    currentEnd?: number;
    errorCode?: string | null;
    errorDescription?: string | null;
  }) {
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = options.currentStart || nowSec;
    const endSec = options.currentEnd || nowSec + 30 * 24 * 3600;
    const paymentId = options.paymentId || uniqueId('pay_test');

    return {
      entity: 'event',
      account_id: 'acc_mock123',
      event: 'subscription.charged',
      contains: ['subscription', 'payment'],
      payload: {
        subscription: {
          entity: {
            id: options.subscriptionId,
            entity: 'subscription',
            plan_id: options.planId,
            customer_id: 'cust_mock123',
            status: 'active',
            current_start: startSec,
            current_end: endSec,
            ended_at: null,
            quantity: 1,
            notes: [],
            charge_at: endSec,
            start_at: startSec,
            end_at: startSec + 365 * 24 * 3600,
            auth_attempts: 0,
            total_count: 12,
            paid_count: 2,
            remaining_count: 10,
            short_url: 'https://rzp.io/i/mock_renew',
            has_scheduled_changes: false,
            change_scheduled_at: null,
            source: 'api',
            created_at: startSec
          }
        },
        payment: {
          entity: {
            id: paymentId,
            entity: 'payment',
            amount: options.amount !== undefined ? options.amount : 4900,
            currency: options.currency || 'INR',
            status: options.paymentStatus || 'captured',
            order_id: null,
            invoice_id: 'inv_mock123',
            international: false,
            method: 'card',
            amount_refunded: 0,
            refund_status: null,
            captured: true,
            description: `Recurring charge for subscription ${options.subscriptionId}`,
            card_id: 'card_mock123',
            bank: null,
            wallet: null,
            vpa: null,
            email: 'user@zdexcloud.test',
            contact: '+919876543210',
            fee: 98,
            tax: 18,
            error_code: options.errorCode !== undefined ? options.errorCode : null,
            error_description: options.errorDescription !== undefined ? options.errorDescription : null,
            error_source: null,
            error_step: null,
            error_reason: null,
            created_at: nowSec
          }
        }
      },
      created_at: nowSec
    };
  }

  async function seedStandardMappings(env: PaymentEnvironment = PaymentEnvironment.TEST) {
    const proMonthlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } },
      include: { plan: true }
    });
    const proMonthlyUsd = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.USD, plan: { code: 'PRO_MONTHLY' } },
      include: { plan: true }
    });
    const proYearlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_YEARLY' } },
      include: { plan: true }
    });
    const proYearlyUsd = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.USD, plan: { code: 'PRO_YEARLY' } },
      include: { plan: true }
    });

    assert.ok(proMonthlyInr && proMonthlyUsd && proYearlyInr && proYearlyUsd);

    proMonthlyInrPrice = proMonthlyInr;
    proYearlyInrPrice = proYearlyInr;
    proMonthlyUsdPrice = proMonthlyUsd;

    await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proMonthlyInr.plan.id,
        planPriceId: proMonthlyInr.id,
        providerPlanId: 'plan_pro_monthly_inr_renew',
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        period: 'monthly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });

    await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proMonthlyUsd.plan.id,
        planPriceId: proMonthlyUsd.id,
        providerPlanId: 'plan_pro_monthly_usd_renew',
        currency: CurrencyCode.USD,
        amountMinorUnits: 99,
        period: 'monthly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });

    await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proYearlyInr.plan.id,
        planPriceId: proYearlyInr.id,
        providerPlanId: 'plan_pro_yearly_inr_renew',
        currency: CurrencyCode.INR,
        amountMinorUnits: 50000,
        period: 'yearly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });
  }

  before(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
    process.env.RAZORPAY_KEY_ID = 'rzp_test_mockKeyRenewal123';
    process.env.RAZORPAY_KEY_SECRET = 'sec_mockSecretRenewal123';

    await PlanService.seedInitialCatalog();
    app = await buildApp();
    await app.ready();

    await prisma.billingPayment.deleteMany({});
    await prisma.billingWebhookEvent.deleteMany({});
    await prisma.notificationRecord.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.subscription.deleteMany({});

    const timestamp = Date.now();

    testUserIn = await prisma.user.create({
      data: {
        email: `wh_renew_in_${timestamp}@zdexcloud.test`,
        fullName: 'Renewal India User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testUserUs = await prisma.user.create({
      data: {
        email: `wh_renew_us_${timestamp}@zdexcloud.test`,
        fullName: 'Renewal US User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    await BillingStateService.getBillingState(testUserIn.id);
    await BillingCountryService.confirmBillingCountry(testUserIn.id, {
      country: 'IN',
      postalCode: '380001'
    });

    await BillingStateService.getBillingState(testUserUs.id);
    await BillingCountryService.confirmBillingCountry(testUserUs.id, {
      country: 'US',
      postalCode: '94105'
    });
  });

  beforeEach(async () => {
    await prisma.billingPayment.deleteMany({
      where: { userId: { in: [testUserIn.id, testUserUs.id] } }
    });
    await prisma.notificationRecord.deleteMany({
      where: { userId: { in: [testUserIn.id, testUserUs.id] } }
    });
    await prisma.auditEvent.deleteMany({
      where: { userId: { in: [testUserIn.id, testUserUs.id] } }
    });
    await prisma.billingWebhookEvent.deleteMany({});
    await prisma.subscription.deleteMany({
      where: { userId: { in: [testUserIn.id, testUserUs.id] } }
    });
    await prisma.billingProviderPlanMapping.deleteMany({
      where: { providerPlanId: { in: ['plan_pro_monthly_inr_renew', 'plan_pro_monthly_usd_renew', 'plan_pro_yearly_inr_renew'] } }
    });
    await prisma.accountBillingState.updateMany({
      where: { userId: { in: [testUserIn.id, testUserUs.id] } },
      data: {
        status: BillingStatus.FREE,
        activeSubscriptionId: null
      }
    });
    await seedStandardMappings();
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (testUserIn) {
      await prisma.billingPayment.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.notificationRecord.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.auditEvent.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.subscription.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.user.deleteMany({ where: { id: testUserIn.id } });
    }
    if (testUserUs) {
      await prisma.billingPayment.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.notificationRecord.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.auditEvent.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.subscription.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.user.deleteMany({ where: { id: testUserUs.id } });
    }
    await prisma.billingWebhookEvent.deleteMany({});
    await prisma.billingProviderPlanMapping.deleteMany({
      where: { providerPlanId: { in: ['plan_pro_monthly_inr_renew', 'plan_pro_monthly_usd_renew', 'plan_pro_yearly_inr_renew'] } }
    });
  });

  // ===========================================================================
  // CATEGORY 1: WEBHOOK / EVENT HANDLING & SIGNATURE SECURITY
  // ===========================================================================
  describe('1. Webhook Signature & Payload Validation', () => {
    test('1. Valid subscription.charged event is accepted with HTTP 200', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_renew_valid'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });
      await prisma.accountBillingState.update({
        where: { userId: testUserIn.id },
        data: { status: BillingStatus.ACTIVE, activeSubscriptionId: sub.id }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        amount: 4900,
        currency: 'INR'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_renew_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, true);
    });

    test('2. Missing HMAC signature is rejected with 400', async () => {
      const payload = createSampleChargedPayload({
        subscriptionId: uniqueId('sub_nosig'),
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: { 'content-type': 'application/json' },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('3. Invalid HMAC signature is rejected with 400', async () => {
      const payload = createSampleChargedPayload({
        subscriptionId: uniqueId('sub_badsig'),
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': 'invalid_signature_hex_1234567890abcdef'
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('4. Malformed JSON payload is rejected with 400', async () => {
      const rawBody = '{"broken": json...';
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('5. Missing subscription ID in charged event payload is rejected with 400', async () => {
      const invalidPayload = {
        entity: 'event',
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              plan_id: 'plan_pro_monthly_inr_renew'
              // missing id
            }
          }
        }
      };
      const rawBody = JSON.stringify(invalidPayload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });
  });

  // ===========================================================================
  // CATEGORY 2: SUBSCRIPTION MATCHING & CONTRACT VALIDATION
  // ===========================================================================
  describe('2. Subscription Matching & Contract Validation', () => {
    test('6. Provider subscription resolves correct internal subscription and user', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_match_test'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_match')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.data.subscriptionId, sub.id);
    });

    test('7. Unknown provider subscription does not create subscription or grant entitlements', async () => {
      const unknownSubId = uniqueId('sub_unknown');
      const payload = createSampleChargedPayload({
        subscriptionId: unknownSubId,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_unknown')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.data.unmatched, true);

      // Verify no subscription created
      const count = await prisma.subscription.count({
        where: { providerSubscriptionId: unknownSubId }
      });
      assert.strictEqual(count, 0);
    });

    test('8. Environment mismatch (TEST webhook on LIVE subscription) is rejected with 400', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.LIVE, // LIVE
          providerSubscriptionId: uniqueId('sub_env_live'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_env_mismatch')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('9. Provider plan mismatch against contracted plan is rejected with 400', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_plan_mismatch'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_different_malicious_id'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_plan_mismatch')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('10. Currency mismatch against contracted currency is rejected with 400', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_curr_mismatch'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        currency: 'USD' // Mismatched currency
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_curr_mismatch')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('11. Amount mismatch against contracted price is rejected with 400', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_amount_mismatch'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        amount: 100 // Tampered amount
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_amount_mismatch')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });
  });

  // ===========================================================================
  // CATEGORY 3: SUCCESSFUL RENEWAL & PERIOD ADVANCEMENT
  // ===========================================================================
  describe('3. Successful Renewal & Period Advancement', () => {
    test('12. ACTIVE subscription is renewed successfully', async () => {
      const oldStart = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const oldEnd = new Date();

      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_renew_active'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: oldStart,
          currentPeriodEnd: oldEnd
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_renew_active')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({
        where: { id: sub.id }
      });
      assert.strictEqual(updatedSub?.status, BillingStatus.ACTIVE);
      assert.ok(updatedSub!.currentPeriodEnd.getTime() > oldEnd.getTime());
    });

    test('13. Current period advances correctly based on provider timestamps', async () => {
      const oldStart = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const oldEnd = new Date();

      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_advance_ts'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: oldStart,
          currentPeriodEnd: oldEnd
        }
      });

      const newStartSec = Math.floor(oldEnd.getTime() / 1000);
      const newEndSec = newStartSec + 30 * 24 * 3600;

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        currentStart: newStartSec,
        currentEnd: newEndSec
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_advance_ts')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({
        where: { id: sub.id }
      });
      assert.strictEqual(Math.floor(updatedSub!.currentPeriodStart.getTime() / 1000), newStartSec);
      assert.strictEqual(Math.floor(updatedSub!.currentPeriodEnd.getTime() / 1000), newEndSec);
    });

    test('14. Monthly interval advances one calendar month', async () => {
      const start = new Date(Date.UTC(2026, 0, 15)); // Jan 15 2026
      const end = new Date(Date.UTC(2026, 1, 15));   // Feb 15 2026

      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_monthly_cal'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: start,
          currentPeriodEnd: end
        }
      });

      // Payload with omitted provider start/end to test deterministic calendar calculation
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      delete (payload.payload.subscription.entity as any).current_start;
      delete (payload.payload.subscription.entity as any).current_end;

      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_monthly_cal')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({
        where: { id: sub.id }
      });
      assert.strictEqual(updatedSub!.currentPeriodStart.toISOString(), end.toISOString());
      // Expect 1 month addition: March 15 2026
      const expectedEnd = new Date(end);
      expectedEnd.setMonth(expectedEnd.getMonth() + 1);
      assert.strictEqual(updatedSub!.currentPeriodEnd.toISOString(), expectedEnd.toISOString());
    });

    test('15. Yearly interval advances one calendar year', async () => {
      const start = new Date(Date.UTC(2026, 0, 15)); // Jan 15 2026
      const end = new Date(Date.UTC(2027, 0, 15));   // Jan 15 2027

      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proYearlyInrPrice.planId,
          planPriceId: proYearlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_yearly_cal'),
          providerPlanId: 'plan_pro_yearly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.YEARLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 50000,
          currentPeriodStart: start,
          currentPeriodEnd: end
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_yearly_inr_renew',
        amount: 50000
      });
      delete (payload.payload.subscription.entity as any).current_start;
      delete (payload.payload.subscription.entity as any).current_end;

      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_yearly_cal')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({
        where: { id: sub.id }
      });
      assert.strictEqual(updatedSub!.currentPeriodStart.toISOString(), end.toISOString());
      // Expect 1 year addition: Jan 15 2028
      const expectedEnd = new Date(end);
      expectedEnd.setFullYear(expectedEnd.getFullYear() + 1);
      assert.strictEqual(updatedSub!.currentPeriodEnd.toISOString(), expectedEnd.toISOString());
    });

    test('16. AccountBillingState remains ACTIVE after renewal', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_state_active'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });
      await prisma.accountBillingState.update({
        where: { userId: testUserIn.id },
        data: { status: BillingStatus.ACTIVE, activeSubscriptionId: sub.id }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_state_active')
        },
        payload: rawBody
      });

      const state = await prisma.accountBillingState.findUnique({
        where: { userId: testUserIn.id }
      });
      assert.strictEqual(state?.status, BillingStatus.ACTIVE);
    });

    test('17. AccountBillingState activeSubscriptionId remains linked to same subscription', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_link_same'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });
      await prisma.accountBillingState.update({
        where: { userId: testUserIn.id },
        data: { status: BillingStatus.ACTIVE, activeSubscriptionId: sub.id }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_link_same')
        },
        payload: rawBody
      });

      const state = await prisma.accountBillingState.findUnique({
        where: { userId: testUserIn.id }
      });
      assert.strictEqual(state?.activeSubscriptionId, sub.id);
    });

    test('18. Entitlement state remains authoritative (maxServers = 5, priorityRelay = true)', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_ent_auth'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });
      await prisma.accountBillingState.update({
        where: { userId: testUserIn.id },
        data: { status: BillingStatus.ACTIVE, activeSubscriptionId: sub.id }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_ent_auth')
        },
        payload: rawBody
      });

      const entitlements = await EntitlementService.resolveUserEntitlements(testUserIn.id);
      assert.strictEqual(entitlements.planCode, 'PRO_MONTHLY');
      assert.strictEqual(entitlements.maxServers, 5);
      assert.strictEqual(entitlements.priorityRelay, true);
    });
  });

  // ===========================================================================
  // CATEGORY 4: FINANCIAL HISTORY & BILLING PAYMENT RECORD
  // ===========================================================================
  describe('4. Financial History & BillingPayment Record', () => {
    test('19. Successful renewal records an immutable BillingPayment row', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_fin_rec'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });

      const payId = uniqueId('pay_fin_rec');
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        paymentId: payId
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_fin_rec')
        },
        payload: rawBody
      });

      const payment = await prisma.billingPayment.findUnique({
        where: {
          provider_environment_providerPaymentId: {
            provider: PaymentProvider.RAZORPAY,
            environment: PaymentEnvironment.TEST,
            providerPaymentId: payId
          }
        }
      });

      assert.ok(payment);
      assert.strictEqual(payment.userId, testUserIn.id);
      assert.strictEqual(payment.subscriptionId, sub.id);
      assert.strictEqual(payment.status, PaymentStatus.SUCCESS);
      assert.strictEqual(payment.amountMinorUnits, 4900);
      assert.strictEqual(payment.currency, CurrencyCode.INR);
    });

    test('20. Provider payment ID is safely preserved in BillingPayment', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_payid_pres'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payId = uniqueId('pay_prov_id_test');
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        paymentId: payId
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_payid_pres')
        },
        payload: rawBody
      });

      const payment = await prisma.billingPayment.findFirst({
        where: { providerPaymentId: payId }
      });
      assert.ok(payment);
      assert.strictEqual(payment.providerPaymentId, payId);
    });

    test('21. Provider event ID is preserved in BillingPayment row', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_evtid_pres'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const evtId = uniqueId('evt_preserve_test');
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': evtId
        },
        payload: rawBody
      });

      const payment = await prisma.billingPayment.findFirst({
        where: { providerEventId: evtId }
      });
      assert.ok(payment);
      assert.strictEqual(payment.providerEventId, evtId);
    });

    test('22. Contracted amount (4900 paise) is preserved in BillingPayment', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_amt_pres'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        amount: 4900
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_amt_pres')
        },
        payload: rawBody
      });

      const payment = await prisma.billingPayment.findFirst({
        where: { subscriptionId: sub.id }
      });
      assert.strictEqual(payment?.amountMinorUnits, 4900);
    });

    test('23. Contracted currency (INR / USD) is preserved in BillingPayment', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserUs.id,
          planId: proMonthlyUsdPrice.planId,
          planPriceId: proMonthlyUsdPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_usd_pres'),
          providerPlanId: 'plan_pro_monthly_usd_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.USD,
          amountMinorUnits: 99,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_usd_renew',
        currency: 'USD',
        amount: 99
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_usd_pres')
        },
        payload: rawBody
      });

      const payment = await prisma.billingPayment.findFirst({
        where: { subscriptionId: sub.id }
      });
      assert.strictEqual(payment?.currency, CurrencyCode.USD);
      assert.strictEqual(payment?.amountMinorUnits, 99);
    });

    test('24. Contracted priceVersion is preserved in BillingPayment metadata', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_ver_pres'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_ver_pres')
        },
        payload: rawBody
      });

      const payment = await prisma.billingPayment.findFirst({
        where: { subscriptionId: sub.id }
      });
      assert.strictEqual((payment?.metadata as any)?.priceVersion, 1);
    });
  });

  // ===========================================================================
  // CATEGORY 5: IDEMPOTENCY & CONCURRENCY
  // ===========================================================================
  describe('5. Durable Idempotency & Concurrency', () => {
    test('25. Duplicate event delivery returns 200 with idempotent: true and does not advance period twice', async () => {
      const oldStart = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const oldEnd = new Date();

      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_dup_renew'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: oldStart,
          currentPeriodEnd: oldEnd
        }
      });

      const dupEvtId = uniqueId('evt_dup_renew');
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      // Delivery 1
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId
        },
        payload: rawBody
      });
      assert.strictEqual(res1.statusCode, 200);

      const subAfterFirst = await prisma.subscription.findUnique({ where: { id: sub.id } });
      const firstRenewedEnd = subAfterFirst!.currentPeriodEnd.getTime();

      // Delivery 2 (Duplicate)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId
        },
        payload: rawBody
      });
      assert.strictEqual(res2.statusCode, 200);
      const json2 = JSON.parse(res2.body);
      assert.strictEqual(json2.data.idempotent, true);

      const subAfterSecond = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(subAfterSecond!.currentPeriodEnd.getTime(), firstRenewedEnd, 'Period must NOT advance twice');
    });

    test('26. Concurrent duplicate renewal deliveries are safe and idempotent', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_concurrent_renew'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });

      const concurrentEvtId = uniqueId('evt_concurrent_renew');
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const results = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/billing/webhooks/razorpay',
          headers: {
            'content-type': 'application/json',
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': concurrentEvtId
          },
          payload: rawBody
        }),
        app.inject({
          method: 'POST',
          url: '/api/v1/billing/webhooks/razorpay',
          headers: {
            'content-type': 'application/json',
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': concurrentEvtId
          },
          payload: rawBody
        }),
        app.inject({
          method: 'POST',
          url: '/api/v1/billing/webhooks/razorpay',
          headers: {
            'content-type': 'application/json',
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': concurrentEvtId
          },
          payload: rawBody
        })
      ]);

      for (const res of results) {
        assert.strictEqual(res.statusCode, 200);
      }

      const auditEvents = await prisma.auditEvent.findMany({
        where: {
          userId: testUserIn.id,
          eventType: AuditEventType.SUBSCRIPTION_RENEWED
        }
      });
      assert.strictEqual(auditEvents.length, 1, 'Exactly 1 renewal audit event must be created');
    });

    test('27. Duplicate event delivery does not create second BillingPayment record', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_dup_payrec'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const dupEvtId = uniqueId('evt_dup_payrec');
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      // Delivery 1
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId
        },
        payload: rawBody
      });

      // Delivery 2
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId
        },
        payload: rawBody
      });

      const payments = await prisma.billingPayment.findMany({
        where: { subscriptionId: sub.id }
      });
      assert.strictEqual(payments.length, 1, 'Exactly 1 BillingPayment row must exist');
    });

    test('28. Duplicate event delivery does not create duplicate SUBSCRIPTION_RENEWED audit events', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_dup_audit'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const dupEvtId = uniqueId('evt_dup_audit');
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      // Delivery 1 & 2
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId
        },
        payload: rawBody
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId
        },
        payload: rawBody
      });

      const audits = await prisma.auditEvent.findMany({
        where: {
          userId: testUserIn.id,
          eventType: AuditEventType.SUBSCRIPTION_RENEWED
        }
      });
      assert.strictEqual(audits.length, 1);
    });

    test('29. Duplicate event delivery does not send duplicate in-app renewal notifications', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_dup_notif'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const dupEvtId = uniqueId('evt_dup_notif');
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      // Delivery 1 & 2
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId
        },
        payload: rawBody
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId
        },
        payload: rawBody
      });

      const notifs = await prisma.notificationRecord.findMany({
        where: {
          userId: testUserIn.id,
          eventType: 'SUBSCRIPTION_RENEWED'
        }
      });
      assert.strictEqual(notifs.length, 1);
    });
  });

  // ===========================================================================
  // CATEGORY 6: PRICE GRANDFATHERING PROTECTION
  // ===========================================================================
  describe('6. Price Grandfathering Protection', () => {
    test('30. Old subscriber retains old contracted PlanPrice upon renewal', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_old_sub'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        amount: 4900
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_old_sub')
        },
        payload: rawBody
      });

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.planPriceId, proMonthlyInrPrice.id);
      assert.strictEqual(updatedSub?.amountMinorUnits, 4900);
      assert.strictEqual(updatedSub?.priceVersion, 1);
    });

    test('31. Newer version 2 PlanPrice in catalog does not affect renewal of version 1 subscriber', async () => {
      // Create version 2 price in catalog for 5900 paise
      const v2Price = await prisma.planPrice.create({
        data: {
          planId: proMonthlyInrPrice.planId,
          currency: CurrencyCode.INR,
          amountMinorUnits: 5900,
          version: 2,
          isActive: true
        }
      });

      // Existing subscription is contracted on version 1 at 4900 paise
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_v1_renew'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          currentPeriodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date()
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        amount: 4900
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_v1_renew')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.planPriceId, proMonthlyInrPrice.id);
      assert.strictEqual(updatedSub?.priceVersion, 1);
      assert.strictEqual(updatedSub?.amountMinorUnits, 4900);

      // Clean up v2 price
      await prisma.planPrice.delete({ where: { id: v2Price.id } });
    });

    test('32. Current catalog price cannot override contracted subscriber amount', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_locked_amt'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        amount: 4900
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_locked_amt')
        },
        payload: rawBody
      });

      const payment = await prisma.billingPayment.findFirst({
        where: { subscriptionId: sub.id }
      });
      assert.strictEqual(payment?.amountMinorUnits, 4900);
    });
  });

  // ===========================================================================
  // CATEGORY 7: ORDERING & LIFECYCLE INTEGRITY
  // ===========================================================================
  describe('7. Ordering & Lifecycle Integrity', () => {
    test('33. subscription.charged event for a CREATED subscription does not activate it', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_created_charge'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_created_charge')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.data.status, 'CREATED');

      const unchangedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(unchangedSub?.status, BillingStatus.CREATED);

      const state = await prisma.accountBillingState.findUnique({ where: { userId: testUserIn.id } });
      assert.strictEqual(state?.status, BillingStatus.FREE);
    });

    test('34. subscription.charged event for an EXPIRED subscription does not silently reactivate it', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_expired_charge'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.EXPIRED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 60 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          expiredAt: new Date(Date.now() - 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_expired_charge')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const unchangedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(unchangedSub?.status, BillingStatus.EXPIRED);
    });

    test('35. subscription.charged event for a REFUNDED subscription does not reactivate it', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_refunded_charge'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.REFUNDED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(Date.now() - 60 * 24 * 3600 * 1000),
          currentPeriodEnd: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          refundedAt: new Date()
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_refunded_charge')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const unchangedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(unchangedSub?.status, BillingStatus.REFUNDED);
    });

    test('36. Late subscription.authenticated event cannot downgrade renewed ACTIVE subscription', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_late_auth_renew'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const lateAuthPayload = {
        entity: 'event',
        event: 'subscription.authenticated',
        contains: ['subscription'],
        payload: {
          subscription: {
            entity: {
              id: sub.providerSubscriptionId,
              plan_id: 'plan_pro_monthly_inr_renew',
              status: 'authenticated'
            }
          }
        }
      };
      const rawBody = JSON.stringify(lateAuthPayload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_late_auth')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const checkSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(checkSub?.status, BillingStatus.ACTIVE);
    });

    test('37. Failed payment charge status does not advance subscription period', async () => {
      const oldStart = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const oldEnd = new Date();

      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_fail_pay'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: oldStart,
          currentPeriodEnd: oldEnd
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew',
        paymentStatus: 'failed',
        errorCode: 'BAD_REQUEST_ERROR',
        errorDescription: 'Card expired'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_fail_pay')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.data.status, 'FAILED');

      const unchangedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(unchangedSub!.currentPeriodEnd.getTime(), oldEnd.getTime());
    });
  });

  // ===========================================================================
  // CATEGORY 8: SECURITY, SECRETS REDACTION & INTEGRITY SAFEGUARDS
  // ===========================================================================
  describe('8. Security, Secrets Redaction & Integrity Safeguards', () => {
    test('38. Existing user devices and servers remain intact after renewal', async () => {
      const device = await prisma.device.create({
        data: {
          userId: testUserIn.id,
          deviceName: 'User Server Phone',
          installationId: uniqueId('inst_dev_renew')
        }
      });

      const server = await prisma.serverInstance.create({
        data: {
          deviceId: device.id,
          serverName: 'Primary Node',
          status: 'RUNNING'
        }
      });

      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_dev_intact_renew'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_dev_intact')
        },
        payload: rawBody
      });

      const foundServer = await prisma.serverInstance.findUnique({ where: { id: server.id } });
      assert.ok(foundServer);
      assert.strictEqual(foundServer.status, 'RUNNING');

      // Cleanup device/server
      await prisma.serverInstance.delete({ where: { id: server.id } });
      await prisma.device.delete({ where: { id: device.id } });
    });

    test('39. Webhook cannot inject arbitrary user identity to hijack renewal', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_hijack_test'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      // Attacker attempts to pass testUserUs id in payload notes/customer
      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      (payload.payload.subscription.entity as any).customer_id = 'cust_attacker';
      (payload.payload.subscription.entity as any).notes = { userId: testUserUs.id };

      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_hijack')
        },
        payload: rawBody
      });

      // Subscription remains belonging to testUserIn
      const checkSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(checkSub?.userId, testUserIn.id);

      // testUserUs billing state remains untouched
      const usState = await prisma.accountBillingState.findUnique({ where: { userId: testUserUs.id } });
      assert.strictEqual(usState?.status, BillingStatus.FREE);
    });

    test('40. Zero secrets in SUBSCRIPTION_RENEWED AuditEvent metadata', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_audit_sec'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_audit_sec')
        },
        payload: rawBody
      });

      const audit = await prisma.auditEvent.findFirst({
        where: {
          userId: testUserIn.id,
          eventType: AuditEventType.SUBSCRIPTION_RENEWED
        }
      });

      assert.ok(audit);
      const metadataStr = JSON.stringify(audit.metadata);
      assert.strictEqual(metadataStr.includes('whsec_'), false, 'Webhook secret must not leak in audit metadata');
      assert.strictEqual(metadataStr.includes('rzp_test_'), false, 'Razorpay key must not leak in audit metadata');
      assert.strictEqual(metadataStr.includes('sec_mock'), false, 'Secret key must not leak in audit metadata');
    });

    test('41. In-app renewal notification is created upon successful renewal', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_notif_created'),
          providerPlanId: 'plan_pro_monthly_inr_renew',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_renew'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_notif_created')
        },
        payload: rawBody
      });

      const notif = await prisma.notificationRecord.findFirst({
        where: {
          userId: testUserIn.id,
          eventType: 'SUBSCRIPTION_RENEWED'
        }
      });

      assert.ok(notif);
      assert.strictEqual(notif.title, 'ZdexCloud Subscription Renewed');
      assert.strictEqual(notif.status, 'UNREAD');
    });
  });
});
