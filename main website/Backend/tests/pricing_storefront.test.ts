import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { CurrencyCode, BillingStatus } from '@prisma/client';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';

describe('ZC-BILLING-2.4 Pricing Page & Regional Storefront Test Suite', () => {
  let app: FastifyInstance;
  let userIndia: any;
  let tokenIndia: string;
  let userUS: any;
  let tokenUS: string;
  let userUnconfirmed: any;
  let tokenUnconfirmed: string;

  before(async () => {
    app = await buildApp();
    await app.ready();
    await PlanService.seedInitialCatalog();

    // 1. Confirmed India User
    userIndia = await prisma.user.create({
      data: {
        email: `pricing.india.${Date.now()}@remotenode.io`,
        fullName: 'Pricing India User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    const sessionIndia = await prisma.userSession.create({
      data: {
        userId: userIndia.id,
        token: `tok_pricing_india_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    tokenIndia = sessionIndia.token;
    await BillingCountryService.confirmBillingCountry(userIndia.id, { country: 'IN', postalCode: '392001' });

    // 2. Confirmed US User
    userUS = await prisma.user.create({
      data: {
        email: `pricing.us.${Date.now()}@remotenode.io`,
        fullName: 'Pricing US User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    const sessionUS = await prisma.userSession.create({
      data: {
        userId: userUS.id,
        token: `tok_pricing_us_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    tokenUS = sessionUS.token;
    await BillingCountryService.confirmBillingCountry(userUS.id, { country: 'US', postalCode: '90210' });

    // 3. Unconfirmed User
    userUnconfirmed = await prisma.user.create({
      data: {
        email: `pricing.unconfirmed.${Date.now()}@remotenode.io`,
        fullName: 'Pricing Unconfirmed User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    const sessionUnconfirmed = await prisma.userSession.create({
      data: {
        userId: userUnconfirmed.id,
        token: `tok_pricing_unconfirmed_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    tokenUnconfirmed = sessionUnconfirmed.token;
  });

  after(async () => {
    if (userIndia) await prisma.user.delete({ where: { id: userIndia.id } }).catch(() => {});
    if (userUS) await prisma.user.delete({ where: { id: userUS.id } }).catch(() => {});
    if (userUnconfirmed) await prisma.user.delete({ where: { id: userUnconfirmed.id } }).catch(() => {});
    await app.close();
  });

  it('1. GET /api/v1/plans renders all 3 approved plans (FREE, PRO_MONTHLY, PRO_YEARLY)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans'
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.plans.length, 3);

    const codes = body.data.plans.map((p: any) => p.code);
    assert.ok(codes.includes('FREE'));
    assert.ok(codes.includes('PRO_MONTHLY'));
    assert.ok(codes.includes('PRO_YEARLY'));
  });

  it('2. Request with CF-IPCountry: IN resolves INR catalog with ₹0, ₹49, ₹500', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: {
        'cf-ipcountry': 'IN'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.currency, 'INR');

    const free = body.data.plans.find((p: any) => p.code === 'FREE');
    const monthly = body.data.plans.find((p: any) => p.code === 'PRO_MONTHLY');
    const yearly = body.data.plans.find((p: any) => p.code === 'PRO_YEARLY');

    assert.strictEqual(free.amountMinorUnits, 0);
    assert.strictEqual(free.formattedPrice, '₹0');
    assert.strictEqual(monthly.amountMinorUnits, 4900);
    assert.strictEqual(monthly.formattedPrice, '₹49');
    assert.strictEqual(yearly.amountMinorUnits, 50000);
    assert.strictEqual(yearly.formattedPrice, '₹500');
  });

  it('3. Request with CF-IPCountry: US resolves USD catalog with $0, $0.99, $9.99', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: {
        'cf-ipcountry': 'US'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.currency, 'USD');

    const free = body.data.plans.find((p: any) => p.code === 'FREE');
    const monthly = body.data.plans.find((p: any) => p.code === 'PRO_MONTHLY');
    const yearly = body.data.plans.find((p: any) => p.code === 'PRO_YEARLY');

    assert.strictEqual(free.amountMinorUnits, 0);
    assert.strictEqual(free.formattedPrice, '$0');
    assert.strictEqual(monthly.amountMinorUnits, 99);
    assert.strictEqual(monthly.formattedPrice, '$0.99');
    assert.strictEqual(yearly.amountMinorUnits, 999);
    assert.strictEqual(yearly.formattedPrice, '$9.99');
  });

  it('4. Zero FX conversion: INR and USD prices are distinct and not FX conversions', async () => {
    const resINR = await app.inject({ method: 'GET', url: '/api/v1/plans?currency=INR' });
    const resUSD = await app.inject({ method: 'GET', url: '/api/v1/plans?currency=USD' });

    const dataINR = JSON.parse(resINR.body).data;
    const dataUSD = JSON.parse(resUSD.body).data;

    const inrMonthly = dataINR.plans.find((p: any) => p.code === 'PRO_MONTHLY');
    const usdMonthly = dataUSD.plans.find((p: any) => p.code === 'PRO_MONTHLY');

    // ₹49 is 4900 minor units; $0.99 is 99 minor units
    assert.strictEqual(inrMonthly.amountMinorUnits, 4900);
    assert.strictEqual(usdMonthly.amountMinorUnits, 99);
    assert.notStrictEqual(inrMonthly.amountMinorUnits / 100, usdMonthly.amountMinorUnits / 100);
  });

  it('5. Integer minor-unit annual savings arithmetic', async () => {
    // INR Annual Savings: (4900 * 12) - 50000 = 58800 - 50000 = 8800 minor units = ₹88
    const inrMonthlyUnits = 4900;
    const inrYearlyUnits = 50000;
    const inrAnnualized = inrMonthlyUnits * 12;
    const inrSavings = inrAnnualized - inrYearlyUnits;
    assert.strictEqual(inrSavings, 8800);
    const inrSavingsPct = Math.round((inrSavings / inrAnnualized) * 100);
    assert.strictEqual(inrSavingsPct, 15);

    // USD Annual Savings: (99 * 12) - 999 = 1188 - 999 = 189 minor units = $1.89
    const usdMonthlyUnits = 99;
    const usdYearlyUnits = 999;
    const usdAnnualized = usdMonthlyUnits * 12;
    const usdSavings = usdAnnualized - usdYearlyUnits;
    assert.strictEqual(usdSavings, 189);
    const usdSavingsPct = Math.round((usdSavings / usdAnnualized) * 100);
    assert.strictEqual(usdSavingsPct, 16);
  });

  it('6. Unconfirmed user GET /api/v1/billing returns currency = null and countryConfirmed = false', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${tokenUnconfirmed}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.currency, null);
    assert.strictEqual(body.data.billingCountry, null);
    assert.strictEqual(body.data.countryConfirmed, false);
  });

  it('7. Confirmed India user GET /api/v1/billing returns currency = INR and countryConfirmed = true', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${tokenIndia}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.currency, 'INR');
    assert.strictEqual(body.data.billingCountry, 'IN');
    assert.strictEqual(body.data.countryConfirmed, true);
  });

  it('8. Confirmed US user GET /api/v1/billing returns currency = USD and countryConfirmed = true', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${tokenUS}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.currency, 'USD');
    assert.strictEqual(body.data.billingCountry, 'US');
    assert.strictEqual(body.data.countryConfirmed, true);
  });

  it('9. GET /api/v1/plans enforces anti-cache headers (private, no-store, Vary: CF-IPCountry)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans'
    });

    const cacheControl = res.headers['cache-control'];
    const vary = res.headers['vary'];
    assert.ok(cacheControl && cacheControl.includes('private') && cacheControl.includes('no-store'));
    assert.ok(vary && vary.includes('CF-IPCountry'));
  });

  it('10. Frontend pricing.html contains accessible toggle, dynamic IDs, and 8-question FAQ', () => {
    const pricingHtmlPath = path.resolve('..', 'Frontend', 'pages', 'pricing.html');
    assert.ok(fs.existsSync(pricingHtmlPath), 'pricing.html must exist');
    const html = fs.readFileSync(pricingHtmlPath, 'utf8');

    // Dynamic price binding IDs
    assert.ok(html.includes('id="price-free"'), 'Missing id="price-free"');
    assert.ok(html.includes('id="price-pro-monthly"'), 'Missing id="price-pro-monthly"');
    assert.ok(html.includes('id="price-pro-yearly"'), 'Missing id="price-pro-yearly"');

    // Accessible toggle
    assert.ok(html.includes('role="group"'), 'Missing toggle role="group"');
    assert.ok(html.includes('id="toggle-monthly"'), 'Missing id="toggle-monthly"');
    assert.ok(html.includes('id="toggle-yearly"'), 'Missing id="toggle-yearly"');
    assert.ok(html.includes('aria-pressed'), 'Missing aria-pressed attribute');

    // Regional banner
    assert.ok(html.includes('id="region-banner"'), 'Missing id="region-banner"');

    // Approved 8 FAQ questions
    assert.ok(html.includes('1. What is included in the Free tier?'), 'Missing FAQ 1');
    assert.ok(html.includes('2. How many servers can Pro run?'), 'Missing FAQ 2');
    assert.ok(html.includes('3. What is the difference between Monthly and Yearly?'), 'Missing FAQ 3');
    assert.ok(html.includes('4. How much do I save with Yearly?'), 'Missing FAQ 4');
    assert.ok(html.includes('5. Which currency will I be charged in?'), 'Missing FAQ 5');
    assert.ok(html.includes('6. Does changing my detected location change my billing country?'), 'Missing FAQ 6');
    assert.ok(html.includes('7. Can I cancel my Pro subscription?'), 'Missing FAQ 7');
    assert.ok(html.includes('8. What happens to my existing servers if Pro expires?'), 'Missing FAQ 8');

    // Controlled upgrade notice modal
    assert.ok(html.includes('id="checkout-notice-modal"'), 'Missing controlled notice modal');
  });
});
