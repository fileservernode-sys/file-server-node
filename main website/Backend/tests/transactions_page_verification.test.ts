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
  PaymentStatus,
  BillingReceiptStatus,
  BillingReceiptType
} from '@prisma/client';
import { BillingReceiptService } from '../src/services/billing/billing_receipt_service.js';

describe('ZC-BILLING-6.1 Transactions Page & Backend Verification Test Suite', () => {
  let app: FastifyInstance;

  function uniqueId(prefix = 'tx') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('TC-TX-01: transactions.html file exists and has zero em dashes', async () => {
    const filePath = path.resolve(__dirname, '../../Frontend/pages/transactions.html');
    assert.strictEqual(fs.existsSync(filePath), true, 'transactions.html must exist');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.strictEqual(content.includes('—'), false, 'transactions.html must contain 0 em dashes');
  });

  test('TC-TX-02: GET /api/v1/billing/receipts returns paginated customer transaction history', async () => {
    const user = await prisma.user.create({
      data: {
        email: `tx_user_${uniqueId()}@example.com`,
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

    const plan = await prisma.plan.findFirst({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });

    if (plan && plan.prices.length > 0) {
      const price = plan.prices[0];
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
          amountMinorUnits: 29900,
          currency: CurrencyCode.INR,
          status: PaymentStatus.SUCCESS,
          chargedAt: new Date()
        }
      });

      await BillingReceiptService.generateReceiptForPayment(payment.id);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/receipts?page=1&limit=10',
        headers: {
          cookie: `zdex_session=${token}`
        }
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
    }
  });

  test('TC-TX-03: IDOR safety - user cannot access another users receipt', async () => {
    const userA = await prisma.user.create({
      data: {
        email: `tx_usera_${uniqueId()}@example.com`,
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });
    const userB = await prisma.user.create({
      data: {
        email: `tx_userb_${uniqueId()}@example.com`,
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

    const plan = await prisma.plan.findFirst({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });

    if (plan && plan.prices.length > 0) {
      const price = plan.prices[0];
      const subA = await prisma.subscription.create({
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

      const paymentA = await prisma.billingPayment.create({
        data: {
          userId: userA.id,
          subscriptionId: subA.id,
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          amountMinorUnits: 29900,
          currency: CurrencyCode.INR,
          status: PaymentStatus.SUCCESS,
          chargedAt: new Date()
        }
      });

      const receiptResult = await BillingReceiptService.generateReceiptForPayment(paymentA.id);

      if (receiptResult.receipt) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/billing/receipts/${receiptResult.receipt.id}/download`,
          headers: {
            cookie: `zdex_session=${tokenB}`
          }
        });

        assert.strictEqual(res.statusCode, 404, 'Must return 404 Not Found for IDOR isolation');
      }
    }
  });
});
