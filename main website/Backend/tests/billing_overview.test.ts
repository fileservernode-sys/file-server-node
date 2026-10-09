import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import {
  BillingInterval,
  CurrencyCode,
  BillingStatus,
  PaymentProvider,
  PaymentEnvironment
} from '@prisma/client';

describe('ZC-BILLING-6.3 Billing Overview Test Suite', () => {
  let app: FastifyInstance;

  function uniqueId(prefix = 'bo') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async function getOrCreatePlanAndPrice() {
    let plan = await prisma.plan.findFirst({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    if (!plan) {
      plan = await prisma.plan.create({
        data: {
          code: 'PRO_MONTHLY',
          name: 'Pro Monthly Plan',
          description: 'Pro Monthly Tier'
        },
        include: { prices: true }
      });
    }
    let price = plan.prices?.[0];
    if (!price) {
      price = await prisma.planPrice.create({
        data: {
          planId: plan.id,
          currency: CurrencyCode.INR,
          amountMinorUnits: 29900,
          version: 1,
          isActive: true
        }
      });
    }
    return { plan, price };
  }

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('TC-BO-01: billing.html exists and contains exactly zero em dashes', async () => {
    const filePath = path.resolve(__dirname, '../../Frontend/pages/billing.html');
    assert.strictEqual(fs.existsSync(filePath), true, 'billing.html must exist');
    const content = fs.readFileSync(filePath, 'utf-8');
    const emDashMatches = content.match(/—/g) || [];
    assert.strictEqual(emDashMatches.length, 0, 'billing.html must contain 0 em dashes');
  });

  test('TC-BO-02: billing.html contains authoritative sections for plan overview, quick links, recent activity, and unified billing address', async () => {
    const filePath = path.resolve(__dirname, '../../Frontend/pages/billing.html');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Section 1: Plan overview & status
    assert.strictEqual(content.includes('plan-overview-content'), true, 'Must include plan overview content container');
    assert.strictEqual(content.includes('plan-title-display'), true, 'Must include plan title display element');
    assert.strictEqual(content.includes('plan-status-badge-container'), true, 'Must include plan status badge container');

    // Section 2: Quick Billing Destinations
    assert.strictEqual(content.includes('subscription.html'), true, 'Must link to subscription.html for plan management');
    assert.strictEqual(content.includes('transactions.html'), true, 'Must link to transactions.html for full history');
    assert.strictEqual(content.includes('pricing.html'), true, 'Must link to pricing.html catalog');

    // Section 3: Recent Activity
    assert.strictEqual(content.includes('billing-recent-activity-card'), true, 'Must include recent activity card');
    assert.strictEqual(content.includes('transaction-details.html'), true, 'Must link to transaction-details.html');

    // Section 4: Unified Billing Address Profile (consolidated address block)
    assert.strictEqual(content.includes('billing-profile-card'), true, 'Must include authoritative billing profile card');
    assert.strictEqual(content.includes('form-billing-profile'), true, 'Must include billing profile form');
    assert.strictEqual(content.includes('billing-country-select'), true, 'Must include billing country selector in address block');
    assert.strictEqual(content.includes('billing-postal-input'), true, 'Must include postal code input in address block');
    assert.strictEqual(content.includes('billing-region-card'), false, 'Redundant separate billing-region-card must be removed');

    // Section 5: Receipts history
    assert.strictEqual(content.includes('billing-history-section'), true, 'Must include billing receipts history section');
  });

  test('TC-BO-03: GET /api/v1/billing requires authentication (401 Unauthorized when unauthenticated)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing'
    });

    assert.strictEqual(res.statusCode, 401, 'Unauthenticated request must return 401 Unauthorized');
  });

  test('TC-BO-04: GET /api/v1/billing returns Free tier defaults when customer has no active subscription', async () => {
    const user = await prisma.user.create({
      data: {
        email: `free_user_${uniqueId()}@example.com`,
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });

    const token = `tok_${uniqueId()}`;
    await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    assert.strictEqual(res.statusCode, 200, 'Authenticated request must return 200 OK');
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.plan, 'FREE');
    assert.strictEqual(body.data.subscription, null);
    assert.ok(body.data.entitlements, 'Must return entitlements');
    assert.strictEqual(typeof body.data.entitlements.maxServers, 'number');
  });

  test('TC-BO-05: GET /api/v1/billing returns active subscription summary and entitlements for paying customer', async () => {
    const user = await prisma.user.create({
      data: {
        email: `pro_user_${uniqueId()}@example.com`,
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });

    const token = `tok_${uniqueId()}`;
    await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    const { plan, price } = await getOrCreatePlanAndPrice();

    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        planPriceId: price.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: `sub_${uniqueId('rzp')}`,
        providerPlanId: 'plan_rzp_pro_monthly',
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: 29900,
        priceVersion: price.version,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000)
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    assert.strictEqual(res.statusCode, 200, 'Authenticated request must return 200 OK');
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, BillingStatus.ACTIVE);
    assert.strictEqual(body.data.plan, 'PRO_MONTHLY');
    assert.ok(body.data.subscription, 'Subscription summary must be present');
    assert.strictEqual(body.data.subscription.id, sub.id);
    assert.strictEqual(body.data.subscription.planCode, 'PRO_MONTHLY');
    assert.strictEqual(body.data.subscription.status, BillingStatus.ACTIVE);
    assert.strictEqual(body.data.subscription.billingInterval, BillingInterval.MONTHLY);
    assert.strictEqual(body.data.subscription.amountMinorUnits, 29900);
  });

  test('TC-BO-06: IDOR isolation: Customer A querying GET /api/v1/billing cannot see Customer B subscription data', async () => {
    // User A (Free)
    const userA = await prisma.user.create({
      data: {
        email: `usera_${uniqueId()}@example.com`,
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });
    const tokenA = `tok_${uniqueId()}`;
    await prisma.userSession.create({
      data: {
        userId: userA.id,
        tokenHash: hashSessionToken(tokenA),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    // User B (Pro)
    const userB = await prisma.user.create({
      data: {
        email: `userb_${uniqueId()}@example.com`,
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });
    const tokenB = `tok_${uniqueId()}`;
    await prisma.userSession.create({
      data: {
        userId: userB.id,
        tokenHash: hashSessionToken(tokenB),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });
    const { plan, price } = await getOrCreatePlanAndPrice();
    const subB = await prisma.subscription.create({
      data: {
        userId: userB.id,
        planId: plan.id,
        planPriceId: price.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: `sub_${uniqueId('rzp')}`,
        providerPlanId: 'plan_rzp_pro_monthly',
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: 29900,
        priceVersion: price.version,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000)
      }
    });

    // User A fetches billing overview
    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const bodyA = JSON.parse(resA.body);
    assert.strictEqual(bodyA.data.subscription, null, 'User A must not receive User B subscription');
    assert.strictEqual(bodyA.data.plan, 'FREE');

    // User B fetches billing overview
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${tokenB}` }
    });
    const bodyB = JSON.parse(resB.body);
    assert.strictEqual(bodyB.data.subscription.id, subB.id, 'User B must only receive own subscription');
  });

  test('TC-BO-07: Provider preservation: active subscription references Razorpay provider without exposing secrets', async () => {
    const user = await prisma.user.create({
      data: {
        email: `rzp_pres_${uniqueId()}@example.com`,
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });
    const token = `tok_${uniqueId()}`;
    await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });
    const { plan, price } = await getOrCreatePlanAndPrice();
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        planPriceId: price.id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: `sub_${uniqueId('rzp')}`,
        providerPlanId: 'plan_rzp_pro_monthly',
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: 29900,
        priceVersion: price.version,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000)
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${token}` }
    });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.subscription.provider, undefined, 'Provider internal name/secrets must not leak');
    assert.strictEqual(body.data.subscription.providerSubscriptionId, undefined, 'Internal provider subscription ID must not leak');
  });
});
