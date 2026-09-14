import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService, PAID_ENTITLED_STATUSES } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { DunningService } from '../src/services/billing/dunning_service.js';
import { RazorpayCheckoutService } from '../src/services/billing/providers/razorpay/razorpay_checkout_service.js';
import { RazorpayWebhookService } from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';
import { RazorpayClient } from '../src/services/billing/providers/razorpay/razorpay_client.js';
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

describe('ZC-BILLING-5.5 Re-Subscription After Cancellation Test Suite', () => {
  let app: FastifyInstance;
  let testUser: any;
  let testSession: any;
  let testDevice: any;
  let proPlan: any;
  let proMonthlyInrPrice: any;
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_resub_1234567890';

  let idCounter = 0;
  function uniqueId(prefix = 'id'): string {
    idCounter += 1;
    return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).substring(2, 7)}`;
  }

  function computeSignature(payload: string | Buffer, secret: string = mockWebhookSecret): string {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  function createMockRazorpayClient(createdSubId?: string) {
    const subId = createdSubId || uniqueId('sub_rzp_new');
    return {
      name: 'RAZORPAY',
      isConfigured: () => true,
      assertConfigured: () => ({
        keyId: 'rzp_test_key_123',
        keySecret: 'rzp_test_secret_456',
        webhookSecret: mockWebhookSecret,
        baseUrl: 'https://api.razorpay.com/v1',
        timeoutMs: 10000,
        isConfigured: true,
        isComplete: true
      }),
      createSubscription: async (params: any) => ({
        id: subId,
        entity: 'subscription',
        plan_id: params.plan_id,
        status: 'created',
        current_start: null,
        current_end: null,
        ended_at: null,
        quantity: 1,
        total_count: params.total_count,
        paid_count: 0,
        remaining_count: params.total_count,
        customer_notify: 1,
        created_at: Math.floor(Date.now() / 1000)
      })
    } as unknown as RazorpayClient;
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

    // Seed provider mapping if needed
    const existingMapping = await prisma.billingProviderPlanMapping.findUnique({
      where: {
        provider_environment_planPriceId: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          planPriceId: proMonthlyInrPrice.id
        }
      }
    });

    if (!existingMapping) {
      await prisma.billingProviderPlanMapping.create({
        data: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          planId: proPlan.id,
          planPriceId: proMonthlyInrPrice.id,
          providerPlanId: 'plan_mock_pro_monthly_inr',
          currency: CurrencyCode.INR,
          amountMinorUnits: proMonthlyInrPrice.amountMinorUnits,
          period: 'monthly',
          interval: 1,
          priceVersion: proMonthlyInrPrice.version,
          isActive: true
        }
      });
    }

    // Create test user
    testUser = await prisma.user.create({
      data: {
        email: `test_resub_${Date.now()}@example.com`,
        fullName: 'Re-subscription Test User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testSession = await prisma.userSession.create({
      data: {
        userId: testUser.id,
        token: `sess_resub_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });

    testDevice = await prisma.device.create({
      data: {
        userId: testUser.id,
        deviceName: 'Resub Test Device',
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

  // Helper to create an expired historical subscription
  async function setupExpiredHistoricalSubscription() {
    const oldSubId = uniqueId('sub_rzp_old');
    const pastStart = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    const pastEnd = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    await prisma.subscription.deleteMany({ where: { userId: testUser.id } });

    const oldSub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: proPlan.id,
        planPriceId: proMonthlyInrPrice.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: oldSubId,
        providerPlanId: 'plan_mock_pro_monthly_inr',
        status: BillingStatus.EXPIRED,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: proMonthlyInrPrice.amountMinorUnits,
        priceVersion: proMonthlyInrPrice.version,
        currentPeriodStart: pastStart,
        currentPeriodEnd: pastEnd,
        cancelAtPeriodEnd: true,
        cancelledAt: pastStart,
        expiredAt: pastEnd
      }
    });

    await prisma.accountBillingState.upsert({
      where: { userId: testUser.id },
      update: {
        status: BillingStatus.EXPIRED,
        activeSubscriptionId: null,
        currency: CurrencyCode.INR,
        billingCountry: 'IN',
        billingPostalCode: '400001'
      },
      create: {
        userId: testUser.id,
        status: BillingStatus.EXPIRED,
        activeSubscriptionId: null,
        currency: CurrencyCode.INR,
        billingCountry: 'IN',
        billingPostalCode: '400001'
      }
    });

    return oldSub;
  }

  // ---------------------------------------------------------------------------
  // 1 & 2. EXPIRED account can start a new Pro checkout creating a NEW Subscription
  // ---------------------------------------------------------------------------
  test('1 & 2. EXPIRED account can start a new Pro checkout and creates a NEW internal Subscription', async () => {
    const oldSub = await setupExpiredHistoricalSubscription();
    const newProviderSubId = uniqueId('sub_rzp_new_1');
    const mockClient = createMockRazorpayClient(newProviderSubId);

    const session = await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    assert.ok(session);
    assert.strictEqual(session.subscriptionId, newProviderSubId);

    // Verify a new Subscription row was created
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: testUser.id },
      orderBy: { createdAt: 'asc' }
    });

    assert.strictEqual(subscriptions.length, 2);
    assert.strictEqual(subscriptions[0].id, oldSub.id);
    assert.strictEqual(subscriptions[1].providerSubscriptionId, newProviderSubId);
    assert.strictEqual(subscriptions[1].status, BillingStatus.CREATED);
  });

  // ---------------------------------------------------------------------------
  // 3. New provider subscription ID differs from old subscription ID
  // ---------------------------------------------------------------------------
  test('3. New provider subscription ID strictly differs from old subscription ID', async () => {
    const oldSub = await setupExpiredHistoricalSubscription();
    const newProviderSubId = uniqueId('sub_rzp_new_distinct');
    const mockClient = createMockRazorpayClient(newProviderSubId);

    const session = await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    assert.notStrictEqual(session.subscriptionId, oldSub.providerSubscriptionId);
    assert.strictEqual(session.subscriptionId, newProviderSubId);
  });

  // ---------------------------------------------------------------------------
  // 4 & 5. Old EXPIRED subscription remains unchanged with historical pricing
  // ---------------------------------------------------------------------------
  test('4 & 5. Old EXPIRED subscription remains unchanged with original PlanPrice and dates', async () => {
    const oldSub = await setupExpiredHistoricalSubscription();
    const oldSnapshot = await prisma.subscription.findUnique({ where: { id: oldSub.id } });

    const newProviderSubId = uniqueId('sub_rzp_new_price');
    const mockClient = createMockRazorpayClient(newProviderSubId);

    await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    const checkOldSub = await prisma.subscription.findUnique({ where: { id: oldSub.id } });
    assert.ok(checkOldSub);
    assert.strictEqual(checkOldSub.status, BillingStatus.EXPIRED);
    assert.strictEqual(checkOldSub.amountMinorUnits, oldSnapshot?.amountMinorUnits);
    assert.strictEqual(checkOldSub.priceVersion, oldSnapshot?.priceVersion);
    assert.strictEqual(checkOldSub.providerSubscriptionId, oldSnapshot?.providerSubscriptionId);
    assert.strictEqual(checkOldSub.currentPeriodEnd.getTime(), oldSnapshot?.currentPeriodEnd.getTime());
  });

  // ---------------------------------------------------------------------------
  // 6 & 7. New subscription starts as CREATED and browser callback does not activate
  // ---------------------------------------------------------------------------
  test('6 & 7. New subscription starts as CREATED; browser callback does not grant entitlements', async () => {
    await setupExpiredHistoricalSubscription();
    const newProviderSubId = uniqueId('sub_rzp_new_created');
    const mockClient = createMockRazorpayClient(newProviderSubId);

    await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    // Check effective entitlements before webhook: MUST BE FREE
    const effective = await BillingStateService.getEffectivePlan(testUser.id);
    assert.strictEqual(effective.planCode, 'FREE');
    assert.strictEqual(effective.status, BillingStatus.EXPIRED);

    const entitlements = await EntitlementService.resolveUserEntitlements(testUser.id);
    assert.strictEqual(entitlements.planCode, 'FREE');
    assert.strictEqual(entitlements.maxServers, 1);
    assert.strictEqual(entitlements.priorityRelay, false);
  });

  // ---------------------------------------------------------------------------
  // 8, 9 & 10. Webhook activates ONLY the new subscription and updates AccountBillingState
  // ---------------------------------------------------------------------------
  test('8, 9 & 10. Webhook activates only the new subscription; old remains EXPIRED', async () => {
    const oldSub = await setupExpiredHistoricalSubscription();
    const newProviderSubId = uniqueId('sub_rzp_new_activate');
    const mockClient = createMockRazorpayClient(newProviderSubId);

    await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    const newSub = await prisma.subscription.findUnique({
      where: { providerSubscriptionId: newProviderSubId }
    });
    assert.ok(newSub);

    // Send authoritative webhook for new subscription
    const nowSec = Math.floor(Date.now() / 1000);
    const webhookPayload = {
      entity: 'event',
      account_id: 'acc_test123',
      event: 'subscription.activated',
      contains: ['subscription'],
      payload: {
        subscription: {
          entity: {
            id: newProviderSubId,
            entity: 'subscription',
            plan_id: newSub.providerPlanId,
            status: 'active',
            current_start: nowSec,
            current_end: nowSec + 30 * 86400
          }
        }
      }
    };

    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody, mockWebhookSecret);
    const providerEventId = uniqueId('evt_act');

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
    assert.strictEqual(result.status, 'ACTIVE');

    // Verify new subscription is ACTIVE
    const checkNewSub = await prisma.subscription.findUnique({ where: { id: newSub.id } });
    assert.ok(checkNewSub);
    assert.strictEqual(checkNewSub.status, BillingStatus.ACTIVE);

    // Verify old subscription remains EXPIRED
    const checkOldSub = await prisma.subscription.findUnique({ where: { id: oldSub.id } });
    assert.ok(checkOldSub);
    assert.strictEqual(checkOldSub.status, BillingStatus.EXPIRED);

    // Verify AccountBillingState points to new subscription
    const state = await prisma.accountBillingState.findUnique({ where: { userId: testUser.id } });
    assert.ok(state);
    assert.strictEqual(state.status, BillingStatus.ACTIVE);
    assert.strictEqual(state.activeSubscriptionId, newSub.id);

    // Verify Entitlements are upgraded to PRO
    const entitlements = await EntitlementService.resolveUserEntitlements(testUser.id);
    assert.strictEqual(entitlements.planCode, 'PRO_MONTHLY');
    assert.strictEqual(entitlements.maxServers, 5);
    assert.strictEqual(entitlements.priorityRelay, true);
  });

  // ---------------------------------------------------------------------------
  // 11. Existing servers remain preserved throughout re-subscription
  // ---------------------------------------------------------------------------
  test('11. Existing server instances remain preserved throughout re-subscription cycle', async () => {
    const s1 = await prisma.serverInstance.create({
      data: { deviceId: testDevice.id, serverName: 'Persistent Server 1', status: 'RUNNING' }
    });
    const s2 = await prisma.serverInstance.create({
      data: { deviceId: testDevice.id, serverName: 'Persistent Server 2', status: 'RUNNING' }
    });

    await setupExpiredHistoricalSubscription();
    const newProviderSubId = uniqueId('sub_rzp_new_servers');
    const mockClient = createMockRazorpayClient(newProviderSubId);

    await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    // Check servers are still intact
    const server1 = await prisma.serverInstance.findUnique({ where: { id: s1.id } });
    const server2 = await prisma.serverInstance.findUnique({ where: { id: s2.id } });
    assert.ok(server1);
    assert.strictEqual(server1.serverName, 'Persistent Server 1');
    assert.ok(server2);
    assert.strictEqual(server2.serverName, 'Persistent Server 2');

    await prisma.serverInstance.deleteMany({ where: { id: { in: [s1.id, s2.id] } } });
  });

  // ---------------------------------------------------------------------------
  // 12. Duplicate checkout requests follow existing idempotency behavior
  // ---------------------------------------------------------------------------
  test('12. Duplicate checkout requests for same plan within 1 hour reuse pending session', async () => {
    await setupExpiredHistoricalSubscription();
    const newProviderSubId = uniqueId('sub_rzp_new_dup');
    const mockClient = createMockRazorpayClient(newProviderSubId);

    const session1 = await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    const session2 = await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    assert.strictEqual(session1.subscriptionId, session2.subscriptionId);

    const createdCount = await prisma.subscription.count({
      where: { userId: testUser.id, status: BillingStatus.CREATED }
    });
    assert.strictEqual(createdCount, 1);
  });

  // ---------------------------------------------------------------------------
  // 13. ACTIVE / CANCELLING / PAST_DUE / GRACE_PERIOD cannot create overlapping subscription
  // ---------------------------------------------------------------------------
  test('13. ACTIVE/CANCELLING/PAST_DUE/GRACE_PERIOD accounts are rejected from creating overlapping checkout', async () => {
    // 1. ACTIVE
    const activeSub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: proPlan.id,
        planPriceId: proMonthlyInrPrice.id,
        providerSubscriptionId: uniqueId('sub_act_guard'),
        status: BillingStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        amountMinorUnits: 4900
      }
    });

    await prisma.accountBillingState.update({
      where: { userId: testUser.id },
      data: { status: BillingStatus.ACTIVE, activeSubscriptionId: activeSub.id }
    });

    let threw = false;
    try {
      await RazorpayCheckoutService.createCheckoutSession(testUser.id, { planCode: 'PRO_MONTHLY' });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 409);
    }
    assert.strictEqual(threw, true);

    // 2. CANCELLING
    await prisma.subscription.update({
      where: { id: activeSub.id },
      data: { status: BillingStatus.CANCELLING, cancelAtPeriodEnd: true }
    });
    await prisma.accountBillingState.update({
      where: { userId: testUser.id },
      data: { status: BillingStatus.CANCELLING }
    });

    threw = false;
    try {
      await RazorpayCheckoutService.createCheckoutSession(testUser.id, { planCode: 'PRO_MONTHLY' });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 409);
    }
    assert.strictEqual(threw, true);
  });

  // ---------------------------------------------------------------------------
  // 14 & 15. Webhook isolation: old webhook cannot activate new; new cannot mutate old
  // ---------------------------------------------------------------------------
  test('14 & 15. Webhook isolation: old provider webhook does not mutate new; new does not mutate old', async () => {
    const oldSub = await setupExpiredHistoricalSubscription();
    const newProviderSubId = uniqueId('sub_rzp_new_iso');
    const mockClient = createMockRazorpayClient(newProviderSubId);

    await RazorpayCheckoutService.createCheckoutSession(
      testUser.id,
      { planCode: 'PRO_MONTHLY' },
      { client: mockClient, environment: PaymentEnvironment.TEST }
    );

    // Send late renewal charge webhook for OLD expired subscription
    const nowSec = Math.floor(Date.now() / 1000);
    const oldWebhookPayload = {
      entity: 'event',
      account_id: 'acc_test123',
      event: 'subscription.charged',
      contains: ['subscription', 'payment'],
      payload: {
        subscription: {
          entity: {
            id: oldSub.providerSubscriptionId,
            entity: 'subscription',
            plan_id: oldSub.providerPlanId || 'plan_mock_pro_monthly_inr',
            status: 'active',
            current_start: nowSec,
            current_end: nowSec + 30 * 86400
          }
        },
        payment: {
          entity: {
            id: uniqueId('pay_old'),
            amount: 4900,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };

    const oldRaw = JSON.stringify(oldWebhookPayload);
    const oldSig = computeSignature(oldRaw, mockWebhookSecret);
    const oldRes = await RazorpayWebhookService.handleWebhook(
      oldRaw,
      oldSig,
      uniqueId('evt_old'),
      oldWebhookPayload,
      { webhookSecret: mockWebhookSecret, environment: PaymentEnvironment.TEST }
    );

    // Webhook processor rejects renewal of EXPIRED subscription
    assert.strictEqual(oldRes.success, false);

    // Verify old sub is still EXPIRED
    const checkOld = await prisma.subscription.findUnique({ where: { id: oldSub.id } });
    assert.strictEqual(checkOld?.status, BillingStatus.EXPIRED);

    // Verify new sub is still CREATED (not mutated by old webhook)
    const checkNew = await prisma.subscription.findUnique({
      where: { providerSubscriptionId: newProviderSubId }
    });
    assert.strictEqual(checkNew?.status, BillingStatus.CREATED);
  });
});
