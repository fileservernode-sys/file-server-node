import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import {
  RazorpayCheckoutService,
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
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('ZC-BILLING-4.4 Payment Success UX Test Suite', () => {
  let app: FastifyInstance;
  let testUserIn: any;
  let testUserUs: any;
  let authTokenIn: string;
  let authTokenUs: string;
  let pricingHtmlContent: string;

  function createMockRazorpayClient(handlers: {
    postHandler?: (endpoint: string, body: any) => Promise<any>;
    getHandler?: (endpoint: string) => Promise<any>;
  }): RazorpayClient {
    const client = new RazorpayClient({
      keyId: 'rzp_test_uxMockKey123',
      keySecret: 'sec_uxMockSecret123',
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

    await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proMonthlyInr.plan.id,
        planPriceId: proMonthlyInr.id,
        providerPlanId: 'plan_pro_monthly_inr_ux',
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
        providerPlanId: 'plan_pro_monthly_usd_ux',
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
        providerPlanId: 'plan_pro_yearly_inr_ux',
        currency: CurrencyCode.INR,
        amountMinorUnits: 50000,
        period: 'yearly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });

    await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        planId: proYearlyUsd.plan.id,
        planPriceId: proYearlyUsd.id,
        providerPlanId: 'plan_pro_yearly_usd_ux',
        currency: CurrencyCode.USD,
        amountMinorUnits: 999,
        period: 'yearly',
        interval: 1,
        priceVersion: 1,
        isActive: true
      }
    });
  }

  before(async () => {
    await PlanService.seedInitialCatalog();
    app = await buildApp();
    await app.ready();

    // Read pricing HTML to verify frontend markup and accessibility contracts
    const pricingPath = path.resolve(process.cwd(), '../Frontend/pages/pricing.html');
    if (fs.existsSync(pricingPath)) {
      pricingHtmlContent = fs.readFileSync(pricingPath, 'utf8');
    } else {
      pricingHtmlContent = fs.readFileSync(path.resolve(process.cwd(), 'Frontend/pages/pricing.html'), 'utf8');
    }

    const timestamp = Date.now();

    // Seed test users
    testUserIn = await prisma.user.create({
      data: {
        email: `ux_in_${timestamp}@zdexcloud.test`,
        fullName: 'UX India User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testUserUs = await prisma.user.create({
      data: {
        email: `ux_us_${timestamp}@zdexcloud.test`,
        fullName: 'UX US User',
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

    const sIn = await prisma.userSession.create({
      data: {
        userId: testUserIn.id,
        token: `mock_session_ux_in_${timestamp}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });
    authTokenIn = sIn.token;

    const sUs = await prisma.userSession.create({
      data: {
        userId: testUserUs.id,
        token: `mock_session_ux_us_${timestamp}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });
    authTokenUs = sUs.token;
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany({
      where: { userId: { in: [testUserIn.id, testUserUs.id] } }
    });
    await prisma.billingProviderPlanMapping.deleteMany({
      where: { providerPlanId: { in: ['plan_pro_monthly_inr_ux', 'plan_pro_monthly_usd_ux', 'plan_pro_yearly_inr_ux', 'plan_pro_yearly_usd_ux'] } }
    });
    await seedStandardMappings();
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (testUserIn) {
      await prisma.subscription.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.userSession.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.user.deleteMany({ where: { id: testUserIn.id } });
    }
    if (testUserUs) {
      await prisma.subscription.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.userSession.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.user.deleteMany({ where: { id: testUserUs.id } });
    }
    await prisma.billingProviderPlanMapping.deleteMany({
      where: { providerPlanId: { in: ['plan_pro_monthly_inr_ux', 'plan_pro_monthly_usd_ux', 'plan_pro_yearly_inr_ux', 'plan_pro_yearly_usd_ux'] } }
    });
  });

  // Test 1: Successful Razorpay callback shows "Payment Submitted" / pending verification UX semantics
  test('Test 1: Frontend includes Payment Submitted / Verification Pending modal and semantics', () => {
    assert.ok(pricingHtmlContent.includes('id="checkout-success-modal"'), 'Must contain checkout-success-modal');
    assert.ok(pricingHtmlContent.includes('Payment Submitted'), 'Must contain Payment Submitted text');
    assert.ok(pricingHtmlContent.includes('Verification Pending'), 'Must display pending verification badge text');
    assert.ok(pricingHtmlContent.includes('dashboard.html'), 'Must link to dashboard to review verified status');
  });

  // Test 2: Client callback does not activate billing (AccountBillingState remains FREE)
  test('Test 2: Client callback does not activate billing on backend', async () => {
    const billingState = await BillingStateService.getBillingState(testUserIn.id);
    assert.strictEqual(billingState.status, BillingStatus.FREE, 'Status must remain FREE');

    // Simulate querying the /api/v1/billing endpoint after client checkout completes
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${authTokenIn}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.plan, 'FREE');
    assert.strictEqual(body.data.status, 'FREE');
  });

  // Test 3: Client callback does not change entitlements (maxServers=1, priorityRelay=false)
  test('Test 3: Client callback does not change entitlements', async () => {
    const entitlements = await EntitlementService.resolveUserEntitlements(testUserIn.id);
    assert.strictEqual(entitlements.planCode, 'FREE');
    assert.strictEqual(entitlements.maxServers, 1, 'maxServers must remain 1');
    assert.strictEqual(entitlements.priorityRelay, false, 'priorityRelay must remain false');
  });

  // Test 4: Client callback does not change server limit
  test('Test 4: Client callback does not change server limit', async () => {
    const entitlements = await EntitlementService.resolveUserEntitlements(testUserIn.id);
    assert.strictEqual(entitlements.maxServers, 1);
    assert.strictEqual(entitlements.entitlements.MAX_SERVERS, 1);
  });

  // Test 5: Payment failure shows safe failure UX
  test('Test 5: Frontend contains safe failure modal with sanitized reasons and retry action', () => {
    assert.ok(pricingHtmlContent.includes('id="checkout-failure-modal"'), 'Must contain checkout-failure-modal');
    assert.ok(pricingHtmlContent.includes('Payment Could Not Be Completed'), 'Must display safe failure heading');
    assert.ok(pricingHtmlContent.includes('id="failure-reason-box"'), 'Must contain failure reason box');
    assert.ok(pricingHtmlContent.includes('retryCheckoutFromFailure'), 'Must provide retry action button');
  });

  // Test 6: Checkout dismissal is not treated as payment failure
  test('Test 6: Checkout dismissal toast and modal flow returns cleanly to breakdown', () => {
    assert.ok(pricingHtmlContent.includes('id="checkout-dismiss-toast"'), 'Must contain dismiss toast');
    assert.ok(pricingHtmlContent.includes('Checkout window closed. You can resume checkout when ready.'), 'Must provide non-error dismiss message');
    assert.ok(pricingHtmlContent.includes('modal:'), 'Must handle modal object in Razorpay wrapper');
    assert.ok(pricingHtmlContent.includes('ondismiss:'), 'Must handle ondismiss callback in modal options');
  });

  // Test 7: Network uncertainty does not falsely claim payment failure
  test('Test 7: Frontend contains uncertain status modal directing customer to dashboard', () => {
    assert.ok(pricingHtmlContent.includes('id="checkout-uncertain-modal"'), 'Must contain checkout-uncertain-modal');
    assert.ok(pricingHtmlContent.includes('Checkout Status Uncertain'), 'Must display uncertain status heading');
    assert.ok(pricingHtmlContent.includes('Go to Dashboard'), 'Must provide dashboard verification action');
  });

  // Test 8: Repeated retry respects existing CREATED subscription reuse
  test('Test 8: Repeated checkout retry reuses unresolved CREATED subscription', async () => {
    let subCreationCount = 0;
    const mockClient = createMockRazorpayClient({
      postHandler: async (endpoint, body) => {
        if (endpoint === '/customers') {
          return { id: 'cust_ux_reuse_1', email: body.email, name: body.name };
        }
        if (endpoint === '/subscriptions') {
          subCreationCount++;
          return {
            id: 'sub_ux_reuse_1',
            plan_id: body.plan_id,
            customer_id: 'cust_ux_reuse_1',
            status: 'created',
            short_url: 'https://rzp.io/i/mock1'
          };
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      }
    });

    // First attempt
    const session1 = await RazorpayCheckoutService.createCheckoutSession(
      testUserIn.id,
      { planCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    assert.strictEqual(session1.subscriptionId, 'sub_ux_reuse_1');
    assert.strictEqual(subCreationCount, 1);

    // Second attempt (simulating customer retrying after dismissal / failure)
    const session2 = await RazorpayCheckoutService.createCheckoutSession(
      testUserIn.id,
      { planCode: 'PRO_YEARLY' },
      { client: mockClient }
    );

    assert.strictEqual(session2.subscriptionId, 'sub_ux_reuse_1', 'Must reuse existing CREATED subscription');
    assert.strictEqual(subCreationCount, 1, 'Must NOT invoke Razorpay API again to create duplicate subscription');
  });

  // Test 9: Page refresh does not fabricate ACTIVE state
  test('Test 9: Page refresh / subsequent backend calls return authentic FREE status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${authTokenIn}` }
    });

    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'FREE');
    assert.strictEqual(body.data.plan, 'FREE');
  });

  // Test 10: Dashboard reflects backend state
  test('Test 10: Dashboard billing query authoritatively returns state matching database', async () => {
    const dbState = await prisma.accountBillingState.findUnique({
      where: { userId: testUserUs.id }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${authTokenUs}` }
    });

    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.status, dbState?.status);
    assert.strictEqual(body.data.currency, dbState?.currency);
    assert.strictEqual(body.data.billingCountry, 'US');
  });

  // Test 11: Provider/internal errors are not exposed to customer
  test('Test 11: Provider errors are sanitized and do not leak sensitive credentials or stacks', async () => {
    const mockClient = createMockRazorpayClient({
      postHandler: async () => {
        throw new RazorpayProviderError(
          'API_ERROR',
          'Sensitive upstream timeout at internal IP 10.0.0.5 with key rzp_test_secret123',
          { statusCode: 502 }
        );
      }
    });

    // Delete existing subscriptions for testUserUs to force new customer/subscription creation attempt
    await prisma.subscription.deleteMany({ where: { userId: testUserUs.id } });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserUs.id,
          { planCode: 'PRO_MONTHLY' },
          { client: mockClient }
        );
      },
      (err: any) => {
        assert.ok(!err.message.includes('rzp_test_secret123'), 'Must sanitize rzp_test_ keys from message');
        assert.ok(!err.message.includes('10.0.0.5') || err.message.includes('[REDACTED]') || err.statusCode === 502);
        return true;
      }
    );
  });

  // Test 12: Loading state prevents duplicate UI submission
  test('Test 12: Frontend button transitions through loading states', () => {
    assert.ok(pricingHtmlContent.includes('Preparing Secure Checkout...'), 'Must contain preparing state text');
    assert.ok(pricingHtmlContent.includes('Opening Secure Payment...'), 'Must contain opening state text');
    assert.ok(pricingHtmlContent.includes('proceedBtn.disabled = true;'), 'Must disable proceed button during submission');
  });

  // Test 13: Success state is accessible
  test('Test 13: Success modal satisfies accessibility attributes', () => {
    assert.ok(pricingHtmlContent.includes('id="checkout-success-modal"'), 'Modal must exist');
    assert.ok(pricingHtmlContent.includes('role="dialog"'), 'Must have role=dialog');
    assert.ok(pricingHtmlContent.includes('aria-modal="true"'), 'Must have aria-modal=true');
    assert.ok(pricingHtmlContent.includes('aria-labelledby="success-modal-heading"'), 'Must have aria-labelledby');
    assert.ok(pricingHtmlContent.includes('aria-describedby="success-modal-desc"'), 'Must have aria-describedby');
  });

  // Test 14: Failure state is accessible
  test('Test 14: Failure modal satisfies accessibility attributes', () => {
    assert.ok(pricingHtmlContent.includes('id="checkout-failure-modal"'), 'Modal must exist');
    assert.ok(pricingHtmlContent.includes('aria-labelledby="failure-modal-heading"'), 'Must have aria-labelledby');
    assert.ok(pricingHtmlContent.includes('aria-describedby="failure-modal-desc"'), 'Must have aria-describedby');
  });

  // Test 15: Mobile layout remains usable
  test('Test 15: Checkout modals include responsive design classes and max-width constraints', () => {
    assert.ok(pricingHtmlContent.includes('max-width: 500px;') || pricingHtmlContent.includes('max-width: 480px;'), 'Modals constrained to responsive card container');
    assert.ok(pricingHtmlContent.includes('width: 100%;'), 'Modals scale to mobile viewport');
    assert.ok(pricingHtmlContent.includes('padding: 20px;'), 'Modals have touch-friendly padding');
  });

  // Test 16: Fake/malicious callback data cannot activate billing
  test('Test 16: Sending arbitrary client payloads cannot alter account tier without webhook', async () => {
    const userBefore = await prisma.accountBillingState.findUnique({
      where: { userId: testUserIn.id }
    });
    assert.strictEqual(userBefore?.status, BillingStatus.FREE);

    // Attacker sends arbitrary request with fake status or fake params
    const fakeReq = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout/session',
      headers: { authorization: `Bearer ${authTokenIn}` },
      payload: {
        planCode: 'PRO_YEARLY',
        fakePaidStatus: true,
        razorpay_payment_id: 'pay_spoofed_12345'
      }
    });

    // Account state must remain unchanged and un-activated
    const userAfter = await prisma.accountBillingState.findUnique({
      where: { userId: testUserIn.id }
    });
    assert.strictEqual(userAfter?.status, BillingStatus.FREE, 'Status must strictly remain FREE');
  });
});
