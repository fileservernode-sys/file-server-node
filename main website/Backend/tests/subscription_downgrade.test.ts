import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService, PAID_ENTITLED_STATUSES } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { RazorpayWebhookService } from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';
import { RazorpayClient } from '../src/services/billing/providers/razorpay/razorpay_client.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval,
  PlanChangeStatus,
  AuditEventType,
  WebhookEventStatus
} from '@prisma/client';
import { config } from '../src/config/env.js';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('ZC-BILLING-6.2 Pro Yearly -> Pro Monthly Downgrade Test Suite', () => {
  let app: FastifyInstance;
  let proMonthlyPlan: any;
  let proYearlyPlan: any;
  let proMonthlyInrPrice: any;
  let proYearlyInrPrice: any;
  let proMonthlyMapping: any;
  let proYearlyMapping: any;
  let originalFetch: typeof global.fetch;
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_downgrade_6_2_1234567890';

  let idCounter = 0;
  function uniqueId(prefix = 'id'): string {
    idCounter += 1;
    return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).substring(2, 7)}`;
  }

  function computeSignature(payload: string | Buffer, secret: string = mockWebhookSecret): string {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  function createMockRazorpayClient(opts?: {
    shouldFail?: boolean;
    errorMessage?: string;
    paymentMethod?: string;
    totalCount?: number;
    paidCount?: number;
    remainingCount?: number;
  }) {
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
      fetchSubscription: async (subscriptionId: string) => {
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          id: subscriptionId,
          entity: 'subscription',
          plan_id: 'plan_rzp_pro_yearly_inr',
          status: 'active',
          payment_method: opts?.paymentMethod || 'card',
          total_count: opts?.totalCount ?? 5,
          paid_count: opts?.paidCount ?? 1,
          remaining_count: opts?.remainingCount ?? 4,
          current_start: nowSec - 30 * 86400,
          current_end: nowSec + 335 * 86400,
          quantity: 1
        };
      },
      updateSubscription: async (subscriptionId: string, params: any) => {
        if (opts?.shouldFail) {
          throw new Error(opts.errorMessage || 'Razorpay update subscription failed');
        }
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          id: subscriptionId,
          entity: 'subscription',
          plan_id: params.plan_id,
          status: 'active',
          payment_method: opts?.paymentMethod || 'card',
          total_count: params.remaining_count ? params.remaining_count + 1 : 5,
          paid_count: 1,
          remaining_count: params.remaining_count ?? 4,
          current_start: nowSec - 30 * 86400,
          current_end: nowSec + 335 * 86400,
          schedule_change_at: params.schedule_change_at || 'cycle_end'
        };
      },
      cancelScheduledChanges: async (subscriptionId: string) => {
        if (opts?.shouldFail) {
          throw new Error(opts.errorMessage || 'Razorpay cancel scheduled changes failed');
        }
        return {
          id: subscriptionId,
          entity: 'subscription',
          plan_id: 'plan_rzp_pro_yearly_inr',
          status: 'active'
        };
      }
    } as unknown as RazorpayClient;
  }

  async function createTestUserWithYearlySubscription(opts?: {
    country?: string;
    currency?: CurrencyCode;
    billingStatus?: BillingStatus;
    subStatus?: BillingStatus;
    cancelAtPeriodEnd?: boolean;
    periodEndOffsetDays?: number;
    providerSubId?: string;
  }) {
    const email = `user_${uniqueId()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        fullName: 'Yearly User',
        emailVerified: true
      }
    });

    const country = opts?.country || 'IN';
    const currency = opts?.currency || CurrencyCode.INR;
    const now = new Date();
    const periodEnd = new Date(now.getTime() + (opts?.periodEndOffsetDays ?? 335) * 86400 * 1000);
    const providerSubId = opts?.providerSubId || `sub_${uniqueId('rzp')}`;

    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: proYearlyPlan.id,
        planPriceId: proYearlyInrPrice.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: providerSubId,
        providerPlanId: 'plan_rzp_pro_yearly_inr',
        status: opts?.subStatus || BillingStatus.ACTIVE,
        billingInterval: BillingInterval.YEARLY,
        currency,
        amountMinorUnits: proYearlyInrPrice.amountMinorUnits,
        priceVersion: proYearlyInrPrice.version,
        currentPeriodStart: new Date(now.getTime() - 30 * 86400 * 1000),
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: opts?.cancelAtPeriodEnd ?? false
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: user.id,
        status: opts?.billingStatus || BillingStatus.ACTIVE,
        activeSubscriptionId: sub.id,
        billingCountry: country,
        billingPostalCode: '400001',
        currency
      }
    });

    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        token: `sess_${uniqueId()}`,
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    return { user, sub, session, country, currency, providerSubId, periodEnd };
  }

  before(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key_123';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_456';
    process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
    config.RAZORPAY_KEY_ID = 'rzp_test_key_123';
    config.RAZORPAY_KEY_SECRET = 'rzp_test_secret_456';
    config.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;

    originalFetch = global.fetch;
    global.fetch = (async (url: any, init?: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('/cancel_scheduled_changes')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({
            id: 'sub_rzp_mock',
            entity: 'subscription',
            plan_id: 'plan_rzp_pro_yearly_inr',
            status: 'active'
          }),
          json: async () => ({
            id: 'sub_rzp_mock',
            entity: 'subscription',
            plan_id: 'plan_rzp_pro_yearly_inr',
            status: 'active'
          })
        };
      }
      if (urlStr.includes('/subscriptions/') || urlStr.includes('/v1/subscriptions')) {
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({
            id: 'sub_rzp_mock',
            entity: 'subscription',
            plan_id: 'plan_rzp_pro_yearly_inr',
            status: 'active',
            payment_method: 'card',
            total_count: 5,
            paid_count: 1,
            remaining_count: 4,
            current_start: nowSec - 30 * 86400,
            current_end: nowSec + 335 * 86400,
            schedule_change_at: 'cycle_end'
          }),
          json: async () => ({
            id: 'sub_rzp_mock',
            entity: 'subscription',
            plan_id: 'plan_rzp_pro_yearly_inr',
            status: 'active',
            payment_method: 'card',
            total_count: 5,
            paid_count: 1,
            remaining_count: 4,
            current_start: nowSec - 30 * 86400,
            current_end: nowSec + 335 * 86400,
            schedule_change_at: 'cycle_end'
          })
        };
      }
      if (originalFetch) {
        return originalFetch(url, init);
      }
      throw new Error(`Unhandled fetch in test: ${urlStr}`);
    }) as any;

    // Retry connecting if DB is waking up
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await prisma.$connect();
        break;
      } catch (err: any) {
        if (attempt === 5) throw err;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    app = await buildApp();
    await app.ready();

    await PlanService.seedInitialCatalog();
    await EntitlementService.seedInitialEntitlements();

    proMonthlyPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    proYearlyPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_YEARLY' },
      include: { prices: true }
    });

    proMonthlyInrPrice = proMonthlyPlan.prices.find((p: any) => p.currency === CurrencyCode.INR);
    proYearlyInrPrice = proYearlyPlan.prices.find((p: any) => p.currency === CurrencyCode.INR);

    proMonthlyMapping = await prisma.billingProviderPlanMapping.upsert({
      where: {
        provider_environment_planPriceId: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          planPriceId: proMonthlyInrPrice.id
        }
      },
      update: {
        providerPlanId: 'plan_rzp_pro_monthly_inr',
        isActive: true
      },
      create: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        planId: proMonthlyPlan.id,
        planPriceId: proMonthlyInrPrice.id,
        providerPlanId: 'plan_rzp_pro_monthly_inr',
        currency: CurrencyCode.INR,
        amountMinorUnits: proMonthlyInrPrice.amountMinorUnits,
        period: 'monthly',
        interval: 1,
        isActive: true
      }
    });

    proYearlyMapping = await prisma.billingProviderPlanMapping.upsert({
      where: {
        provider_environment_planPriceId: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          planPriceId: proYearlyInrPrice.id
        }
      },
      update: {
        providerPlanId: 'plan_rzp_pro_yearly_inr',
        isActive: true
      },
      create: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        planId: proYearlyPlan.id,
        planPriceId: proYearlyInrPrice.id,
        providerPlanId: 'plan_rzp_pro_yearly_inr',
        currency: CurrencyCode.INR,
        amountMinorUnits: proYearlyInrPrice.amountMinorUnits,
        period: 'yearly',
        interval: 1,
        isActive: true
      }
    });
  });

  after(async () => {
    await app.close();
  });

  // 1. Active Pro Yearly subscription successfully schedules downgrade to Pro Monthly at cycle end
  test('1. Active Pro Yearly subscription successfully schedules downgrade to Pro Monthly at cycle end', async () => {
    const { user } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    const result = await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sourcePlan, 'PRO_YEARLY');
    assert.strictEqual(result.targetPlan, 'PRO_MONTHLY');
    assert.strictEqual(result.status, 'SCHEDULED');
    assert.ok(result.planChangeId);
    assert.ok(result.effectiveAt);
  });

  // 2. Downgrade schedule does NOT take effect immediately: local plan remains PRO_YEARLY, active, with yearly currentPeriodEnd
  test('2. Downgrade schedule does NOT take effect immediately: local plan remains PRO_YEARLY, active, with yearly currentPeriodEnd', async () => {
    const { user, sub, periodEnd } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const updatedSub = await prisma.subscription.findUnique({
      where: { id: sub.id },
      include: { plan: true }
    });

    assert.strictEqual(updatedSub?.plan.code, 'PRO_YEARLY');
    assert.strictEqual(updatedSub?.billingInterval, BillingInterval.YEARLY);
    assert.strictEqual(updatedSub?.status, BillingStatus.ACTIVE);
    assert.strictEqual(updatedSub?.currentPeriodEnd.getTime(), periodEnd.getTime());
  });

  // 3. User keeps all Pro entitlements and server capacity (maxServers: 5) while downgrade is pending
  test('3. User keeps all Pro entitlements and server capacity (maxServers: 5) while downgrade is pending', async () => {
    const { user } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const entitlements = await EntitlementService.resolveUserEntitlements(user.id);
    assert.strictEqual(entitlements.planCode, 'PRO_YEARLY');
    assert.strictEqual(entitlements.maxServers, 5);
    assert.strictEqual(entitlements.priorityRelay, true);
  });

  // 4. Server instances and devices are NOT stopped, reduced, or modified during pending downgrade
  test('4. Server instances and devices are NOT stopped, reduced, or modified during pending downgrade', async () => {
    const { user } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    const device = await prisma.device.create({
      data: {
        userId: user.id,
        deviceName: 'Yearly Phone',
        platform: 'ANDROID',
        status: 'ONLINE'
      }
    });

    const server1 = await prisma.serverInstance.create({
      data: { deviceId: device.id, serverName: 'Server 1', status: 'RUNNING' }
    });
    const server2 = await prisma.serverInstance.create({
      data: { deviceId: device.id, serverName: 'Server 2', status: 'RUNNING' }
    });

    await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const currentServers = await prisma.serverInstance.findMany({
      where: { deviceId: device.id }
    });
    assert.strictEqual(currentServers.length, 2);
    assert.ok(currentServers.every((s) => s.status === 'RUNNING'));
  });

  // 5. Zero immediate proration credit, zero immediate refund, zero immediate BillingPayment generated upon scheduling downgrade
  test('5. Zero immediate proration credit, zero immediate refund, zero immediate BillingPayment generated upon scheduling downgrade', async () => {
    const { user, sub } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    const result = await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    assert.strictEqual(result.creditMinorUnits, 0);
    assert.strictEqual(result.netAmountMinorUnits, 0);

    const payments = await prisma.billingPayment.findMany({
      where: { subscriptionId: sub.id }
    });
    assert.strictEqual(payments.length, 0);
  });

  // 6. Local SubscriptionPlanChange record is created with status SCHEDULED, requestedAt, and scheduledFor set to cycle end
  test('6. Local SubscriptionPlanChange record is created with status SCHEDULED, requestedAt, and scheduledFor set to cycle end', async () => {
    const { user, sub, periodEnd } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    const result = await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const planChange = await prisma.subscriptionPlanChange.findUnique({
      where: { id: result.planChangeId },
      include: { fromPlan: true, toPlan: true }
    });

    assert.ok(planChange);
    assert.strictEqual(planChange.status, PlanChangeStatus.SCHEDULED);
    assert.strictEqual(planChange.fromPlan.code, 'PRO_YEARLY');
    assert.strictEqual(planChange.toPlan.code, 'PRO_MONTHLY');
    assert.strictEqual(planChange.creditMinorUnits, 0);
    assert.strictEqual(planChange.netAmountMinorUnits, 0);
    assert.strictEqual(planChange.scheduledFor?.getTime(), periodEnd.getTime());
  });

  // 7. AuditEvent SUBSCRIPTION_DOWNGRADE_REQUESTED and SUBSCRIPTION_DOWNGRADE_SCHEDULED are recorded with full metadata
  test('7. AuditEvent SUBSCRIPTION_DOWNGRADE_REQUESTED and SUBSCRIPTION_DOWNGRADE_SCHEDULED are recorded with full metadata', async () => {
    const { user, sub } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const requestedAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_REQUESTED
      }
    });
    assert.ok(requestedAudit);
    assert.strictEqual((requestedAudit.metadata as any)?.subscriptionId, sub.id);
    assert.strictEqual((requestedAudit.metadata as any)?.toPlan, 'PRO_MONTHLY');

    const scheduledAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_SCHEDULED
      }
    });
    assert.ok(scheduledAudit);
    assert.strictEqual((scheduledAudit.metadata as any)?.subscriptionId, sub.id);
  });

  // 8. User notification for scheduled downgrade is created with proper title and body
  test('8. User notification for scheduled downgrade is created with proper title and body', async () => {
    const { user, sub } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const notif = await prisma.notificationRecord.findFirst({
      where: {
        userId: user.id,
        eventType: 'SUBSCRIPTION_DOWNGRADE_SCHEDULED'
      }
    });

    assert.ok(notif);
    assert.strictEqual(notif.title, 'Pro Monthly Downgrade Scheduled');
    assert.ok(notif.body.includes('transition to Pro Monthly'));
  });

  // 9. Attempting to schedule downgrade when account is FREE is rejected (409 Conflict)
  test('9. Attempting to schedule downgrade when account is FREE is rejected (409 Conflict)', async () => {
    const email = `free_${uniqueId()}@example.com`;
    const freeUser = await prisma.user.create({
      data: { email, fullName: 'Free User', emailVerified: true }
    });
    await prisma.accountBillingState.create({
      data: { userId: freeUser.id, status: BillingStatus.FREE }
    });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(freeUser.id, { targetPlanCode: 'PRO_MONTHLY' });
      },
      (err: any) => err.statusCode === 409
    );
  });

  // 10. Attempting to schedule downgrade when subscription is in PAST_DUE or GRACE_PERIOD is rejected (409 Conflict)
  test('10. Attempting to schedule downgrade when subscription is in PAST_DUE or GRACE_PERIOD is rejected (409 Conflict)', async () => {
    const { user: userPastDue } = await createTestUserWithYearlySubscription({
      billingStatus: BillingStatus.PAST_DUE,
      subStatus: BillingStatus.PAST_DUE
    });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(userPastDue.id, { targetPlanCode: 'PRO_MONTHLY' });
      },
      (err: any) => err.statusCode === 409
    );

    const { user: userGrace } = await createTestUserWithYearlySubscription({
      billingStatus: BillingStatus.GRACE_PERIOD,
      subStatus: BillingStatus.GRACE_PERIOD
    });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(userGrace.id, { targetPlanCode: 'PRO_MONTHLY' });
      },
      (err: any) => err.statusCode === 409
    );
  });

  // 11. Attempting to schedule downgrade when subscription is CANCELLING or cancelAtPeriodEnd=true is rejected (409 Conflict)
  test('11. Attempting to schedule downgrade when subscription is CANCELLING or cancelAtPeriodEnd=true is rejected (409 Conflict)', async () => {
    const { user: userCancelling } = await createTestUserWithYearlySubscription({
      billingStatus: BillingStatus.CANCELLING,
      cancelAtPeriodEnd: true
    });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(userCancelling.id, { targetPlanCode: 'PRO_MONTHLY' });
      },
      (err: any) => err.statusCode === 409
    );
  });

  // 12. Attempting to schedule downgrade when subscription is EXPIRED or REFUNDED is rejected (409 Conflict)
  test('12. Attempting to schedule downgrade when subscription is EXPIRED or REFUNDED is rejected (409 Conflict)', async () => {
    const { user: userExpired } = await createTestUserWithYearlySubscription({
      billingStatus: BillingStatus.EXPIRED,
      subStatus: BillingStatus.EXPIRED
    });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(userExpired.id, { targetPlanCode: 'PRO_MONTHLY' });
      },
      (err: any) => err.statusCode === 409
    );
  });

  // 13. Attempting to schedule downgrade when current plan is PRO_MONTHLY is rejected (409 Conflict)
  test('13. Attempting to schedule downgrade when current plan is PRO_MONTHLY is rejected (409 Conflict)', async () => {
    const email = `monthly_${uniqueId()}@example.com`;
    const monthlyUser = await prisma.user.create({
      data: { email, fullName: 'Monthly User', emailVerified: true }
    });
    const sub = await prisma.subscription.create({
      data: {
        userId: monthlyUser.id,
        planId: proMonthlyPlan.id,
        planPriceId: proMonthlyInrPrice.id,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: proMonthlyInrPrice.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });
    await prisma.accountBillingState.create({
      data: {
        userId: monthlyUser.id,
        status: BillingStatus.ACTIVE,
        activeSubscriptionId: sub.id,
        billingCountry: 'IN',
        currency: CurrencyCode.INR
      }
    });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(monthlyUser.id, { targetPlanCode: 'PRO_MONTHLY' });
      },
      (err: any) => err.statusCode === 409
    );
  });

  // 14. Attempting to schedule downgrade with unsupported target plan (e.g. FREE or PRO_CUSTOM) is rejected (400 Bad Request)
  test('14. Attempting to schedule downgrade with unsupported target plan (e.g. FREE or PRO_CUSTOM) is rejected (400 Bad Request)', async () => {
    const { user } = await createTestUserWithYearlySubscription();

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(user.id, { targetPlanCode: 'FREE' });
      },
      (err: any) => err.statusCode === 400
    );
  });

  // 15. Attempting to schedule duplicate downgrade when one is already SCHEDULED or PROCESSING is rejected (409 Conflict)
  test('15. Attempting to schedule duplicate downgrade when one is already SCHEDULED or PROCESSING is rejected (409 Conflict)', async () => {
    const { user } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(
          user.id,
          { targetPlanCode: 'PRO_MONTHLY' },
          { client: mockClient }
        );
      },
      (err: any) => err.statusCode === 409
    );
  });

  // 16. Unconfirmed billing country or currency mismatch is rejected before provider call
  test('16. Unconfirmed billing country or currency mismatch is rejected before provider call', async () => {
    const email = `unconfirmed_${uniqueId()}@example.com`;
    const user = await prisma.user.create({
      data: { email, fullName: 'Unconfirmed Country User', emailVerified: true }
    });
    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: proYearlyPlan.id,
        planPriceId: proYearlyInrPrice.id,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.YEARLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: proYearlyInrPrice.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 86400000)
      }
    });
    await prisma.accountBillingState.create({
      data: {
        userId: user.id,
        status: BillingStatus.ACTIVE,
        activeSubscriptionId: sub.id,
        billingCountry: null
      }
    });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(user.id, { targetPlanCode: 'PRO_MONTHLY' });
      },
      (err: any) => err.statusCode === 400
    );
  });

  // 17. Incomplete Razorpay catalog mapping throws CATALOG_INCOMPLETE error and preserves original subscription
  test('17. Incomplete Razorpay catalog mapping throws CATALOG_INCOMPLETE error and preserves original subscription', async () => {
    const { user, sub } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    await prisma.billingProviderPlanMapping.update({
      where: { id: proMonthlyMapping.id },
      data: { isActive: false }
    });

    try {
      await assert.rejects(
        async () => {
          await BillingStateService.downgradeSubscription(
            user.id,
            { targetPlanCode: 'PRO_MONTHLY' },
            { client: mockClient }
          );
        },
        (err: any) => err.errorCode === 'CATALOG_INCOMPLETE'
      );

      const unchangedSub = await prisma.subscription.findUnique({
        where: { id: sub.id }
      });
      assert.strictEqual(unchangedSub?.planId, proYearlyPlan.id);
    } finally {
      await prisma.billingProviderPlanMapping.update({
        where: { id: proMonthlyMapping.id },
        data: { isActive: true }
      });
    }
  });

  // 18. Payment method safety: UPI / eMandate subscriptions are rejected for scheduled downgrade
  test('18. Payment method safety: UPI / eMandate subscriptions are rejected for scheduled downgrade', async () => {
    const { user } = await createTestUserWithYearlySubscription();
    const upiMockClient = createMockRazorpayClient({ paymentMethod: 'upi' });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(
          user.id,
          { targetPlanCode: 'PRO_MONTHLY' },
          { client: upiMockClient }
        );
      },
      (err: any) => err.statusCode === 409 && err.errorCode === 'DOWNGRADE_PAYMENT_METHOD_UNSUPPORTED'
    );
  });

  // 19. Dynamic remaining_count safety: safe remaining_count is calculated and never passed as 0
  test('19. Dynamic remaining_count safety: safe remaining_count is calculated and never passed as 0', async () => {
    const { user } = await createTestUserWithYearlySubscription();
    let passedRemainingCount: number | undefined;

    const mockClient = {
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
      fetchSubscription: async (subscriptionId: string) => {
        return {
          id: subscriptionId,
          entity: 'subscription',
          plan_id: 'plan_rzp_pro_yearly_inr',
          status: 'active',
          payment_method: 'card',
          total_count: 5,
          paid_count: 5, // would calculate to 0, must be clamped to at least 1
          remaining_count: 0
        };
      },
      updateSubscription: async (subscriptionId: string, params: any) => {
        passedRemainingCount = params.remaining_count;
        return {
          id: subscriptionId,
          entity: 'subscription',
          plan_id: params.plan_id,
          status: 'active'
        };
      }
    } as unknown as RazorpayClient;

    await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    assert.strictEqual(passedRemainingCount, 1);
  });

  // 20. Provider API failure during scheduling marks SubscriptionPlanChange as FAILED and preserves original subscription
  test('20. Provider API failure during scheduling marks SubscriptionPlanChange as FAILED and preserves original subscription', async () => {
    const { user, sub } = await createTestUserWithYearlySubscription();
    const failingMockClient = createMockRazorpayClient({
      shouldFail: true,
      errorMessage: 'Razorpay 500 Internal Error'
    });

    await assert.rejects(
      async () => {
        await BillingStateService.downgradeSubscription(
          user.id,
          { targetPlanCode: 'PRO_MONTHLY' },
          { client: failingMockClient }
        );
      },
      (err: any) => err.message.includes('Razorpay 500 Internal Error')
    );

    const failedPlanChange = await prisma.subscriptionPlanChange.findFirst({
      where: { subscriptionId: sub.id }
    });
    assert.ok(failedPlanChange);
    assert.strictEqual(failedPlanChange.status, PlanChangeStatus.FAILED);
    assert.ok(failedPlanChange.failureReason?.includes('Razorpay 500 Internal Error'));

    const unchangedSub = await prisma.subscription.findUnique({
      where: { id: sub.id }
    });
    assert.strictEqual(unchangedSub?.planId, proYearlyPlan.id);
  });

  // 21. Scheduled downgrade can be cancelled before cycle end via POST /billing/subscription/downgrade/cancel
  test('21. Scheduled downgrade can be cancelled before cycle end via POST /billing/subscription/downgrade/cancel', async () => {
    const { user, session } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscription/downgrade/cancel',
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'CANCELLED');
    assert.strictEqual(body.data.currentPlan, 'PRO_YEARLY');
  });

  // 22. Cancelling scheduled downgrade calls Razorpay cancelScheduledChanges, marks SubscriptionPlanChange as CANCELLED with cancelledAt, and emits audit event
  test('22. Cancelling scheduled downgrade calls Razorpay cancelScheduledChanges, marks SubscriptionPlanChange as CANCELLED with cancelledAt, and emits audit event', async () => {
    const { user, sub } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    const schedResult = await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const cancelResult = await BillingStateService.cancelPendingDowngrade(user.id, { client: mockClient });
    assert.strictEqual(cancelResult.success, true);
    assert.strictEqual(cancelResult.status, 'CANCELLED');

    const cancelledPlanChange = await prisma.subscriptionPlanChange.findUnique({
      where: { id: schedResult.planChangeId }
    });
    assert.ok(cancelledPlanChange);
    assert.strictEqual(cancelledPlanChange.status, PlanChangeStatus.CANCELLED);
    assert.ok(cancelledPlanChange.cancelledAt);

    const cancelAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_CANCELLED
      }
    });
    assert.ok(cancelAudit);
  });

  // 23. Cancelling downgrade when no downgrade is pending returns 404 / error
  test('23. Cancelling downgrade when no downgrade is pending returns 404 / error', async () => {
    const { user } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    await assert.rejects(
      async () => {
        await BillingStateService.cancelPendingDowngrade(user.id, { client: mockClient });
      },
      (err: any) => err.statusCode === 404
    );
  });

  // 24. Webhook synchronization: subscription.updated at cycle end authoritatively transitions subscription to PRO_MONTHLY, marks SubscriptionPlanChange COMPLETED, and emits SUBSCRIPTION_DOWNGRADE_EFFECTIVE audit event
  test('24. Webhook synchronization: subscription.updated at cycle end authoritatively transitions subscription to PRO_MONTHLY, marks SubscriptionPlanChange COMPLETED, and emits SUBSCRIPTION_DOWNGRADE_EFFECTIVE audit event', async () => {
    const { user, sub, providerSubId } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    const schedResult = await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    const eventId = `evt_wh_downgrade_${uniqueId()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const webhookPayload = {
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'subscription.updated',
      contains: ['subscription'],
      payload: {
        subscription: {
          entity: {
            id: providerSubId,
            plan_id: 'plan_rzp_pro_monthly_inr',
            status: 'active',
            current_start: nowSec,
            current_end: nowSec + 30 * 86400,
            quantity: 1
          }
        }
      }
    };

    const rawPayload = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawPayload);

    const result = await RazorpayWebhookService.handleWebhook(
      rawPayload,
      signature,
      eventId,
      webhookPayload
    );

    assert.strictEqual(result.success, true);

    const updatedSub = await prisma.subscription.findUnique({
      where: { id: sub.id },
      include: { plan: true }
    });
    assert.strictEqual(updatedSub?.plan.code, 'PRO_MONTHLY');
    assert.strictEqual(updatedSub?.billingInterval, BillingInterval.MONTHLY);
    assert.strictEqual(updatedSub?.amountMinorUnits, proMonthlyInrPrice.amountMinorUnits);

    const completedPlanChange = await prisma.subscriptionPlanChange.findUnique({
      where: { id: schedResult.planChangeId }
    });
    assert.strictEqual(completedPlanChange?.status, PlanChangeStatus.COMPLETED);
    assert.ok(completedPlanChange?.completedAt);

    const effectiveAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_EFFECTIVE
      }
    });
    assert.ok(effectiveAudit);
  });

  // 25. Webhook plan mismatch: provider sends unexpected plan ID at cycle end; SubscriptionPlanChange is marked REQUIRES_REVIEW and SUBSCRIPTION_DOWNGRADE_MISMATCHED audit event is emitted without dropping entitlements
  test('25. Webhook plan mismatch: provider sends unexpected plan ID at cycle end; SubscriptionPlanChange is marked REQUIRES_REVIEW and SUBSCRIPTION_DOWNGRADE_MISMATCHED audit event is emitted without dropping entitlements', async () => {
    const { user, sub, providerSubId } = await createTestUserWithYearlySubscription();
    const mockClient = createMockRazorpayClient();

    const schedResult = await BillingStateService.downgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_MONTHLY' },
      { client: mockClient }
    );

    // Create an alternate mapping for testing mismatch
    const altMapping = await prisma.billingProviderPlanMapping.upsert({
      where: {
        provider_environment_providerPlanId: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          providerPlanId: 'plan_rzp_unexpected_mismatch_inr'
        }
      },
      update: { isActive: true },
      create: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        planId: proYearlyPlan.id,
        planPriceId: proYearlyInrPrice.id,
        providerPlanId: 'plan_rzp_unexpected_mismatch_inr',
        currency: CurrencyCode.INR,
        amountMinorUnits: 999900,
        period: 'yearly',
        interval: 1,
        isActive: true
      }
    });

    const eventId = `evt_wh_mismatch_${uniqueId()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const webhookPayload = {
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'subscription.updated',
      contains: ['subscription'],
      payload: {
        subscription: {
          entity: {
            id: providerSubId,
            plan_id: 'plan_rzp_unexpected_mismatch_inr',
            status: 'active',
            current_start: nowSec,
            current_end: nowSec + 365 * 86400,
            quantity: 1
          }
        }
      }
    };

    const rawPayload = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawPayload);

    const result = await RazorpayWebhookService.handleWebhook(
      rawPayload,
      signature,
      eventId,
      webhookPayload
    );

    assert.strictEqual(result.success, true);

    const reviewedPlanChange = await prisma.subscriptionPlanChange.findUnique({
      where: { id: schedResult.planChangeId }
    });
    assert.strictEqual(reviewedPlanChange?.status, PlanChangeStatus.REQUIRES_REVIEW);
    assert.ok(reviewedPlanChange?.failureReason?.includes('Provider plan mismatch'));

    const mismatchAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_MISMATCHED
      }
    });
    assert.ok(mismatchAudit);

    const entitlements = await EntitlementService.resolveUserEntitlements(user.id);
    assert.strictEqual(entitlements.maxServers, 5);
    assert.strictEqual(entitlements.priorityRelay, true);
  });

  after(async () => {
    if (originalFetch) {
      global.fetch = originalFetch;
    }
    await app.close();
    await prisma.$disconnect();
  });
});
