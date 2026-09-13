import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService, PAID_ENTITLED_STATUSES } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { UpgradeReconciliationService } from '../src/services/billing/upgrade_reconciliation_service.js';
import { RazorpayWebhookService } from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';
import { RazorpayClient } from '../src/services/billing/providers/razorpay/razorpay_client.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval,
  PlanChangeStatus,
  UpgradeReconciliationStatus,
  AuditEventType,
  WebhookEventStatus
} from '@prisma/client';
import { config } from '../src/config/env.js';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('ZC-BILLING-6.1 Pro Upgrade & Provider Financial Reconciliation Test Suite', () => {
  let app: FastifyInstance;
  let proMonthlyPlan: any;
  let proYearlyPlan: any;
  let proMonthlyInrPrice: any;
  let proYearlyInrPrice: any;
  let proMonthlyMapping: any;
  let proYearlyMapping: any;
  let originalFetch: typeof global.fetch;
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_upgrade_6_1_1234567890';

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
          plan_id: 'plan_rzp_pro_monthly_inr',
          status: 'active',
          payment_method: opts?.paymentMethod || 'card',
          total_count: opts?.totalCount ?? 12,
          paid_count: opts?.paidCount ?? 1,
          remaining_count: opts?.remainingCount ?? 11,
          current_start: nowSec - 10 * 86400,
          current_end: nowSec + 20 * 86400,
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
          total_count: params.remaining_count ? params.remaining_count + 1 : 12,
          paid_count: 1,
          remaining_count: params.remaining_count ?? 11,
          current_start: nowSec,
          current_end: nowSec + 365 * 86400,
          quantity: 1,
          customer_notify: 1,
          updated_at: nowSec
        };
      }
    } as unknown as RazorpayClient;
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
            total_count: 12,
            paid_count: 1,
            remaining_count: 11,
            current_start: nowSec,
            current_end: nowSec + 365 * 86400,
            quantity: 1,
            customer_notify: 1,
            updated_at: nowSec
          }),
          json: async () => ({
            id: 'sub_rzp_mock',
            entity: 'subscription',
            plan_id: 'plan_rzp_pro_yearly_inr',
            status: 'active',
            payment_method: 'card',
            total_count: 12,
            paid_count: 1,
            remaining_count: 11,
            current_start: nowSec,
            current_end: nowSec + 365 * 86400,
            quantity: 1,
            customer_notify: 1,
            updated_at: nowSec
          })
        };
      }
      return originalFetch(url, init);
    }) as any;

    app = await buildApp();
    await app.ready();

    await PlanService.seedInitialCatalog();
    await EntitlementService.seedInitialEntitlements();

    // Fetch plans
    proMonthlyPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    proYearlyPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_YEARLY' },
      include: { prices: true }
    });

    proMonthlyInrPrice = proMonthlyPlan?.prices.find((p: any) => p.currency === CurrencyCode.INR);
    proYearlyInrPrice = proYearlyPlan?.prices.find((p: any) => p.currency === CurrencyCode.INR);

    // Ensure provider plan mappings exist
    proMonthlyMapping = await prisma.billingProviderPlanMapping.upsert({
      where: {
        provider_environment_planPriceId: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          planPriceId: proMonthlyInrPrice.id
        }
      },
      update: { providerPlanId: 'plan_rzp_pro_monthly_inr', isActive: true },
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
      update: { providerPlanId: 'plan_rzp_pro_yearly_inr', isActive: true },
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
    if (originalFetch) {
      global.fetch = originalFetch;
    }
    if (app) {
      await app.close();
    }
  });

  async function createTestAccount(opts?: {
    country?: string;
    postalCode?: string;
    subStatus?: BillingStatus;
    periodDaysAgo?: number;
    totalPeriodDays?: number;
    serverCount?: number;
  }) {
    const user = await prisma.user.create({
      data: {
        id: uniqueId('usr'),
        email: `${uniqueId('test_user')}@example.com`,
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    const session = await prisma.userSession.create({
      data: {
        id: uniqueId('sess'),
        userId: user.id,
        token: uniqueId('tok'),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    const country = opts?.country || 'IN';
    const postalCode = opts?.postalCode || '380001';
    const currency = BillingCountryService.deriveBillingCurrency(country);

    await BillingCountryService.confirmBillingCountry(user.id, { country, postalCode });

    const serverCount = opts?.serverCount ?? 4;
    const device = await prisma.device.create({
      data: {
        id: uniqueId('dev'),
        userId: user.id,
        deviceName: 'Test Pixel 7',
        platform: 'ANDROID',
        status: 'ONLINE'
      }
    });

    for (let i = 0; i < serverCount; i++) {
      await prisma.serverInstance.create({
        data: {
          id: uniqueId('srv'),
          deviceId: device.id,
          serverName: `Production Server ${i + 1}`,
          status: 'RUNNING'
        }
      });
    }

    const now = new Date();
    const periodDaysAgo = opts?.periodDaysAgo ?? 10;
    const totalPeriodDays = opts?.totalPeriodDays ?? 30;

    const periodStart = new Date(now.getTime() - periodDaysAgo * 86400 * 1000);
    const periodEnd = new Date(periodStart.getTime() + totalPeriodDays * 86400 * 1000);

    const subscription = await prisma.subscription.create({
      data: {
        id: uniqueId('sub'),
        userId: user.id,
        planId: proMonthlyPlan.id,
        planPriceId: proMonthlyInrPrice.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: uniqueId('sub_rzp'),
        providerPlanId: proMonthlyMapping.providerPlanId,
        status: opts?.subStatus || BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency,
        amountMinorUnits: proMonthlyInrPrice.amountMinorUnits,
        priceVersion: proMonthlyInrPrice.version,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      },
      include: { plan: true, planPrice: true }
    });

    await prisma.accountBillingState.update({
      where: { userId: user.id },
      data: {
        status: opts?.subStatus || BillingStatus.ACTIVE,
        activeSubscriptionId: subscription.id
      }
    });

    return { user, session, subscription, device };
  }

  // 1. Proration Calculation Engine
  test('1. Proration Calculation Engine: integer arithmetic, credit boundaries, deterministic rounding', async () => {
    const fromAmount = 49900; // 499 INR in paise
    const targetAmount = 499900; // 4999 INR in paise

    const start = new Date('2026-09-01T00:00:00Z');
    const end = new Date('2026-10-01T00:00:00Z'); // 30 days = 2,592,000s

    // Case A: Exact half period remaining (15 days remaining)
    const mid = new Date('2026-09-16T00:00:00Z');
    const resMid = BillingStateService.calculateUpgradeProration(
      { amountMinorUnits: fromAmount, currentPeriodStart: start, currentPeriodEnd: end, currency: CurrencyCode.INR },
      targetAmount,
      mid
    );

    assert.strictEqual(resMid.creditMinorUnits, 24950);
    assert.strictEqual(resMid.netAmountMinorUnits, 499900 - 24950);
    assert.ok(resMid.creditMinorUnits <= fromAmount);
    assert.ok(resMid.netAmountMinorUnits >= 0);

    // Case B: Past period end (0 remaining)
    const afterEnd = new Date('2026-10-05T00:00:00Z');
    const resAfter = BillingStateService.calculateUpgradeProration(
      { amountMinorUnits: fromAmount, currentPeriodStart: start, currentPeriodEnd: end, currency: CurrencyCode.INR },
      targetAmount,
      afterEnd
    );

    assert.strictEqual(resAfter.creditMinorUnits, 0);
    assert.strictEqual(resAfter.netAmountMinorUnits, targetAmount);
  });

  // 2. Supported Payment Method Upgrade (Card) & Pending Reconciliation Creation
  test('2. Supported Payment Method Upgrade: Card payment method succeeds and creates SubscriptionUpgradeReconciliation', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient({ paymentMethod: 'card', totalCount: 12, paidCount: 1, remainingCount: 11 });

    const result = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.targetPlan, 'PRO_YEARLY');

    const updatedSub = await prisma.subscription.findUnique({
      where: { id: subscription.id },
      include: { plan: true, planPrice: true }
    });
    assert.strictEqual(updatedSub?.plan.code, 'PRO_YEARLY');
    assert.strictEqual(updatedSub?.billingInterval, BillingInterval.YEARLY);

    // Verify SubscriptionPlanChange and SubscriptionUpgradeReconciliation
    const planChange = await prisma.subscriptionPlanChange.findUnique({
      where: { id: result.planChangeId },
      include: { reconciliation: true }
    });
    assert.ok(planChange);
    assert.strictEqual(planChange.status, PlanChangeStatus.COMPLETED);
    assert.ok(planChange.reconciliation);
    assert.strictEqual(planChange.reconciliation.expectedAmountMinorUnits, result.netAmountMinorUnits);
    assert.strictEqual(planChange.reconciliation.expectedCreditMinorUnits, result.creditMinorUnits);
    assert.strictEqual(planChange.reconciliation.status, UpgradeReconciliationStatus.PENDING);
  });

  // 3. Unsupported Payment Method Rejection (UPI / eMandate)
  test('3. Unsupported Payment Method Rejection: UPI/eMandate rejected with UPGRADE_PAYMENT_METHOD_UNSUPPORTED without mutating local state', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClientUpi = createMockRazorpayClient({ paymentMethod: 'upi' });

    await assert.rejects(
      async () => {
        await BillingStateService.upgradeSubscription(
          user.id,
          { targetPlanCode: 'PRO_YEARLY' },
          { client: mockClientUpi }
        );
      },
      (err: any) => {
        assert.strictEqual(err.errorCode, 'UPGRADE_PAYMENT_METHOD_UNSUPPORTED');
        return true;
      }
    );

    // Verify Subscription remains unchanged in PRO_MONTHLY
    const subAfter = await prisma.subscription.findUnique({
      where: { id: subscription.id },
      include: { plan: true }
    });
    assert.strictEqual(subAfter?.plan.code, 'PRO_MONTHLY');
    assert.strictEqual(subAfter?.status, BillingStatus.ACTIVE);
  });

  // 4. Safe remaining_count calculation
  test('4. Safe remaining_count calculation: derived from total_count - paid_count without hardcoding', async () => {
    const { user } = await createTestAccount({ periodDaysAgo: 5, totalPeriodDays: 30 });
    let passedRemainingCount: number | undefined;

    const mockClient = {
      name: 'RAZORPAY',
      isConfigured: () => true,
      assertConfigured: () => ({ isComplete: true } as any),
      fetchSubscription: async (subId: string) => ({
        id: subId,
        entity: 'subscription',
        plan_id: 'plan_rzp_pro_monthly_inr',
        status: 'active',
        payment_method: 'card',
        total_count: 36,
        paid_count: 5,
        remaining_count: 31
      }),
      updateSubscription: async (subId: string, params: any) => {
        passedRemainingCount = params.remaining_count;
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          id: subId,
          entity: 'subscription',
          plan_id: params.plan_id,
          status: 'active',
          remaining_count: params.remaining_count,
          current_start: nowSec,
          current_end: nowSec + 365 * 86400,
          updated_at: nowSec
        };
      }
    } as unknown as RazorpayClient;

    const result = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(passedRemainingCount, 31);
  });

  // 5. Provider Update Failure Handling
  test('5. Provider update failure: leaves PRO_MONTHLY intact and marks SubscriptionPlanChange FAILED', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient({ shouldFail: true, errorMessage: 'Card expired on remote gateway' });

    await assert.rejects(
      async () => {
        await BillingStateService.upgradeSubscription(
          user.id,
          { targetPlanCode: 'PRO_YEARLY' },
          { client: mockClient }
        );
      },
      (err: any) => {
        assert.ok(err.message.includes('Card expired'));
        return true;
      }
    );

    // Verify Subscription is still PRO_MONTHLY
    const subAfter = await prisma.subscription.findUnique({
      where: { id: subscription.id },
      include: { plan: true }
    });
    assert.strictEqual(subAfter?.plan.code, 'PRO_MONTHLY');
    assert.strictEqual(subAfter?.status, BillingStatus.ACTIVE);

    // Verify failed plan change record
    const failedChange = await prisma.subscriptionPlanChange.findFirst({
      where: { subscriptionId: subscription.id, status: PlanChangeStatus.FAILED }
    });
    assert.ok(failedChange);
    assert.ok(failedChange.failureReason?.includes('Card expired'));
  });

  // 6. Provider Success with Matching Financial Evidence (MATCHED)
  test('6. Provider Success with Matching Financial Evidence: reconciles to MATCHED and emits audit event', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient();

    const upgradeResult = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    const providerPaymentId = uniqueId('pay_upg_match');
    const providerEventId = uniqueId('evt_match');

    const recResult = await UpgradeReconciliationService.reconcileUpgradeFinancials(
      upgradeResult.planChangeId,
      {
        actualAmountMinorUnits: upgradeResult.netAmountMinorUnits,
        actualCurrency: upgradeResult.currency,
        providerPaymentId,
        providerEventId,
        providerEventType: 'subscription.charged'
      }
    );

    assert.strictEqual(recResult.status, UpgradeReconciliationStatus.MATCHED);
    assert.strictEqual(recResult.actualAmountMinorUnits, upgradeResult.netAmountMinorUnits);
    assert.strictEqual(recResult.mismatchReason, null);
    assert.ok(recResult.resolvedAt);

    // Verify Audit Event
    const matchedAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED
      }
    });
    assert.ok(matchedAudit);
  });

  // 7. Provider Success with Mismatched Financial Evidence (REQUIRES_REVIEW / MISMATCHED)
  test('7. Provider Success with Mismatched Financial Evidence: sets status REQUIRES_REVIEW and preserves user entitlements', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient();

    const upgradeResult = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    const unexpectedChargedAmount = upgradeResult.netAmountMinorUnits + 50000; // 500 INR mismatch
    const providerPaymentId = uniqueId('pay_upg_mismatch');
    const providerEventId = uniqueId('evt_mismatch');

    const recResult = await UpgradeReconciliationService.reconcileUpgradeFinancials(
      upgradeResult.planChangeId,
      {
        actualAmountMinorUnits: unexpectedChargedAmount,
        actualCurrency: upgradeResult.currency,
        providerPaymentId,
        providerEventId,
        providerEventType: 'subscription.charged'
      }
    );

    assert.strictEqual(recResult.status, UpgradeReconciliationStatus.REQUIRES_REVIEW);
    assert.ok(recResult.mismatchReason?.includes('Financial amount mismatch'));

    // Verify Audit Event
    const mismatchAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED
      }
    });
    assert.ok(mismatchAudit);

    // Ensure user subscription remains PRO_YEARLY and active (no drop or downgrade)
    const subAfter = await prisma.subscription.findUnique({
      where: { id: subscription.id },
      include: { plan: true }
    });
    assert.strictEqual(subAfter?.status, BillingStatus.ACTIVE);
    assert.strictEqual(subAfter?.plan.code, 'PRO_YEARLY');
  });

  // 8. Provider Evidence Pending (PENDING)
  test('8. Provider Evidence Pending: preserves PENDING reconciliation status without fabricating completion', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient();

    const upgradeResult = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    const recResult = await UpgradeReconciliationService.reconcileUpgradeFinancials(
      upgradeResult.planChangeId,
      {
        providerEventId: uniqueId('evt_pending')
      }
    );

    assert.strictEqual(recResult.status, UpgradeReconciliationStatus.PENDING);
    assert.ok(recResult.mismatchReason?.includes('pending'));
  });

  // 9. Duplicate subscription.updated Webhook (Idempotency)
  test('9. Duplicate subscription.updated webhook: processes idempotently without duplicating plan changes', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const providerEventId = uniqueId('evt_upd_dup');
    const nowSec = Math.floor(Date.now() / 1000);

    const payload = {
      event: 'subscription.updated',
      id: providerEventId,
      payload: {
        subscription: {
          entity: {
            id: subscription.providerSubscriptionId,
            plan_id: proYearlyMapping.providerPlanId,
            status: 'active',
            current_start: nowSec,
            current_end: nowSec + 365 * 86400,
            quantity: 1,
            customer_notify: 1,
            updated_at: nowSec
          }
        }
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const res1 = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      providerEventId,
      payload,
      { webhookSecret: mockWebhookSecret }
    );
    assert.strictEqual(res1.success, true);

    const res2 = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      providerEventId,
      payload,
      { webhookSecret: mockWebhookSecret }
    );
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.idempotent, true);
  });

  // 10. Duplicate Payment Event & BillingPayment Linking
  test('10. Duplicate Payment Event & BillingPayment Linking: links BillingPayment.planChangeId and guards against duplicates', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient();

    const upgradeResult = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    const providerPaymentId = uniqueId('pay_upg_link');
    const providerEventId = uniqueId('evt_charged_link');
    const nowSec = Math.floor(Date.now() / 1000);

    const payload = {
      event: 'subscription.charged',
      id: providerEventId,
      payload: {
        subscription: {
          entity: {
            id: subscription.providerSubscriptionId,
            plan_id: proYearlyMapping.providerPlanId,
            status: 'active',
            current_start: nowSec,
            current_end: nowSec + 365 * 86400,
            quantity: 1,
            updated_at: nowSec
          }
        },
        payment: {
          entity: {
            id: providerPaymentId,
            amount: proYearlyInrPrice.amountMinorUnits,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const res1 = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      providerEventId,
      payload,
      { webhookSecret: mockWebhookSecret }
    );
    assert.strictEqual(res1.success, true);

    // Verify payment linked
    const payment = await prisma.billingPayment.findUnique({
      where: {
        provider_environment_providerPaymentId: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          providerPaymentId
        }
      }
    });
    assert.ok(payment);
    assert.strictEqual(payment.planChangeId, upgradeResult.planChangeId);

    // Duplicate webhook
    const res2 = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      providerEventId,
      payload,
      { webhookSecret: mockWebhookSecret }
    );
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.idempotent, true);
  });

  // 11. Duplicate Reconciliation Attempt (Idempotency)
  test('11. Duplicate Reconciliation Attempt: returns idempotent result when already MATCHED with same payment', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient();

    const upgradeResult = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    const providerPaymentId = uniqueId('pay_dup_rec');
    const rec1 = await UpgradeReconciliationService.reconcileUpgradeFinancials(
      upgradeResult.planChangeId,
      {
        actualAmountMinorUnits: upgradeResult.netAmountMinorUnits,
        actualCurrency: upgradeResult.currency,
        providerPaymentId,
        providerEventId: uniqueId('evt_dup_1')
      }
    );
    assert.strictEqual(rec1.status, UpgradeReconciliationStatus.MATCHED);

    const rec2 = await UpgradeReconciliationService.reconcileUpgradeFinancials(
      upgradeResult.planChangeId,
      {
        actualAmountMinorUnits: upgradeResult.netAmountMinorUnits,
        actualCurrency: upgradeResult.currency,
        providerPaymentId,
        providerEventId: uniqueId('evt_dup_2')
      }
    );
    assert.strictEqual(rec2.status, UpgradeReconciliationStatus.MATCHED);
    assert.strictEqual(rec2.idempotent, true);
  });

  // 12. Historical Financial Amounts Remain Immutable
  test('12. Historical Financial Amounts Remain Immutable: reconciliation performs 0 mutations to historical calculations', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient();

    const upgradeResult = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    const initialPlanChange = await prisma.subscriptionPlanChange.findUnique({
      where: { id: upgradeResult.planChangeId }
    });

    // Run reconciliation with mismatched amount
    await UpgradeReconciliationService.reconcileUpgradeFinancials(
      upgradeResult.planChangeId,
      {
        actualAmountMinorUnits: 999999,
        actualCurrency: CurrencyCode.INR,
        providerPaymentId: uniqueId('pay_mismatch_immut')
      }
    );

    const planChangeAfter = await prisma.subscriptionPlanChange.findUnique({
      where: { id: upgradeResult.planChangeId }
    });

    assert.strictEqual(planChangeAfter?.fromAmountMinorUnits, initialPlanChange?.fromAmountMinorUnits);
    assert.strictEqual(planChangeAfter?.toAmountMinorUnits, initialPlanChange?.toAmountMinorUnits);
    assert.strictEqual(planChangeAfter?.creditMinorUnits, initialPlanChange?.creditMinorUnits);
    assert.strictEqual(planChangeAfter?.netAmountMinorUnits, initialPlanChange?.netAmountMinorUnits);
    assert.strictEqual(planChangeAfter?.currency, initialPlanChange?.currency);
  });

  // 13. Resource & Entitlement Continuity
  test('13. Resource & Entitlement Continuity: 4 active servers and devices preserved during upgrade and reconciliation', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30, serverCount: 4 });
    const mockClient = createMockRazorpayClient();

    const upgradeResult = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    const servers = await prisma.serverInstance.findMany({
      where: { device: { userId: user.id } }
    });
    assert.strictEqual(servers.length, 4);

    const entitlements = await EntitlementService.resolveUserEntitlements(user.id);
    assert.strictEqual(entitlements.planCode, 'PRO_YEARLY');
    assert.strictEqual(entitlements.maxServers, 5);
    assert.strictEqual(entitlements.priorityRelay, true);
  });

  // 14. Failed Upgrade Leaves PRO_MONTHLY Intact
  test('14. Failed Upgrade Leaves PRO_MONTHLY Intact: zero entitlement drop on provider failure', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient({ shouldFail: true, errorMessage: 'Gateway rejected' });

    await assert.rejects(async () => {
      await BillingStateService.upgradeSubscription(
        user.id,
        { targetPlanCode: 'PRO_YEARLY' },
        { client: mockClient }
      );
    });

    const entitlements = await EntitlementService.resolveUserEntitlements(user.id);
    assert.strictEqual(entitlements.planCode, 'PRO_MONTHLY');
    assert.strictEqual(entitlements.maxServers, 5);
  });

  // 15. Successful Upgrade Reaches PRO_YEARLY
  test('15. Successful Upgrade Reaches PRO_YEARLY: state reaches PRO_YEARLY with active entitlements', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient();

    const res = await BillingStateService.upgradeSubscription(
      user.id,
      { targetPlanCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.targetPlan, 'PRO_YEARLY');

    const effective = await BillingStateService.getEffectivePlan(user.id);
    assert.strictEqual(effective.planCode, 'PRO_YEARLY');
    assert.strictEqual(effective.status, BillingStatus.ACTIVE);
  });

  // 16. Concurrency & Mutex Safety
  test('16. Concurrency & Mutex Safety: Concurrent upgrade requests execute safely without split-brain', async () => {
    const { user, subscription } = await createTestAccount({ periodDaysAgo: 10, totalPeriodDays: 30 });
    const mockClient = createMockRazorpayClient();

    const results = await Promise.allSettled([
      BillingStateService.upgradeSubscription(user.id, { targetPlanCode: 'PRO_YEARLY' }, { client: mockClient }),
      BillingStateService.upgradeSubscription(user.id, { targetPlanCode: 'PRO_YEARLY' }, { client: mockClient })
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1);
    assert.strictEqual(rejected.length, 1);
  });
});
