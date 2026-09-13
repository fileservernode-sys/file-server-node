import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import {
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

describe('ZC-BILLING-3.3 Razorpay Plan Catalog Sync & Mapping Test Suite', () => {
  // Test-specific fake client generator
  function createMockRazorpayClient(
    mockHandler: (endpoint: string, body: any) => Promise<any>
  ): RazorpayClient {
    const client = new RazorpayClient({
      keyId: 'rzp_test_mockKey123',
      keySecret: 'sec_mockSecret123',
      baseUrl: 'https://api.razorpay.com/v1'
    });

    // Override post method
    client.post = async <T>(endpoint: string, body?: any): Promise<T> => {
      return (await mockHandler(endpoint, body)) as T;
    };

    return client;
  }

  before(async () => {
    // Seed standard initial catalog
    await PlanService.seedInitialCatalog();
  });

  beforeEach(async () => {
    // Clean up any test mappings before each test
    await prisma.billingProviderPlanMapping.deleteMany({});
  });

  after(async () => {
    await prisma.billingProviderPlanMapping.deleteMany({});
  });

  // ---------------------------------------------------------------------------
  // 1. FREE TIER EXCLUSION
  // ---------------------------------------------------------------------------
  test('1. FREE Tier Exclusion — FREE plan has no external provider mapping', async () => {
    const freePlan = await prisma.plan.findUnique({
      where: { code: 'FREE' },
      include: { prices: true }
    });
    assert.ok(freePlan);
    for (const p of freePlan.prices) {
      assert.strictEqual(p.amountMinorUnits, 0);
    }

    // Resolving provider plan ID for FREE must fail
    await assert.rejects(
      async () => await RazorpayPlanCatalogService.resolveProviderPlanId('FREE', CurrencyCode.INR),
      (err: any) => {
        assert.ok(err.message.includes('FREE plan tier has no external provider'));
        return true;
      }
    );

    // Attempting to sync FREE plan price must fail
    if (freePlan.prices.length > 0) {
      await assert.rejects(
        async () => await RazorpayPlanCatalogService.syncPlanPrice(freePlan.prices[0].id),
        (err: any) => {
          assert.ok(err instanceof RazorpayProviderError);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 2. INDIVIDUAL PLAN SYNCHRONIZATION
  // ---------------------------------------------------------------------------
  test('2. PRO_MONTHLY INR — Syncs correctly with period=monthly, interval=1, amount=4900', async () => {
    const proMonthlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } }
    });
    assert.ok(proMonthlyInr);
    assert.strictEqual(proMonthlyInr.amountMinorUnits, 4900);

    let capturedPayload: any;
    const client = createMockRazorpayClient(async (endpoint, body) => {
      capturedPayload = body;
      return {
        id: 'plan_pro_monthly_inr_mock1',
        entity: 'plan',
        interval: 1,
        period: 'monthly',
        item: {
          id: 'item_1',
          name: body.item.name,
          amount: 4900,
          currency: 'INR'
        }
      };
    });

    const mapping = await RazorpayPlanCatalogService.syncPlanPrice(proMonthlyInr.id, {
      client,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(mapping.providerPlanId, 'plan_pro_monthly_inr_mock1');
    assert.strictEqual(mapping.currency, CurrencyCode.INR);
    assert.strictEqual(mapping.amountMinorUnits, 4900);
    assert.strictEqual(mapping.period, 'monthly');
    assert.strictEqual(mapping.interval, 1);
    assert.strictEqual(mapping.environment, PaymentEnvironment.TEST);

    // Verify request payload sent to Razorpay API
    assert.strictEqual(capturedPayload.period, 'monthly');
    assert.strictEqual(capturedPayload.interval, 1);
    assert.strictEqual(capturedPayload.item.amount, 4900);
    assert.strictEqual(capturedPayload.item.currency, 'INR');
    assert.strictEqual(capturedPayload.notes.zdexcloud_plan_code, 'PRO_MONTHLY');
  });

  test('3. PRO_MONTHLY USD — Syncs correctly with period=monthly, interval=1, amount=99', async () => {
    const proMonthlyUsd = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.USD, plan: { code: 'PRO_MONTHLY' } }
    });
    assert.ok(proMonthlyUsd);
    assert.strictEqual(proMonthlyUsd.amountMinorUnits, 99);

    const client = createMockRazorpayClient(async (endpoint, body) => ({
      id: 'plan_pro_monthly_usd_mock1',
      entity: 'plan',
      interval: 1,
      period: 'monthly',
      item: { id: 'item_2', amount: 99, currency: 'USD' }
    }));

    const mapping = await RazorpayPlanCatalogService.syncPlanPrice(proMonthlyUsd.id, {
      client,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(mapping.providerPlanId, 'plan_pro_monthly_usd_mock1');
    assert.strictEqual(mapping.currency, CurrencyCode.USD);
    assert.strictEqual(mapping.amountMinorUnits, 99);
  });

  test('4. PRO_YEARLY INR — Syncs correctly with period=yearly, interval=1, amount=50000', async () => {
    const proYearlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_YEARLY' } }
    });
    assert.ok(proYearlyInr);
    assert.strictEqual(proYearlyInr.amountMinorUnits, 50000);

    const client = createMockRazorpayClient(async (endpoint, body) => ({
      id: 'plan_pro_yearly_inr_mock1',
      entity: 'plan',
      interval: 1,
      period: 'yearly',
      item: { id: 'item_3', amount: 50000, currency: 'INR' }
    }));

    const mapping = await RazorpayPlanCatalogService.syncPlanPrice(proYearlyInr.id, {
      client,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(mapping.providerPlanId, 'plan_pro_yearly_inr_mock1');
    assert.strictEqual(mapping.period, 'yearly');
    assert.strictEqual(mapping.amountMinorUnits, 50000);
  });

  test('5. PRO_YEARLY USD — Syncs correctly with period=yearly, interval=1, amount=999', async () => {
    const proYearlyUsd = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.USD, plan: { code: 'PRO_YEARLY' } }
    });
    assert.ok(proYearlyUsd);
    assert.strictEqual(proYearlyUsd.amountMinorUnits, 999);

    const client = createMockRazorpayClient(async (endpoint, body) => ({
      id: 'plan_pro_yearly_usd_mock1',
      entity: 'plan',
      interval: 1,
      period: 'yearly',
      item: { id: 'item_4', amount: 999, currency: 'USD' }
    }));

    const mapping = await RazorpayPlanCatalogService.syncPlanPrice(proYearlyUsd.id, {
      client,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(mapping.providerPlanId, 'plan_pro_yearly_usd_mock1');
    assert.strictEqual(mapping.period, 'yearly');
    assert.strictEqual(mapping.amountMinorUnits, 999);
  });

  // ---------------------------------------------------------------------------
  // 3. IDEMPOTENCY & CONFLICT PROTECTION
  // ---------------------------------------------------------------------------
  test('6. Idempotency — Reuses existing mapping without calling provider API', async () => {
    const proMonthlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } }
    });
    assert.ok(proMonthlyInr);

    let apiCallCount = 0;
    const client = createMockRazorpayClient(async () => {
      apiCallCount++;
      return {
        id: 'plan_idempotent_test_1',
        interval: 1,
        period: 'monthly',
        item: { amount: 4900, currency: 'INR' }
      };
    });

    // First call creates the mapping
    const mapping1 = await RazorpayPlanCatalogService.syncPlanPrice(proMonthlyInr.id, {
      client,
      environment: PaymentEnvironment.TEST
    });
    assert.strictEqual(apiCallCount, 1);

    // Second call should return cached mapping without calling Razorpay API
    const mapping2 = await RazorpayPlanCatalogService.syncPlanPrice(proMonthlyInr.id, {
      client,
      environment: PaymentEnvironment.TEST
    });
    assert.strictEqual(apiCallCount, 1);
    assert.strictEqual(mapping1.id, mapping2.id);
    assert.strictEqual(mapping1.providerPlanId, mapping2.providerPlanId);
  });

  test('7. Mapping Conflict — Conflicting price attributes in existing mapping fails safely', async () => {
    const proMonthlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } },
      include: { plan: true }
    });
    assert.ok(proMonthlyInr);

    // Seed a corrupted / conflicting mapping manually in DB (e.g. wrong currency)
    await prisma.billingProviderPlanMapping.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        planId: proMonthlyInr.plan.id,
        planPriceId: proMonthlyInr.id,
        providerPlanId: 'plan_conflicting_xyz',
        currency: CurrencyCode.USD, // Mismatch with INR
        amountMinorUnits: 9999,
        period: 'monthly',
        interval: 1,
        priceVersion: 1
      }
    });

    const client = createMockRazorpayClient(async () => ({}));

    await assert.rejects(
      async () =>
        await RazorpayPlanCatalogService.syncPlanPrice(proMonthlyInr.id, {
          client,
          environment: PaymentEnvironment.TEST
        }),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'MAPPING_CONFLICT');
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 4. ENVIRONMENT ISOLATION (TEST vs LIVE)
  // ---------------------------------------------------------------------------
  test('8. Environment Isolation — TEST and LIVE mappings are isolated', async () => {
    const proMonthlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } }
    });
    assert.ok(proMonthlyInr);

    const testClient = createMockRazorpayClient(async () => ({
      id: 'plan_test_abc123',
      interval: 1,
      period: 'monthly',
      item: { amount: 4900, currency: 'INR' }
    }));

    const liveClient = createMockRazorpayClient(async () => ({
      id: 'plan_live_xyz789',
      interval: 1,
      period: 'monthly',
      item: { amount: 4900, currency: 'INR' }
    }));

    const testMapping = await RazorpayPlanCatalogService.syncPlanPrice(proMonthlyInr.id, {
      client: testClient,
      environment: PaymentEnvironment.TEST
    });

    const liveMapping = await RazorpayPlanCatalogService.syncPlanPrice(proMonthlyInr.id, {
      client: liveClient,
      environment: PaymentEnvironment.LIVE
    });

    assert.strictEqual(testMapping.environment, PaymentEnvironment.TEST);
    assert.strictEqual(testMapping.providerPlanId, 'plan_test_abc123');

    assert.strictEqual(liveMapping.environment, PaymentEnvironment.LIVE);
    assert.strictEqual(liveMapping.providerPlanId, 'plan_live_xyz789');

    // Verify resolveProviderPlanId respects environment parameter
    const resolvedTest = await RazorpayPlanCatalogService.resolveProviderPlanId(
      'PRO_MONTHLY',
      CurrencyCode.INR,
      1,
      PaymentEnvironment.TEST
    );
    const resolvedLive = await RazorpayPlanCatalogService.resolveProviderPlanId(
      'PRO_MONTHLY',
      CurrencyCode.INR,
      1,
      PaymentEnvironment.LIVE
    );

    assert.strictEqual(resolvedTest, 'plan_test_abc123');
    assert.strictEqual(resolvedLive, 'plan_live_xyz789');
  });

  // ---------------------------------------------------------------------------
  // 5. PROVIDER RESPONSE VALIDATION
  // ---------------------------------------------------------------------------
  test('9. Provider Validation — Rejects provider response with mismatched amount or currency', async () => {
    const proMonthlyInr = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } }
    });
    assert.ok(proMonthlyInr);

    // Provider returns amount 5000 instead of 4900
    const client = createMockRazorpayClient(async () => ({
      id: 'plan_bad_amount',
      interval: 1,
      period: 'monthly',
      item: { amount: 5000, currency: 'INR' }
    }));

    await assert.rejects(
      async () =>
        await RazorpayPlanCatalogService.syncPlanPrice(proMonthlyInr.id, {
          client,
          environment: PaymentEnvironment.TEST
        }),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'RESPONSE_MISMATCH');
        return true;
      }
    );

    // Ensure no corrupted mapping was persisted
    const mapping = await RazorpayPlanCatalogService.getMappingForPlanPrice(
      proMonthlyInr.id,
      PaymentEnvironment.TEST
    );
    assert.strictEqual(mapping, null);
  });

  // ---------------------------------------------------------------------------
  // 6. FULL PAID CATALOG SYNC & VERIFICATION
  // ---------------------------------------------------------------------------
  test('10. Full Catalog Sync — syncAllPaidPlans synchronizes all 4 commercial offerings', async () => {
    const client = createMockRazorpayClient(async (endpoint, body) => {
      const code = body.notes?.zdexcloud_plan_code;
      const currency = body.notes?.zdexcloud_currency;
      return {
        id: `plan_${code.toLowerCase()}_${currency.toLowerCase()}_synced`,
        interval: body.interval,
        period: body.period,
        item: {
          amount: body.item.amount,
          currency: body.item.currency
        }
      };
    });

    const mappings = await RazorpayPlanCatalogService.syncAllPaidPlans({
      client,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(mappings.length, 4);

    const verification = await RazorpayPlanCatalogService.verifyCatalogMappings(
      PaymentEnvironment.TEST
    );
    assert.strictEqual(verification.complete, true);
    assert.strictEqual(verification.missing.length, 0);
    assert.strictEqual(verification.mappings.length, 4);

    // Verify resolving all 4 plans
    const proMonthlyInr = await RazorpayPlanCatalogService.resolveProviderPlanId(
      'PRO_MONTHLY',
      CurrencyCode.INR,
      1,
      PaymentEnvironment.TEST
    );
    const proMonthlyUsd = await RazorpayPlanCatalogService.resolveProviderPlanId(
      'PRO_MONTHLY',
      CurrencyCode.USD,
      1,
      PaymentEnvironment.TEST
    );
    const proYearlyInr = await RazorpayPlanCatalogService.resolveProviderPlanId(
      'PRO_YEARLY',
      CurrencyCode.INR,
      1,
      PaymentEnvironment.TEST
    );
    const proYearlyUsd = await RazorpayPlanCatalogService.resolveProviderPlanId(
      'PRO_YEARLY',
      CurrencyCode.USD,
      1,
      PaymentEnvironment.TEST
    );

    assert.strictEqual(proMonthlyInr, 'plan_pro_monthly_inr_synced');
    assert.strictEqual(proMonthlyUsd, 'plan_pro_monthly_usd_synced');
    assert.strictEqual(proYearlyInr, 'plan_pro_yearly_inr_synced');
    assert.strictEqual(proYearlyUsd, 'plan_pro_yearly_usd_synced');
  });

  test('11. Catalog Incomplete — Throws if any required commercial offering is missing', async () => {
    // Temporarily deactivate PRO_YEARLY USD
    const proYearlyUsd = await prisma.planPrice.findFirst({
      where: { currency: CurrencyCode.USD, plan: { code: 'PRO_YEARLY' } }
    });
    assert.ok(proYearlyUsd);

    await prisma.planPrice.update({
      where: { id: proYearlyUsd.id },
      data: { isActive: false }
    });

    try {
      const client = createMockRazorpayClient(async () => ({}));

      await assert.rejects(
        async () =>
          await RazorpayPlanCatalogService.syncAllPaidPlans({
            client,
            environment: PaymentEnvironment.TEST
          }),
        (err: any) => {
          assert.ok(err instanceof RazorpayProviderError);
          assert.strictEqual(err.code, 'CATALOG_INCOMPLETE');
          assert.ok(err.message.includes('PRO_YEARLY:USD'));
          return true;
        }
      );
    } finally {
      // Restore PRO_YEARLY USD
      await prisma.planPrice.update({
        where: { id: proYearlyUsd.id },
        data: { isActive: true }
      });
    }
  });
});
