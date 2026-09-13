import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { prisma } from '../src/config/database.js';
import { BillingInterval, CurrencyCode } from '@prisma/client';

describe('ZC-BILLING-1.1 Plan System & Catalog Test Suite', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
    // Ensure catalog is seeded before tests run
    await PlanService.seedInitialCatalog();
  });

  after(async () => {
    await app.close();
  });

  test('1. Plan Catalog Integrity — FREE, PRO_MONTHLY, PRO_YEARLY exist in database', async () => {
    const freePlan = await prisma.plan.findUnique({ where: { code: 'FREE' } });
    const proMonthlyPlan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
    const proYearlyPlan = await prisma.plan.findUnique({ where: { code: 'PRO_YEARLY' } });

    assert.ok(freePlan, 'FREE plan must exist');
    assert.strictEqual(freePlan.code, 'FREE');
    assert.strictEqual(freePlan.interval, BillingInterval.FREE);
    assert.strictEqual(freePlan.serverLimit, 1);
    assert.strictEqual(freePlan.priorityRelay, false);

    assert.ok(proMonthlyPlan, 'PRO_MONTHLY plan must exist');
    assert.strictEqual(proMonthlyPlan.code, 'PRO_MONTHLY');
    assert.strictEqual(proMonthlyPlan.interval, BillingInterval.MONTHLY);
    assert.strictEqual(proMonthlyPlan.serverLimit, 5);
    assert.strictEqual(proMonthlyPlan.priorityRelay, true);

    assert.ok(proYearlyPlan, 'PRO_YEARLY plan must exist');
    assert.strictEqual(proYearlyPlan.code, 'PRO_YEARLY');
    assert.strictEqual(proYearlyPlan.interval, BillingInterval.YEARLY);
    assert.strictEqual(proYearlyPlan.serverLimit, 5);
    assert.strictEqual(proYearlyPlan.priorityRelay, true);
  });

  test('2. Currency & Minor Unit Amounts — INR and USD prices for all plans', async () => {
    const plans = await PlanService.getActivePlans();
    assert.strictEqual(plans.length >= 3, true);

    const free = plans.find(p => p.code === 'FREE');
    assert.ok(free);
    const freeInr = free.prices.find(pr => pr.currency === CurrencyCode.INR);
    const freeUsd = free.prices.find(pr => pr.currency === CurrencyCode.USD);
    assert.ok(freeInr);
    assert.ok(freeUsd);
    assert.strictEqual(freeInr.amountMinorUnits, 0);
    assert.strictEqual(freeUsd.amountMinorUnits, 0);

    const proMonthly = plans.find(p => p.code === 'PRO_MONTHLY');
    assert.ok(proMonthly);
    const proMonthlyInr = proMonthly.prices.find(pr => pr.currency === CurrencyCode.INR);
    const proMonthlyUsd = proMonthly.prices.find(pr => pr.currency === CurrencyCode.USD);
    assert.ok(proMonthlyInr);
    assert.ok(proMonthlyUsd);
    assert.strictEqual(proMonthlyInr.amountMinorUnits, 4900, 'Pro Monthly INR must be 4900 paise (?49)');
    assert.strictEqual(proMonthlyUsd.amountMinorUnits, 99, 'Pro Monthly USD must be 99 cents ($0.99)');

    const proYearly = plans.find(p => p.code === 'PRO_YEARLY');
    assert.ok(proYearly);
    const proYearlyInr = proYearly.prices.find(pr => pr.currency === CurrencyCode.INR);
    const proYearlyUsd = proYearly.prices.find(pr => pr.currency === CurrencyCode.USD);
    assert.ok(proYearlyInr);
    assert.ok(proYearlyUsd);
    assert.strictEqual(proYearlyInr.amountMinorUnits, 50000, 'Pro Yearly INR must be 50000 paise (?500)');
    assert.strictEqual(proYearlyUsd.amountMinorUnits, 999, 'Pro Yearly USD must be 999 cents ($9.99)');
  });

  test('3. Stable Identifiers & Unique Code Constraint', async () => {
    let duplicateRejected = false;
    try {
      await prisma.plan.create({
        data: {
          code: 'FREE', // Duplicate code
          name: 'Duplicate Free Plan',
          interval: BillingInterval.FREE
        }
      });
    } catch (err: any) {
      duplicateRejected = true;
    }
    assert.strictEqual(duplicateRejected, true, 'Database must reject duplicate plan codes');
  });

  test('4. Price Versioning & Immutability — New price version does not overwrite history', async () => {
    // Create a temporary test plan
    const testPlanCode = `TEST_PLAN_${Date.now()}`;
    const testPlan = await prisma.plan.create({
      data: {
        code: testPlanCode,
        name: 'Test Plan for Versioning',
        interval: BillingInterval.MONTHLY
      }
    });

    try {
      // 1. Create Price Version 1
      const priceV1 = await PlanService.createPriceVersion(
        testPlan.id,
        CurrencyCode.INR,
        4900,
        new Date('2026-09-01T00:00:00Z')
      );
      assert.strictEqual(priceV1.version, 1);
      assert.strictEqual(priceV1.amountMinorUnits, 4900);
      assert.strictEqual(priceV1.isActive, true);

      // 2. Introduce Price Version 2 (e.g. price increase to 5900)
      const priceV2 = await PlanService.createPriceVersion(
        testPlan.id,
        CurrencyCode.INR,
        5900,
        new Date('2026-10-01T00:00:00Z')
      );
      assert.strictEqual(priceV2.version, 2);
      assert.strictEqual(priceV2.amountMinorUnits, 5900);
      assert.strictEqual(priceV2.isActive, true);

      // 3. Verify Version 1 is preserved and marked inactive
      const oldPrice = await prisma.planPrice.findUnique({ where: { id: priceV1.id } });
      assert.ok(oldPrice);
      assert.strictEqual(oldPrice.amountMinorUnits, 4900, 'Original V1 amount must be unchanged');
      assert.strictEqual(oldPrice.isActive, false, 'V1 must be deactivated');
      assert.ok(oldPrice.effectiveTo !== null, 'V1 effectiveTo must be set');

      // 4. Verify getPlanByCode returns active version 2
      const activePlanData = await PlanService.getPlanByCode(testPlanCode, CurrencyCode.INR);
      assert.ok(activePlanData);
      assert.strictEqual(activePlanData.prices.length, 1);
      assert.strictEqual(activePlanData.prices[0].version, 2);
      assert.strictEqual(activePlanData.prices[0].amountMinorUnits, 5900);
    } finally {
      // Cleanup test data
      await prisma.planPrice.deleteMany({ where: { planId: testPlan.id } });
      await prisma.plan.delete({ where: { id: testPlan.id } });
    }
  });

  test('5. Delete Protection — Deleting plan with existing prices is restricted', async () => {
    const testPlanCode = `TEST_DEL_${Date.now()}`;
    const testPlan = await prisma.plan.create({
      data: {
        code: testPlanCode,
        name: 'Test Plan for Delete Protection',
        interval: BillingInterval.MONTHLY
      }
    });

    await prisma.planPrice.create({
      data: {
        planId: testPlan.id,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        version: 1
      }
    });

    let deleteBlocked = false;
    try {
      await prisma.plan.delete({ where: { id: testPlan.id } });
    } catch (err: any) {
      deleteBlocked = true;
    }

    assert.strictEqual(deleteBlocked, true, 'Foreign key onDelete: Restrict must block destructive plan deletion');

    // Cleanup
    await prisma.planPrice.deleteMany({ where: { planId: testPlan.id } });
    await prisma.plan.delete({ where: { id: testPlan.id } });
  });

  test('6. GET /api/v1/plans returns authoritative catalog', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plans'
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.plans));
    assert.strictEqual(body.data.count >= 3, true);

    const codes = body.data.plans.map((p: any) => p.code);
    assert.ok(codes.includes('FREE'));
    assert.ok(codes.includes('PRO_MONTHLY'));
    assert.ok(codes.includes('PRO_YEARLY'));
  });

  test('7. GET /api/v1/plans?currency=INR filters prices by INR', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plans?currency=INR'
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);

    for (const plan of body.data.plans) {
      for (const price of plan.prices) {
        assert.strictEqual(price.currency, 'INR');
      }
    }
  });

  test('8. GET /api/v1/plans?currency=INVALID returns 400 validation error', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plans?currency=EUR'
    });

    assert.strictEqual(response.statusCode, 400);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  });

  test('9. GET /api/v1/plans/PRO_MONTHLY returns single plan details', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plans/PRO_MONTHLY'
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.plan.code, 'PRO_MONTHLY');
    assert.strictEqual(body.data.plan.serverLimit, 5);
  });

  test('10. GET /api/v1/plans/NONEXISTENT returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plans/NONEXISTENT'
    });

    assert.strictEqual(response.statusCode, 404);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'PLAN_NOT_FOUND');
  });
});
