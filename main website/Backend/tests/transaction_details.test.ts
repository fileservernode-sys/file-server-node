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
  PaymentEnvironment,
  PaymentStatus
} from '@prisma/client';
import { BillingReceiptService } from '../src/services/billing/billing_receipt_service.js';

describe('ZC-BILLING-6.2 Transaction Details & IDOR Security Test Suite', () => {
  let app: FastifyInstance;

  function uniqueId(prefix = 'txd') {
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

  test('TC-TXD-01: transaction-details.html exists and has zero em dashes', async () => {
    const filePath = path.resolve(__dirname, '../../Frontend/pages/transaction-details.html');
    assert.strictEqual(fs.existsSync(filePath), true, 'transaction-details.html must exist');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.strictEqual(content.includes('—'), false, 'transaction-details.html must contain 0 em dashes');
  });

  test('TC-TXD-02: transactions.html links to transaction-details.html and has zero em dashes', async () => {
    const filePath = path.resolve(__dirname, '../../Frontend/pages/transactions.html');
    assert.strictEqual(fs.existsSync(filePath), true, 'transactions.html must exist');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.strictEqual(content.includes('—'), false, 'transactions.html must contain 0 em dashes');
    assert.strictEqual(content.includes('transaction-details.html'), true, 'transactions.html must link to transaction-details.html');
  });

  test('TC-TXD-03: GET /api/v1/billing/receipts/:id returns transaction details by receipt ID', async () => {
    const user = await prisma.user.create({
      data: {
        email: `txd_user_${uniqueId()}@example.com`,
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

    const payment = await prisma.billingPayment.create({
      data: {
        userId: user.id,
        subscriptionId: sub.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_${uniqueId()}`,
        amountMinorUnits: 29900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });

    const receiptResult = await BillingReceiptService.generateReceiptForPayment(payment.id);
    assert.strictEqual(receiptResult.success, true);
    const receipt = receiptResult.receipt;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/${receipt.id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, receipt.id);
    assert.strictEqual(body.data.receiptNumber, receipt.receiptNumber);
    assert.strictEqual(body.data.amountPaidMinorUnits, 29900);
    assert.strictEqual(body.data.currency, CurrencyCode.INR);
    assert.strictEqual(body.data.payment.providerPaymentId, payment.providerPaymentId);
  });

  test('TC-TXD-04: GET /api/v1/billing/receipts/:id supports resolution by receiptNumber and paymentId', async () => {
    const user = await prisma.user.create({
      data: {
        email: `txd_user_${uniqueId()}@example.com`,
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

    const payment = await prisma.billingPayment.create({
      data: {
        userId: user.id,
        subscriptionId: sub.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_${uniqueId()}`,
        amountMinorUnits: 29900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });

    const receiptResult = await BillingReceiptService.generateReceiptForPayment(payment.id);
    const receipt = receiptResult.receipt;

    // Lookup by receiptNumber
    const resByNumber = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/${receipt.receiptNumber}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.strictEqual(resByNumber.statusCode, 200);
    const bodyByNumber = JSON.parse(resByNumber.body);
    assert.strictEqual(bodyByNumber.data.id, receipt.id);

    // Lookup by paymentId
    const resByPayment = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/${payment.id}`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.strictEqual(resByPayment.statusCode, 200);
    const bodyByPayment = JSON.parse(resByPayment.body);
    assert.strictEqual(bodyByPayment.data.id, receipt.id);
  });

  test('TC-TXD-05: IDOR Protection — User A cannot retrieve User B transaction details', async () => {
    // User A (Owner)
    const userA = await prisma.user.create({
      data: {
        email: `txd_usera_${uniqueId()}@example.com`,
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });

    // User B (Attacker)
    const userB = await prisma.user.create({
      data: {
        email: `txd_userb_${uniqueId()}@example.com`,
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });

    const tokenB = `tok_b_${uniqueId()}`;
    await prisma.userSession.create({
      data: {
        userId: userB.id,
        tokenHash: hashSessionToken(tokenB),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    const { plan, price } = await getOrCreatePlanAndPrice();

    const sub = await prisma.subscription.create({
      data: {
        userId: userA.id,
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

    const payment = await prisma.billingPayment.create({
      data: {
        userId: userA.id,
        subscriptionId: sub.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_${uniqueId()}`,
        amountMinorUnits: 29900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });

    const receiptResult = await BillingReceiptService.generateReceiptForPayment(payment.id);
    const receipt = receiptResult.receipt;

    // Attacker User B attempts to access User A's transaction
    const unauthorizedResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/${receipt.id}`,
      headers: {
        authorization: `Bearer ${tokenB}`
      }
    });

    assert.strictEqual(unauthorizedResponse.statusCode, 403);
    const errBody = JSON.parse(unauthorizedResponse.body);
    assert.strictEqual(errBody.success, false);
  });

  test('TC-TXD-06: Unauthenticated access returns 401 Unauthorized', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/non_existent_tx_id`
    });

    assert.strictEqual(response.statusCode, 401);
  });

  test('TC-TXD-07: Non-existent transaction returns 404 Not Found for authenticated user', async () => {
    const user = await prisma.user.create({
      data: {
        email: `txd_user_${uniqueId()}@example.com`,
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

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/non_existent_rec_999999`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    assert.strictEqual(response.statusCode, 404);
  });
});
