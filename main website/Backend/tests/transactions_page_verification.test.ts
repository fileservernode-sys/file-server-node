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
    await prisma.session.create({
      data: {
        userId: user.id,
        sessionTokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    // Create 2 test payments and receipts
    const payment = await prisma.billingPayment.create({
      data: {
        userId: user.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        amountMinorUnits: 29900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.CAPTURED,
        chargedAt: new Date()
      }
    });

    await BillingReceiptService.createReceiptForPayment({
      paymentId: payment.id,
      planCode: 'pro',
      planName: 'Pro Plan',
      billingInterval: BillingInterval.MONTHLY
    });

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
    assert.strictEqual(Array.isArray(body.receipts), true);
    assert.strictEqual(body.receipts.length >= 1, true);
    assert.strictEqual(body.receipts[0].planName, 'Pro Plan');
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
    await prisma.session.create({
      data: {
        userId: userB.id,
        sessionTokenHash: hashSessionToken(tokenB),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    const paymentA = await prisma.billingPayment.create({
      data: {
        userId: userA.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        amountMinorUnits: 29900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.CAPTURED,
        chargedAt: new Date()
      }
    });

    const receiptA = await BillingReceiptService.createReceiptForPayment({
      paymentId: paymentA.id,
      planCode: 'pro',
      planName: 'Pro Plan',
      billingInterval: BillingInterval.MONTHLY
    });

    // User B tries to access user A's receipt
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/${receiptA.id}/download`,
      headers: {
        cookie: `zdex_session=${tokenB}`
      }
    });

    assert.strictEqual(res.statusCode, 404, 'Must return 404 Not Found for IDOR isolation');
  });
});
