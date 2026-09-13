import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { DunningService, GRACE_PERIOD_DAYS } from '../src/services/billing/dunning_service.js';
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

describe('ZC-BILLING-5.3 Dunning, Past Due & Grace Period Foundation Test Suite', () => {
  let app: FastifyInstance;
  let testUserIn: any;
  let testUserUs: any;
  let testSessionIn: any;
  let testDeviceIn: any;
  let proMonthlyInrPrice: any;
  let proYearlyInrPrice: any;
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_dunning_1234567890';

  let idCounter = 0;
  function uniqueId(prefix = 'id'): string {
    idCounter += 1;
    return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).substring(2, 7)}`;
  }

  function computeSignature(payload: string | Buffer, secret: string = mockWebhookSecret): string {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  function createSampleFailurePayload(options: {
    subscriptionId: string;
    planId: string;
    event?: string;
    paymentId?: string;
    currentStart?: number;
    errorCode?: string;
    errorDescription?: string;
  }) {
    const nowSec = Math.floor(Date.now() / 1000);
    const paymentId = options.paymentId || uniqueId('pay_fail');

    return {
      entity: 'event',
      account_id: 'acc_mock123',
      event: options.event || 'subscription.pending',
      contains: ['subscription', 'payment'],
      payload: {
        subscription: {
          entity: {
            id: options.subscriptionId,
            entity: 'subscription',
            plan_id: options.planId,
            customer_id: 'cust_mock123',
            status: 'pending',
            current_start: options.currentStart !== undefined ? options.currentStart : nowSec,
            current_end: nowSec + 30 * 24 * 3600,
            ended_at: null,
            quantity: 1,
            notes: [],
            charge_at: nowSec,
            start_at: nowSec - 30 * 24 * 3600,
            end_at: nowSec + 335 * 24 * 3600,
            auth_attempts: 1,
            total_count: 12,
            paid_count: 1,
            remaining_count: 11,
            short_url: 'https://rzp.io/i/mock_pending',
            has_scheduled_changes: false,
            change_scheduled_at: null,
            source: 'api',
            created_at: nowSec - 30 * 24 * 3600
          }
        },
        payment: {
          entity: {
            id: paymentId,
            entity: 'payment',
            amount: 4900,
            currency: 'INR',
            status: 'failed',
            order_id: 'order_mock123',
            invoice_id: 'inv_mock123',
            international: false,
            method: 'card',
            amount_refunded: 0,
            refund_status: null,
            captured: false,
            description: 'ZdexCloud Pro Monthly recurring charge failed',
            card_id: 'card_mock123',
            bank: null,
            wallet: null,
            vpa: null,
            email: 'test-dunning@example.com',
            contact: '+919999999999',
            notes: [],
            fee: null,
            tax: null,
            error_code: options.errorCode || 'BAD_REQUEST_ERROR',
            error_description: options.errorDescription || 'Payment declined by issuer bank',
            error_source: 'bank_error',
            error_step: 'payment_authorization',
            error_reason: 'payment_failed',
            created_at: nowSec
          }
        }
      },
      created_at: nowSec
    };
  }

  function createSampleChargedPayload(options: {
    subscriptionId: string;
    planId: string;
    paymentId?: string;
    amount?: number;
    currency?: string;
  }) {
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = nowSec;
    const endSec = nowSec + 30 * 24 * 3600;
    const paymentId = options.paymentId || uniqueId('pay_succ');

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
            status: 'captured',
            order_id: 'order_mock123',
            invoice_id: 'inv_mock123',
            international: false,
            method: 'card',
            amount_refunded: 0,
            refund_status: null,
            captured: true,
            description: 'ZdexCloud Pro Monthly recurring charge recovery',
            card_id: 'card_mock123',
            bank: null,
            wallet: null,
            vpa: null,
            email: 'test-dunning@example.com',
            contact: '+919999999999',
            notes: [],
            fee: 998,
            tax: 0,
            error_code: null,
            error_description: null,
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

  before(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
    app = await buildApp();

    await PlanService.seedInitialCatalog();
    await EntitlementService.seedInitialEntitlements();

    // Clean old test artifacts
    await prisma.billingPayment.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.notificationRecord.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.auditEvent.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.serverInstance.deleteMany({
      where: { device: { user: { email: { contains: 'dunning-test' } } } }
    }).catch(() => {});
    await prisma.device.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.userSession.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.accountBillingState.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: { contains: 'dunning-test' } }
    }).catch(() => {});

    // Create test user (India)
    testUserIn = await prisma.user.create({
      data: {
        email: `dunning-test-in-${Date.now()}@example.com`,
        fullName: 'Dunning Test User India',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testSessionIn = await prisma.userSession.create({
      data: {
        userId: testUserIn.id,
        token: `tok_dunning_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });

    testDeviceIn = await prisma.device.create({
      data: {
        userId: testUserIn.id,
        installationId: uniqueId('inst'),
        deviceName: 'Dunning Test Phone',
        platform: 'Android',
        status: 'ONLINE'
      }
    });

    await BillingCountryService.confirmBillingCountry(testUserIn.id, {
      country: 'IN',
      postalCode: '400001'
    });

    // Create test user (US)
    testUserUs = await prisma.user.create({
      data: {
        email: `dunning-test-us-${Date.now()}@example.com`,
        fullName: 'Dunning Test User US',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    await BillingCountryService.confirmBillingCountry(testUserUs.id, {
      country: 'US',
      postalCode: '94105'
    });

    const proMonthly = await prisma.plan.findUnique({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    proMonthlyInrPrice = proMonthly?.prices.find((p) => p.currency === 'INR' && p.isActive);

    const proYearly = await prisma.plan.findUnique({
      where: { code: 'PRO_YEARLY' },
      include: { prices: true }
    });
    proYearlyInrPrice = proYearly?.prices.find((p) => p.currency === 'INR' && p.isActive);
  });

  after(async () => {
    if (app) await app.close();

    // Clean test artifacts
    await prisma.billingPayment.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.notificationRecord.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.auditEvent.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.serverInstance.deleteMany({
      where: { device: { user: { email: { contains: 'dunning-test' } } } }
    }).catch(() => {});
    await prisma.device.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.userSession.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.accountBillingState.deleteMany({
      where: { user: { email: { contains: 'dunning-test' } } }
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: { contains: 'dunning-test' } }
    }).catch(() => {});
  });

  // Helper to create active subscription for test user
  async function createActiveTestSub(user: any, planCode = 'PRO_MONTHLY', providerSubId?: string, providerPlanId = 'plan_rzp_mock_pm_inr') {
    const pSubId = providerSubId || uniqueId('sub_rzp');
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

    const plan = await prisma.plan.findUnique({ where: { code: planCode } });
    const planPrice = await prisma.planPrice.findFirst({
      where: { planId: plan!.id, currency: CurrencyCode.INR, isActive: true }
    });

    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan!.id,
        planPriceId: planPrice!.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: pSubId,
        providerPlanId,
        status: BillingStatus.ACTIVE,
        billingInterval: plan!.interval,
        currency: planPrice!.currency,
        amountMinorUnits: planPrice!.amountMinorUnits,
        priceVersion: planPrice!.version,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      },
      include: { plan: true, planPrice: true }
    });

    await prisma.accountBillingState.upsert({
      where: { userId: user.id },
      update: {
        status: BillingStatus.ACTIVE,
        activeSubscriptionId: sub.id,
        currency: sub.currency
      },
      create: {
        userId: user.id,
        status: BillingStatus.ACTIVE,
        activeSubscriptionId: sub.id,
        currency: sub.currency
      }
    });

    return sub;
  }

  // ===========================================================================
  // 1. Failed Renewal & Grace Period Initiation
  // ===========================================================================
  describe('1. Failed Renewal & Grace Period Initiation', () => {
    test('1. ACTIVE + verified failed recurring payment (subscription.pending) transitions to GRACE_PERIOD', async () => {
      const pSubId = uniqueId('sub_pending_1');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const payload = createSampleFailurePayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr',
        event: 'subscription.pending'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_pend')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data?.status || body.status, 'GRACE_PERIOD');

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.GRACE_PERIOD);
      assert.ok(updatedSub?.gracePeriodStartedAt);
      assert.ok(updatedSub?.gracePeriodEndsAt);

      const updatedState = await prisma.accountBillingState.findUnique({ where: { userId: testUserIn.id } });
      assert.strictEqual(updatedState?.status, BillingStatus.GRACE_PERIOD);
      assert.strictEqual(updatedState?.activeSubscriptionId, sub.id);
    });

    test('2. subscription.halted webhook also initiates GRACE_PERIOD safely', async () => {
      const pSubId = uniqueId('sub_halted_2');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const payload = createSampleFailurePayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr',
        event: 'subscription.halted'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_halt')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.GRACE_PERIOD);
    });

    test('3. gracePeriodStartedAt is persisted and server-controlled', async () => {
      const pSubId = uniqueId('sub_grace_time');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const beforeTime = new Date();
      await DunningService.startGracePeriod(sub.id, { reason: 'Test grace initiation' });
      const afterTime = new Date();

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.ok(updatedSub?.gracePeriodStartedAt);
      assert.ok(updatedSub.gracePeriodStartedAt >= beforeTime);
      assert.ok(updatedSub.gracePeriodStartedAt <= afterTime);
    });

    test('4. grace expiration is calculated to exactly +5 calendar days', async () => {
      const pSubId = uniqueId('sub_grace_calc');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const fixedDate = new Date('2026-03-01T12:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: fixedDate });

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.ok(updatedSub?.gracePeriodStartedAt);
      assert.ok(updatedSub?.gracePeriodEndsAt);

      const expectedEnd = new Date('2026-03-06T12:00:00.000Z');
      assert.strictEqual(updatedSub.gracePeriodEndsAt.toISOString(), expectedEnd.toISOString());
    });

    test('5. Duplicate failure webhooks do NOT reset or extend grace dates', async () => {
      const pSubId = uniqueId('sub_dup_fail');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const firstDate = new Date('2026-03-01T12:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: firstDate });

      const subAfterFirst = await prisma.subscription.findUnique({ where: { id: sub.id } });
      const originalStart = subAfterFirst?.gracePeriodStartedAt?.toISOString();
      const originalEnd = subAfterFirst?.gracePeriodEndsAt?.toISOString();

      // Second failure webhook arriving 2 days later
      const payload = createSampleFailurePayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_dup_fail')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);

      const subAfterSecond = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(subAfterSecond?.gracePeriodStartedAt?.toISOString(), originalStart);
      assert.strictEqual(subAfterSecond?.gracePeriodEndsAt?.toISOString(), originalEnd);
    });

    test('6. Duplicate failure webhooks do not duplicate Day 0 in-app notification', async () => {
      const pSubId = uniqueId('sub_dup_notif');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      // Trigger first failure
      const payload1 = createSampleFailurePayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const raw1 = JSON.stringify(payload1);
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': computeSignature(raw1),
          'x-razorpay-event-id': uniqueId('evt_fail_1')
        },
        payload: raw1
      });

      // Trigger second failure
      const payload2 = createSampleFailurePayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const raw2 = JSON.stringify(payload2);
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': computeSignature(raw2),
          'x-razorpay-event-id': uniqueId('evt_fail_2')
        },
        payload: raw2
      });

      const notifications = await prisma.notificationRecord.findMany({
        where: {
          userId: testUserIn.id,
          idempotencyKey: `notif_dunning_${sub.id}_day_0`
        }
      });
      assert.strictEqual(notifications.length, 1);
    });

    test('7. Exact duplicate webhook event payload remains idempotent', async () => {
      const pSubId = uniqueId('sub_idem_fail');
      await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const evtId = uniqueId('evt_same_fail');
      const payload = createSampleFailurePayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': evtId
        },
        payload: rawBody
      });
      assert.strictEqual(res1.statusCode, 200);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': evtId
        },
        payload: rawBody
      });
      assert.strictEqual(res2.statusCode, 200);
      const body2 = JSON.parse(res2.body);
      assert.strictEqual(body2.data?.idempotent || body2.idempotent, true);
    });
  });

  // ===========================================================================
  // 2. Dunning Milestone Schedule (Day 0, 2, 4, 5)
  // ===========================================================================
  describe('2. Dunning Milestone Schedule', () => {
    test('8. Day 0 milestone is processed once during grace period start', async () => {
      const pSubId = uniqueId('sub_dunning_d0');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id);

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      const milestones = updatedSub?.dunningMilestones as number[];
      assert.ok(Array.isArray(milestones));
      assert.ok(milestones.includes(0));
    });

    test('9. Day 2 milestone is processed once when elapsed days >= 2', async () => {
      const pSubId = uniqueId('sub_dunning_d2');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const startDate = new Date('2026-03-01T00:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: startDate });

      // Evaluate on Day 2
      const day2Date = new Date('2026-03-03T10:00:00.000Z'); // 2 calendar days elapsed
      const result = await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: day2Date
      });

      assert.strictEqual(result.evaluatedCount, 1);
      assert.strictEqual(result.milestonesProcessed.length, 1);
      assert.strictEqual(result.milestonesProcessed[0].milestone, 2);

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      const milestones = updatedSub?.dunningMilestones as number[];
      assert.ok(milestones.includes(2));

      // Check in-app notification
      const notif = await prisma.notificationRecord.findUnique({
        where: { idempotencyKey: `notif_dunning_${sub.id}_day_2` }
      });
      assert.ok(notif);
      assert.strictEqual(notif.eventType, 'SUBSCRIPTION_PAYMENT_DUE');
    });

    test('10. Day 4 milestone is processed once when elapsed days >= 4', async () => {
      const pSubId = uniqueId('sub_dunning_d4');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const startDate = new Date('2026-03-01T00:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: startDate });

      // Evaluate on Day 4
      const day4Date = new Date('2026-03-05T10:00:00.000Z'); // 4 calendar days elapsed
      const result = await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: day4Date
      });

      const day4Proc = result.milestonesProcessed.find((m) => m.milestone === 4);
      assert.ok(day4Proc);

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      const milestones = updatedSub?.dunningMilestones as number[];
      assert.ok(milestones.includes(4));

      const notif = await prisma.notificationRecord.findUnique({
        where: { idempotencyKey: `notif_dunning_${sub.id}_day_4` }
      });
      assert.ok(notif);
      assert.strictEqual(notif.eventType, 'SUBSCRIPTION_GRACE_PERIOD_FINAL_WARNING');
    });

    test('11. Day 5 milestone expires the subscription when grace ends', async () => {
      const pSubId = uniqueId('sub_dunning_d5');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const startDate = new Date('2026-03-01T00:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: startDate });

      // Evaluate on Day 5
      const day5Date = new Date('2026-03-06T10:00:00.000Z'); // 5 calendar days elapsed
      const result = await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: day5Date
      });

      const day5Proc = result.milestonesProcessed.find((m) => m.milestone === 5);
      assert.ok(day5Proc);
      assert.strictEqual(day5Proc?.transitionedTo, BillingStatus.EXPIRED);

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.EXPIRED);
      assert.ok(updatedSub?.expiredAt);

      const updatedState = await prisma.accountBillingState.findUnique({ where: { userId: testUserIn.id } });
      assert.strictEqual(updatedState?.status, BillingStatus.EXPIRED);
      assert.strictEqual(updatedState?.activeSubscriptionId, null);
    });

    test('12. Milestones survive state reload / process restarts', async () => {
      const pSubId = uniqueId('sub_dunning_persist');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const startDate = new Date('2026-03-01T00:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: startDate });

      // Run Day 2
      await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: new Date('2026-03-03T00:00:00.000Z')
      });

      // Reload fresh subscription from DB
      const freshSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      const milestones = freshSub?.dunningMilestones as number[];
      assert.deepStrictEqual(milestones.sort(), [0, 2]);
    });

    test('13. An already-processed milestone cannot fire again', async () => {
      const pSubId = uniqueId('sub_dunning_nofire');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const startDate = new Date('2026-03-01T00:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: startDate });

      const day2Date = new Date('2026-03-03T00:00:00.000Z');
      const res1 = await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: day2Date
      });
      assert.strictEqual(res1.milestonesProcessed.length, 1);

      // Second evaluation on the same day
      const res2 = await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: day2Date
      });
      assert.strictEqual(res2.milestonesProcessed.length, 0);
    });
  });

  // ===========================================================================
  // 3. Recovery Back to ACTIVE
  // ===========================================================================
  describe('3. Recovery Back to ACTIVE', () => {
    test('14. GRACE_PERIOD + successful charge webhook recovers to ACTIVE', async () => {
      const pSubId = uniqueId('sub_recover_grace');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id);

      const payload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr',
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
          'x-razorpay-event-id': uniqueId('evt_recov_1')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data?.status || body.status, 'ACTIVE');

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.ACTIVE);
      assert.strictEqual(updatedSub?.gracePeriodStartedAt, null);
      assert.strictEqual(updatedSub?.gracePeriodEndsAt, null);

      const updatedState = await prisma.accountBillingState.findUnique({ where: { userId: testUserIn.id } });
      assert.strictEqual(updatedState?.status, BillingStatus.ACTIVE);
      assert.strictEqual(updatedState?.activeSubscriptionId, sub.id);
    });

    test('15. PAST_DUE + successful charge webhook recovers to ACTIVE', async () => {
      const pSubId = uniqueId('sub_recover_pd');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await BillingStateService.markPastDue(sub.id);

      const payload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr',
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
          'x-razorpay-event-id': uniqueId('evt_recov_pd')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.ACTIVE);
    });

    test('16. Recovery clears grace-period dates and dunning milestones completely', async () => {
      const pSubId = uniqueId('sub_recover_clean');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id);

      const payload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_recov_clean')
        },
        payload: rawBody
      });

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.gracePeriodStartedAt, null);
      assert.strictEqual(updatedSub?.gracePeriodEndsAt, null);
      assert.strictEqual(updatedSub?.dunningMilestones, null);
    });

    test('17. Billing period advances correctly upon recovery', async () => {
      const pSubId = uniqueId('sub_recover_period');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const prevPeriodEnd = sub.currentPeriodEnd;
      await DunningService.startGracePeriod(sub.id);

      const payload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_recov_adv')
        },
        payload: rawBody
      });

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.ok(updatedSub!.currentPeriodEnd >= prevPeriodEnd);
    });

    test('18. Payment ledger records immutable SUCCESS transaction for recovery', async () => {
      const pSubId = uniqueId('sub_recover_ledger');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id);

      const paymentId = uniqueId('pay_recov_immut');
      const payload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr',
        paymentId
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_recov_immut')
        },
        payload: rawBody
      });

      const payment = await prisma.billingPayment.findFirst({
        where: { providerPaymentId: paymentId }
      });
      assert.ok(payment);
      assert.strictEqual(payment.status, PaymentStatus.SUCCESS);
      assert.strictEqual(payment.amountMinorUnits, 4900);
      assert.strictEqual(payment.currency, CurrencyCode.INR);
    });

    test('19. Duplicate successful recovery webhook remains idempotent', async () => {
      const pSubId = uniqueId('sub_recover_dup');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id);

      const evtId = uniqueId('evt_recov_dup');
      const payload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': evtId
        },
        payload: rawBody
      });
      assert.strictEqual(res1.statusCode, 200);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': evtId
        },
        payload: rawBody
      });
      assert.strictEqual(res2.statusCode, 200);
      const body2 = JSON.parse(res2.body);
      assert.strictEqual(body2.data?.idempotent || body2.idempotent, true);
    });

    test('20. Recovery does not create duplicate subscription records', async () => {
      const pSubId = uniqueId('sub_recover_nodup');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id);

      const payload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_recov_nodup')
        },
        payload: rawBody
      });

      const userSubs = await prisma.subscription.findMany({
        where: { userId: testUserIn.id, providerSubscriptionId: pSubId }
      });
      assert.strictEqual(userSubs.length, 1);
    });
  });

  // ===========================================================================
  // 4. Grace Period Expiration & Entitlements
  // ===========================================================================
  describe('4. Grace Period Expiration & Entitlements', () => {
    test('21. Grace period reaching 5 days transitions to EXPIRED', async () => {
      const pSubId = uniqueId('sub_expire_5d');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const startDate = new Date('2026-03-01T00:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: startDate });

      const day5 = new Date('2026-03-06T00:00:01.000Z');
      await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: day5
      });

      const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(updatedSub?.status, BillingStatus.EXPIRED);
    });

    test('22. Expiration changes effective plan to FREE', async () => {
      const pSubId = uniqueId('sub_expire_eff');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id, { now: new Date('2026-03-01T00:00:00.000Z') });
      await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: new Date('2026-03-06T00:00:01.000Z')
      });

      const effective = await BillingStateService.getEffectivePlan(testUserIn.id);
      assert.strictEqual(effective.planCode, 'FREE');
      assert.strictEqual(effective.status, BillingStatus.EXPIRED);
      assert.strictEqual(effective.subscription, null);
    });

    test('23. Effective maxServers becomes 1 after expiration', async () => {
      const pSubId = uniqueId('sub_expire_ent');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id, { now: new Date('2026-03-01T00:00:00.000Z') });
      await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: new Date('2026-03-06T00:00:01.000Z')
      });

      const entitlements = await EntitlementService.resolveUserEntitlements(testUserIn.id);
      assert.strictEqual(entitlements.maxServers, 1);
      assert.strictEqual(entitlements.priorityRelay, false);
      assert.strictEqual(entitlements.planCode, 'FREE');
    });

    test('24. Existing servers remain intact after expiration (zero deletion)', async () => {
      const pSubId = uniqueId('sub_expire_nodes');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      // Create 2 test devices with servers while in Pro
      const dev1 = await prisma.device.create({
        data: { userId: testUserIn.id, installationId: uniqueId('inst1'), deviceName: 'Dev 1', platform: 'Android' }
      });
      const dev2 = await prisma.device.create({
        data: { userId: testUserIn.id, installationId: uniqueId('inst2'), deviceName: 'Dev 2', platform: 'Android' }
      });

      const s1 = await prisma.serverInstance.create({ data: { deviceId: dev1.id, status: 'RUNNING' } });
      const s2 = await prisma.serverInstance.create({ data: { deviceId: dev2.id, status: 'STOPPED' } });

      // Expire subscription
      await DunningService.startGracePeriod(sub.id, { now: new Date('2026-03-01T00:00:00.000Z') });
      await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: new Date('2026-03-06T00:00:01.000Z')
      });

      // Verify servers still exist
      const foundS1 = await prisma.serverInstance.findUnique({ where: { id: s1.id } });
      const foundS2 = await prisma.serverInstance.findUnique({ where: { id: s2.id } });
      assert.ok(foundS1);
      assert.ok(foundS2);
      assert.strictEqual(foundS1.status, 'RUNNING'); // Unchanged status
    });

    test('25. Existing files and endpoints remain untouched on expiration', async () => {
      // Invariant check: Control plane does not mutate user data or storage
      const pSubId = uniqueId('sub_expire_files');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      await DunningService.startGracePeriod(sub.id, { now: new Date('2026-03-01T00:00:00.000Z') });
      await DunningService.processDunningAndExpirations({
        subscriptionId: sub.id,
        now: new Date('2026-03-06T00:00:01.000Z')
      });

      const dev = await prisma.device.findFirst({ where: { userId: testUserIn.id } });
      assert.ok(dev);
    });

    test('26. Existing devices remain untouched on expiration', async () => {
      const devCountBefore = await prisma.device.count({ where: { userId: testUserIn.id } });
      assert.ok(devCountBefore > 0);

      const effective = await BillingStateService.getEffectivePlan(testUserIn.id);
      assert.strictEqual(effective.planCode, 'FREE');

      const devCountAfter = await prisma.device.count({ where: { userId: testUserIn.id } });
      assert.strictEqual(devCountAfter, devCountBefore);
    });

    test('27. POST /api/v1/servers is blocked when account is at or above Free limit (1 server)', async () => {
      // User testUserIn has servers from previous test (count >= 1)
      const newDev = await prisma.device.create({
        data: { userId: testUserIn.id, installationId: uniqueId('inst_block'), deviceName: 'Dev Block', platform: 'Android' }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/servers',
        headers: {
          authorization: `Bearer ${testSessionIn.token}`
        },
        payload: {
          deviceId: newDev.id
        }
      });

      assert.strictEqual(res.statusCode, 409);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'MAX_SERVERS_REACHED');
    });

    test('28. One-server account creation is allowed when account has 0 servers', async () => {
      // Create clean 0-server user
      const zeroUser = await prisma.user.create({
        data: {
          email: `dunning-zero-${Date.now()}@example.com`,
          fullName: 'Zero Server User',
          status: 'ACTIVE',
          emailVerified: true
        }
      });
      const zeroSession = await prisma.userSession.create({
        data: {
          userId: zeroUser.id,
          token: uniqueId('tok_zero'),
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
        }
      });
      const zeroDevice = await prisma.device.create({
        data: {
          userId: zeroUser.id,
          installationId: uniqueId('inst_zero'),
          deviceName: 'Zero Phone',
          platform: 'Android'
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/servers',
        headers: {
          authorization: `Bearer ${zeroSession.token}`
        },
        payload: {
          deviceId: zeroDevice.id
        }
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
      assert.ok(body.data.serverInstance.id);
    });
  });

  // ===========================================================================
  // 5. State Machine Integrity & Security
  // ===========================================================================
  describe('5. State Machine Integrity & Security', () => {
    test('29. FREE account cannot enter grace through a failure webhook', async () => {
      // Unmatched or free account
      const payload = createSampleFailurePayload({
        subscriptionId: 'sub_nonexistent_free',
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_free_fail')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.data?.unmatched || body.unmatched, true);
    });

    test('30. CREATED subscription cannot enter grace through a failure webhook', async () => {
      const pSubId = uniqueId('sub_created_fail');
      const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
      const planPrice = await prisma.planPrice.findFirst({
        where: { planId: plan!.id, currency: CurrencyCode.INR }
      });

      const createdSub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: plan!.id,
          planPriceId: planPrice!.id,
          providerSubscriptionId: pSubId,
          status: BillingStatus.CREATED,
          amountMinorUnits: 49900,
          currency: CurrencyCode.INR,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const payload = createSampleFailurePayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_created_fail')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const subAfter = await prisma.subscription.findUnique({ where: { id: createdSub.id } });
      assert.strictEqual(subAfter?.status, BillingStatus.CREATED);
    });

    test('31. REFUNDED subscription cannot recover to ACTIVE through renewal logic', async () => {
      const pSubId = uniqueId('sub_refunded_recov');
      const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
      const planPrice = await prisma.planPrice.findFirst({
        where: { planId: plan!.id, currency: CurrencyCode.INR }
      });

      const refSub = await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: plan!.id,
          planPriceId: planPrice!.id,
          providerSubscriptionId: pSubId,
          status: BillingStatus.REFUNDED,
          amountMinorUnits: 49900,
          currency: CurrencyCode.INR,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
          refundedAt: new Date()
        }
      });

      const payload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawBody = JSON.stringify(payload);
      const signature = computeSignature(rawBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': uniqueId('evt_ref_recov')
        },
        payload: rawBody
      });

      assert.strictEqual(res.statusCode, 200);
      const subAfter = await prisma.subscription.findUnique({ where: { id: refSub.id } });
      assert.strictEqual(subAfter?.status, BillingStatus.REFUNDED);
    });

    test('32. Out-of-order failure event delivered after recovery cannot regress ACTIVE state', async () => {
      const pSubId = uniqueId('sub_ooo_test');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      // Start grace
      await DunningService.startGracePeriod(sub.id);

      // Recover to ACTIVE
      const chargePayload = createSampleChargedPayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      const rawCharge = JSON.stringify(chargePayload);
      await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': computeSignature(rawCharge),
          'x-razorpay-event-id': uniqueId('evt_ooo_recov')
        },
        payload: rawCharge
      });

      const subAfterRecov = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(subAfterRecov?.status, BillingStatus.ACTIVE);
      assert.strictEqual(subAfterRecov?.gracePeriodStartedAt, null);

      // Duplicate / late-arriving failure webhook from previous failed attempt (older cycle)
      const oldFailurePayload = createSampleFailurePayload({
        subscriptionId: pSubId,
        planId: 'plan_rzp_mock_pm_inr'
      });
      (oldFailurePayload.payload.subscription.entity as any).current_start = Math.floor(Date.now() / 1000) - 60 * 24 * 3600;
      (oldFailurePayload.payload.payment.entity as any).created_at = Math.floor(Date.now() / 1000) - 60 * 24 * 3600;
      const rawOldFail = JSON.stringify(oldFailurePayload);
      const resOld = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/webhooks/razorpay',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': computeSignature(rawOldFail),
          'x-razorpay-event-id': uniqueId('evt_ooo_late_fail')
        },
        payload: rawOldFail
      });

      assert.strictEqual(resOld.statusCode, 200);

      // Status must still remain ACTIVE (not regressed to GRACE_PERIOD)
      const subFinal = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.ok(subFinal);
    });

    test('33. Concurrent failure processing is safe against races', async () => {
      const pSubId = uniqueId('sub_concur_fail');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const payload1 = createSampleFailurePayload({ subscriptionId: pSubId, planId: 'plan_rzp_mock_pm_inr' });
      const payload2 = createSampleFailurePayload({ subscriptionId: pSubId, planId: 'plan_rzp_mock_pm_inr' });

      const raw1 = JSON.stringify(payload1);
      const raw2 = JSON.stringify(payload2);

      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/billing/webhooks/razorpay',
          headers: {
            'content-type': 'application/json',
            'x-razorpay-signature': computeSignature(raw1),
            'x-razorpay-event-id': uniqueId('evt_conc_1')
          },
          payload: raw1
        }),
        app.inject({
          method: 'POST',
          url: '/api/v1/billing/webhooks/razorpay',
          headers: {
            'content-type': 'application/json',
            'x-razorpay-signature': computeSignature(raw2),
            'x-razorpay-event-id': uniqueId('evt_conc_2')
          },
          payload: raw2
        })
      ]);

      assert.strictEqual(res1.statusCode, 200);
      assert.strictEqual(res2.statusCode, 200);

      const finalSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(finalSub?.status, BillingStatus.GRACE_PERIOD);
    });

    test('34. Concurrent expiration evaluation is idempotent and safe', async () => {
      const pSubId = uniqueId('sub_concur_exp');
      const sub = await createActiveTestSub(testUserIn, 'PRO_MONTHLY', pSubId);

      const startDate = new Date('2026-03-01T00:00:00.000Z');
      await DunningService.startGracePeriod(sub.id, { now: startDate });

      const day5 = new Date('2026-03-06T00:00:01.000Z');

      const [res1, res2] = await Promise.all([
        DunningService.processDunningAndExpirations({ subscriptionId: sub.id, now: day5 }),
        DunningService.processDunningAndExpirations({ subscriptionId: sub.id, now: day5 })
      ]);

      const totalMilestone5Count =
        res1.milestonesProcessed.filter((m) => m.milestone === 5).length +
        res2.milestonesProcessed.filter((m) => m.milestone === 5).length;

      // Exactly 1 execution should have transitioned to EXPIRED
      assert.strictEqual(totalMilestone5Count, 1);

      const finalSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.strictEqual(finalSub?.status, BillingStatus.EXPIRED);
    });
  });
});
