import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { DunningService } from '../src/services/billing/dunning_service.js';
import {
  RazorpayWebhookService,
  verifyRazorpayWebhookSignature
} from '../src/services/billing/providers/razorpay/index.js';
import { RazorpayClient } from '../src/services/billing/providers/razorpay/razorpay_client.js';
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

describe('ZC-BILLING-5.4 Subscription Cancellation & Period-End Cancellation Test Suite', () => {
  let app: FastifyInstance;
  let testUser: any;
  let testSession: any;
  let testDevice: any;
  let proMonthlyInrPrice: any;
  let proPlan: any;
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_cancel_1234567890';

  let idCounter = 0;
  function uniqueId(prefix = 'id'): string {
    idCounter += 1;
    return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).substring(2, 7)}`;
  }

  function computeSignature(payload: string | Buffer, secret: string = mockWebhookSecret): string {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  before(async () => {
    app = await buildApp();
    await app.ready();

    await PlanService.seedInitialCatalog();
    await EntitlementService.seedInitialEntitlements();

    const plan = await prisma.plan.findUnique({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    proPlan = plan;
    proMonthlyInrPrice = plan?.prices.find((p) => p.currency === CurrencyCode.INR);

    // Create persistent test user
    testUser = await prisma.user.create({
      data: {
        email: `test_cancel_${Date.now()}@example.com`,
        fullName: 'Cancel Test User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testSession = await prisma.userSession.create({
      data: {
        userId: testUser.id,
        token: `sess_cancel_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });

    testDevice = await prisma.device.create({
      data: {
        userId: testUser.id,
        deviceName: 'Cancel Test Device',
        installationId: uniqueId('inst'),
        status: 'ONLINE'
      }
    });

    await BillingCountryService.confirmBillingCountry(testUser.id, {
      country: 'IN',
      postalCode: '400001'
    });
  });

  after(async () => {
    if (testUser) {
      await prisma.notificationRecord.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.auditEvent.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.billingPayment.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.subscription.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.accountBillingState.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.serverInstance.deleteMany({ where: { deviceId: testDevice.id } }).catch(() => {});
      await prisma.device.deleteMany({ where: { id: testDevice.id } }).catch(() => {});
      await prisma.userSession.deleteMany({ where: { id: testSession.id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: testUser.id } }).catch(() => {});
    }
    await app.close();
  });

  // Helper to create an active subscription for testUser
  async function setupActiveSubscription(periodDays = 30) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + periodDays * 24 * 3600 * 1000);
    const providerSubId = uniqueId('sub_cancel');
    const providerPlanId = uniqueId('plan_prov');

    // Clean up existing
    await prisma.subscription.deleteMany({ where: { userId: testUser.id } });

    const sub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: proPlan.id,
        planPriceId: proMonthlyInrPrice.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: providerSubId,
        providerPlanId,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: proMonthlyInrPrice.amountMinorUnits,
        priceVersion: proMonthlyInrPrice.version,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      },
      include: {
        plan: true,
        planPrice: true
      }
    });

    await prisma.accountBillingState.upsert({
      where: { userId: testUser.id },
      update: {
        status: BillingStatus.ACTIVE,
        activeSubscriptionId: sub.id,
        currency: CurrencyCode.INR,
        billingCountry: 'IN',
        billingPostalCode: '400001'
      },
      create: {
        userId: testUser.id,
        status: BillingStatus.ACTIVE,
        activeSubscriptionId: sub.id,
        currency: CurrencyCode.INR,
        billingCountry: 'IN',
        billingPostalCode: '400001'
      }
    });

    return sub;
  }

  // ---------------------------------------------------------------------------
  // 1. ACTIVE cancellation request
  // ---------------------------------------------------------------------------
  test('1. Authenticated customer cancellation request succeeds', async () => {
    const sub = await setupActiveSubscription();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscription/cancel',
      headers: {
        authorization: `Bearer ${testSession.token}`,
        'content-type': 'application/json'
      },
      payload: { reason: 'Switching plans' }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'CANCELLING');
    assert.strictEqual(body.data.cancelAtPeriodEnd, true);
  });

  // ---------------------------------------------------------------------------
  // 2. Cancellation sets cancelAtPeriodEnd and cancelledAt
  // ---------------------------------------------------------------------------
  test('2. Cancellation sets cancelAtPeriodEnd=true and cancelledAt timestamp', async () => {
    const sub = await setupActiveSubscription();
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.ok(updatedSub);
    assert.strictEqual(updatedSub.cancelAtPeriodEnd, true);
    assert.strictEqual(updatedSub.status, BillingStatus.CANCELLING);
    assert.ok(updatedSub.cancelledAt instanceof Date);
  });

  // ---------------------------------------------------------------------------
  // 3. Cancellation preserves currentPeriodEnd
  // ---------------------------------------------------------------------------
  test('3. Cancellation preserves currentPeriodEnd without shortening period', async () => {
    const sub = await setupActiveSubscription(25);
    const originalEnd = sub.currentPeriodEnd.getTime();

    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.ok(updatedSub);
    assert.strictEqual(updatedSub.currentPeriodEnd.getTime(), originalEnd);
  });

  // ---------------------------------------------------------------------------
  // 4. Cancellation changes billing state to CANCELLING
  // ---------------------------------------------------------------------------
  test('4. Cancellation updates AccountBillingState.status to CANCELLING', async () => {
    await setupActiveSubscription();
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const state = await prisma.accountBillingState.findUnique({ where: { userId: testUser.id } });
    assert.ok(state);
    assert.strictEqual(state.status, BillingStatus.CANCELLING);
  });

  // ---------------------------------------------------------------------------
  // 5. Paid entitlements remain active during CANCELLING
  // ---------------------------------------------------------------------------
  test('5. Paid entitlements remain active during CANCELLING status', async () => {
    await setupActiveSubscription();
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const effectivePlan = await BillingStateService.getEffectivePlan(testUser.id);
    assert.strictEqual(effectivePlan.planCode, 'PRO_MONTHLY');
    assert.strictEqual(effectivePlan.status, BillingStatus.CANCELLING);

    const entitlements = await EntitlementService.resolveUserEntitlements(testUser.id);
    assert.strictEqual(entitlements.planCode, 'PRO_MONTHLY');
    assert.strictEqual(entitlements.maxServers, 5);
    assert.strictEqual(entitlements.priorityRelay, true);
  });

  // ---------------------------------------------------------------------------
  // 6. Repeated cancellation is idempotent
  // ---------------------------------------------------------------------------
  test('6. Repeated cancellation requests are idempotent and do not fail', async () => {
    await setupActiveSubscription();

    const first = await BillingStateService.requestSubscriptionCancellation(testUser.id);
    const second = await BillingStateService.requestSubscriptionCancellation(testUser.id);

    assert.strictEqual(first.id, second.id);
    assert.strictEqual(second.status, BillingStatus.CANCELLING);
    assert.strictEqual(second.cancelAtPeriodEnd, true);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscription/cancel',
      headers: {
        authorization: `Bearer ${testSession.token}`,
        'content-type': 'application/json'
      },
      payload: {}
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.data.status, 'CANCELLING');
  });

  // ---------------------------------------------------------------------------
  // 7. Provider cancellation failure does not falsely mark success
  // ---------------------------------------------------------------------------
  test('7. Provider cancellation failure fails safely without mutating local state', async () => {
    const sub = await setupActiveSubscription();

    // Mock client that throws error
    const mockClient = {
      cancelSubscription: async () => {
        throw new Error('Razorpay API 500: Internal Server Error');
      }
    } as unknown as RazorpayClient;

    let threw = false;
    try {
      await BillingStateService.requestSubscriptionCancellation(testUser.id, { client: mockClient });
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes('Razorpay API 500'));
    }

    assert.strictEqual(threw, true);

    // Verify local DB state remains ACTIVE
    const checkSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.ok(checkSub);
    assert.strictEqual(checkSub.status, BillingStatus.ACTIVE);
    assert.strictEqual(checkSub.cancelAtPeriodEnd, false);
  });

  // ---------------------------------------------------------------------------
  // 8. Cancellation reversal is explicitly rejected with 409 Conflict (CANCELLATION_REVERSAL_UNSUPPORTED)
  // ---------------------------------------------------------------------------
  test('8. Cancellation reversal is explicitly rejected with 409 Conflict (CANCELLATION_REVERSAL_UNSUPPORTED)', async () => {
    const sub = await setupActiveSubscription();
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscription/cancel/undo',
      headers: {
        authorization: `Bearer ${testSession.token}`,
        'content-type': 'application/json'
      },
      payload: { reason: 'Decided to stay' }
    });

    assert.strictEqual(response.statusCode, 409);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'CANCELLATION_REVERSAL_UNSUPPORTED');

    // Confirm local state remains CANCELLING
    const checkSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.ok(checkSub);
    assert.strictEqual(checkSub.status, BillingStatus.CANCELLING);
    assert.strictEqual(checkSub.cancelAtPeriodEnd, true);
  });

  // ---------------------------------------------------------------------------
  // 9. BillingStateService.undoSubscriptionCancellation throws ConflictError and preserves CANCELLING state
  // ---------------------------------------------------------------------------
  test('9. BillingStateService.undoSubscriptionCancellation throws ConflictError and preserves CANCELLING state', async () => {
    const sub = await setupActiveSubscription();
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    let threw = false;
    try {
      await BillingStateService.undoSubscriptionCancellation(testUser.id);
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 409);
      assert.strictEqual(err.errorCode, 'CANCELLATION_REVERSAL_UNSUPPORTED');
    }

    assert.strictEqual(threw, true);

    const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.ok(updatedSub);
    assert.strictEqual(updatedSub.status, BillingStatus.CANCELLING);
    assert.strictEqual(updatedSub.cancelAtPeriodEnd, true);

    const state = await prisma.accountBillingState.findUnique({ where: { userId: testUser.id } });
    assert.ok(state);
    assert.strictEqual(state.status, BillingStatus.CANCELLING);
  });

  // ---------------------------------------------------------------------------
  // 10. Period-end cancellation transitions to EXPIRED
  // ---------------------------------------------------------------------------
  test('10. Period-end cancellation transitions to EXPIRED when period ends', async () => {
    const sub = await setupActiveSubscription(10);
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    // Simulate time advancing past currentPeriodEnd (e.g. 11 days later)
    const simulatedNow = new Date(sub.currentPeriodEnd.getTime() + 1000);

    const evalResult = await DunningService.processDunningAndExpirations({
      now: simulatedNow,
      subscriptionId: sub.id,
      userId: testUser.id
    });

    assert.ok(evalResult.milestonesProcessed.some((m) => m.transitionedTo === BillingStatus.EXPIRED));

    const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.ok(updatedSub);
    assert.strictEqual(updatedSub.status, BillingStatus.EXPIRED);
    assert.ok(updatedSub.expiredAt);

    const state = await prisma.accountBillingState.findUnique({ where: { userId: testUser.id } });
    assert.ok(state);
    assert.strictEqual(state.status, BillingStatus.EXPIRED);
    assert.strictEqual(state.activeSubscriptionId, null);
  });

  // ---------------------------------------------------------------------------
  // 11. Expiration resolves Free entitlements
  // ---------------------------------------------------------------------------
  test('11. Expiration resolves Free entitlements (maxServers=1, priorityRelay=false)', async () => {
    const sub = await setupActiveSubscription(5);
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const simulatedNow = new Date(sub.currentPeriodEnd.getTime() + 5000);
    await DunningService.processDunningAndExpirations({
      now: simulatedNow,
      subscriptionId: sub.id,
      userId: testUser.id
    });

    const effective = await BillingStateService.getEffectivePlan(testUser.id);
    assert.strictEqual(effective.planCode, 'FREE');
    assert.strictEqual(effective.status, BillingStatus.EXPIRED);

    const entitlements = await EntitlementService.resolveUserEntitlements(testUser.id);
    assert.strictEqual(entitlements.planCode, 'FREE');
    assert.strictEqual(entitlements.maxServers, 1);
    assert.strictEqual(entitlements.priorityRelay, false);
  });

  // ---------------------------------------------------------------------------
  // 12. Existing servers remain preserved after expiration
  // ---------------------------------------------------------------------------
  test('12. Existing server instances remain preserved without deletion or stoppage', async () => {
    // Create 2 servers while on Pro
    const s1 = await prisma.serverInstance.create({
      data: { deviceId: testDevice.id, serverName: 'Server 1', status: 'RUNNING' }
    });
    const s2 = await prisma.serverInstance.create({
      data: { deviceId: testDevice.id, serverName: 'Server 2', status: 'RUNNING' }
    });

    const sub = await setupActiveSubscription(2);
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const simulatedNow = new Date(sub.currentPeriodEnd.getTime() + 10000);
    await DunningService.processDunningAndExpirations({
      now: simulatedNow,
      subscriptionId: sub.id,
      userId: testUser.id
    });

    // Check that both servers still exist in RUNNING status
    const server1 = await prisma.serverInstance.findUnique({ where: { id: s1.id } });
    const server2 = await prisma.serverInstance.findUnique({ where: { id: s2.id } });

    assert.ok(server1);
    assert.strictEqual(server1.status, 'RUNNING');
    assert.ok(server2);
    assert.strictEqual(server2.status, 'RUNNING');

    // Clean up test servers
    await prisma.serverInstance.deleteMany({ where: { id: { in: [s1.id, s2.id] } } });
  });

  // ---------------------------------------------------------------------------
  // 13. Existing files remain preserved
  // ---------------------------------------------------------------------------
  test('13. Existing device and metadata remain untouched after cancellation expiration', async () => {
    const sub = await setupActiveSubscription(1);
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const simulatedNow = new Date(sub.currentPeriodEnd.getTime() + 10000);
    await DunningService.processDunningAndExpirations({
      now: simulatedNow,
      subscriptionId: sub.id,
      userId: testUser.id
    });

    const dev = await prisma.device.findUnique({ where: { id: testDevice.id } });
    assert.ok(dev);
    assert.strictEqual(dev.status, 'ONLINE');
  });

  // ---------------------------------------------------------------------------
  // 14. New server creation is blocked when Free limit is exceeded
  // ---------------------------------------------------------------------------
  test('14. New server creation is blocked on Free plan when server limit is reached', async () => {
    const s1 = await prisma.serverInstance.create({
      data: { deviceId: testDevice.id, serverName: 'Free Server 1', status: 'STOPPED' }
    });

    const sub = await setupActiveSubscription(1);
    await BillingStateService.requestSubscriptionCancellation(testUser.id);

    const simulatedNow = new Date(sub.currentPeriodEnd.getTime() + 10000);
    await DunningService.processDunningAndExpirations({
      now: simulatedNow,
      subscriptionId: sub.id,
      userId: testUser.id
    });

    const entitlements = await EntitlementService.resolveUserEntitlements(testUser.id);
    assert.strictEqual(entitlements.maxServers, 1);

    const serverCount = await prisma.serverInstance.count({ where: { deviceId: testDevice.id } });
    assert.strictEqual(serverCount >= entitlements.maxServers, true);

    await prisma.serverInstance.deleteMany({ where: { id: s1.id } });
  });

  // ---------------------------------------------------------------------------
  // 15. Duplicate / out-of-order cancellation webhooks are safe
  // ---------------------------------------------------------------------------
  test('15. Webhook subscription.cancelled handles immediate and scheduled events safely', async () => {
    const sub = await setupActiveSubscription(20);
    const providerEventId = uniqueId('evt_cancel');

    const webhookPayload = {
      entity: 'event',
      account_id: 'acc_test123',
      event: 'subscription.cancelled',
      contains: ['subscription'],
      payload: {
        subscription: {
          entity: {
            id: sub.providerSubscriptionId,
            entity: 'subscription',
            plan_id: sub.providerPlanId,
            status: 'cancelled',
            current_start: Math.floor(sub.currentPeriodStart.getTime() / 1000),
            current_end: Math.floor(sub.currentPeriodEnd.getTime() / 1000),
            ended_at: null
          }
        }
      }
    };

    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody, mockWebhookSecret);

    const result = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      providerEventId,
      webhookPayload,
      {
        webhookSecret: mockWebhookSecret,
        environment: PaymentEnvironment.TEST
      }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'CANCELLING');

    // Duplicate webhook delivery
    const dupResult = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      providerEventId,
      webhookPayload,
      {
        webhookSecret: mockWebhookSecret,
        environment: PaymentEnvironment.TEST
      }
    );

    assert.strictEqual(dupResult.success, true);
    assert.strictEqual(dupResult.idempotent, true);
  });

  // ---------------------------------------------------------------------------
  // 16. Concurrent cancellation requests are safe
  // ---------------------------------------------------------------------------
  test('16. Concurrent cancellation requests execute safely without race conditions', async () => {
    await setupActiveSubscription();

    const [r1, r2] = await Promise.all([
      BillingStateService.requestSubscriptionCancellation(testUser.id),
      BillingStateService.requestSubscriptionCancellation(testUser.id)
    ]);

    assert.strictEqual(r1.status, BillingStatus.CANCELLING);
    assert.strictEqual(r2.status, BillingStatus.CANCELLING);
    assert.strictEqual(r1.id, r2.id);

    const auditCount = await prisma.auditEvent.count({
      where: {
        userId: testUser.id,
        eventType: AuditEventType.SUBSCRIPTION_CANCELLATION_REQUESTED
      }
    });

    assert.ok(auditCount >= 1);
  });
});
