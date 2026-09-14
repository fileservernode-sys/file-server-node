import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import {
  RazorpayCatalogReconciliationService,
  RazorpayPlanCatalogService,
  RazorpayClient,
  RazorpayProviderError
} from '../src/services/billing/providers/razorpay/index.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingInterval
} from '@prisma/client';

describe('ZC-BILLING-3.4 Razorpay Provider Read/Verify & Catalog Reconciliation Test Suite', () => {
  // Test helper to generate a mock RazorpayClient with get/post/fetch hooks
  function createMockRazorpayClient(handlers: {
    getHandler?: (endpoint: string) => Promise<any>;
    postHandler?: (endpoint: string, body: any) => Promise<any>;
  }): RazorpayClient {
    const client = new RazorpayClient({
      keyId: 'rzp_test_mockKeyRecon123',
      keySecret: 'sec_mockSecretRecon123',
      baseUrl: 'https://api.razorpay.com/v1'
    });

    if (handlers.getHandler) {
      client.get = async <T>(endpoint: string): Promise<T> => {
        return (await handlers.getHandler!(endpoint)) as T;
      };
    }

    if (handlers.postHandler) {
      client.post = async <T>(endpoint: string, body?: any): Promise<T> => {
        return (await handlers.postHandler!(endpoint, body)) as T;
      };
    }

    return client;
  }

  before(async () => {
    // Seed standard initial catalog
    await PlanService.seedInitialCatalog();
  });

  beforeEach(async () => {
    await prisma.billingProviderPlanMapping.deleteMany({});
  });

  after(async () => {
    await prisma.billingProviderPlanMapping.deleteMany({});
  });

  // Helper to seed standard 4 commercial mappings in database
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
        providerPlanId: 'plan_pro_monthly_inr_1',
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
        providerPlanId: 'plan_pro_monthly_usd_1',
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
        providerPlanId: 'plan_pro_yearly_inr_1',
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
        providerPlanId: 'plan_pro_yearly_usd_1',
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

  // ---------------------------------------------------------------------------
  // 1. LOW-LEVEL TRANSPORT & FETCH TESTS
  // ---------------------------------------------------------------------------
  test('1. RazorpayClient.fetchPlan — calls GET /plans/{plan_id} and returns plan entity', async () => {
    let capturedEndpoint = '';
    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        capturedEndpoint = endpoint;
        return {
          id: 'plan_test_fetch_1',
          entity: 'plan',
          interval: 1,
          period: 'monthly',
          item: { id: 'item_1', amount: 4900, currency: 'INR' }
        };
      }
    });

    const plan = await client.fetchPlan('plan_test_fetch_1');
    assert.strictEqual(capturedEndpoint, '/plans/plan_test_fetch_1');
    assert.strictEqual(plan.id, 'plan_test_fetch_1');
    assert.strictEqual(plan.item.amount, 4900);
  });

  test('2. RazorpayClient.fetchPlans — calls GET /plans with pagination parameters', async () => {
    let capturedEndpoint = '';
    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        capturedEndpoint = endpoint;
        return {
          entity: 'collection',
          count: 2,
          items: [
            { id: 'plan_1', period: 'monthly', interval: 1 },
            { id: 'plan_2', period: 'yearly', interval: 1 }
          ]
        };
      }
    });

    const res = await client.fetchPlans({ count: 10, skip: 5 });
    assert.strictEqual(capturedEndpoint, '/plans?count=10&skip=5');
    assert.strictEqual(res.count, 2);
    assert.strictEqual(res.items.length, 2);
  });

  test('3. RazorpayClient.fetchAllPlans — paginates until all items are collected', async () => {
    let callCount = 0;
    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        callCount++;
        if (endpoint.includes('skip=0') || !endpoint.includes('skip=')) {
          return {
            entity: 'collection',
            count: 3,
            items: [
              { id: 'plan_page1_1', period: 'monthly' },
              { id: 'plan_page1_2', period: 'monthly' }
            ]
          };
        } else {
          return {
            entity: 'collection',
            count: 3,
            items: [{ id: 'plan_page2_1', period: 'yearly' }]
          };
        }
      }
    });

    const allPlans = await client.fetchAllPlans({ pageSize: 2 });
    assert.strictEqual(allPlans.length, 3);
    assert.strictEqual(callCount, 2);
    assert.strictEqual(allPlans[0].id, 'plan_page1_1');
    assert.strictEqual(allPlans[2].id, 'plan_page2_1');
  });

  // ---------------------------------------------------------------------------
  // 2. INDIVIDUAL MAPPING VERIFICATION (verifyMapping)
  // ---------------------------------------------------------------------------
  test('4. verifyMapping — Pro Monthly INR verified successfully with exact attributes', async () => {
    const { mappings } = await seedStandardMappings();
    const inrMapping = mappings[0];

    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        assert.strictEqual(endpoint, `/plans/${inrMapping.providerPlanId}`);
        return {
          id: inrMapping.providerPlanId,
          entity: 'plan',
          interval: 1,
          period: 'monthly',
          item: { id: 'item_inr_1', amount: 4900, currency: 'INR' }
        };
      }
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(inrMapping, { client });
    assert.strictEqual(result.isVerified, true);
    assert.strictEqual(result.status, 'VERIFIED');
    assert.strictEqual(result.discrepancies.length, 0);
    assert.strictEqual(result.localState?.currency, 'INR');
    assert.strictEqual(result.localState?.amountMinorUnits, 4900);
    assert.strictEqual(result.providerState?.amount, 4900);
  });

  test('5. verifyMapping — Pro Monthly USD verified successfully with exact attributes', async () => {
    const { mappings } = await seedStandardMappings();
    const usdMapping = mappings[1];

    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: usdMapping.providerPlanId,
        entity: 'plan',
        interval: 1,
        period: 'monthly',
        item: { id: 'item_usd_1', amount: 99, currency: 'USD' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(usdMapping, { client });
    assert.strictEqual(result.isVerified, true);
    assert.strictEqual(result.status, 'VERIFIED');
    assert.strictEqual(result.discrepancies.length, 0);
  });

  test('6. verifyMapping — Pro Yearly INR verified successfully with exact attributes', async () => {
    const { mappings } = await seedStandardMappings();
    const yearlyInrMapping = mappings[2];

    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: yearlyInrMapping.providerPlanId,
        entity: 'plan',
        interval: 1,
        period: 'yearly',
        item: { id: 'item_inr_yr', amount: 50000, currency: 'INR' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(yearlyInrMapping, { client });
    assert.strictEqual(result.isVerified, true);
    assert.strictEqual(result.status, 'VERIFIED');
    assert.strictEqual(result.discrepancies.length, 0);
  });

  test('7. verifyMapping — Pro Yearly USD verified successfully with exact attributes', async () => {
    const { mappings } = await seedStandardMappings();
    const yearlyUsdMapping = mappings[3];

    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: yearlyUsdMapping.providerPlanId,
        entity: 'plan',
        interval: 1,
        period: 'yearly',
        item: { id: 'item_usd_yr', amount: 999, currency: 'USD' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(yearlyUsdMapping, { client });
    assert.strictEqual(result.isVerified, true);
    assert.strictEqual(result.status, 'VERIFIED');
  });

  test('8. verifyMapping — Detects AMOUNT_MISMATCH when provider amount differs', async () => {
    const { mappings } = await seedStandardMappings();
    const inrMapping = mappings[0];

    // Provider returns 4999 instead of 4900
    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: inrMapping.providerPlanId,
        entity: 'plan',
        interval: 1,
        period: 'monthly',
        item: { amount: 4999, currency: 'INR' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(inrMapping, { client });
    assert.strictEqual(result.isVerified, false);
    assert.strictEqual(result.status, 'AMOUNT_MISMATCH');
    assert.ok(result.discrepancies.some((d) => d.includes('Amount mismatch')));
  });

  test('9. verifyMapping — Detects CURRENCY_MISMATCH when provider currency differs', async () => {
    const { mappings } = await seedStandardMappings();
    const inrMapping = mappings[0];

    // Provider returns USD instead of INR
    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: inrMapping.providerPlanId,
        entity: 'plan',
        interval: 1,
        period: 'monthly',
        item: { amount: 4900, currency: 'USD' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(inrMapping, { client });
    assert.strictEqual(result.isVerified, false);
    assert.strictEqual(result.status, 'CURRENCY_MISMATCH');
    assert.ok(result.discrepancies.some((d) => d.includes('Currency mismatch')));
  });

  test('10. verifyMapping — Detects PERIOD_MISMATCH when provider period differs', async () => {
    const { mappings } = await seedStandardMappings();
    const inrMapping = mappings[0];

    // Provider returns yearly instead of monthly
    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: inrMapping.providerPlanId,
        entity: 'plan',
        interval: 1,
        period: 'yearly',
        item: { amount: 4900, currency: 'INR' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(inrMapping, { client });
    assert.strictEqual(result.isVerified, false);
    assert.strictEqual(result.status, 'PERIOD_MISMATCH');
    assert.ok(result.discrepancies.some((d) => d.includes('Period mismatch')));
  });

  test('11. verifyMapping — Detects INTERVAL_MISMATCH when provider interval differs', async () => {
    const { mappings } = await seedStandardMappings();
    const inrMapping = mappings[0];

    // Provider returns interval 3 instead of 1
    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: inrMapping.providerPlanId,
        entity: 'plan',
        interval: 3,
        period: 'monthly',
        item: { amount: 4900, currency: 'INR' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(inrMapping, { client });
    assert.strictEqual(result.isVerified, false);
    assert.strictEqual(result.status, 'INTERVAL_MISMATCH');
    assert.ok(result.discrepancies.some((d) => d.includes('Interval mismatch')));
  });

  test('12. verifyMapping — Detects MISSING_PROVIDER_PLAN when Razorpay returns 404', async () => {
    const { mappings } = await seedStandardMappings();
    const inrMapping = mappings[0];

    const client = createMockRazorpayClient({
      getHandler: async () => {
        throw new RazorpayProviderError('API_ERROR', 'Razorpay API Error (404): Plan not found', {
          statusCode: 404
        });
      }
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(inrMapping, { client });
    assert.strictEqual(result.isVerified, false);
    assert.strictEqual(result.status, 'MISSING_PROVIDER_PLAN');
    assert.ok(result.discrepancies[0].includes('404 Not Found'));
  });

  test('13. verifyMapping — Detects LOCAL_MAPPING_CONFLICT on inconsistent local DB mapping', async () => {
    const { mappings, proMonthlyInr } = await seedStandardMappings();
    const inrMapping = mappings[0];

    // Manually mutate mapping in DB to have wrong currency
    await prisma.billingProviderPlanMapping.update({
      where: { id: inrMapping.id },
      data: { currency: CurrencyCode.USD }
    });

    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: inrMapping.providerPlanId,
        entity: 'plan',
        interval: 1,
        period: 'monthly',
        item: { amount: 4900, currency: 'INR' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyMapping(inrMapping.id, { client });
    assert.strictEqual(result.isVerified, false);
    assert.strictEqual(result.status, 'LOCAL_MAPPING_CONFLICT');
    assert.ok(result.discrepancies.some((d) => d.includes('Mapping currency')));
  });

  // ---------------------------------------------------------------------------
  // 3. PLAN PRICE VERIFICATION (verifyPlanPrice)
  // ---------------------------------------------------------------------------
  test('14. verifyPlanPrice — Verifies PlanPrice through mapped provider plan', async () => {
    const { mappings, proMonthlyInr } = await seedStandardMappings();

    const client = createMockRazorpayClient({
      getHandler: async () => ({
        id: mappings[0].providerPlanId,
        entity: 'plan',
        interval: 1,
        period: 'monthly',
        item: { amount: 4900, currency: 'INR' }
      })
    });

    const result = await RazorpayCatalogReconciliationService.verifyPlanPrice(proMonthlyInr.id, {
      client
    });
    assert.strictEqual(result.isVerified, true);
    assert.strictEqual(result.status, 'VERIFIED');
  });

  test('15. verifyPlanPrice — Returns CATALOG_INCOMPLETE if PlanPrice has no provider mapping', async () => {
    const proMonthlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } }
    });
    assert.ok(proMonthlyInr);

    // No mappings seeded in DB
    const client = createMockRazorpayClient({});
    const result = await RazorpayCatalogReconciliationService.verifyPlanPrice(proMonthlyInr.id, {
      client
    });
    assert.strictEqual(result.isVerified, false);
    assert.strictEqual(result.status, 'CATALOG_INCOMPLETE');
    assert.ok(result.discrepancies[0].includes('No local Razorpay mapping found'));
  });

  test('16. verifyPlanPrice — Throws validation error for FREE plan tier', async () => {
    const freePrice = await prisma.planPrice.findFirst({
      where: { plan: { code: 'FREE' } }
    });
    assert.ok(freePrice);

    await assert.rejects(
      async () => await RazorpayCatalogReconciliationService.verifyPlanPrice(freePrice.id),
      (err: any) => {
        assert.ok(err.message.includes('FREE plan tier has no external provider mapping'));
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 4. FULL CATALOG RECONCILIATION (reconcileCatalog)
  // ---------------------------------------------------------------------------
  test('17. Full Catalog Reconciliation — Clean catalog returns isClean=true and 4 verified offerings', async () => {
    const { mappings } = await seedStandardMappings();

    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        if (endpoint.startsWith('/plans?') || endpoint === '/plans') {
          return {
            entity: 'collection',
            count: 4,
            items: [
              {
                id: 'plan_pro_monthly_inr_1',
                period: 'monthly',
                interval: 1,
                item: { amount: 4900, currency: 'INR', name: 'ZdexCloud Pro Monthly INR v1' },
                notes: { zdexcloud_plan_code: 'PRO_MONTHLY' }
              },
              {
                id: 'plan_pro_monthly_usd_1',
                period: 'monthly',
                interval: 1,
                item: { amount: 99, currency: 'USD', name: 'ZdexCloud Pro Monthly USD v1' },
                notes: { zdexcloud_plan_code: 'PRO_MONTHLY' }
              },
              {
                id: 'plan_pro_yearly_inr_1',
                period: 'yearly',
                interval: 1,
                item: { amount: 50000, currency: 'INR', name: 'ZdexCloud Pro Yearly INR v1' },
                notes: { zdexcloud_plan_code: 'PRO_YEARLY' }
              },
              {
                id: 'plan_pro_yearly_usd_1',
                period: 'yearly',
                interval: 1,
                item: { amount: 999, currency: 'USD', name: 'ZdexCloud Pro Yearly USD v1' },
                notes: { zdexcloud_plan_code: 'PRO_YEARLY' }
              }
            ]
          };
        }

        // Handle single /plans/{id}
        const mapping = mappings.find((m) => endpoint.includes(m.providerPlanId));
        if (mapping) {
          return {
            id: mapping.providerPlanId,
            period: mapping.period,
            interval: mapping.interval,
            item: { amount: mapping.amountMinorUnits, currency: mapping.currency }
          };
        }
        throw new RazorpayProviderError('API_ERROR', '404 Plan Not Found', { statusCode: 404 });
      }
    });

    const result = await RazorpayCatalogReconciliationService.reconcileCatalog(PaymentEnvironment.TEST, {
      client
    });

    assert.strictEqual(result.isClean, true);
    assert.strictEqual(result.totalLocalPrices, 4);
    assert.strictEqual(result.totalLocalMappings, 4);
    assert.strictEqual(result.verifiedCount, 4);
    assert.strictEqual(result.mismatchedCount, 0);
    assert.strictEqual(result.missingCount, 0);
    assert.strictEqual(result.orphanCount, 0);
    assert.strictEqual(result.missingLocalMappings.length, 0);
  });

  test('18. Full Catalog Reconciliation — Detects missing local mappings', async () => {
    // Seed only 3 mappings (omit PRO_YEARLY USD)
    const { mappings } = await seedStandardMappings();
    await prisma.billingProviderPlanMapping.delete({
      where: { id: mappings[3].id } // delete PRO_YEARLY USD mapping
    });

    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        if (endpoint.startsWith('/plans?') || endpoint === '/plans') {
          return { entity: 'collection', count: 0, items: [] };
        }
        const mapping = mappings.find((m) => endpoint.includes(m.providerPlanId));
        if (mapping) {
          return {
            id: mapping.providerPlanId,
            period: mapping.period,
            interval: mapping.interval,
            item: { amount: mapping.amountMinorUnits, currency: mapping.currency }
          };
        }
        throw new RazorpayProviderError('API_ERROR', '404 Not Found', { statusCode: 404 });
      }
    });

    const result = await RazorpayCatalogReconciliationService.reconcileCatalog(PaymentEnvironment.TEST, {
      client
    });

    assert.strictEqual(result.isClean, false);
    assert.strictEqual(result.totalLocalPrices, 4);
    assert.strictEqual(result.totalLocalMappings, 3);
    assert.strictEqual(result.missingLocalMappings.length, 1);
    assert.ok(result.missingLocalMappings[0].includes('PRO_YEARLY (USD'));
  });

  test('19. Full Catalog Reconciliation — Detects orphan provider plans', async () => {
    const { mappings } = await seedStandardMappings();

    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        if (endpoint.startsWith('/plans?') || endpoint === '/plans') {
          return {
            entity: 'collection',
            count: 5,
            items: [
              {
                id: 'plan_pro_monthly_inr_1',
                period: 'monthly',
                interval: 1,
                item: { amount: 4900, currency: 'INR' },
                notes: { zdexcloud_plan_code: 'PRO_MONTHLY' }
              },
              {
                id: 'plan_pro_monthly_usd_1',
                period: 'monthly',
                interval: 1,
                item: { amount: 99, currency: 'USD' },
                notes: { zdexcloud_plan_code: 'PRO_MONTHLY' }
              },
              {
                id: 'plan_pro_yearly_inr_1',
                period: 'yearly',
                interval: 1,
                item: { amount: 50000, currency: 'INR' },
                notes: { zdexcloud_plan_code: 'PRO_YEARLY' }
              },
              {
                id: 'plan_pro_yearly_usd_1',
                period: 'yearly',
                interval: 1,
                item: { amount: 999, currency: 'USD' },
                notes: { zdexcloud_plan_code: 'PRO_YEARLY' }
              },
              // ORPHAN: tagged with zdexcloud but not in DB
              {
                id: 'plan_orphan_deprecated_1',
                period: 'monthly',
                interval: 1,
                item: { amount: 2900, currency: 'INR' },
                notes: { zdexcloud_plan_code: 'PRO_OLD_TIER', zdexcloud_environment: 'TEST' }
              }
            ]
          };
        }

        const mapping = mappings.find((m) => endpoint.includes(m.providerPlanId));
        if (mapping) {
          return {
            id: mapping.providerPlanId,
            period: mapping.period,
            interval: mapping.interval,
            item: { amount: mapping.amountMinorUnits, currency: mapping.currency }
          };
        }
        throw new RazorpayProviderError('API_ERROR', '404 Not Found', { statusCode: 404 });
      }
    });

    const result = await RazorpayCatalogReconciliationService.reconcileCatalog(PaymentEnvironment.TEST, {
      client
    });

    assert.strictEqual(result.isClean, false);
    assert.strictEqual(result.orphanCount, 1);
    assert.strictEqual(result.orphans[0].providerPlanId, 'plan_orphan_deprecated_1');
  });

  test('20. Full Catalog Reconciliation — Ignores unrelated third-party provider plans', async () => {
    const { mappings } = await seedStandardMappings();

    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        if (endpoint.startsWith('/plans?') || endpoint === '/plans') {
          return {
            entity: 'collection',
            count: 5,
            items: [
              {
                id: 'plan_pro_monthly_inr_1',
                period: 'monthly',
                interval: 1,
                item: { amount: 4900, currency: 'INR' },
                notes: { zdexcloud_plan_code: 'PRO_MONTHLY' }
              },
              {
                id: 'plan_pro_monthly_usd_1',
                period: 'monthly',
                interval: 1,
                item: { amount: 99, currency: 'USD' },
                notes: { zdexcloud_plan_code: 'PRO_MONTHLY' }
              },
              {
                id: 'plan_pro_yearly_inr_1',
                period: 'yearly',
                interval: 1,
                item: { amount: 50000, currency: 'INR' },
                notes: { zdexcloud_plan_code: 'PRO_YEARLY' }
              },
              {
                id: 'plan_pro_yearly_usd_1',
                period: 'yearly',
                interval: 1,
                item: { amount: 999, currency: 'USD' },
                notes: { zdexcloud_plan_code: 'PRO_YEARLY' }
              },
              // UNRELATED: no zdexcloud notes or name
              {
                id: 'plan_third_party_saas_1',
                period: 'monthly',
                interval: 1,
                item: { amount: 1500, currency: 'INR', name: 'Other SaaS Plan' },
                notes: { client_id: 'client_123' }
              }
            ]
          };
        }

        const mapping = mappings.find((m) => endpoint.includes(m.providerPlanId));
        if (mapping) {
          return {
            id: mapping.providerPlanId,
            period: mapping.period,
            interval: mapping.interval,
            item: { amount: mapping.amountMinorUnits, currency: mapping.currency }
          };
        }
        throw new RazorpayProviderError('API_ERROR', '404 Not Found', { statusCode: 404 });
      }
    });

    const result = await RazorpayCatalogReconciliationService.reconcileCatalog(PaymentEnvironment.TEST, {
      client
    });

    assert.strictEqual(result.isClean, true);
    assert.strictEqual(result.orphanCount, 0);
    assert.strictEqual(result.unrelatedCount, 1);
    assert.strictEqual(result.unrelatedPlans[0].providerPlanId, 'plan_third_party_saas_1');
  });


  // ---------------------------------------------------------------------------
  // 5. SAFETY & IMMUTABILITY INVARIANTS
  // ---------------------------------------------------------------------------
  test('21. Safety & Immutability — Reconciliation performs 0 DB mutations and 0 provider writes', async () => {
    const { mappings } = await seedStandardMappings();

    const countBefore = await prisma.billingProviderPlanMapping.count();
    let postCallCount = 0;

    const client = createMockRazorpayClient({
      getHandler: async (endpoint) => {
        // Return mismatched amount to trigger failure
        return {
          id: 'plan_mismatched',
          period: 'monthly',
          interval: 1,
          item: { amount: 99999, currency: 'INR' }
        };
      },
      postHandler: async () => {
        postCallCount++;
        return {};
      }
    });

    // Run reconciliation on mismatched catalog
    const result = await RazorpayCatalogReconciliationService.reconcileCatalog(PaymentEnvironment.TEST, {
      client
    });

    assert.strictEqual(result.isClean, false);

    // Verify 0 provider write calls
    assert.strictEqual(postCallCount, 0);

    // Verify 0 database mutations or auto-repairs
    const countAfter = await prisma.billingProviderPlanMapping.count();
    assert.strictEqual(countBefore, countAfter);

    const checkMapping = await prisma.billingProviderPlanMapping.findUnique({
      where: { id: mappings[0].id }
    });
    assert.strictEqual(checkMapping?.amountMinorUnits, 4900); // Unaltered
  });
});
