import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { RazorpayCheckoutService } from '../src/services/billing/providers/razorpay/index.js';
import { CurrencyCode, BillingInterval, BillingStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('ZC-BILLING-4.2 Checkout Price Breakdown Test Suite', () => {
  let app: FastifyInstance;
  let testUserIn: any;
  let testUserUs: any;
  let testUserUnconfirmed: any;
  let authTokenIn: string;
  let authTokenUs: string;
  let authTokenUnconfirmed: string;

  before(async () => {
    // 1. Ensure Plans and PlanPrices are seeded in database
    await PlanService.seedInitialCatalog();

    // 2. Initialize Fastify test app
    app = await buildApp();
    await app.ready();

    // 3. Create clean test users
    const timestamp = Date.now();

    // Indian confirmed user
    testUserIn = await prisma.user.create({
      data: {
        email: `breakdown_in_${timestamp}@example.com`,
        fullName: 'India Breakdown User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    // US confirmed user
    testUserUs = await prisma.user.create({
      data: {
        email: `breakdown_us_${timestamp}@example.com`,
        fullName: 'US Breakdown User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    // Unconfirmed country user
    testUserUnconfirmed = await prisma.user.create({
      data: {
        email: `breakdown_unconf_${timestamp}@example.com`,
        fullName: 'Unconfirmed Breakdown User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    // Setup billing states
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

    await BillingStateService.getBillingState(testUserUnconfirmed.id);

    // Create userSession tokens for HTTP route verification
    const sessionIn = await prisma.userSession.create({
      data: {
        userId: testUserIn.id,
        token: `mock_session_token_in_${timestamp}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });
    authTokenIn = sessionIn.token;

    const sessionUs = await prisma.userSession.create({
      data: {
        userId: testUserUs.id,
        token: `mock_session_token_us_${timestamp}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });
    authTokenUs = sessionUs.token;

    const sessionUnconf = await prisma.userSession.create({
      data: {
        userId: testUserUnconfirmed.id,
        token: `mock_session_token_unconf_${timestamp}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });
    authTokenUnconfirmed = sessionUnconf.token;
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (testUserIn) {
      await prisma.userSession.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserIn.id } });
      await prisma.user.deleteMany({ where: { id: testUserIn.id } });
    }
    if (testUserUs) {
      await prisma.userSession.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserUs.id } });
      await prisma.user.deleteMany({ where: { id: testUserUs.id } });
    }
    if (testUserUnconfirmed) {
      await prisma.userSession.deleteMany({ where: { userId: testUserUnconfirmed.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserUnconfirmed.id } });
      await prisma.user.deleteMany({ where: { id: testUserUnconfirmed.id } });
    }
  });

  describe('1. Input & State Validation Invariants', () => {
    test('1.1 Should reject breakdown when userId is missing', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.getPriceBreakdown('', 'PRO_MONTHLY');
        },
        (err: any) => {
          assert.strictEqual(err.message, 'userId is required');
          return true;
        }
      );
    });

    test('1.2 Should reject breakdown when planCode is missing', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.getPriceBreakdown(testUserIn.id, '');
        },
        (err: any) => {
          assert.strictEqual(err.message, 'planCode is required');
          return true;
        }
      );
    });

    test('1.3 Should reject FREE plan from entering paid breakdown', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.getPriceBreakdown(testUserIn.id, 'FREE');
        },
        (err: any) => {
          assert.strictEqual(err.message, 'FREE plan tier cannot enter paid checkout flow');
          return true;
        }
      );
    });

    test('1.4 Should reject invalid planCode', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.getPriceBreakdown(testUserIn.id, 'ENTERPRISE_CUSTOM');
        },
        (err: any) => {
          assert.strictEqual(err.message, "Unsupported planCode 'ENTERPRISE_CUSTOM'. Must be PRO_MONTHLY or PRO_YEARLY");
          return true;
        }
      );
    });

    test('1.5 Should reject non-existent user with NotFoundError', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.getPriceBreakdown('non_existent_user_id_123', 'PRO_MONTHLY');
        },
        (err: any) => {
          assert.strictEqual(err.message, 'User account not found');
          return true;
        }
      );
    });

    test('1.6 Should reject unconfirmed billing country with ValidationError', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.getPriceBreakdown(testUserUnconfirmed.id, 'PRO_MONTHLY');
        },
        (err: any) => {
          assert.strictEqual(
            err.message,
            'Billing country must be confirmed before viewing price breakdown. Please update your billing region in account settings.'
          );
          return true;
        }
      );
    });
  });

  describe('2. India (IN) Authoritative Breakdown Calculations', () => {
    test('2.1 PRO_MONTHLY in India resolves ₹49 (4900 paise) with tax included and 0 savings', async () => {
      const breakdown = await RazorpayCheckoutService.getPriceBreakdown(testUserIn.id, 'PRO_MONTHLY');

      assert.strictEqual(breakdown.planCode, 'PRO_MONTHLY');
      assert.strictEqual(breakdown.planName, 'Pro Monthly');
      assert.strictEqual(breakdown.interval, BillingInterval.MONTHLY);
      assert.strictEqual(breakdown.billingCountry, 'IN');
      assert.strictEqual(breakdown.currency, CurrencyCode.INR);
      assert.strictEqual(breakdown.amountMinorUnits, 4900);
      assert.strictEqual(breakdown.formattedAmount, '₹49');
      assert.strictEqual(breakdown.priceVersion, 1);
      assert.strictEqual(breakdown.savings, null);
      assert.strictEqual(breakdown.tax.included, true);
      assert.strictEqual(breakdown.tax.formattedAmount, 'Included in price');
      assert.strictEqual(breakdown.fees.amountMinorUnits, 0);
      assert.strictEqual(breakdown.fees.formattedAmount, '₹0');
      assert.strictEqual(breakdown.totalMinorUnits, 4900);
      assert.strictEqual(breakdown.formattedTotal, '₹49');
      assert.strictEqual(breakdown.renewal.interval, BillingInterval.MONTHLY);
      assert.strictEqual(breakdown.renewal.formattedAmount, '₹49');
      assert.strictEqual(breakdown.renewal.notice, 'Renews monthly at ₹49/month until cancelled');
    });

    test('2.2 PRO_YEARLY in India resolves ₹500 (50000 paise) with ₹88 savings (~15%) and tax included', async () => {
      const breakdown = await RazorpayCheckoutService.getPriceBreakdown(testUserIn.id, 'PRO_YEARLY');

      assert.strictEqual(breakdown.planCode, 'PRO_YEARLY');
      assert.strictEqual(breakdown.planName, 'Pro Yearly');
      assert.strictEqual(breakdown.interval, BillingInterval.YEARLY);
      assert.strictEqual(breakdown.billingCountry, 'IN');
      assert.strictEqual(breakdown.currency, CurrencyCode.INR);
      assert.strictEqual(breakdown.amountMinorUnits, 50000);
      assert.strictEqual(breakdown.formattedAmount, '₹500');
      assert.strictEqual(breakdown.priceVersion, 1);

      assert.ok(breakdown.savings);
      assert.strictEqual(breakdown.savings.amountMinorUnits, 8800); // (49*12 - 500) = 88 => 8800 paise
      assert.strictEqual(breakdown.savings.formattedAmount, '₹88');
      assert.strictEqual(breakdown.savings.percentage, 15); // 8800 / 58800 = 14.96% => 15%
      assert.strictEqual(breakdown.savings.annualizedMonthlyMinorUnits, 58800);
      assert.strictEqual(breakdown.savings.formattedAnnualizedMonthly, '₹588');

      assert.strictEqual(breakdown.tax.included, true);
      assert.strictEqual(breakdown.tax.formattedAmount, 'Included in price');
      assert.strictEqual(breakdown.fees.amountMinorUnits, 0);
      assert.strictEqual(breakdown.fees.formattedAmount, '₹0');
      assert.strictEqual(breakdown.totalMinorUnits, 50000);
      assert.strictEqual(breakdown.formattedTotal, '₹500');
      assert.strictEqual(breakdown.renewal.interval, BillingInterval.YEARLY);
      assert.strictEqual(breakdown.renewal.formattedAmount, '₹500');
      assert.strictEqual(breakdown.renewal.notice, 'Renews annually at ₹500/year until cancelled');
    });
  });

  describe('3. Non-India (US) Authoritative Breakdown Calculations', () => {
    test('3.1 PRO_MONTHLY in US resolves $0.99 (99 cents) with tax calculated at checkout', async () => {
      const breakdown = await RazorpayCheckoutService.getPriceBreakdown(testUserUs.id, 'PRO_MONTHLY');

      assert.strictEqual(breakdown.planCode, 'PRO_MONTHLY');
      assert.strictEqual(breakdown.planName, 'Pro Monthly');
      assert.strictEqual(breakdown.interval, BillingInterval.MONTHLY);
      assert.strictEqual(breakdown.billingCountry, 'US');
      assert.strictEqual(breakdown.currency, CurrencyCode.USD);
      assert.strictEqual(breakdown.amountMinorUnits, 99);
      assert.strictEqual(breakdown.formattedAmount, '$0.99');
      assert.strictEqual(breakdown.priceVersion, 1);
      assert.strictEqual(breakdown.savings, null);
      assert.strictEqual(breakdown.tax.included, false);
      assert.strictEqual(breakdown.tax.formattedAmount, 'Calculated at checkout');
      assert.strictEqual(breakdown.fees.amountMinorUnits, 0);
      assert.strictEqual(breakdown.fees.formattedAmount, '$0');
      assert.strictEqual(breakdown.totalMinorUnits, 99);
      assert.strictEqual(breakdown.formattedTotal, '$0.99');
      assert.strictEqual(breakdown.renewal.interval, BillingInterval.MONTHLY);
      assert.strictEqual(breakdown.renewal.formattedAmount, '$0.99');
      assert.strictEqual(breakdown.renewal.notice, 'Renews monthly at $0.99/month until cancelled');
    });

    test('3.2 PRO_YEARLY in US resolves $9.99 (999 cents) with $1.89 savings (~16%)', async () => {
      const breakdown = await RazorpayCheckoutService.getPriceBreakdown(testUserUs.id, 'PRO_YEARLY');

      assert.strictEqual(breakdown.planCode, 'PRO_YEARLY');
      assert.strictEqual(breakdown.planName, 'Pro Yearly');
      assert.strictEqual(breakdown.interval, BillingInterval.YEARLY);
      assert.strictEqual(breakdown.billingCountry, 'US');
      assert.strictEqual(breakdown.currency, CurrencyCode.USD);
      assert.strictEqual(breakdown.amountMinorUnits, 999);
      assert.strictEqual(breakdown.formattedAmount, '$9.99');
      assert.strictEqual(breakdown.priceVersion, 1);

      assert.ok(breakdown.savings);
      assert.strictEqual(breakdown.savings.amountMinorUnits, 189); // (99*12 - 999) = 1188 - 999 = 189 cents
      assert.strictEqual(breakdown.savings.formattedAmount, '$1.89');
      assert.strictEqual(breakdown.savings.percentage, 16); // 189 / 1188 = 15.90% => 16%
      assert.strictEqual(breakdown.savings.annualizedMonthlyMinorUnits, 1188);
      assert.strictEqual(breakdown.savings.formattedAnnualizedMonthly, '$11.88');

      assert.strictEqual(breakdown.tax.included, false);
      assert.strictEqual(breakdown.tax.formattedAmount, 'Calculated at checkout');
      assert.strictEqual(breakdown.fees.amountMinorUnits, 0);
      assert.strictEqual(breakdown.fees.formattedAmount, '$0');
      assert.strictEqual(breakdown.totalMinorUnits, 999);
      assert.strictEqual(breakdown.formattedTotal, '$9.99');
      assert.strictEqual(breakdown.renewal.interval, BillingInterval.YEARLY);
      assert.strictEqual(breakdown.renewal.formattedAmount, '$9.99');
      assert.strictEqual(breakdown.renewal.notice, 'Renews annually at $9.99/year until cancelled');
    });
  });

  describe('4. Zero Premature Side-Effects Invariant', () => {
    test('4.1 Calling getPriceBreakdown creates 0 Subscriptions and 0 AuditEvents', async () => {
      const subCountBefore = await prisma.subscription.count({ where: { userId: testUserIn.id } });
      const auditCountBefore = await prisma.auditEvent.count({ where: { userId: testUserIn.id } });

      await RazorpayCheckoutService.getPriceBreakdown(testUserIn.id, 'PRO_YEARLY');

      const subCountAfter = await prisma.subscription.count({ where: { userId: testUserIn.id } });
      const auditCountAfter = await prisma.auditEvent.count({ where: { userId: testUserIn.id } });

      assert.strictEqual(subCountAfter, subCountBefore, 'Subscription count must not increase');
      assert.strictEqual(auditCountAfter, auditCountBefore, 'AuditEvent count must not increase');

      const billingState = await BillingStateService.getBillingState(testUserIn.id);
      assert.strictEqual(billingState.status, BillingStatus.FREE, 'Billing state must remain FREE');

      const entitlements = await EntitlementService.resolveUserEntitlements(testUserIn.id);
      assert.strictEqual(entitlements.maxServers, 1, 'Server limit must remain 1');
    });
  });


  describe('5. HTTP Route Endpoints (GET /api/v1/billing/checkout/price-breakdown)', () => {
    test('5.1 Unauthenticated request returns 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/checkout/price-breakdown?planCode=PRO_MONTHLY'
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });

    test('5.2 Missing planCode query parameter returns 400 ValidationError', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/checkout/price-breakdown',
        headers: {
          authorization: `Bearer ${authTokenIn}`
        }
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error.message, 'planCode query parameter is required');
    });

    test('5.3 Unconfirmed billing country returns 400 ValidationError', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/checkout/price-breakdown?planCode=PRO_MONTHLY',
        headers: {
          authorization: `Bearer ${authTokenUnconfirmed}`
        }
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, false);
      assert.ok(json.error.message.includes('Billing country must be confirmed'));
    });

    test('5.4 Authenticated India user retrieves valid price breakdown for PRO_YEARLY', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/checkout/price-breakdown?planCode=PRO_YEARLY',
        headers: {
          authorization: `Bearer ${authTokenIn}`
        }
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.planCode, 'PRO_YEARLY');
      assert.strictEqual(json.data.currency, 'INR');
      assert.strictEqual(json.data.amountMinorUnits, 50000);
      assert.strictEqual(json.data.formattedAmount, '₹500');
      assert.strictEqual(json.data.savings.formattedAmount, '₹88');
      assert.strictEqual(json.data.tax.included, true);
      assert.strictEqual(json.data.tax.formattedAmount, 'Included in price');
    });

    test('5.5 Authenticated US user retrieves valid price breakdown for PRO_YEARLY', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/checkout/price-breakdown?planCode=PRO_YEARLY',
        headers: {
          authorization: `Bearer ${authTokenUs}`
        }
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.planCode, 'PRO_YEARLY');
      assert.strictEqual(json.data.currency, 'USD');
      assert.strictEqual(json.data.amountMinorUnits, 999);
      assert.strictEqual(json.data.formattedAmount, '$9.99');
      assert.strictEqual(json.data.savings.formattedAmount, '$1.89');
      assert.strictEqual(json.data.tax.included, false);
      assert.strictEqual(json.data.tax.formattedAmount, 'Calculated at checkout');
    });
  });
});
