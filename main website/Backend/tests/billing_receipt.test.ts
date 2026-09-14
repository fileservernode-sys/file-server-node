import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  BillingInterval,
  CurrencyCode,
  BillingStatus,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  RefundStatus,
  RefundReason,
  BillingReceiptStatus,
  BillingReceiptType,
  AuditEventType
} from '@prisma/client';
import { PlanService } from '../src/services/billing/plan_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { BillingReceiptService } from '../src/services/billing/billing_receipt_service.js';
import { BillingRefundService } from '../src/services/billing/billing_refund_service.js';

describe('ZC-BILLING-6.4 Billing Receipt Foundation Test Suite', () => {
  let app: FastifyInstance;
  let proMonthlyPlan: any;
  let proYearlyPlan: any;
  let proMonthlyInrPrice: any;
  let proYearlyInrPrice: any;
  let proMonthlyUsdPrice: any;
  let proYearlyUsdPrice: any;

  function uniqueId(prefix = 'test') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async function dbRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        if (i === retries - 1) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error('dbRetry exhausted');
  }

  async function createTestUserWithPayment(opts?: {
    planInterval?: BillingInterval;
    amountMinorUnits?: number;
    paymentStatus?: PaymentStatus;
    providerPaymentId?: string | null;
    chargeDaysAgo?: number;
    currency?: CurrencyCode;
    planChangeId?: string | null;
  }) {
    return await dbRetry(async () => {
      const email = `receipt_user_${uniqueId()}@example.com`;
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'Jane Doe',
          emailVerified: true
        }
      });

      const isYearly = opts?.planInterval === BillingInterval.YEARLY;
      const plan = isYearly ? proYearlyPlan : proMonthlyPlan;
      const isUsd = opts?.currency === CurrencyCode.USD;
      const price = isYearly
        ? (isUsd ? proYearlyUsdPrice : proYearlyInrPrice)
        : (isUsd ? proMonthlyUsdPrice : proMonthlyInrPrice);

      const currency = opts?.currency || CurrencyCode.INR;
      const amountMinorUnits = opts?.amountMinorUnits ?? price.amountMinorUnits;
      const now = new Date();
      const chargeDate = new Date(now.getTime() - (opts?.chargeDaysAgo ?? 1) * 86400 * 1000);

      const sub = await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          planPriceId: price.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: `sub_${uniqueId('rzp')}`,
          providerPlanId: isYearly ? 'plan_rzp_pro_yearly' : 'plan_rzp_pro_monthly',
          status: BillingStatus.ACTIVE,
          billingInterval: opts?.planInterval || BillingInterval.MONTHLY,
          currency,
          amountMinorUnits,
          priceVersion: price.version,
          currentPeriodStart: chargeDate,
          currentPeriodEnd: new Date(chargeDate.getTime() + (isYearly ? 365 : 30) * 86400 * 1000)
        }
      });

      await prisma.accountBillingState.create({
        data: {
          userId: user.id,
          status: BillingStatus.ACTIVE,
          activeSubscriptionId: sub.id,
          billingCountry: isUsd ? 'US' : 'IN',
          currency
        }
      });

      const providerPaymentId = opts?.providerPaymentId !== undefined ? opts.providerPaymentId : `pay_${uniqueId('rzp')}`;
      const payment = await prisma.billingPayment.create({
        data: {
          userId: user.id,
          subscriptionId: sub.id,
          planChangeId: opts?.planChangeId || null,
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          providerPaymentId,
          amountMinorUnits,
          currency,
          status: opts?.paymentStatus || PaymentStatus.SUCCESS,
          chargedAt: chargeDate
        }
      });

      const session = await prisma.userSession.create({
        data: {
          userId: user.id,
          token: `tok_${uniqueId()}`,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
        }
      });

      return { user, sub, payment, session, plan, price };
    });
  }

  before(async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await prisma.$connect();
        break;
      } catch (err: any) {
        if (attempt === 5) throw err;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    app = await buildApp();
    await app.ready();

    proMonthlyPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    proYearlyPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_YEARLY' },
      include: { prices: true }
    });

    if (!proMonthlyPlan || !proYearlyPlan) {
      await PlanService.seedInitialCatalog();
      await EntitlementService.seedInitialEntitlements();

      proMonthlyPlan = await prisma.plan.findUnique({
        where: { code: 'PRO_MONTHLY' },
        include: { prices: true }
      });
      proYearlyPlan = await prisma.plan.findUnique({
        where: { code: 'PRO_YEARLY' },
        include: { prices: true }
      });
    }

    proMonthlyInrPrice = proMonthlyPlan.prices.find((p: any) => p.currency === CurrencyCode.INR);
    proYearlyInrPrice = proYearlyPlan.prices.find((p: any) => p.currency === CurrencyCode.INR);
    proMonthlyUsdPrice = proMonthlyPlan.prices.find((p: any) => p.currency === CurrencyCode.USD);
    proYearlyUsdPrice = proYearlyPlan.prices.find((p: any) => p.currency === CurrencyCode.USD);
  });

  after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // 1. Successful initial payment creates one billing document
  test('1. Successful initial payment creates one billing document', async () => {
    const { user, payment, sub } = await createTestUserWithPayment({
      planInterval: BillingInterval.MONTHLY
    });

    const result = await BillingReceiptService.generateReceiptForPayment(payment.id);
    assert.strictEqual(result.success, true);
    assert.ok(result.receipt);
    assert.strictEqual(result.receipt.userId, user.id);
    assert.strictEqual(result.receipt.paymentId, payment.id);
    assert.strictEqual(result.receipt.subscriptionId, sub.id);
    assert.strictEqual(result.receipt.status, BillingReceiptStatus.ISSUED);
    assert.strictEqual(result.receipt.type, BillingReceiptType.SUBSCRIPTION_PURCHASE);
    assert.strictEqual(result.receipt.amountPaidMinorUnits, payment.amountMinorUnits);
    assert.strictEqual(result.receipt.currency, CurrencyCode.INR);
  });

  // 2. Successful renewal creates a separate billing document
  test('2. Successful renewal creates a separate billing document', async () => {
    const { user, sub, payment: firstPayment } = await createTestUserWithPayment({
      planInterval: BillingInterval.MONTHLY,
      chargeDaysAgo: 30
    });

    const firstReceipt = await BillingReceiptService.generateReceiptForPayment(firstPayment.id);

    // Second renewal charge
    const renewalPayment = await prisma.billingPayment.create({
      data: {
        userId: user.id,
        subscriptionId: sub.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_${uniqueId('rzp')}`,
        amountMinorUnits: sub.amountMinorUnits,
        currency: sub.currency,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });

    const renewalReceipt = await BillingReceiptService.generateReceiptForPayment(renewalPayment.id);

    assert.notStrictEqual(firstReceipt.receipt.id, renewalReceipt.receipt.id);
    assert.notStrictEqual(firstReceipt.receipt.receiptNumber, renewalReceipt.receipt.receiptNumber);
    assert.strictEqual(renewalReceipt.receipt.type, BillingReceiptType.SUBSCRIPTION_RENEWAL);
  });

  // 3. Historical plan price is preserved (Price Grandfathering)
  test('3. Historical plan price is preserved in billing document', async () => {
    const grandfatheredAmount = 3900; // 39 INR
    const { payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.MONTHLY,
      amountMinorUnits: grandfatheredAmount
    });

    const result = await BillingReceiptService.generateReceiptForPayment(payment.id);
    assert.strictEqual(result.receipt.amountPaidMinorUnits, 3900);
    assert.strictEqual(result.receipt.totalMinorUnits, 3900);
    assert.strictEqual(result.receipt.subtotalMinorUnits + result.receipt.taxMinorUnits, 3900);
  });

  // 4. INR document formats correctly
  test('4. INR document formats correctly', async () => {
    const inrFormatted = BillingReceiptService.formatAmount(4900, CurrencyCode.INR);
    assert.strictEqual(inrFormatted, '₹49.00');

    const inrYearly = BillingReceiptService.formatAmount(50000, CurrencyCode.INR);
    assert.strictEqual(inrYearly, '₹500.00');
  });

  // 5. USD document formats correctly
  test('5. USD document formats correctly', async () => {
    const usdFormatted = BillingReceiptService.formatAmount(99, CurrencyCode.USD);
    assert.strictEqual(usdFormatted, '$0.99');

    const usdYearly = BillingReceiptService.formatAmount(999, CurrencyCode.USD);
    assert.strictEqual(usdYearly, '$9.99');
  });

  // 6. Billing document has unique immutable number (ZCR-YYYYMM-XXXXXX)
  test('6. Billing document has unique immutable number matching format', async () => {
    const { payment } = await createTestUserWithPayment();
    const result = await BillingReceiptService.generateReceiptForPayment(payment.id);

    assert.match(result.receipt.receiptNumber, /^ZCR-\d{6}-[0-9A-F]{6}$/i);
  });

  // 7. Duplicate call returns existing document idempotently
  test('7. Duplicate call returns existing document idempotently without duplicates', async () => {
    const { payment } = await createTestUserWithPayment();

    const call1 = await BillingReceiptService.generateReceiptForPayment(payment.id);
    const call2 = await BillingReceiptService.generateReceiptForPayment(payment.id);

    assert.strictEqual(call1.receipt.id, call2.receipt.id);
    assert.strictEqual(call2.idempotent, true);

    const count = await prisma.billingReceipt.count({
      where: { paymentId: payment.id }
    });
    assert.strictEqual(count, 1);
  });

  // 8. Pending payment rejects receipt issuance
  test('8. Pending payment rejects receipt issuance (409 Conflict)', async () => {
    const { payment } = await createTestUserWithPayment({
      paymentStatus: PaymentStatus.PENDING
    });

    await assert.rejects(
      async () => {
        await BillingReceiptService.generateReceiptForPayment(payment.id);
      },
      (err: any) => err.statusCode === 409 && err.errorCode === 'PAYMENT_NOT_CAPTURED'
    );
  });

  // 9. Failed payment rejects receipt issuance
  test('9. Failed payment rejects receipt issuance (409 Conflict)', async () => {
    const { payment } = await createTestUserWithPayment({
      paymentStatus: PaymentStatus.FAILED
    });

    await assert.rejects(
      async () => {
        await BillingReceiptService.generateReceiptForPayment(payment.id);
      },
      (err: any) => err.statusCode === 409 && err.errorCode === 'PAYMENT_NOT_CAPTURED'
    );
  });

  // 10. Strict ownership enforcement (IDOR Protection: 403 Forbidden for another user)
  test('10. Another user cannot access customer receipt (403 Forbidden)', async () => {
    const { user: owner, payment } = await createTestUserWithPayment();
    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);

    const otherUser = await prisma.user.create({
      data: {
        email: `attacker_${uniqueId()}@example.com`,
        fullName: 'Attacker User',
        emailVerified: true
      }
    });

    await assert.rejects(
      async () => {
        await BillingReceiptService.getReceipt(otherUser.id, receipt.id);
      },
      (err: any) => err.statusCode === 403
    );
  });

  // 11. Admin can access any receipt
  test('11. Admin can access any receipt', async () => {
    const { payment } = await createTestUserWithPayment();
    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);

    const fetched = await BillingReceiptService.getReceipt('some_admin_id', receipt.id, { isAdmin: true });
    assert.strictEqual(fetched.id, receipt.id);
  });

  // 12. Original BillingPayment remains immutable after receipt generation
  test('12. Original BillingPayment remains immutable after receipt generation', async () => {
    const { payment } = await createTestUserWithPayment();
    await BillingReceiptService.generateReceiptForPayment(payment.id);

    const reloadedPayment = await prisma.billingPayment.findUnique({
      where: { id: payment.id }
    });

    assert.strictEqual(reloadedPayment?.amountMinorUnits, payment.amountMinorUnits);
    assert.strictEqual(reloadedPayment?.status, PaymentStatus.SUCCESS);
  });

  // 13. Refund remains linked to original payment/document without mutating original receipt amount
  test('13. Refund remains linked to original payment without mutating original receipt', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });

    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);

    // Issue refund
    await BillingRefundService.requestRefund(
      user.id,
      {
        paymentId: payment.id,
        reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
      },
      {
        client: {
          name: 'RAZORPAY',
          isConfigured: () => true,
          assertConfigured: () => ({ isConfigured: true, isComplete: true }),
          createRefund: async () => ({
            id: `rfnd_${uniqueId('rcpt_link')}`,
            entity: 'refund',
            amount: payment.amountMinorUnits,
            currency: 'INR',
            status: 'processed'
          })
        } as any
      }
    );

    const reloadedReceipt = await BillingReceiptService.getReceipt(user.id, receipt.id);
    assert.strictEqual(reloadedReceipt.amountPaidMinorUnits, payment.amountMinorUnits);
    assert.strictEqual(reloadedReceipt.payment.refunds.length, 1);
    assert.strictEqual(reloadedReceipt.payment.refunds[0].status, RefundStatus.PROCESSED);
  });

  // 14. Partial refund maintains exact net calculation in rendered HTML
  test('14. Partial refund renders net retained breakdown in HTML', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });

    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);
    const partialRefundAmount = 20000; // 200 INR

    await BillingRefundService.requestRefund(
      user.id,
      {
        paymentId: payment.id,
        amountMinorUnits: partialRefundAmount,
        reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
      },
      {
        client: {
          name: 'RAZORPAY',
          isConfigured: () => true,
          assertConfigured: () => ({ isConfigured: true, isComplete: true }),
          createRefund: async () => ({
            id: `rfnd_${uniqueId('partial_html')}`,
            entity: 'refund',
            amount: partialRefundAmount,
            currency: 'INR',
            status: 'processed'
          })
        } as any
      }
    );

    const receiptWithRefunds = await BillingReceiptService.getReceipt(user.id, receipt.id);
    const html = BillingReceiptService.renderReceiptHtml(receiptWithRefunds);

    assert.ok(html.includes('Refund Adjustments'));
    assert.ok(html.includes('-₹200.00'));
    assert.ok(html.includes('Net Retained Amount:'));
  });

  // 15. Upgrade charge creates upgrade receipt linking SubscriptionPlanChange
  test('15. Upgrade charge creates upgrade receipt with proration metadata', async () => {
    const { user, sub, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY
    });

    const planChange = await prisma.subscriptionPlanChange.create({
      data: {
        userId: user.id,
        subscriptionId: sub.id,
        fromPlanId: proMonthlyPlan.id,
        fromPlanPriceId: proMonthlyInrPrice.id,
        toPlanId: proYearlyPlan.id,
        toPlanPriceId: proYearlyInrPrice.id,
        fromAmountMinorUnits: 4900,
        toAmountMinorUnits: 50000,
        currency: CurrencyCode.INR,
        creditMinorUnits: 2500,
        netAmountMinorUnits: 47500,
        status: 'COMPLETED' as any
      }
    });

    await prisma.billingPayment.update({
      where: { id: payment.id },
      data: { planChangeId: planChange.id }
    });

    const result = await BillingReceiptService.generateReceiptForPayment(payment.id);
    assert.strictEqual(result.receipt.type, BillingReceiptType.SUBSCRIPTION_UPGRADE);
    assert.strictEqual(result.receipt.planChangeId, planChange.id);
    assert.ok((result.receipt.metadata as any)?.upgradeDetails);
  });

  // 16. Rendered HTML contains ZdexCloud branding and Razorpay provider attribution
  test('16. Rendered HTML contains ZdexCloud branding and Razorpay provider attribution', async () => {
    const { payment, user } = await createTestUserWithPayment();
    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);
    const fullReceipt = await BillingReceiptService.getReceipt(user.id, receipt.id);
    const html = BillingReceiptService.renderReceiptHtml(fullReceipt);

    // ZdexCloud Brand
    assert.ok(html.includes('ZdexCloud'));
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('Customer Billing Receipt'));

    // Razorpay Attribution
    assert.ok(html.includes('Payment Provider:'));
    assert.ok(html.includes('Razorpay'));

    // No sensitive data
    assert.strictEqual(html.includes('password'), false);
    assert.strictEqual(html.includes('cvv'), false);
    assert.strictEqual(html.includes('token'), false);
  });

  // 17. REST API: GET /api/v1/billing/receipts returns list
  test('17. REST API: GET /api/v1/billing/receipts returns list of receipts', async () => {
    const { user, session, payment } = await createTestUserWithPayment();
    await BillingReceiptService.generateReceiptForPayment(payment.id);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/receipts',
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.receipts));
    assert.strictEqual(body.data.receipts.length >= 1, true);
  });

  // 18. REST API: GET /api/v1/billing/receipts/:id returns receipt details
  test('18. REST API: GET /api/v1/billing/receipts/:id returns receipt details', async () => {
    const { user, session, payment } = await createTestUserWithPayment();
    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/${receipt.id}`,
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, receipt.id);
  });

  // 19. REST API: GET /api/v1/billing/receipts/:id/html returns rendered HTML
  test('19. REST API: GET /api/v1/billing/receipts/:id/html returns rendered HTML', async () => {
    const { user, session, payment } = await createTestUserWithPayment();
    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/${receipt.id}/html`,
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const contentType = String(response.headers['content-type'] || '');
    assert.ok(contentType.includes('text/html'));
    assert.ok(response.body.includes('<!DOCTYPE html>'));
    assert.ok(response.body.includes('ZdexCloud Customer Billing Receipt'));
  });

  // 20. REST API: GET /api/v1/billing/receipts/:id/download returns downloadable file
  test('20. REST API: GET /api/v1/billing/receipts/:id/download returns attachment header', async () => {
    const { user, session, payment } = await createTestUserWithPayment();
    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/receipts/${receipt.id}/download`,
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const disposition = String(response.headers['content-disposition'] || '');
    assert.ok(disposition.includes('attachment; filename='));
  });

  // 21. REST API: GET /api/v1/billing/payments/:id/receipt returns receipt by payment ID
  test('21. REST API: GET /api/v1/billing/payments/:id/receipt returns receipt', async () => {
    const { user, session, payment } = await createTestUserWithPayment();
    const { receipt } = await BillingReceiptService.generateReceiptForPayment(payment.id);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/payments/${payment.id}/receipt`,
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, receipt.id);
  });
});
