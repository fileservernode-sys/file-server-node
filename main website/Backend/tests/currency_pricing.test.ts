import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { PricingCatalogService, PriceFormatter } from '../src/services/billing/pricing_catalog_service.js';
import { CountryDetectionService } from '../src/services/billing/country_detection_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStatus, CurrencyCode, BillingInterval } from '@prisma/client';

describe('ZC-BILLING-2.2 Currency-Aware Pricing & Regional Catalog Resolution Test Suite', () => {
  let app: FastifyInstance;
  const testEmailUs = `pricing.test.us.${Date.now()}@zdexcloud.com`;
  let usUserId = '';
  let usUserToken = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Ensure catalog is seeded
    await PlanService.seedInitialCatalog();

    // Create a test user with confirmed billingCountry = 'US'
    const user = await prisma.user.create({
      data: {
        email: testEmailUs,
        passwordHash: 'test-hash',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    usUserId = user.id;

    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        token: `tok_pricing_us_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    usUserToken = session.token;

    // Create an active USD subscription with confirmed billingCountry 'US'
    await BillingStateService.createSubscription({
      userId: usUserId,
      planCode: 'PRO_MONTHLY',
      currency: CurrencyCode.USD,
      billingCountry: 'US'
    });
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: { email: testEmailUs }
      });
    } catch {}
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. INDIA CATALOG
  // ---------------------------------------------------------------------------
  test('1. India Catalog — CF-IPCountry=IN returns INR catalog with exact locked prices', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: { 'cf-ipcountry': 'IN' }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.countryCode, 'IN');
    assert.strictEqual(body.data.currency, 'INR');
    assert.strictEqual(body.data.countryConfirmed, false);

    const plans = body.data.plans;
    const free = plans.find((p: any) => p.code === 'FREE');
    assert.ok(free);
    assert.strictEqual(free.amountMinorUnits, 0);
    assert.strictEqual(free.currency, 'INR');
    assert.strictEqual(free.formattedPrice, '₹0');

    const proMonthly = plans.find((p: any) => p.code === 'PRO_MONTHLY');
    assert.ok(proMonthly);
    assert.strictEqual(proMonthly.amountMinorUnits, 4900);
    assert.strictEqual(proMonthly.currency, 'INR');
    assert.strictEqual(proMonthly.formattedPrice, '₹49');

    const proYearly = plans.find((p: any) => p.code === 'PRO_YEARLY');
    assert.ok(proYearly);
    assert.strictEqual(proYearly.amountMinorUnits, 50000);
    assert.strictEqual(proYearly.currency, 'INR');
    assert.strictEqual(proYearly.formattedPrice, '₹500');
  });

  // ---------------------------------------------------------------------------
  // 2. UNITED STATES CATALOG
  // ---------------------------------------------------------------------------
  test('2. United States Catalog — CF-IPCountry=US returns USD catalog with exact locked prices', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: { 'cf-ipcountry': 'US' }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.countryCode, 'US');
    assert.strictEqual(body.data.currency, 'USD');
    assert.strictEqual(body.data.countryConfirmed, false);

    const plans = body.data.plans;
    const free = plans.find((p: any) => p.code === 'FREE');
    assert.ok(free);
    assert.strictEqual(free.amountMinorUnits, 0);
    assert.strictEqual(free.currency, 'USD');
    assert.strictEqual(free.formattedPrice, '$0');

    const proMonthly = plans.find((p: any) => p.code === 'PRO_MONTHLY');
    assert.ok(proMonthly);
    assert.strictEqual(proMonthly.amountMinorUnits, 99);
    assert.strictEqual(proMonthly.currency, 'USD');
    assert.strictEqual(proMonthly.formattedPrice, '$0.99');

    const proYearly = plans.find((p: any) => p.code === 'PRO_YEARLY');
    assert.ok(proYearly);
    assert.strictEqual(proYearly.amountMinorUnits, 999);
    assert.strictEqual(proYearly.currency, 'USD');
    assert.strictEqual(proYearly.formattedPrice, '$9.99');
  });

  // ---------------------------------------------------------------------------
  // 3. GERMANY / INTERNATIONAL
  // ---------------------------------------------------------------------------
  test('3. Germany (DE) — Resolves to USD catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: { 'cf-ipcountry': 'DE' }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.countryCode, 'DE');
    assert.strictEqual(body.data.currency, 'USD');
  });

  // ---------------------------------------------------------------------------
  // 4. UNKNOWN / MISSING HEADER
  // ---------------------------------------------------------------------------
  test('4. Unknown / Missing Header — Resolves to safe USD default catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans'
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.countryCode, null);
    assert.strictEqual(body.data.currency, 'USD');
  });

  // ---------------------------------------------------------------------------
  // 5. TOR / CLOUDFLARE SPECIAL TOKEN T1
  // ---------------------------------------------------------------------------
  test('5. Tor Exit Node (T1) — Resolves to UNKNOWN country and USD catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: { 'cf-ipcountry': 'T1' }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.countryCode, null);
    assert.strictEqual(body.data.currency, 'USD');
  });

  // ---------------------------------------------------------------------------
  // 6. LOWERCASE NORMALIZATION
  // ---------------------------------------------------------------------------
  test('6. Lowercase Country (in) — Normalizes to IN and returns INR catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: { 'cf-ipcountry': 'in' }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.countryCode, 'IN');
    assert.strictEqual(body.data.currency, 'INR');
  });

  // ---------------------------------------------------------------------------
  // 7. CLIENT CURRENCY SPOOF PROTECTION
  // ---------------------------------------------------------------------------
  test('7. Client Currency Spoof Defense — US visitor attempting ?currency=INR is rejected', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans?currency=INR',
      headers: { 'cf-ipcountry': 'US' } // US IP cannot force INR
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  });

  // ---------------------------------------------------------------------------
  // 8. CATALOG COMPLETENESS
  // ---------------------------------------------------------------------------
  test('8. Catalog Completeness — All active plans have valid INR and USD prices', async () => {
    const inrCatalog = await PricingCatalogService.getRegionalCatalog(CurrencyCode.INR);
    assert.strictEqual(inrCatalog.length >= 3, true);
    for (const p of inrCatalog) {
      assert.strictEqual(p.currency, CurrencyCode.INR);
      assert.ok(typeof p.amountMinorUnits === 'number');
      assert.ok(typeof p.formattedPrice === 'string');
    }

    const usdCatalog = await PricingCatalogService.getRegionalCatalog(CurrencyCode.USD);
    assert.strictEqual(usdCatalog.length >= 3, true);
    for (const p of usdCatalog) {
      assert.strictEqual(p.currency, CurrencyCode.USD);
      assert.ok(typeof p.amountMinorUnits === 'number');
      assert.ok(typeof p.formattedPrice === 'string');
    }
  });

  // ---------------------------------------------------------------------------
  // 9. PRICE VERSIONING & LATEST VALID SELECTION
  // ---------------------------------------------------------------------------
  test('9. Price Versioning — Storefront resolves the latest active version', async () => {
    const proMonthlyPlan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
    assert.ok(proMonthlyPlan);

    // Create a temporary price version 2
    const priceV2 = await prisma.planPrice.create({
      data: {
        planId: proMonthlyPlan!.id,
        currency: CurrencyCode.INR,
        amountMinorUnits: 5900,
        version: 2,
        isActive: true,
        effectiveFrom: new Date()
      }
    });

    try {
      const inrCatalog = await PricingCatalogService.getRegionalCatalog(CurrencyCode.INR);
      const proMonthly = inrCatalog.find(p => p.code === 'PRO_MONTHLY');
      assert.ok(proMonthly);
      assert.strictEqual(proMonthly!.priceVersion, 2);
      assert.strictEqual(proMonthly!.amountMinorUnits, 5900);
      assert.strictEqual(proMonthly!.formattedPrice, '₹59');
    } finally {
      // Clean up V2
      await prisma.planPrice.delete({ where: { id: priceV2.id } });
    }
  });

  // ---------------------------------------------------------------------------
  // 10. GRANDFATHERING INTEGRITY
  // ---------------------------------------------------------------------------
  test('10. Price Grandfathering — Existing subscription retains contracted version 1 price', async () => {
    const activeSub = await BillingStateService.getActiveSubscription(usUserId);
    assert.ok(activeSub);
    assert.strictEqual(activeSub!.priceVersion, 1);
    assert.strictEqual(activeSub!.amountMinorUnits, 99); // $0.99
    assert.strictEqual(activeSub!.currency, CurrencyCode.USD);

    // Create V2 price in catalog for USD
    const proMonthlyPlan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
    assert.ok(proMonthlyPlan);

    const priceV2 = await prisma.planPrice.create({
      data: {
        planId: proMonthlyPlan!.id,
        currency: CurrencyCode.USD,
        amountMinorUnits: 199, // $1.99
        version: 2,
        isActive: true,
        effectiveFrom: new Date()
      }
    });

    try {
      // Public catalog reflects V2
      const usdCatalog = await PricingCatalogService.getRegionalCatalog(CurrencyCode.USD);
      const proMonthly = usdCatalog.find(p => p.code === 'PRO_MONTHLY');
      assert.strictEqual(proMonthly!.priceVersion, 2);
      assert.strictEqual(proMonthly!.amountMinorUnits, 199);

      // Existing subscription STILL retains V1 ($0.99)
      const subAfter = await BillingStateService.getActiveSubscription(usUserId);
      assert.ok(subAfter);
      assert.strictEqual(subAfter!.priceVersion, 1);
      assert.strictEqual(subAfter!.amountMinorUnits, 99);
      assert.strictEqual(subAfter!.planPriceId, activeSub!.planPriceId);
    } finally {
      await prisma.planPrice.delete({ where: { id: priceV2.id } });
    }
  });

  // ---------------------------------------------------------------------------
  // 11. NO SUBSCRIPTION MUTATION ON COUNTRY CHANGE
  // ---------------------------------------------------------------------------
  test('11. No Subscription Mutation — Inbound CF-IPCountry=IN does not mutate active USD subscription', async () => {
    // Make storefront request with IN header
    await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: {
        authorization: `Bearer ${usUserToken}`,
        'cf-ipcountry': 'IN'
      }
    });

    const sub = await BillingStateService.getActiveSubscription(usUserId);
    assert.ok(sub);
    assert.strictEqual(sub!.currency, CurrencyCode.USD);
    assert.strictEqual(sub!.amountMinorUnits, 99);
  });

  // ---------------------------------------------------------------------------
  // 12. NO BILLING COUNTRY MUTATION
  // ---------------------------------------------------------------------------
  test('12. No Billing Country Mutation — AccountBillingState.billingCountry is never altered by storefront IP', async () => {
    // Make storefront request with IN header
    await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: {
        authorization: `Bearer ${usUserToken}`,
        'cf-ipcountry': 'IN'
      }
    });

    const billingState = await BillingStateService.getBillingState(usUserId);
    assert.strictEqual(billingState.billingCountry, 'US');
    assert.strictEqual(billingState.currency, CurrencyCode.USD);
  });

  // ---------------------------------------------------------------------------
  // 13. ENTITLEMENT INTEGRITY
  // ---------------------------------------------------------------------------
  test('13. Entitlement Integrity — Pricing response reflects authoritative EntitlementService capabilities', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: { 'cf-ipcountry': 'IN' }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    const plans = body.data.plans;

    const free = plans.find((p: any) => p.code === 'FREE');
    assert.strictEqual(free.serverLimit, 1);
    assert.strictEqual(free.priorityRelay, false);
    assert.strictEqual(free.entitlements.maxServers, 1);
    assert.strictEqual(free.entitlements.priorityRelay, false);

    const proMonthly = plans.find((p: any) => p.code === 'PRO_MONTHLY');
    assert.strictEqual(proMonthly.serverLimit, 5);
    assert.strictEqual(proMonthly.priorityRelay, true);
    assert.strictEqual(proMonthly.entitlements.maxServers, 5);
    assert.strictEqual(proMonthly.entitlements.priorityRelay, true);
  });

  // ---------------------------------------------------------------------------
  // 14. IDOR & ACCOUNT ISOLATION
  // ---------------------------------------------------------------------------
  test('14. IDOR & Public Safety — Public catalog exposes no customer or provider secrets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: { 'cf-ipcountry': 'IN' }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.user, undefined);
    assert.strictEqual(body.data.subscription, undefined);
    assert.strictEqual(body.data.customer, undefined);

    for (const p of body.data.plans) {
      assert.strictEqual(p.userId, undefined);
      assert.strictEqual(p.secret, undefined);
      assert.strictEqual(p.razorpayKey, undefined);
    }
  });

  // ---------------------------------------------------------------------------
  // 15. CACHE ISOLATION HEADERS
  // ---------------------------------------------------------------------------
  test('15. Cache Isolation — GET /api/v1/plans sets private, no-store and Vary: CF-IPCountry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: { 'cf-ipcountry': 'IN' }
    });

    assert.strictEqual(res.statusCode, 200);
    const cacheControl = res.headers['cache-control'];
    const vary = res.headers['vary'];

    assert.ok(cacheControl, 'Cache-Control must be set');
    assert.ok(cacheControl.includes('private'), 'Cache-Control must contain private');
    assert.ok(cacheControl.includes('no-store'), 'Cache-Control must contain no-store');

    assert.ok(vary, 'Vary must be set');
    assert.ok(vary.includes('CF-IPCountry'), 'Vary must contain CF-IPCountry');
  });
});
