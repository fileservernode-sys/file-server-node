import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
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
  BillingInterval,
  AuditEventType
} from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('ZC-BILLING-4.3 Checkout Security Hardening Test Suite', () => {
  let app: FastifyInstance;
  let testUserIn: any;
  let testUserUs: any;
  let testUserAttacker: any;
  let testUserUnconfirmed: any;
  let authTokenIn: string;
  let authTokenUs: string;
  let authTokenAttacker: string;
  let authTokenUnconfirmed: string;
  let authTokenExpired: string;

  // Test helper to generate mock RazorpayClient
  function createMockRazorpayClient(handlers: {
    postHandler?: (endpoint: string, body: any) => Promise<any>;
    getHandler?: (endpoint: string) => Promise<any>;
  }): RazorpayClient {
    const client = new RazorpayClient({
      keyId: 'rzp_test_secMockKey123',
      keySecret: 'sec_secMockSecret123',
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

  // Seed standard mappings for TEST environment
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
        providerPlanId: 'plan_pro_monthly_inr_sec',
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
        providerPlanId: 'plan_pro_monthly_usd_sec',
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
        providerPlanId: 'plan_pro_yearly_inr_sec',
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
        providerPlanId: 'plan_pro_yearly_usd_sec',
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
    process.env.RAZORPAY_KEY_ID = 'rzp_test_secMockKey123';
    process.env.RAZORPAY_KEY_SECRET = 'sec_secMockSecret123';

    await PlanService.seedInitialCatalog();
    app = await buildApp();
    await app.ready();

    const timestamp = Date.now();

    testUserIn = await prisma.user.create({
      data: {
        email: `sec_in_${timestamp}@example.com`,
        fullName: 'India Sec User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testUserUs = await prisma.user.create({
      data: {
        email: `sec_us_${timestamp}@example.com`,
        fullName: 'US Sec User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testUserAttacker = await prisma.user.create({
      data: {
        email: `sec_attacker_${timestamp}@example.com`,
        fullName: 'Attacker Sec User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testUserUnconfirmed = await prisma.user.create({
      data: {
        email: `sec_unconf_${timestamp}@example.com`,
        fullName: 'Unconfirmed Sec User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserIn.id,
        billingCountry: 'IN',
        billingPostalCode: '380001',
        currency: CurrencyCode.INR,
        status: BillingStatus.FREE
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserUs.id,
        billingCountry: 'US',
        billingPostalCode: '94105',
        currency: CurrencyCode.USD,
        status: BillingStatus.FREE
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserAttacker.id,
        billingCountry: 'IN',
        billingPostalCode: '110001',
        currency: CurrencyCode.INR,
        status: BillingStatus.FREE
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserUnconfirmed.id,
        billingCountry: null,
        billingPostalCode: null,
        currency: null,
        status: BillingStatus.FREE
      }
    });

    const sIn = await prisma.userSession.create({
      data: { userId: testUserIn.id, token: `mock_session_in_${timestamp}`, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }
    });
    authTokenIn = sIn.token;

    const sUs = await prisma.userSession.create({
      data: { userId: testUserUs.id, token: `mock_session_us_${timestamp}`, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }
    });
    authTokenUs = sUs.token;

    const sAtk = await prisma.userSession.create({
      data: { userId: testUserAttacker.id, token: `mock_session_atk_${timestamp}`, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }
    });
    authTokenAttacker = sAtk.token;

    const sUnconf = await prisma.userSession.create({
      data: { userId: testUserUnconfirmed.id, token: `mock_session_unconf_${timestamp}`, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }
    });
    authTokenUnconfirmed = sUnconf.token;

    const sExp = await prisma.userSession.create({
      data: { userId: testUserIn.id, token: `mock_session_exp_${timestamp}`, expiresAt: new Date(Date.now() - 1000) }
    });
    authTokenExpired = sExp.token;
  });

  after(async () => {
    try {
      await app.close();
    } catch {}
    try {
      await prisma.subscription.deleteMany({
        where: { userId: { in: [testUserIn.id, testUserUs.id, testUserAttacker.id, testUserUnconfirmed.id] } }
      });
    } catch {}
    try {
      await prisma.auditEvent.deleteMany({
        where: { userId: { in: [testUserIn.id, testUserUs.id, testUserAttacker.id, testUserUnconfirmed.id] } }
      });
    } catch {}
    try {
      await prisma.userSession.deleteMany({
        where: { userId: { in: [testUserIn.id, testUserUs.id, testUserAttacker.id, testUserUnconfirmed.id] } }
      });
    } catch {}
    try {
      await prisma.accountBillingState.deleteMany({
        where: { userId: { in: [testUserIn.id, testUserUs.id, testUserAttacker.id, testUserUnconfirmed.id] } }
      });
    } catch {}
    try {
      await prisma.user.deleteMany({
        where: { id: { in: [testUserIn.id, testUserUs.id, testUserAttacker.id, testUserUnconfirmed.id] } }
      });
    } catch {}
    try {
      await prisma.billingProviderPlanMapping.deleteMany({
        where: { providerPlanId: { in: ['plan_pro_monthly_inr_sec', 'plan_pro_monthly_usd_sec', 'plan_pro_yearly_inr_sec', 'plan_pro_yearly_usd_sec'] } }
      });
    } catch {}
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany({
      where: { userId: { in: [testUserIn.id, testUserUs.id, testUserAttacker.id, testUserUnconfirmed.id] } }
    });
    await prisma.billingProviderPlanMapping.deleteMany({
      where: { providerPlanId: { in: ['plan_pro_monthly_inr_sec', 'plan_pro_monthly_usd_sec', 'plan_pro_yearly_inr_sec', 'plan_pro_yearly_usd_sec'] } }
    });
    await seedStandardMappings();
  });

  // ==========================================
  // CATEGORY 1: AUTHENTICATION & IDOR SECURITY
  // ==========================================
  describe('1. Authentication & IDOR Protection', () => {
    test('1. Missing Authorization header is rejected with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout/session',
        payload: { planCode: 'PRO_MONTHLY' }
      });
      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });

    test('2. Malformed Bearer header format is rejected with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout/session',
        headers: { authorization: 'Basic invalid_token_format' },
        payload: { planCode: 'PRO_MONTHLY' }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('3. Invalid / non-existent session token is rejected with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout/session',
        headers: { authorization: 'Bearer non_existent_token_12345' },
        payload: { planCode: 'PRO_MONTHLY' }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('4. Expired session token is rejected with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout/session',
        headers: { authorization: `Bearer ${authTokenExpired}` },
        payload: { planCode: 'PRO_MONTHLY' }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5. IDOR Protection — User A session with User B payload operates exclusively on User A', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout/session',
        headers: { authorization: `Bearer ${authTokenAttacker}` },
        payload: {
          planCode: 'PRO_MONTHLY',
          userId: testUserIn.id,
          accountId: testUserIn.id,
          email: testUserIn.email
        }
      });

      // Verify that NO subscription was created for User In
      const userInSubs = await prisma.subscription.findMany({ where: { userId: testUserIn.id } });
      assert.strictEqual(userInSubs.length, 0);

      // Verify attacker's state
      const attackerBilling = await prisma.accountBillingState.findUnique({ where: { userId: testUserAttacker.id } });
      assert.ok(attackerBilling);
    });
  });

  // ==========================================
  // CATEGORY 2: PRICE & AMOUNT TAMPERING
  // ==========================================
  describe('2. Price & Amount Tampering Protection', () => {
    test('6. Overriding amountMinorUnits: 1 for INR Monthly is ignored -> Enforces ₹49.00 (4900 paise)', async () => {
      let capturedPayload: any = null;
      const mockClient = createMockRazorpayClient({
        postHandler: async (endpoint, body) => {
          capturedPayload = body;
          return { id: 'sub_sec_amt_in_m', entity: 'subscription', plan_id: 'plan_pro_monthly_inr_sec', status: 'created' };
        }
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_MONTHLY', amountMinorUnits: 1 } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.amountMinorUnits, 4900);
      assert.strictEqual(result.formattedAmount, '₹49');
      assert.strictEqual(capturedPayload.plan_id, 'plan_pro_monthly_inr_sec');
    });

    test('7. Overriding amountMinorUnits: 1 for INR Yearly is ignored -> Enforces ₹500.00 (50000 paise)', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_sec_amt_in_y',
          entity: 'subscription',
          plan_id: 'plan_pro_yearly_inr_sec',
          status: 'created'
        })
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_YEARLY', amountMinorUnits: 1 } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.amountMinorUnits, 50000);
      assert.strictEqual(result.formattedAmount, '₹500');
    });

    test('8. Overriding amountMinorUnits: 1 for USD Monthly is ignored -> Enforces $0.99 (99 cents)', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_sec_amt_us_m',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_usd_sec',
          status: 'created'
        })
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserUs.id,
        { planCode: 'PRO_MONTHLY', amountMinorUnits: 1 } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.amountMinorUnits, 99);
      assert.strictEqual(result.formattedAmount, '$0.99');
    });

    test('9. Overriding amountMinorUnits: 1 for USD Yearly is ignored -> Enforces $9.99 (999 cents)', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_sec_amt_us_y',
          entity: 'subscription',
          plan_id: 'plan_pro_yearly_usd_sec',
          status: 'created'
        })
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserUs.id,
        { planCode: 'PRO_YEARLY', amountMinorUnits: 1 } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.amountMinorUnits, 999);
      assert.strictEqual(result.formattedAmount, '$9.99');
    });
  });

  // ==========================================
  // CATEGORY 3: CURRENCY & COUNTRY TAMPERING
  // ==========================================
  describe('3. Currency & Country Tampering Protection', () => {
    test('10. India account sending currency: "USD" in body is ignored -> Resolves INR', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_sec_curr_in',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'created'
        })
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_MONTHLY', currency: 'USD' } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.currency, CurrencyCode.INR);
      assert.strictEqual(result.amountMinorUnits, 4900);
    });

    test('11. US account sending currency: "INR" in body is ignored -> Resolves USD', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_sec_curr_us',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_usd_sec',
          status: 'created'
        })
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserUs.id,
        { planCode: 'PRO_MONTHLY', currency: 'INR' } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.currency, CurrencyCode.USD);
      assert.strictEqual(result.amountMinorUnits, 99);
    });

    test('12. India account sending billingCountry: "US" in body cannot change country -> Uses confirmed IN', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_sec_country_override',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'created'
        })
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_MONTHLY', billingCountry: 'US' } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.billingCountry, 'IN');
      assert.strictEqual(result.currency, CurrencyCode.INR);
    });

    test('13. Unconfirmed country account is rejected with 400 on checkout session', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserUnconfirmed.id, { planCode: 'PRO_MONTHLY' });
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'VALIDATION_ERROR');
          assert.match(err.message, /Billing country must be confirmed/i);
          return true;
        }
      );
    });

    test('14. Unconfirmed country account is rejected with 400 on price breakdown', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.getPriceBreakdown(testUserUnconfirmed.id, 'PRO_MONTHLY');
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'VALIDATION_ERROR');
          assert.match(err.message, /Billing country must be confirmed/i);
          return true;
        }
      );
    });
  });

  // ==========================================
  // CATEGORY 4: PLAN & VERSION TAMPERING
  // ==========================================
  describe('4. Plan, Version, & Provider Plan ID Tampering', () => {
    test('15. Overriding planPriceId in body is ignored -> Server resolves active catalog PlanPrice', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_sec_price_id',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'created'
        })
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_MONTHLY', planPriceId: 'fake_plan_price_123' } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.amountMinorUnits, 4900);
    });

    test('16. Overriding priceVersion: 999 in body is ignored -> Server resolves active version 1', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_sec_ver_override',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'created'
        })
      });

      const result = await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_MONTHLY', priceVersion: 999 } as any,
        { client: mockClient }
      );

      assert.strictEqual(result.amountMinorUnits, 4900);
    });

    test('17. Overriding providerPlanId in body is ignored -> Server resolves verified mapping', async () => {
      let capturedPayload: any = null;
      const mockClient = createMockRazorpayClient({
        postHandler: async (endpoint, body) => {
          capturedPayload = body;
          return { id: 'sub_sec_provider_plan', entity: 'subscription', plan_id: 'plan_pro_monthly_inr_sec', status: 'created' };
        }
      });

      await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_MONTHLY', providerPlanId: 'plan_attacker_free_123' } as any,
        { client: mockClient }
      );

      assert.strictEqual(capturedPayload.plan_id, 'plan_pro_monthly_inr_sec');
    });

    test('18. planCode: "FREE" is strictly rejected with 400', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'FREE' });
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'VALIDATION_ERROR');
          assert.match(err.message, /FREE plan tier cannot enter paid checkout flow/i);
          return true;
        }
      );
    });

    test('19. Unsupported planCode: "ENTERPRISE" is rejected with 400', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'ENTERPRISE' });
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'VALIDATION_ERROR');
          assert.match(err.message, /Unsupported planCode/i);
          return true;
        }
      );
    });

    test('20. Empty or missing planCode is rejected with 400', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: '' });
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'VALIDATION_ERROR');
          return true;
        }
      );
    });
  });

  // ==========================================
  // CATEGORY 5: SUBSCRIPTION STATE PROTECTION
  // ==========================================
  describe('5. Subscription State & Replay Protection', () => {
    test('21. Existing ACTIVE subscription blocks new checkout session with 409 Conflict', async () => {
      const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
      const planPrice = await prisma.planPrice.findFirst({ where: { planId: plan!.id, currency: CurrencyCode.INR } });

      await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: plan!.id,
          planPriceId: planPrice!.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: 'sub_active_existing_123',
          providerPlanId: 'plan_pro_monthly_inr_sec',
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const mockClient = createMockRazorpayClient({});

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'CONFLICT');
          assert.match(err.message, /already has an active subscription/i);
          return true;
        }
      );
    });

    test('22. Existing PAST_DUE subscription blocks new checkout session with 409 Conflict', async () => {
      const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
      const planPrice = await prisma.planPrice.findFirst({ where: { planId: plan!.id, currency: CurrencyCode.INR } });

      await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: plan!.id,
          planPriceId: planPrice!.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: 'sub_past_due_123',
          providerPlanId: 'plan_pro_monthly_inr_sec',
          status: BillingStatus.PAST_DUE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const mockClient = createMockRazorpayClient({});

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'CONFLICT');
          return true;
        }
      );
    });

    test('23. Existing GRACE_PERIOD subscription blocks new checkout session with 409 Conflict', async () => {
      const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
      const planPrice = await prisma.planPrice.findFirst({ where: { planId: plan!.id, currency: CurrencyCode.INR } });

      await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: plan!.id,
          planPriceId: planPrice!.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: 'sub_grace_123',
          providerPlanId: 'plan_pro_monthly_inr_sec',
          status: BillingStatus.GRACE_PERIOD,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const mockClient = createMockRazorpayClient({});

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'CONFLICT');
          return true;
        }
      );
    });

    test('24. Existing CANCELLING subscription blocks new checkout session with 409 Conflict', async () => {
      const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
      const planPrice = await prisma.planPrice.findFirst({ where: { planId: plan!.id, currency: CurrencyCode.INR } });

      await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: plan!.id,
          planPriceId: planPrice!.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: 'sub_cancelling_123',
          providerPlanId: 'plan_pro_monthly_inr_sec',
          status: BillingStatus.CANCELLING,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      const mockClient = createMockRazorpayClient({});

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.errorCode, 'CONFLICT');
          return true;
        }
      );
    });

    test('25. Recent unresolved CREATED subscription within 1 hour is reused without duplicate provider calls', async () => {
      let callCount = 0;
      const mockClient = createMockRazorpayClient({
        postHandler: async () => {
          callCount++;
          return { id: 'sub_reuse_test_123', entity: 'subscription', plan_id: 'plan_pro_monthly_inr_sec', status: 'created' };
        }
      });

      // Call 1
      const res1 = await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
      assert.strictEqual(callCount, 1);
      assert.strictEqual(res1.subscriptionId, 'sub_reuse_test_123');

      // Call 2 (Immediate repeat for same plan)
      const res2 = await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
      assert.strictEqual(callCount, 1); // Zero additional calls to Razorpay
      assert.strictEqual(res2.subscriptionId, 'sub_reuse_test_123');
    });

    test('26. Recent CREATED Monthly subscription is NOT reused for Yearly -> Creates separate Yearly subscription', async () => {
      let monthlyCall = 0;
      let yearlyCall = 0;
      const mockClient = createMockRazorpayClient({
        postHandler: async (endpoint, body) => {
          if (body.plan_id === 'plan_pro_monthly_inr_sec') {
            monthlyCall++;
            return { id: 'sub_monthly_123', entity: 'subscription', plan_id: 'plan_pro_monthly_inr_sec', status: 'created' };
          }
          if (body.plan_id === 'plan_pro_yearly_inr_sec') {
            yearlyCall++;
            return { id: 'sub_yearly_456', entity: 'subscription', plan_id: 'plan_pro_yearly_inr_sec', status: 'created' };
          }
        }
      });

      const resMonthly = await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
      assert.strictEqual(resMonthly.subscriptionId, 'sub_monthly_123');

      // Switch to Yearly
      const resYearly = await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_YEARLY' }, { client: mockClient });
      assert.strictEqual(resYearly.subscriptionId, 'sub_yearly_456');
      assert.strictEqual(yearlyCall, 1);
    });

    test('27. Stale CREATED subscription (> 1 hour) is NOT reused -> Creates fresh subscription', async () => {
      const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
      const planPrice = await prisma.planPrice.findFirst({ where: { planId: plan!.id, currency: CurrencyCode.INR } });

      // Insert stale subscription 2 hours ago
      await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: plan!.id,
          planPriceId: planPrice!.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: 'sub_stale_123',
          providerPlanId: 'plan_pro_monthly_inr_sec',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          createdAt: new Date(Date.now() - 2 * 3600 * 1000),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      let callCount = 0;
      const mockClient = createMockRazorpayClient({
        postHandler: async () => {
          callCount++;
          return { id: 'sub_fresh_after_stale', entity: 'subscription', plan_id: 'plan_pro_monthly_inr_sec', status: 'created' };
        }
      });

      const res = await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
      assert.strictEqual(callCount, 1);
      assert.strictEqual(res.subscriptionId, 'sub_fresh_after_stale');
    });

    test('28. Pre-activation CREATED checkout does NOT activate billing or grant Pro entitlements', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_preactivation_test',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'created'
        })
      });

      await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });

      // Verify AccountBillingState remains FREE
      const state = await BillingStateService.getBillingState(testUserIn.id);
      assert.strictEqual(state.status, BillingStatus.FREE);
      assert.strictEqual(state.activeSubscriptionId, null);

      // Verify Effective Plan remains FREE and entitlements are limited to 1 server
      const effective = await BillingStateService.getEffectivePlan(testUserIn.id);
      assert.strictEqual(effective.planCode, 'FREE');
      assert.strictEqual(effective.status, BillingStatus.FREE);

      const entitlements = await EntitlementService.resolvePlanEntitlements(effective.planCode);
      assert.strictEqual(entitlements.maxServers, 1);
      assert.strictEqual(entitlements.priorityRelay, false);
    });
  });

  // ==========================================
  // CATEGORY 6: CONCURRENCY & RACE CONDITIONS
  // ==========================================
  describe('6. Concurrency & Serialization', () => {
    test('29. Concurrent checkout requests for same user are serialized via Mutex -> Exactly 1 provider call and reused', async () => {
      let providerCalls = 0;
      const mockClient = createMockRazorpayClient({
        postHandler: async () => {
          providerCalls++;
          // Simulate network delay
          await new Promise((r) => setTimeout(r, 50));
          return { id: `sub_concurrent_${providerCalls}`, entity: 'subscription', plan_id: 'plan_pro_monthly_inr_sec', status: 'created' };
        }
      });

      // Launch 3 simultaneous checkout requests for testUserIn
      const [res1, res2, res3] = await Promise.all([
        RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient }),
        RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient }),
        RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient })
      ]);

      assert.strictEqual(providerCalls, 1);
      assert.strictEqual(res1.subscriptionId, 'sub_concurrent_1');
      assert.strictEqual(res2.subscriptionId, 'sub_concurrent_1');
      assert.strictEqual(res3.subscriptionId, 'sub_concurrent_1');

      // Verify only 1 internal subscription record created
      const subs = await prisma.subscription.findMany({ where: { userId: testUserIn.id } });
      assert.strictEqual(subs.length, 1);
    });

    test('30. Database unique constraint on providerSubscriptionId enforces global uniqueness', async () => {
      const plan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
      const planPrice = await prisma.planPrice.findFirst({ where: { planId: plan!.id, currency: CurrencyCode.INR } });

      await prisma.subscription.create({
        data: {
          userId: testUserIn.id,
          planId: plan!.id,
          planPriceId: planPrice!.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: 'sub_unique_constraint_test',
          providerPlanId: 'plan_pro_monthly_inr_sec',
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          priceVersion: 1,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
        }
      });

      // Attempt duplicate insertion with same providerSubscriptionId
      await assert.rejects(async () => {
        await prisma.subscription.create({
          data: {
            userId: testUserUs.id,
            planId: plan!.id,
            planPriceId: planPrice!.id,
            provider: PaymentProvider.RAZORPAY,
            providerEnvironment: PaymentEnvironment.TEST,
            providerSubscriptionId: 'sub_unique_constraint_test',
            providerPlanId: 'plan_pro_monthly_inr_sec',
            status: BillingStatus.CREATED,
            billingInterval: BillingInterval.MONTHLY,
            currency: CurrencyCode.INR,
            amountMinorUnits: 4900,
            priceVersion: 1,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000)
          }
        });
      });
    });
  });

  // ==========================================
  // CATEGORY 7: PROVIDER RESPONSE VALIDATION
  // ==========================================
  describe('7. Provider Response Validation & Sanitization', () => {
    test('31. Non-object provider response is rejected with INVALID_RESPONSE', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => 'not a json object' as any
      });

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INVALID_RESPONSE');
          return true;
        }
      );
    });

    test('32. Missing or invalid sub_ prefix in subscription ID throws INVALID_RESPONSE', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'invalid_id_format',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'created'
        })
      });

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INVALID_RESPONSE');
          assert.match(err.message, /must start with sub_/i);
          return true;
        }
      );
    });

    test('33. Mismatched provider plan_id throws RESPONSE_MISMATCH', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_mismatch_123',
          entity: 'subscription',
          plan_id: 'plan_some_other_plan_id',
          status: 'created'
        })
      });

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'RESPONSE_MISMATCH');
          assert.match(err.message, /expected 'plan_pro_monthly_inr_sec'/i);
          return true;
        }
      );
    });

    test('34. Unexpected entity type (e.g. payment) in provider response throws INVALID_RESPONSE', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_wrong_entity_123',
          entity: 'payment',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'created'
        })
      });

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INVALID_RESPONSE');
          assert.match(err.message, /expected 'subscription'/i);
          return true;
        }
      );
    });

    test('35. Unexpected subscription status (e.g. halted) in provider response throws INVALID_RESPONSE', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_bad_status_123',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'halted'
        })
      });

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INVALID_RESPONSE');
          assert.match(err.message, /unexpected status 'halted'/i);
          return true;
        }
      );
    });

    test('36. Provider error messages sanitize secret tokens and credentials', () => {
      const rawErrorMsg = 'Failed auth with Basic dXNyOnBhc3M= and key_secret=super_secret_val for rzp_test_1234567890';
      const err = new RazorpayProviderError('AUTH_ERROR', rawErrorMsg);

      assert.ok(!err.message.includes('dXNyOnBhc3M='));
      assert.ok(!err.message.includes('super_secret_val'));
      assert.ok(err.message.includes('Basic [REDACTED]'));
      assert.ok(err.message.includes('key_secret=[REDACTED]'));
      assert.ok(err.message.includes('rzp_test_[REDACTED]'));
    });
  });

  // ==========================================
  // CATEGORY 8: AUDIT LOGGING
  // ==========================================
  describe('8. Audit Event Security', () => {
    test('37. Checkout initialization records AuditEvent with action CHECKOUT_SESSION_INITIALIZED and no secrets', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async () => ({
          id: 'sub_audit_test_123',
          entity: 'subscription',
          plan_id: 'plan_pro_monthly_inr_sec',
          status: 'created'
        })
      });

      await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, { planCode: 'PRO_MONTHLY' }, { client: mockClient });

      const audit = await prisma.auditEvent.findFirst({
        where: { userId: testUserIn.id, eventType: AuditEventType.SUBSCRIPTION_CREATED },
        orderBy: { createdAt: 'desc' }
      });

      assert.ok(audit);
      const meta = audit.metadata as any;
      assert.strictEqual(meta.action, 'CHECKOUT_SESSION_INITIALIZED');
      assert.strictEqual(meta.providerSubscriptionId, 'sub_audit_test_123');
      assert.strictEqual(meta.planCode, 'PRO_MONTHLY');
      assert.strictEqual(meta.currency, 'INR');
      assert.strictEqual(meta.amountMinorUnits, 4900);

      // Verify no secrets or sensitive auth data exists in audit metadata
      const rawJson = JSON.stringify(meta);
      assert.ok(!rawJson.includes('keySecret'));
      assert.ok(!rawJson.includes('sec_secMockSecret123'));
      assert.ok(!rawJson.includes('Authorization'));
    });
  });
});
