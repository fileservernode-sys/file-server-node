import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import {
  RazorpayCheckoutService,
  RazorpayPlanCatalogService,
  RazorpayClient,
  RazorpayProviderError
} from '../src/services/billing/providers/razorpay/index.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval
} from '@prisma/client';

describe('ZC-BILLING-4.1 Razorpay Checkout Session & Subscription Initialization Test Suite', () => {
  let testUserIn: any;
  let testUserUs: any;
  let testUserUnconfirmed: any;

  // Test helper to generate mock RazorpayClient
  function createMockRazorpayClient(handlers: {
    postHandler?: (endpoint: string, body: any) => Promise<any>;
    getHandler?: (endpoint: string) => Promise<any>;
  }): RazorpayClient {
    const client = new RazorpayClient({
      keyId: 'rzp_test_mockKeyCheckout123',
      keySecret: 'sec_mockSecretCheckout123',
      baseUrl: 'https://api.razorpay.com/v1'
    });

    if (handlers.postHandler) {
      client.post = async <T>(endpoint: string, body?: any): Promise<T> => {
        return (await handlers.postHandler!(endpoint, body)) as T;
      };
    }

    if (handlers.getHandler) {
      client.get = async <T>(endpoint: string): Promise<T> => {
        return (await handlers.getHandler!(endpoint)) as T;
      };
    }

    return client;
  }

  // Helper to seed standard provider mappings
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

    await prisma.billingProviderPlanMapping.deleteMany({
      where: {
        provider: PaymentProvider.RAZORPAY,
        environment: env
      }
    });

    const m1 = await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proMonthlyInr.plan.id,
        planPriceId: proMonthlyInr.id,
        providerPlanId: 'plan_pro_monthly_inr_mock',
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        period: 'monthly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });

    const m2 = await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proMonthlyUsd.plan.id,
        planPriceId: proMonthlyUsd.id,
        providerPlanId: 'plan_pro_monthly_usd_mock',
        currency: CurrencyCode.USD,
        amountMinorUnits: 99,
        period: 'monthly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });

    const m3 = await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proYearlyInr.plan.id,
        planPriceId: proYearlyInr.id,
        providerPlanId: 'plan_pro_yearly_inr_mock',
        currency: CurrencyCode.INR,
        amountMinorUnits: 50000,
        period: 'yearly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });

    const m4 = await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proYearlyUsd.plan.id,
        planPriceId: proYearlyUsd.id,
        providerPlanId: 'plan_pro_yearly_usd_mock',
        currency: CurrencyCode.USD,
        amountMinorUnits: 999,
        period: 'yearly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });

    return { proMonthlyInr, proMonthlyUsd, proYearlyInr, proYearlyUsd, mappings: [m1, m2, m3, m4] };
  }

  before(async () => {
    await PlanService.seedInitialCatalog();

    // Create test users
    testUserIn = await prisma.user.upsert({
      where: { email: 'checkout_in_test@example.com' },
      update: {},
      create: {
        email: 'checkout_in_test@example.com',
        fullName: 'India Checkout User',
        emailVerified: true
      }
    });

    testUserUs = await prisma.user.upsert({
      where: { email: 'checkout_us_test@example.com' },
      update: {},
      create: {
        email: 'checkout_us_test@example.com',
        fullName: 'US Checkout User',
        emailVerified: true
      }
    });

    testUserUnconfirmed = await prisma.user.upsert({
      where: { email: 'checkout_unconfirmed_test@example.com' },
      update: {},
      create: {
        email: 'checkout_unconfirmed_test@example.com',
        fullName: 'Unconfirmed Checkout User',
        emailVerified: true
      }
    });

    // Confirm countries
    await BillingCountryService.confirmBillingCountry(testUserIn.id, {
      country: 'IN',
      postalCode: '392001'
    });

    await BillingCountryService.confirmBillingCountry(testUserUs.id, {
      country: 'US',
      postalCode: '94105'
    });
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany({
      where: {
        userId: { in: [testUserIn.id, testUserUs.id, testUserUnconfirmed.id] }
      }
    });
    await prisma.accountBillingState.updateMany({
      where: {
        userId: { in: [testUserIn.id, testUserUs.id, testUserUnconfirmed.id] }
      },
      data: {
        status: BillingStatus.FREE,
        activeSubscriptionId: null
      }
    });
    await prisma.billingProviderPlanMapping.deleteMany({});
  });

  after(async () => {
    await prisma.subscription.deleteMany({
      where: {
        userId: { in: [testUserIn.id, testUserUs.id, testUserUnconfirmed.id] }
      }
    });
    await prisma.accountBillingState.updateMany({
      where: {
        userId: { in: [testUserIn.id, testUserUs.id, testUserUnconfirmed.id] }
      },
      data: {
        status: BillingStatus.FREE,
        activeSubscriptionId: null
      }
    });
    await prisma.billingProviderPlanMapping.deleteMany({});
  });


  // ---------------------------------------------------------------------------
  // 1. INPUT VALIDATION & COUNTRY CHECKS
  // ---------------------------------------------------------------------------
  test('1. Unconfirmed Billing Country — Rejects checkout initialization if country is null', async () => {
    await seedStandardMappings();

    const client = createMockRazorpayClient({});

    await assert.rejects(
      async () =>
        await RazorpayCheckoutService.createCheckoutSession(
          testUserUnconfirmed.id,
          { planCode: 'PRO_MONTHLY' },
          { client }
        ),
      (err: any) => {
        assert.ok(err.message.includes('Billing country must be confirmed'));
        return true;
      }
    );
  });

  test('2. FREE Plan Rejection — FREE plan cannot enter paid checkout flow', async () => {
    await seedStandardMappings();

    const client = createMockRazorpayClient({});

    await assert.rejects(
      async () =>
        await RazorpayCheckoutService.createCheckoutSession(
          testUserIn.id,
          { planCode: 'FREE' },
          { client }
        ),
      (err: any) => {
        assert.ok(err.message.includes('FREE plan tier cannot enter paid checkout'));
        return true;
      }
    );
  });

  test('3. Invalid Plan Code Rejection — Unsupported plan code fails validation', async () => {
    await seedStandardMappings();

    const client = createMockRazorpayClient({});

    await assert.rejects(
      async () =>
        await RazorpayCheckoutService.createCheckoutSession(
          testUserIn.id,
          { planCode: 'ENTERPRISE_CUSTOM' },
          { client }
        ),
      (err: any) => {
        assert.ok(err.message.includes('Unsupported planCode'));
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 2. INDIA CHECKOUT INITIALIZATION (INR)
  // ---------------------------------------------------------------------------
  test('4. PRO_MONTHLY INR Checkout — Creates Razorpay Subscription with INR 4900 mapping', async () => {
    const { mappings } = await seedStandardMappings();
    let capturedPayload: any;

    const client = createMockRazorpayClient({
      postHandler: async (endpoint, body) => {
        assert.strictEqual(endpoint, '/subscriptions');
        capturedPayload = body;
        return {
          id: 'sub_pro_monthly_inr_123',
          entity: 'subscription',
          plan_id: mappings[0].providerPlanId,
          status: 'created',
          current_start: null,
          current_end: null,
          quantity: 1,
          total_count: 120,
          customer_notify: 1
        };
      }
    });

    const result = await RazorpayCheckoutService.createCheckoutSession(
      testUserIn.id,
      { planCode: 'PRO_MONTHLY' },
      { client }
    );

    assert.strictEqual(result.keyId, 'rzp_test_mockKeyCheckout123');
    assert.strictEqual(result.subscriptionId, 'sub_pro_monthly_inr_123');
    assert.strictEqual(result.planCode, 'PRO_MONTHLY');
    assert.strictEqual(result.interval, BillingInterval.MONTHLY);
    assert.strictEqual(result.currency, CurrencyCode.INR);
    assert.strictEqual(result.amountMinorUnits, 4900);
    assert.strictEqual(result.formattedAmount, '₹49');
    assert.strictEqual(result.billingCountry, 'IN');

    // Verify request payload to Razorpay
    assert.strictEqual(capturedPayload.plan_id, 'plan_pro_monthly_inr_mock');
    assert.strictEqual(capturedPayload.total_count, 120);
    assert.strictEqual(capturedPayload.quantity, 1);
    assert.strictEqual(capturedPayload.customer_notify, 1);
    assert.strictEqual(capturedPayload.notes.zdexcloud_user_id, testUserIn.id);

    // Verify internal Subscription is persisted in CREATED status
    const persisted = await prisma.subscription.findUnique({
      where: { providerSubscriptionId: 'sub_pro_monthly_inr_123' }
    });
    assert.ok(persisted);
    assert.strictEqual(persisted.status, BillingStatus.CREATED);
    assert.strictEqual(persisted.currency, CurrencyCode.INR);
    assert.strictEqual(persisted.amountMinorUnits, 4900);
  });

  test('5. PRO_YEARLY INR Checkout — Creates Razorpay Subscription with total_count=10 and INR 50000', async () => {
    const { mappings } = await seedStandardMappings();
    let capturedPayload: any;

    const client = createMockRazorpayClient({
      postHandler: async (endpoint, body) => {
        capturedPayload = body;
        return {
          id: 'sub_pro_yearly_inr_123',
          entity: 'subscription',
          plan_id: mappings[2].providerPlanId,
          status: 'created',
          quantity: 1,
          total_count: 10
        };
      }
    });

    const result = await RazorpayCheckoutService.createCheckoutSession(
      testUserIn.id,
      { planCode: 'PRO_YEARLY' },
      { client }
    );

    assert.strictEqual(result.subscriptionId, 'sub_pro_yearly_inr_123');
    assert.strictEqual(result.currency, CurrencyCode.INR);
    assert.strictEqual(result.amountMinorUnits, 50000);
    assert.strictEqual(result.formattedAmount, '₹500');
    assert.strictEqual(capturedPayload.total_count, 10);
  });

  // ---------------------------------------------------------------------------
  // 3. INTERNATIONAL CHECKOUT INITIALIZATION (USD)
  // ---------------------------------------------------------------------------
  test('6. PRO_MONTHLY USD Checkout — Non-India user resolves USD 99 price point', async () => {
    const { mappings } = await seedStandardMappings();

    const client = createMockRazorpayClient({
      postHandler: async (endpoint, body) => ({
        id: 'sub_pro_monthly_usd_123',
        entity: 'subscription',
        plan_id: mappings[1].providerPlanId,
        status: 'created',
        quantity: 1,
        total_count: 120
      })
    });

    const result = await RazorpayCheckoutService.createCheckoutSession(
      testUserUs.id,
      { planCode: 'PRO_MONTHLY' },
      { client }
    );

    assert.strictEqual(result.subscriptionId, 'sub_pro_monthly_usd_123');
    assert.strictEqual(result.currency, CurrencyCode.USD);
    assert.strictEqual(result.amountMinorUnits, 99);
    assert.strictEqual(result.formattedAmount, '$0.99');
    assert.strictEqual(result.billingCountry, 'US');
  });

  test('7. PRO_YEARLY USD Checkout — Non-India user resolves USD 999 price point', async () => {
    const { mappings } = await seedStandardMappings();

    const client = createMockRazorpayClient({
      postHandler: async (endpoint, body) => ({
        id: 'sub_pro_yearly_usd_123',
        entity: 'subscription',
        plan_id: mappings[3].providerPlanId,
        status: 'created',
        quantity: 1,
        total_count: 10
      })
    });

    const result = await RazorpayCheckoutService.createCheckoutSession(
      testUserUs.id,
      { planCode: 'PRO_YEARLY' },
      { client }
    );

    assert.strictEqual(result.subscriptionId, 'sub_pro_yearly_usd_123');
    assert.strictEqual(result.currency, CurrencyCode.USD);
    assert.strictEqual(result.amountMinorUnits, 999);
    assert.strictEqual(result.formattedAmount, '$9.99');
  });

  // ---------------------------------------------------------------------------
  // 4. PRE-ACTIVATION ENTITLEMENT SAFETY (DO NOT ACTIVATE)
  // ---------------------------------------------------------------------------
  test('8. Pre-Activation Safety — Initializing checkout does NOT activate billing or grant entitlements', async () => {
    const { mappings } = await seedStandardMappings();

    const client = createMockRazorpayClient({
      postHandler: async () => ({
        id: 'sub_safety_test_1',
        entity: 'subscription',
        plan_id: mappings[0].providerPlanId,
        status: 'created'
      })
    });

    // User initializes checkout
    await RazorpayCheckoutService.createCheckoutSession(
      testUserIn.id,
      { planCode: 'PRO_MONTHLY' },
      { client }
    );

    // 1. Verify AccountBillingState.status is STILL FREE
    const billingState = await BillingStateService.getBillingState(testUserIn.id);
    assert.strictEqual(billingState.status, BillingStatus.FREE);
    assert.strictEqual(billingState.activeSubscriptionId, null);

    // 2. Verify getEffectivePlan is STILL FREE
    const effective = await BillingStateService.getEffectivePlan(testUserIn.id);
    assert.strictEqual(effective.planCode, 'FREE');
    assert.strictEqual(effective.status, BillingStatus.FREE);
    assert.strictEqual(effective.subscription, null);

    // 3. Verify entitlements are STILL FREE
    const entitlements = await EntitlementService.resolveUserEntitlements(testUserIn.id);
    assert.strictEqual(entitlements.planCode, 'FREE');
    assert.strictEqual(entitlements.maxServers, 1);
    assert.strictEqual(entitlements.priorityRelay, false);
  });

  // ---------------------------------------------------------------------------
  // 5. IDEMPOTENCY & DUPLICATE CHECKOUT PROTECTION
  // ---------------------------------------------------------------------------
  test('9. Idempotency — Reuses existing pending CREATED subscription without duplicate provider calls', async () => {
    const { mappings } = await seedStandardMappings();
    let apiCallCount = 0;

    const client = createMockRazorpayClient({
      postHandler: async () => {
        apiCallCount++;
        return {
          id: 'sub_idempotent_test_1',
          entity: 'subscription',
          plan_id: mappings[0].providerPlanId,
          status: 'created'
        };
      }
    });

    // First call creates the subscription
    const res1 = await RazorpayCheckoutService.createCheckoutSession(
      testUserIn.id,
      { planCode: 'PRO_MONTHLY' },
      { client }
    );
    assert.strictEqual(apiCallCount, 1);
    assert.strictEqual(res1.subscriptionId, 'sub_idempotent_test_1');

    // Second call within pending window reuses existing session
    const res2 = await RazorpayCheckoutService.createCheckoutSession(
      testUserIn.id,
      { planCode: 'PRO_MONTHLY' },
      { client }
    );
    assert.strictEqual(apiCallCount, 1); // 0 additional API calls
    assert.strictEqual(res2.subscriptionId, 'sub_idempotent_test_1');
  });

  test('10. Active Subscription Conflict — Rejects checkout if account already has an active subscription', async () => {
    await seedStandardMappings();

    // Directly activate a subscription for testUserIn
    await BillingStateService.createSubscription({
      userId: testUserIn.id,
      planCode: 'PRO_MONTHLY',
      currency: CurrencyCode.INR
    });

    const client = createMockRazorpayClient({});

    await assert.rejects(
      async () =>
        await RazorpayCheckoutService.createCheckoutSession(
          testUserIn.id,
          { planCode: 'PRO_MONTHLY' },
          { client }
        ),
      (err: any) => {
        assert.ok(err.message.includes('Account already has an active subscription'));
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 6. PROVIDER RESPONSE INTEGRITY & ERROR SANITIZATION
  // ---------------------------------------------------------------------------
  test('11. Provider Response Integrity — Rejects malformed provider response with wrong plan_id', async () => {
    await seedStandardMappings();

    const client = createMockRazorpayClient({
      postHandler: async () => ({
        id: 'sub_bad_plan_id',
        entity: 'subscription',
        plan_id: 'plan_wrong_mismatched_xyz',
        status: 'created'
      })
    });

    await assert.rejects(
      async () =>
        await RazorpayCheckoutService.createCheckoutSession(
          testUserIn.id,
          { planCode: 'PRO_MONTHLY' },
          { client }
        ),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'RESPONSE_MISMATCH');
        return true;
      }
    );
  });

  test('12. Security & Secret Redaction — Provider secrets and Auth headers are never in result', async () => {
    const { mappings } = await seedStandardMappings();

    const client = createMockRazorpayClient({
      postHandler: async () => ({
        id: 'sub_security_test_1',
        entity: 'subscription',
        plan_id: mappings[0].providerPlanId,
        status: 'created'
      })
    });

    const result = await RazorpayCheckoutService.createCheckoutSession(
      testUserIn.id,
      { planCode: 'PRO_MONTHLY' },
      { client }
    );

    const jsonStr = JSON.stringify(result);
    assert.ok(!jsonStr.includes('sec_mockSecretCheckout123'));
    assert.ok(!jsonStr.includes('Basic '));
    assert.ok(!jsonStr.includes('webhook_secret'));
  });
});
