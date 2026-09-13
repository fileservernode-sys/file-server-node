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
  AuditEventType,
  WebhookEventStatus
} from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('ZC-BILLING-5.1 Subscription Activation & Webhook Foundation Test Suite', () => {
  let app: FastifyInstance;
  let testUserIn: any;
  let testUserUs: any;
  let proMonthlyInrPrice: any;
  let proYearlyInrPrice: any;
  let proMonthlyUsdPrice: any;
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_1234567890';

  let counter = 0;
  function uniqueId(prefix = 'id'): string {
    counter += 1;
    return `${prefix}_${Date.now()}_${counter}_${Math.random().toString(36).substring(2, 7)}`;
  }


  // Helper to compute valid HMAC SHA256 signature
  function computeSignature(payload: string | Buffer, secret: string = mockWebhookSecret): string {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  // Helper to generate sample Razorpay subscription webhook payload
  function createSamplePayload(options: {
    event: string;
    subscriptionId: string;
    planId: string;
    status?: string;
    currentStart?: number;
    currentEnd?: number;
  }) {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      entity: 'event',
      account_id: 'acc_mock123',
      event: options.event,
      contains: ['subscription'],
      payload: {
        subscription: {
          entity: {
            id: options.subscriptionId,
            entity: 'subscription',
            plan_id: options.planId,
            customer_id: 'cust_mock123',
            status: options.status || (options.event === 'subscription.activated' ? 'active' : 'authenticated'),
            current_start: options.currentStart || nowSec,
            current_end: options.currentEnd || nowSec + 30 * 24 * 3600,
            ended_at: null,
            quantity: 1,
            notes: [],
            charge_at: nowSec + 30 * 24 * 3600,
            start_at: nowSec,
            end_at: nowSec + 365 * 24 * 3600,
            auth_attempts: 0,
            total_count: 12,
            paid_count: 1,
            remaining_count: 11,
            short_url: 'https://rzp.io/i/mock1',
            has_scheduled_changes: false,
            change_scheduled_at: null,
            source: 'api',
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
        providerPlanId: 'plan_pro_monthly_inr_wh',
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
        providerPlanId: 'plan_pro_monthly_usd_wh',
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
        providerPlanId: 'plan_pro_yearly_inr_wh',
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
    process.env.RAZORPAY_KEY_ID = 'rzp_test_mockKeyWebhook123';
    process.env.RAZORPAY_KEY_SECRET = 'sec_mockSecretWebhook123';

    await PlanService.seedInitialCatalog();
    app = await buildApp();
    await app.ready();

    await prisma.billingWebhookEvent.deleteMany({});
    await prisma.notificationRecord.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.subscription.deleteMany({});

    const timestamp = Date.now();

    testUserIn = await prisma.user.create({
      data: {
        email: `wh_in_${timestamp}@zdexcloud.test`,
        fullName: 'Webhook India User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testUserUs = await prisma.user.create({
      data: {
        email: `wh_us_${timestamp}@zdexcloud.test`,
        fullName: 'Webhook US User',
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
      where: { providerPlanId: { in: ['plan_pro_monthly_inr_wh', 'plan_pro_monthly_usd_wh', 'plan_pro_yearly_inr_wh'] } }
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
      await prisma.notificationRecord.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.auditEvent.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.subscription.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.user.deleteMany({ where: { id: testUserIn.id } });
    }
    if (testUserUs) {
      await prisma.notificationRecord.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.auditEvent.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.subscription.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.user.deleteMany({ where: { id: testUserUs.id } });
    }
    await prisma.billingWebhookEvent.deleteMany({});
    await prisma.billingProviderPlanMapping.deleteMany({
      where: { providerPlanId: { in: ['plan_pro_monthly_inr_wh', 'plan_pro_monthly_usd_wh', 'plan_pro_yearly_inr_wh'] } }
    });
  });

  // ===========================================================================
  // CATEGORY 1: WEBHOOK SIGNATURE SECURITY
  // ===========================================================================
  describe('1. Webhook Signature Security', () => {
    test('1. Valid HMAC signature is accepted with 200', async () => {
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: 'sub_valid_sig_1',
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_valid_sig_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, true);
    });

    test('2. Missing signature header is rejected with 400', async () => {
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: 'sub_missing_sig_1',
        planId: 'plan_pro_monthly_inr_wh'
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: { 'content-type': 'application/json' },
        payload
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'INVALID_SIGNATURE');
    });

    test('3. Invalid signature is rejected with 400', async () => {
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: 'sub_invalid_sig_1',
        planId: 'plan_pro_monthly_inr_wh'
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': 'invalid_forged_signature_hex_1234567890abcdef'
        },
        payload
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'INVALID_SIGNATURE');
    });

    test('4. Malformed signature is rejected with 400', async () => {
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: 'sub_malformed_sig_1',
        planId: 'plan_pro_monthly_inr_wh'
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': '   '
        },
        payload
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('5. Raw request body bytes are strictly used for HMAC verification', () => {
      const rawString = '{"event":"subscription.activated","test":1}';
      const sig = computeSignature(rawString);
      const isValid = verifyRazorpayWebhookSignature(rawString, sig, mockWebhookSecret);
      assert.strictEqual(isValid, true);
    });

    test('6. Modified / tampered body fails signature validation', async () => {
      const payload1 = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: 'sub_tamper_1',
        planId: 'plan_pro_monthly_inr_wh'
      });
      const originalSig = computeSignature(JSON.stringify(payload1));

      // Tampered payload body
      const payloadTampered = { ...payload1, event: 'subscription.halted' };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': originalSig
        },
        payload: payloadTampered
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.error.code, 'INVALID_SIGNATURE');
    });
  });

  // ===========================================================================
  // CATEGORY 2: EVENT PAYLOAD VALIDATION
  // ===========================================================================
  describe('2. Event Payload Validation', () => {
    test('7. Malformed non-object JSON payload is rejected with 400', async () => {
      const rawBody = '"just a plain string"';
      const sig = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': sig
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('8. Missing subscription entity in payload throws ValidationError', async () => {
      const invalidPayload = {
        entity: 'event',
        event: 'subscription.activated',
        payload: {} // missing subscription
      };
      const rawBody = JSON.stringify(invalidPayload);
      const sig = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': sig
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('9. Missing event field is rejected with 400', async () => {
      const invalidPayload = {
        entity: 'event',
        payload: { subscription: { entity: { id: 'sub_123', plan_id: 'plan_123' } } }
      };
      const rawBody = JSON.stringify(invalidPayload);
      const sig = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': sig
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('10. Missing provider subscription ID is rejected with 400', async () => {
      const invalidPayload = {
        entity: 'event',
        event: 'subscription.activated',
        payload: {
          subscription: {
            entity: {
              plan_id: 'plan_pro_monthly_inr_wh'
              // missing id
            }
          }
        }
      };
      const rawBody = JSON.stringify(invalidPayload);
      const sig = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': sig
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });
  });

  // ===========================================================================
  // CATEGORY 3: DURABLE IDEMPOTENCY & CONCURRENCY
  // ===========================================================================
  describe('3. Durable Idempotency & Concurrency', () => {
    test('11. First valid event creates BillingWebhookEvent with PROCESSED status', async () => {
      // Create test subscription
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_idemp_test_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const eventId = uniqueId('evt_idemp_1');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': eventId
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const log = await prisma.billingWebhookEvent.findUnique({
        where: {
          provider_environment_providerEventId: {
            provider: PaymentProvider.RAZORPAY,
            environment: PaymentEnvironment.TEST,
            providerEventId: eventId
          }
        }
      });

      assert.ok(log);
      assert.strictEqual(log.status, WebhookEventStatus.PROCESSED);
      assert.strictEqual(log.eventType, 'subscription.activated');
    });

    test('12. Duplicate event delivery returns 200 and does not reactivate or duplicate work', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_idemp_test_2'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const dupEvtId12 = uniqueId('evt_idemp_dup');
      // First delivery
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId12
        },
        payload: rawBody
      });

      // Second delivery (duplicate)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': dupEvtId12
        },
        payload: rawBody
      });

      assert.strictEqual(res2.statusCode, 200);
      const json2 = JSON.parse(res2.body);
      assert.strictEqual(json2.data.idempotent, true);
    });

    test('13. Concurrent duplicate deliveries are safe and idempotent', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_concurrent_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      // Send 3 concurrent requests with exact same event ID
      const concurrentEvtId = uniqueId('evt_concurrent');
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

      // All must return HTTP 200
      for (const res of results) {
        assert.strictEqual(res.statusCode, 200);
      }

      // Exactly 1 SUBSCRIPTION_ACTIVATED audit event must exist for this event
      const auditEvents = await prisma.auditEvent.findMany({
        where: {
          userId: testUserIn.id,
          eventType: AuditEventType.SUBSCRIPTION_ACTIVATED
        }
      });
      assert.strictEqual(auditEvents.length, 1);
    });

    test('14. Duplicate delivery does not create duplicate in-app notification', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_notif_dup_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const notifDupEvtId = uniqueId('evt_notif_dup');
      // Delivery 1
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': notifDupEvtId
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
          'x-razorpay-event-id': notifDupEvtId
        },
        payload: rawBody
      });

      const notifs = await prisma.notificationRecord.findMany({
        where: { userId: testUserIn.id }
      });
      assert.strictEqual(notifs.length, 1, 'Exactly one notification record must be created');
    });

    test('15. Duplicate delivery does not create duplicate audit events', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_audit_dup'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const auditDupEvtId = uniqueId('evt_audit_dup');

      // Delivery 1
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': auditDupEvtId
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
          'x-razorpay-event-id': auditDupEvtId
        },
        payload: rawBody
      });

      const auditCount = await prisma.auditEvent.count({
        where: { userId: testUserIn.id, eventType: AuditEventType.SUBSCRIPTION_ACTIVATED }
      });
      assert.strictEqual(auditCount, 1);
    });
  });

  // ===========================================================================
  // CATEGORY 4: SUBSCRIPTION MATCHING & CONSISTENCY
  // ===========================================================================
  describe('4. Subscription Matching & Plan Consistency', () => {
    test('16. Unknown provider subscription ID returns unmatched without modifying user state', async () => {
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: 'sub_unknown_999999',
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_unmatched_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.data.unmatched, true);

      // Verify no user became ACTIVE
      const userState = await prisma.accountBillingState.findUnique({
        where: { userId: testUserIn.id }
      });
      assert.strictEqual(userState?.status, BillingStatus.FREE);
    });

    test('17. Provider environment mismatch is rejected with 400', async () => {
      // Create subscription in LIVE environment
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.LIVE,
          providerSubscriptionId: uniqueId('sub_env_mismatch_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      // Deliver webhook configured for TEST environment
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_env_mismatch_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
    });

    test('18. Provider plan mismatch is rejected with 400', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_plan_mismatch_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      // Payload contains spoofed or mismatched plan ID
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_spoofed_different_plan_id'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_plan_mismatch_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.error.code, 'MAPPING_CONFLICT');
    });

    test('19. Currency and commercial price version coherence maintained', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proYearlyInrPrice.planId,
          planPriceId: proYearlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_curr_check_1'),
          providerPlanId: 'plan_pro_yearly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.YEARLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 50000,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 365 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_yearly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_curr_check_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({
        where: { id: sub.id }
      });
      assert.strictEqual(updatedSub?.currency, CurrencyCode.INR);
      assert.strictEqual(updatedSub?.amountMinorUnits, 50000);
    });

    test('20. Internal PlanPrice remains commercial authority for amount and currency', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserUs.id,
          planId: proMonthlyUsdPrice.planId,
          planPriceId: proMonthlyUsdPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_price_auth_1'),
          providerPlanId: 'plan_pro_monthly_usd_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.USD,
          amountMinorUnits: 99,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_usd_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_price_auth_1')
        },
        payload: rawBody
      });

      const updatedSub = await prisma.subscription.findUnique({
        where: { id: sub.id }
      });
      assert.strictEqual(updatedSub?.amountMinorUnits, 99);
      assert.strictEqual(updatedSub?.currency, CurrencyCode.USD);
    });
  });

  // ===========================================================================
  // CATEGORY 5: AUTHORITATIVE ACTIVATION & ENTITLEMENT ENGINE
  // ===========================================================================
  describe('5. Authoritative Activation & Entitlements', () => {
    test('21. Subscription transitions CREATED -> ACTIVE upon subscription.activated', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_trans_act_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_trans_act_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({
        where: { id: sub.id }
      });
      assert.strictEqual(updatedSub?.status, BillingStatus.ACTIVE);
    });

    test('22. AccountBillingState transitions to ACTIVE upon subscription.activated', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_state_act_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_state_act_1')
        },
        payload: rawBody
      });

      const userState = await prisma.accountBillingState.findUnique({
        where: { userId: testUserIn.id }
      });
      assert.strictEqual(userState?.status, BillingStatus.ACTIVE);
    });

    test('23. activeSubscriptionId is linked correctly in AccountBillingState', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_link_act_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_link_act_1')
        },
        payload: rawBody
      });

      const userState = await prisma.accountBillingState.findUnique({
        where: { userId: testUserIn.id }
      });
      assert.strictEqual(userState?.activeSubscriptionId, sub.id);
    });

    test('24. Entitlement recalculation elevates capabilities to Pro (maxServers=5, priorityRelay=true)', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_ent_act_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_ent_act_1')
        },
        payload: rawBody
      });

      const entitlements = await EntitlementService.resolveUserEntitlements(testUserIn.id);
      assert.strictEqual(entitlements.planCode, 'PRO_MONTHLY');
      assert.strictEqual(entitlements.maxServers, 5);
      assert.strictEqual(entitlements.priorityRelay, true);
    });

    test('25. Existing servers and user devices remain completely intact across activation', async () => {
      // User has an existing device
      const device = await prisma.device.create({
        data: {
          userId: testUserIn.id,
          deviceName: 'Pixel 8 Pro',
          installationId: `inst_wh_${Date.now()}`,
          status: 'ONLINE'
        }
      });

      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_dev_intact_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_dev_intact_1')
        },
        payload: rawBody
      });

      // Assert device still exists unchanged
      const foundDevice = await prisma.device.findUnique({
        where: { id: device.id }
      });
      assert.ok(foundDevice);
      assert.strictEqual(foundDevice.status, 'ONLINE');

      // Clean up
      await prisma.device.delete({ where: { id: device.id } });
    });
  });

  // ===========================================================================
  // CATEGORY 6: EVENT ORDERING & MONOTONICITY
  // ===========================================================================
  describe('6. Event Ordering & Monotonicity', () => {
    test('26. subscription.activated can arrive without prior subscription.authenticated', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_direct_act_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_direct_act_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.ACTIVE);
    });

    test('27. Late subscription.authenticated cannot downgrade an already ACTIVE subscription', async () => {
      // Setup subscription already in ACTIVE state
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_late_auth_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      await prisma.accountBillingState.update({
        where: { userId: testUserIn.id },
        data: { status: BillingStatus.ACTIVE, activeSubscriptionId: sub.id }
      });

      // Late arriving subscription.authenticated event
      const payload = createSamplePayload({
        event: 'subscription.authenticated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh',
        status: 'authenticated'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_late_auth_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      // Verify status strictly remains ACTIVE
      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.ACTIVE, 'Subscription must not downgrade');

      const userState = await prisma.accountBillingState.findUnique({ where: { userId: testUserIn.id } });
      assert.strictEqual(userState?.status, BillingStatus.ACTIVE);
    });

    test('28. Repeated subscription.activated remains safely idempotent', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_repeat_act_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      // Request 1
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_rep_1')
        },
        payload: rawBody
      });
      assert.strictEqual(res1.statusCode, 200);

      // Request 2
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_rep_2') // different event ID for same activation
        },
        payload: rawBody
      });
      assert.strictEqual(res2.statusCode, 200);

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.ACTIVE);
    });
  });

  // ===========================================================================
  // CATEGORY 7: SECURITY & INTEGRITY SAFEGUARDS
  // ===========================================================================
  describe('7. Security & Integrity Safeguards', () => {
    test('29. Webhook cannot select arbitrary target user', async () => {
      // Subscription belongs to testUserIn
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_target_user_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      // Attacker passes different user metadata or email in payload
      const payload = {
        ...createSamplePayload({
          event: 'subscription.activated',
          subscriptionId: sub.providerSubscriptionId!,
          planId: 'plan_pro_monthly_inr_wh'
        }),
        user_id: testUserUs.id,
        email: testUserUs.email
      };
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_target_1')
        },
        payload: rawBody
      });

      // Authoritative subscription owner testUserIn must be activated
      const userInState = await prisma.accountBillingState.findUnique({ where: { userId: testUserIn.id } });
      assert.strictEqual(userInState?.status, BillingStatus.ACTIVE);

      // Attacker testUserUs must remain FREE
      const userUsState = await prisma.accountBillingState.findUnique({ where: { userId: testUserUs.id } });
      assert.strictEqual(userUsState?.status, BillingStatus.FREE);
    });

    test('30. Webhook cannot alter internal contracted price', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_price_alter_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      // Webhook payload claims amount was 100 instead of 4900
      const payload = {
        ...createSamplePayload({
          event: 'subscription.activated',
          subscriptionId: sub.providerSubscriptionId!,
          planId: 'plan_pro_monthly_inr_wh'
        }),
        amount: 100
      };
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_price_alter_1')
        },
        payload: rawBody
      });

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.amountMinorUnits, 4900, 'Price remains strictly internal contracted 4900');
    });

    test('31. Webhook cannot alter contracted currency', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_curr_alter_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = {
        ...createSamplePayload({
          event: 'subscription.activated',
          subscriptionId: sub.providerSubscriptionId!,
          planId: 'plan_pro_monthly_inr_wh'
        }),
        currency: 'USD'
      };
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_curr_alter_1')
        },
        payload: rawBody
      });

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.currency, CurrencyCode.INR);
    });

    test('32. Webhook cannot grant entitlements for unmatched subscription', async () => {
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: 'sub_unmatched_grant_attempt',
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_unmatched_grant_1')
        },
        payload: rawBody
      });

      // No user gets 5 servers
      const entIn = await EntitlementService.resolveUserEntitlements(testUserIn.id);
      assert.strictEqual(entIn.maxServers, 1);
      const entUs = await EntitlementService.resolveUserEntitlements(testUserUs.id);
      assert.strictEqual(entUs.maxServers, 1);
    });

    test('33. Provider errors are sanitized and do not leak secrets', async () => {
      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: 'sub_err_sanitize_1',
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);

      // Send invalid signature
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': 'invalid_sig'
        },
        payload: rawBody
      });

      const body = res.body;
      assert.ok(!body.includes(mockWebhookSecret), 'Must not leak webhook secret');
      assert.ok(!body.includes('sec_mockSecretWebhook123'), 'Must not leak API key secret');
    });

    test('34. Authoritative SUBSCRIPTION_ACTIVATED audit event is created with safe metadata', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_audit_check_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_audit_check_1')
        },
        payload: rawBody
      });

      const auditEvent = await prisma.auditEvent.findFirst({
        where: {
          userId: testUserIn.id,
          eventType: AuditEventType.SUBSCRIPTION_ACTIVATED
        }
      });

      assert.ok(auditEvent);
      const metadata = auditEvent.metadata as any;
      assert.strictEqual(metadata.action, 'SUBSCRIPTION_ACTIVATED');
      assert.strictEqual(metadata.subscriptionId, sub.id);
      assert.strictEqual(metadata.provider, 'RAZORPAY');
      assert.strictEqual(metadata.planCode, 'PRO_MONTHLY');
      assert.strictEqual(metadata.amountMinorUnits, 4900);
      assert.strictEqual(metadata.currency, 'INR');
    });

    test('35. In-app activation notification is triggered upon successful subscription activation', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: proMonthlyInrPrice.planId,
          planPriceId: proMonthlyInrPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: uniqueId('sub_notif_check_1'),
          providerPlanId: 'plan_pro_monthly_inr_wh',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSamplePayload({
        event: 'subscription.activated',
        subscriptionId: sub.providerSubscriptionId!,
        planId: 'plan_pro_monthly_inr_wh'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_notif_check_1')
        },
        payload: rawBody
      });

      const notif = await prisma.notificationRecord.findFirst({
        where: {
          userId: testUserIn.id,
          eventType: 'SUBSCRIPTION_ACTIVATED'
        }
      });

      assert.ok(notif);
      assert.strictEqual(notif.title, 'ZdexCloud Pro Activated');
      assert.ok(notif.body.includes('subscription is now active'));
    });
  });
});
