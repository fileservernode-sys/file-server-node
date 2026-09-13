import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { CountryDetectionService } from '../src/services/billing/country_detection_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStatus, CurrencyCode } from '@prisma/client';

describe('ZC-BILLING-2.1 Country Detection & Storefront Geolocation Test Suite', () => {
  let app: FastifyInstance;
  const testEmailAuth = `country.test.auth.${Date.now()}@zdexcloud.com`;
  const testEmailUs = `country.test.us.${Date.now()}@zdexcloud.com`;
  let authUserId = '';
  let authUserToken = '';
  let usUserId = '';
  let usUserToken = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Ensure catalog is seeded
    await PlanService.seedInitialCatalog();

    // Create test user 1 (Fresh user)
    const user1 = await prisma.user.create({
      data: {
        email: testEmailAuth,
        passwordHash: 'test-hash',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    authUserId = user1.id;

    const session1 = await prisma.userSession.create({
      data: {
        userId: user1.id,
        token: `tok_country_auth_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    authUserToken = session1.token;

    // Create test user 2 with confirmed billing country US
    const user2 = await prisma.user.create({
      data: {
        email: testEmailUs,
        passwordHash: 'test-hash',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    usUserId = user2.id;

    const session2 = await prisma.userSession.create({
      data: {
        userId: user2.id,
        token: `tok_country_us_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    usUserToken = session2.token;

    await prisma.accountBillingState.create({
      data: {
        userId: user2.id,
        status: BillingStatus.FREE,
        billingCountry: 'US',
        currency: CurrencyCode.USD
      }
    });
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: { email: { in: [testEmailAuth, testEmailUs] } }
      });
    } catch {}
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. INDIA DETECTION
  // ---------------------------------------------------------------------------
  test('1. India Detection — CF-IPCountry=IN resolves to countryCode=IN and currency=INR', async () => {
    const res = CountryDetectionService.detect({ 'cf-ipcountry': 'IN' });
    assert.strictEqual(res.countryCode, 'IN');
    assert.strictEqual(res.countrySource, 'CLOUDFLARE');
    assert.strictEqual(res.confidence, 'IP_ESTIMATE');
    assert.strictEqual(res.currency, 'INR');
    assert.strictEqual(res.countryConfirmed, false);
  });

  // ---------------------------------------------------------------------------
  // 2. LOWERCASE INDIA NORMALIZATION
  // ---------------------------------------------------------------------------
  test('2. Lowercase India — CF-IPCountry=in is normalized to IN and currency=INR', async () => {
    const res = CountryDetectionService.detect({ 'cf-ipcountry': 'in' });
    assert.strictEqual(res.countryCode, 'IN');
    assert.strictEqual(res.currency, 'INR');
    assert.strictEqual(res.countryConfirmed, false);
  });

  // ---------------------------------------------------------------------------
  // 3. UNITED STATES DETECTION
  // ---------------------------------------------------------------------------
  test('3. United States — CF-IPCountry=US resolves to countryCode=US and currency=USD', async () => {
    const res = CountryDetectionService.detect({ 'cf-ipcountry': 'US' });
    assert.strictEqual(res.countryCode, 'US');
    assert.strictEqual(res.countrySource, 'CLOUDFLARE');
    assert.strictEqual(res.currency, 'USD');
    assert.strictEqual(res.countryConfirmed, false);
  });

  // ---------------------------------------------------------------------------
  // 4. INTERNATIONAL (GERMANY, UK, JAPAN, ETC.)
  // ---------------------------------------------------------------------------
  test('4. International Non-IN Countries — Resolve to valid countryCode and currency=USD', async () => {
    const countries = ['DE', 'GB', 'FR', 'JP', 'SG', 'AU', 'CA', 'AE'];
    for (const code of countries) {
      const res = CountryDetectionService.detect({ 'cf-ipcountry': code });
      assert.strictEqual(res.countryCode, code);
      assert.strictEqual(res.currency, 'USD');
      assert.strictEqual(res.countryConfirmed, false);
    }
  });

  // ---------------------------------------------------------------------------
  // 5. MISSING HEADER
  // ---------------------------------------------------------------------------
  test('5. Missing Header — No CF-IPCountry resolves to countryCode=null, source=UNKNOWN, currency=USD', async () => {
    const res = CountryDetectionService.detect({});
    assert.strictEqual(res.countryCode, null);
    assert.strictEqual(res.countrySource, 'UNKNOWN');
    assert.strictEqual(res.confidence, 'UNKNOWN');
    assert.strictEqual(res.currency, 'USD');
    assert.strictEqual(res.countryConfirmed, false);
  });

  // ---------------------------------------------------------------------------
  // 6. CLOUDFLARE SPECIAL CODE XX
  // ---------------------------------------------------------------------------
  test('6. Cloudflare Unknown (XX) — Mapped to UNKNOWN and safe USD default', async () => {
    const res = CountryDetectionService.detect({ 'cf-ipcountry': 'XX' });
    assert.strictEqual(res.countryCode, null);
    assert.strictEqual(res.countrySource, 'UNKNOWN');
    assert.strictEqual(res.confidence, 'UNKNOWN');
    assert.strictEqual(res.currency, 'USD');
  });

  // ---------------------------------------------------------------------------
  // 7. TOR NETWORK CODE T1
  // ---------------------------------------------------------------------------
  test('7. Tor Network (T1) — Mapped to UNKNOWN and safe USD default', async () => {
    const res = CountryDetectionService.detect({ 'cf-ipcountry': 'T1' });
    assert.strictEqual(res.countryCode, null);
    assert.strictEqual(res.countrySource, 'UNKNOWN');
    assert.strictEqual(res.currency, 'USD');
  });

  // ---------------------------------------------------------------------------
  // 8. MALFORMED / INVALID VALUES
  // ---------------------------------------------------------------------------
  test('8. Malformed Country Values — Rejected as UNKNOWN', async () => {
    const invalidValues = ['INDIA', 'IND', 'USA', 'U.S.', '123', 'IN1', 'I', 'TOOLONG'];
    for (const val of invalidValues) {
      const res = CountryDetectionService.detect({ 'cf-ipcountry': val });
      assert.strictEqual(res.countryCode, null, `Expected null for ${val}`);
      assert.strictEqual(res.countrySource, 'UNKNOWN');
      assert.strictEqual(res.currency, 'USD');
    }
  });

  // ---------------------------------------------------------------------------
  // 9. HEADER SPOOF & CLIENT MANIPULATION DEFENSE
  // ---------------------------------------------------------------------------
  test('9. Header Case-Insensitive Extraction & Array Support', async () => {
    const resUpper = CountryDetectionService.detect({ 'CF-IPCountry': 'IN' });
    assert.strictEqual(resUpper.countryCode, 'IN');
    assert.strictEqual(resUpper.currency, 'INR');

    const resArray = CountryDetectionService.detect({ 'cf-ipcountry': ['US', 'IN'] });
    assert.strictEqual(resArray.countryCode, 'US');
    assert.strictEqual(resArray.currency, 'USD');
  });

  // ---------------------------------------------------------------------------
  // 10. AUTHENTICATED USER — NO PROFILE MUTATION
  // ---------------------------------------------------------------------------
  test('10. Authenticated Request — Storefront detection does not mutate user profile or billing state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region',
      headers: {
        authorization: `Bearer ${authUserToken}`,
        'cf-ipcountry': 'IN'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.countryCode, 'IN');
    assert.strictEqual(body.data.currency, 'INR');

    // Verify user profile is unmutated
    const billingState = await BillingStateService.getBillingState(authUserId);
    assert.strictEqual(billingState.billingCountry, null); // Still not set
    assert.strictEqual(billingState.status, BillingStatus.FREE);
  });

  // ---------------------------------------------------------------------------
  // 11. EXISTING BILLING COUNTRY PRESERVATION
  // ---------------------------------------------------------------------------
  test('11. Existing Confirmed Billing Country — Inbound IN header preserves confirmed US billingCountry', async () => {
    // User has confirmed US billing country in DB
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region',
      headers: {
        authorization: `Bearer ${usUserToken}`,
        'cf-ipcountry': 'IN' // User traveling to India
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    // Storefront hint returns IN for initial display
    assert.strictEqual(body.data.countryCode, 'IN');
    assert.strictEqual(body.data.currency, 'INR');

    // But DB authoritative billing country MUST remain US
    const dbState = await prisma.accountBillingState.findUnique({
      where: { userId: usUserId }
    });
    assert.strictEqual(dbState!.billingCountry, 'US');
    assert.strictEqual(dbState!.currency, CurrencyCode.USD);
  });

  // ---------------------------------------------------------------------------
  // 12. PRICING CATALOG INTEGRITY
  // ---------------------------------------------------------------------------
  test('12. Pricing Catalog Integrity — PlanPrice catalog remains authoritative and unmutated', async () => {
    const inrMonthly = await prisma.planPrice.findFirst({
      where: { plan: { code: 'PRO_MONTHLY' }, currency: CurrencyCode.INR }
    });
    assert.ok(inrMonthly);
    assert.strictEqual(inrMonthly!.amountMinorUnits, 4900);

    const usdMonthly = await prisma.planPrice.findFirst({
      where: { plan: { code: 'PRO_MONTHLY' }, currency: CurrencyCode.USD }
    });
    assert.ok(usdMonthly);
    assert.strictEqual(usdMonthly!.amountMinorUnits, 99);

    const inrYearly = await prisma.planPrice.findFirst({
      where: { plan: { code: 'PRO_YEARLY' }, currency: CurrencyCode.INR }
    });
    assert.ok(inrYearly);
    assert.strictEqual(inrYearly!.amountMinorUnits, 50000);

    const usdYearly = await prisma.planPrice.findFirst({
      where: { plan: { code: 'PRO_YEARLY' }, currency: CurrencyCode.USD }
    });
    assert.ok(usdYearly);
    assert.strictEqual(usdYearly!.amountMinorUnits, 999);
  });

  // ---------------------------------------------------------------------------
  // 13. REST ENDPOINT /api/v1/storefront/region BEHAVIOR
  // ---------------------------------------------------------------------------
  test('13. Storefront Region Endpoint — Anonymous requests return structured region data', async () => {
    // 13a. Anonymous India request
    const resIn = await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region',
      headers: { 'cf-ipcountry': 'IN' }
    });
    assert.strictEqual(resIn.statusCode, 200);
    const bodyIn = JSON.parse(resIn.payload);
    assert.strictEqual(bodyIn.success, true);
    assert.deepStrictEqual(bodyIn.data, {
      countryCode: 'IN',
      countrySource: 'CLOUDFLARE',
      currency: 'INR',
      countryConfirmed: false
    });

    // 13b. Anonymous US request
    const resUs = await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region',
      headers: { 'cf-ipcountry': 'US' }
    });
    assert.strictEqual(resUs.statusCode, 200);
    const bodyUs = JSON.parse(resUs.payload);
    assert.strictEqual(bodyUs.success, true);
    assert.deepStrictEqual(bodyUs.data, {
      countryCode: 'US',
      countrySource: 'CLOUDFLARE',
      currency: 'USD',
      countryConfirmed: false
    });

    // 13c. Anonymous Missing header request
    const resNone = await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region'
    });
    assert.strictEqual(resNone.statusCode, 200);
    const bodyNone = JSON.parse(resNone.payload);
    assert.strictEqual(bodyNone.success, true);
    assert.deepStrictEqual(bodyNone.data, {
      countryCode: null,
      countrySource: 'UNKNOWN',
      currency: 'USD',
      countryConfirmed: false
    });
  });

  // ---------------------------------------------------------------------------
  // 14. ANTI-CACHE HEADERS & VARY VERIFICATION
  // ---------------------------------------------------------------------------
  test('14. Cache Safety — Endpoint sets private, no-store and Vary: CF-IPCountry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region',
      headers: { 'cf-ipcountry': 'IN' }
    });
    assert.strictEqual(res.statusCode, 200);
    const cacheControl = res.headers['cache-control'];
    const vary = res.headers['vary'];

    assert.ok(cacheControl, 'Cache-Control header must be set');
    assert.ok(cacheControl.includes('private'), 'Cache-Control must contain private');
    assert.ok(cacheControl.includes('no-store'), 'Cache-Control must contain no-store');

    assert.ok(vary, 'Vary header must be set');
    assert.ok(vary.includes('CF-IPCountry'), 'Vary must contain CF-IPCountry');
  });

  // ---------------------------------------------------------------------------
  // 15. NO BILLING AUTHORITY
  // ---------------------------------------------------------------------------
  test('15. No Billing Authority — Country detection cannot activate subscriptions or grant entitlements', async () => {
    // Send request with CF-IPCountry=IN for free user
    await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region',
      headers: {
        authorization: `Bearer ${authUserToken}`,
        'cf-ipcountry': 'IN'
      }
    });

    // Verify user's billing state remains FREE with default limits (1 server)
    const effectivePlan = await BillingStateService.getEffectivePlan(authUserId);
    assert.strictEqual(effectivePlan.planCode, 'FREE');
    assert.strictEqual(effectivePlan.status, BillingStatus.FREE);
    assert.strictEqual(effectivePlan.subscription, null);
  });
});
