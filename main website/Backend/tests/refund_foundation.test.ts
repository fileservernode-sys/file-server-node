import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { BillingRefundService } from '../src/services/billing/billing_refund_service.js';
import { RazorpayWebhookService } from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';
import { RazorpayClient } from '../src/services/billing/providers/razorpay/razorpay_client.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval,
  PaymentStatus,
  RefundStatus,
  RefundReason,
  AuditEventType,
  WebhookEventStatus
} from '@prisma/client';
import { config } from '../src/config/env.js';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('ZC-BILLING-6.3 Refund Foundation Test Suite', () => {
  let app: FastifyInstance;
  let proMonthlyPlan: any;
  let proYearlyPlan: any;
  let proMonthlyInrPrice: any;
  let proYearlyInrPrice: any;
  let originalFetch: typeof global.fetch;
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_refund_6_3_1234567890';

  let idCounter = 0;
  function uniqueId(prefix = 'id'): string {
    idCounter += 1;
    return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).substring(2, 7)}`;
  }

  function computeSignature(payload: string | Buffer, secret: string = mockWebhookSecret): string {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  function createMockRazorpayClient(opts?: {
    shouldFail?: boolean;
    isTimeout?: boolean;
    errorMessage?: string;
    refundStatus?: string;
    refundId?: string;
  }) {
    return {
      name: 'RAZORPAY',
      isConfigured: () => true,
      assertConfigured: () => ({
        keyId: 'rzp_test_key_123',
        keySecret: 'rzp_test_secret_456',
        webhookSecret: mockWebhookSecret,
        baseUrl: 'https://api.razorpay.com/v1',
        timeoutMs: 10000,
        isConfigured: true,
        isComplete: true
      }),
      createRefund: async (paymentId: string, params: any, reqOpts?: any) => {
        if (opts?.isTimeout) {
          const timeoutErr: any = new Error('Razorpay API request timed out after 10000ms');
          timeoutErr.code = 'TIMEOUT_ERROR';
          timeoutErr.name = 'AbortError';
          throw timeoutErr;
        }
        if (opts?.shouldFail) {
          throw new Error(opts.errorMessage || 'Razorpay refund failed');
        }
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          id: opts?.refundId || `rfnd_${uniqueId('rzp')}`,
          entity: 'refund',
          amount: params.amount,
          currency: 'INR',
          payment_id: paymentId,
          status: opts?.refundStatus || 'processed',
          created_at: nowSec,
          notes: params.notes || {}
        };
      },
      fetchRefund: async (refundId: string) => {
        return {
          id: refundId,
          entity: 'refund',
          amount: 50000,
          currency: 'INR',
          payment_id: 'pay_rzp_mock',
          status: 'processed'
        };
      }
    } as unknown as RazorpayClient;
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
  }) {
    return await dbRetry(async () => {
      const email = `user_${uniqueId()}@example.com`;
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'Refund Test User',
          emailVerified: true
        }
      });

      const isYearly = opts?.planInterval === BillingInterval.YEARLY;
      const plan = isYearly ? proYearlyPlan : proMonthlyPlan;
      const price = isYearly ? proYearlyInrPrice : proMonthlyInrPrice;
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
          providerPlanId: isYearly ? 'plan_rzp_pro_yearly_inr' : 'plan_rzp_pro_monthly_inr',
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
          billingCountry: 'IN',
          currency
        }
      });

      const providerPaymentId = opts?.providerPaymentId !== undefined ? opts.providerPaymentId : `pay_${uniqueId('rzp')}`;
      const payment = await prisma.billingPayment.create({
        data: {
          userId: user.id,
          subscriptionId: sub.id,
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
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key_123';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_456';
    process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
    config.RAZORPAY_KEY_ID = 'rzp_test_key_123';
    config.RAZORPAY_KEY_SECRET = 'rzp_test_secret_456';
    config.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;

    originalFetch = global.fetch;
    global.fetch = (async (url: any, init?: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('/payments/') && urlStr.includes('/refund')) {
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({
            id: 'rfnd_rzp_mock_global',
            entity: 'refund',
            amount: 50000,
            currency: 'INR',
            payment_id: 'pay_rzp_mock_global',
            status: 'processed',
            created_at: nowSec
          }),
          json: async () => ({
            id: 'rfnd_rzp_mock_global',
            entity: 'refund',
            amount: 50000,
            currency: 'INR',
            payment_id: 'pay_rzp_mock_global',
            status: 'processed',
            created_at: nowSec
          })
        };
      }
      if (originalFetch) {
        return originalFetch(url, init);
      }
      throw new Error(`Unhandled fetch in test: ${urlStr}`);
    }) as any;

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
  });

  after(async () => {
    if (originalFetch) {
      global.fetch = originalFetch;
    }
    await app.close();
    await prisma.$disconnect();
  });

  // 1. Full refund eligibility accepted
  test('1. Full refund eligibility accepted for valid payment', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 5
    });

    const result = await BillingRefundService.validateRefundEligibility(user.id, payment.id);
    assert.strictEqual(result.isFullRefund, true);
    assert.strictEqual(result.requestedAmountMinorUnits, payment.amountMinorUnits);
    assert.strictEqual(result.refundableAmountMinorUnits, payment.amountMinorUnits);
  });

  // 2. Partial refund eligibility accepted where policy permits
  test('2. Partial refund eligibility accepted where policy permits', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 5
    });

    const partialAmount = Math.floor(payment.amountMinorUnits / 2);
    const result = await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
      amountMinorUnits: partialAmount
    });
    assert.strictEqual(result.isFullRefund, false);
    assert.strictEqual(result.requestedAmountMinorUnits, partialAmount);
    assert.strictEqual(result.refundableAmountMinorUnits, payment.amountMinorUnits);
  });

  // 3. Monthly normal refund rejected after cycle start
  test('3. Monthly normal refund rejected after cycle start (409 Conflict)', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.MONTHLY,
      chargeDaysAgo: 3
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
          reason: 'ANNUAL_WITHIN_REFUND_WINDOW' as any
        });
      },
      (err: any) => err.statusCode === 409 && err.errorCode === 'MONTHLY_NON_REFUNDABLE'
    );
  });

  // 4. Annual refund inside 14-day window eligible
  test('4. Annual refund inside 14-day window eligible', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 10
    });

    const result = await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
      reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
    });
    assert.strictEqual(result.requestedAmountMinorUnits, payment.amountMinorUnits);
  });

  // 5. Annual refund outside 14-day window rejected
  test('5. Annual refund outside 14-day window rejected (409 Conflict)', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 15
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
          reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
        });
      },
      (err: any) => err.statusCode === 409 && err.errorCode === 'ANNUAL_REFUND_WINDOW_EXPIRED'
    );
  });

  // 6. Duplicate payment refund accepted
  test('6. Duplicate payment refund accepted under exception policy', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.MONTHLY,
      chargeDaysAgo: 20
    });

    const result = await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
      reason: RefundReason.DUPLICATE_PAYMENT
    });
    assert.strictEqual(result.requestedAmountMinorUnits, payment.amountMinorUnits);
  });

  // 7. Erroneous payment refund accepted
  test('7. Erroneous payment refund accepted under exception policy', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.MONTHLY,
      chargeDaysAgo: 25
    });

    const result = await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
      reason: RefundReason.ERRONEOUS_PAYMENT
    });
    assert.strictEqual(result.requestedAmountMinorUnits, payment.amountMinorUnits);
  });

  // 8. Technical service failure refund path accepted where policy allows
  test('8. Technical service failure refund path accepted where policy allows', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.MONTHLY,
      chargeDaysAgo: 18
    });

    const result = await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
      reason: RefundReason.TECHNICAL_SERVICE_FAILURE
    });
    assert.strictEqual(result.requestedAmountMinorUnits, payment.amountMinorUnits);
  });

  // 9. Invalid payment rejected (not found)
  test('9. Invalid payment rejected (404 Not Found)', async () => {
    const { user } = await createTestUserWithPayment();

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, 'non_existent_payment_id');
      },
      (err: any) => err.statusCode === 404
    );
  });

  // 10. Payment belonging to another user rejected
  test('10. Payment belonging to another user rejected (403 Forbidden)', async () => {
    const { payment } = await createTestUserWithPayment();
    const otherUser = await prisma.user.create({
      data: { email: `other_${uniqueId()}@example.com`, fullName: 'Other User', emailVerified: true }
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(otherUser.id, payment.id);
      },
      (err: any) => err.statusCode === 403
    );
  });

  // 11. Uncaptured payment rejected
  test('11. Uncaptured / Failed payment rejected (409 Conflict)', async () => {
    const { user, payment } = await createTestUserWithPayment({
      paymentStatus: PaymentStatus.FAILED
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, payment.id);
      },
      (err: any) => err.statusCode === 409
    );
  });

  // 12. Already fully refunded payment rejected
  test('12. Already fully refunded payment rejected (409 Conflict)', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });

    await prisma.billingRefund.create({
      data: {
        userId: user.id,
        subscriptionId: payment.subscriptionId,
        paymentId: payment.id,
        amountMinorUnits: payment.amountMinorUnits,
        currency: payment.currency,
        status: RefundStatus.PROCESSED,
        idempotencyKey: `idem_test_fully_${uniqueId()}`,
        requestedBy: user.id
      }
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, payment.id);
      },
      (err: any) => err.statusCode === 409 && err.errorCode === 'PAYMENT_ALREADY_REFUNDED'
    );
  });

  // 13. Refund amount > refundable amount rejected
  test('13. Refund amount > refundable amount rejected (409 Conflict)', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
          amountMinorUnits: payment.amountMinorUnits + 5000
        });
      },
      (err: any) => err.statusCode === 409 && err.errorCode === 'REFUND_AMOUNT_EXCEEDS_REFUNDABLE'
    );
  });

  // 14. Negative amount rejected
  test('14. Negative amount rejected (400 Bad Request)', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
          amountMinorUnits: -500
        });
      },
      (err: any) => err.statusCode === 400
    );
  });

  // 15. Zero amount rejected
  test('15. Zero amount rejected (400 Bad Request)', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
          amountMinorUnits: 0
        });
      },
      (err: any) => err.statusCode === 400
    );
  });

  // 16. Missing provider payment ID rejected
  test('16. Payment lacking provider payment ID rejected (409 Conflict)', async () => {
    const { user, payment } = await createTestUserWithPayment({
      providerPaymentId: null
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, payment.id);
      },
      (err: any) => err.statusCode === 409
    );
  });

  // 17. Provider payment ID cannot be arbitrarily supplied as authority
  test('17. Provider payment ID cannot be arbitrarily supplied as authority (paymentId is verified internally)', async () => {
    const { user } = await createTestUserWithPayment();

    await assert.rejects(
      async () => {
        await BillingRefundService.validateRefundEligibility(user.id, 'fake_client_payment_id');
      },
      (err: any) => err.statusCode === 404
    );
  });

  // 18. Full refund creates immutable refund record
  test('18. Full refund creates immutable BillingRefund record with status PROCESSED and stores provider refund ID', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient({ refundId: 'rfnd_test_full_18' });

    const result = await BillingRefundService.requestRefund(
      user.id,
      {
        paymentId: payment.id,
        reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
      },
      { client: mockClient }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.refund.status, RefundStatus.PROCESSED);
    assert.strictEqual(result.refund.amountMinorUnits, payment.amountMinorUnits);
    assert.strictEqual(result.refund.providerRefundId, 'rfnd_test_full_18');

    // Verify record in database
    const saved = await prisma.billingRefund.findUnique({
      where: { id: result.refund.id }
    });
    assert.ok(saved);
    assert.strictEqual(saved.status, RefundStatus.PROCESSED);
    assert.strictEqual(saved.amountMinorUnits, payment.amountMinorUnits);
  });

  // 19. Partial refund tracks remaining refundable amount
  test('19. Partial refund tracks remaining refundable amount correctly', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient();
    const partialAmount = 20000; // 200 INR (partial of 500 INR)

    await BillingRefundService.requestRefund(
      user.id,
      {
        paymentId: payment.id,
        amountMinorUnits: partialAmount,
        reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
      },
      { client: mockClient }
    );

    const validation = await BillingRefundService.validateRefundEligibility(user.id, payment.id, {
      reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
    });
    assert.strictEqual(validation.cumulativeRefundedAmountMinorUnits, partialAmount);
    assert.strictEqual(validation.refundableAmountMinorUnits, payment.amountMinorUnits - partialAmount);
  });

  // 20. Multiple partial refunds cannot exceed captured amount
  test('20. Multiple partial refunds cannot exceed captured amount', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient();
    const halfAmount = Math.floor(payment.amountMinorUnits / 2);

    // First half
    await BillingRefundService.requestRefund(
      user.id,
      {
        paymentId: payment.id,
        amountMinorUnits: halfAmount,
        reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
      },
      { client: mockClient }
    );

    // Attempt second refund with more than remaining
    await assert.rejects(
      async () => {
        await BillingRefundService.requestRefund(
          user.id,
          {
            paymentId: payment.id,
            amountMinorUnits: halfAmount + 1000,
            reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
          },
          { client: mockClient }
        );
      },
      (err: any) => err.statusCode === 409 && err.errorCode === 'REFUND_AMOUNT_EXCEEDS_REFUNDABLE'
    );
  });

  // 21. Provider refund request uses minor units
  test('21. Provider refund request receives exact minor units amount', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    let passedAmount: number | undefined;

    const mockClient = {
      name: 'RAZORPAY',
      isConfigured: () => true,
      assertConfigured: () => ({
        keyId: 'rzp_test_key_123',
        keySecret: 'rzp_test_secret_456',
        webhookSecret: mockWebhookSecret,
        baseUrl: 'https://api.razorpay.com/v1',
        timeoutMs: 10000,
        isConfigured: true,
        isComplete: true
      }),
      createRefund: async (paymentId: string, params: any) => {
        passedAmount = params.amount;
        return {
          id: 'rfnd_test_minor_units',
          entity: 'refund',
          amount: params.amount,
          currency: 'INR',
          payment_id: paymentId,
          status: 'processed'
        };
      }
    } as unknown as RazorpayClient;

    await BillingRefundService.requestRefund(
      user.id,
      {
        paymentId: payment.id,
        amountMinorUnits: 25000,
        reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
      },
      { client: mockClient }
    );

    assert.strictEqual(passedAmount, 25000);
  });

  // 22. Provider idempotency key is reused on retry
  test('22. Provider idempotency key is passed in headers on refund request', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    let passedIdempotencyKey: string | undefined;

    const mockClient = {
      name: 'RAZORPAY',
      isConfigured: () => true,
      assertConfigured: () => ({
        keyId: 'rzp_test_key_123',
        keySecret: 'rzp_test_secret_456',
        webhookSecret: mockWebhookSecret,
        baseUrl: 'https://api.razorpay.com/v1',
        timeoutMs: 10000,
        isConfigured: true,
        isComplete: true
      }),
      createRefund: async (paymentId: string, params: any, reqOpts?: any) => {
        passedIdempotencyKey = reqOpts?.idempotencyKey;
        return {
          id: 'rfnd_test_idem_header',
          entity: 'refund',
          amount: params.amount,
          currency: 'INR',
          payment_id: paymentId,
          status: 'processed'
        };
      }
    } as unknown as RazorpayClient;

    const testIdemKey = `idem_test_key_${uniqueId()}`;
    await BillingRefundService.requestRefund(
      user.id,
      {
        paymentId: payment.id,
        idempotencyKey: testIdemKey,
        reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW
      },
      { client: mockClient }
    );

    assert.strictEqual(passedIdempotencyKey, testIdemKey);
  });

  // 23. Duplicate refund request returns existing record without second provider call
  test('23. Duplicate refund request with same idempotencyKey returns existing refund record', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    let providerCallCount = 0;

    const mockClient = {
      name: 'RAZORPAY',
      isConfigured: () => true,
      assertConfigured: () => ({
        keyId: 'rzp_test_key_123',
        keySecret: 'rzp_test_secret_456',
        webhookSecret: mockWebhookSecret,
        baseUrl: 'https://api.razorpay.com/v1',
        timeoutMs: 10000,
        isConfigured: true,
        isComplete: true
      }),
      createRefund: async (paymentId: string, params: any) => {
        providerCallCount++;
        return {
          id: 'rfnd_test_dup_idem',
          entity: 'refund',
          amount: params.amount,
          currency: 'INR',
          payment_id: paymentId,
          status: 'processed'
        };
      }
    } as unknown as RazorpayClient;

    const testIdemKey = `idem_dup_${uniqueId()}`;

    const res1 = await BillingRefundService.requestRefund(
      user.id,
      { paymentId: payment.id, idempotencyKey: testIdemKey, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
      { client: mockClient }
    );

    const res2 = await BillingRefundService.requestRefund(
      user.id,
      { paymentId: payment.id, idempotencyKey: testIdemKey, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
      { client: mockClient }
    );

    assert.strictEqual(providerCallCount, 1);
    assert.strictEqual(res2.idempotent, true);
    assert.strictEqual(res2.refund.id, res1.refund.id);
  });

  // 24. Provider timeout preserves safe REQUIRES_REVIEW state
  test('24. Provider timeout preserves safe REQUIRES_REVIEW state and emits audit event', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const timeoutMockClient = createMockRazorpayClient({ isTimeout: true });

    const result = await BillingRefundService.requestRefund(
      user.id,
      { paymentId: payment.id, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
      { client: timeoutMockClient }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.refund.status, RefundStatus.REQUIRES_REVIEW);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.REFUND_REQUIRES_REVIEW
      }
    });
    assert.ok(audit);
  });

  // 25. Provider explicit failure marks refund as FAILED
  test('25. Provider explicit failure marks refund as FAILED and preserves original payment', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const failingMockClient = createMockRazorpayClient({
      shouldFail: true,
      errorMessage: 'Razorpay 400 Bad Request: Payment already refunded'
    });

    await assert.rejects(
      async () => {
        await BillingRefundService.requestRefund(
          user.id,
          { paymentId: payment.id, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
          { client: failingMockClient }
        );
      },
      (err: any) => err.message.includes('Razorpay 400 Bad Request')
    );

    const failedRefund = await prisma.billingRefund.findFirst({
      where: { paymentId: payment.id }
    });
    assert.ok(failedRefund);
    assert.strictEqual(failedRefund.status, RefundStatus.FAILED);

    // Verify original payment is unchanged
    const unchangedPayment = await prisma.billingPayment.findUnique({
      where: { id: payment.id }
    });
    assert.strictEqual(unchangedPayment?.status, PaymentStatus.SUCCESS);
  });

  // 26. Webhook synchronization: refund.processed marks refund PROCESSED and emits audit event
  test('26. Webhook synchronization: refund.processed marks refund PROCESSED and emits audit event', async () => {
    const { user, payment } = await createTestUserWithPayment();
    const providerRefundId = `rfnd_wh_${uniqueId()}`;

    const pendingRefund = await prisma.billingRefund.create({
      data: {
        userId: user.id,
        paymentId: payment.id,
        provider: PaymentProvider.RAZORPAY,
        providerPaymentId: payment.providerPaymentId,
        providerRefundId,
        amountMinorUnits: payment.amountMinorUnits,
        currency: payment.currency,
        status: RefundStatus.PROCESSING,
        idempotencyKey: `idem_wh_proc_${uniqueId()}`,
        requestedBy: user.id
      }
    });

    const eventId = `evt_wh_ref_proc_${uniqueId()}`;
    const webhookPayload = {
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'refund.processed',
      contains: ['refund', 'payment'],
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: payment.providerPaymentId,
            amount: payment.amountMinorUnits,
            currency: 'INR',
            status: 'processed'
          }
        },
        payment: {
          entity: {
            id: payment.providerPaymentId
          }
        }
      }
    };

    const rawPayload = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawPayload);

    const result = await RazorpayWebhookService.handleWebhook(
      rawPayload,
      signature,
      eventId,
      webhookPayload
    );

    assert.strictEqual(result.success, true);

    const updatedRefund = await prisma.billingRefund.findUnique({
      where: { id: pendingRefund.id }
    });
    assert.strictEqual(updatedRefund?.status, RefundStatus.PROCESSED);
    assert.ok(updatedRefund?.providerProcessedAt);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.REFUND_PROCESSED
      }
    });
    assert.ok(audit);
  });

  // 27. Repeated refund webhook is idempotent
  test('27. Repeated refund webhook is idempotent', async () => {
    const { user, payment } = await createTestUserWithPayment();
    const providerRefundId = `rfnd_wh_rep_${uniqueId()}`;

    await prisma.billingRefund.create({
      data: {
        userId: user.id,
        paymentId: payment.id,
        provider: PaymentProvider.RAZORPAY,
        providerPaymentId: payment.providerPaymentId,
        providerRefundId,
        amountMinorUnits: payment.amountMinorUnits,
        currency: payment.currency,
        status: RefundStatus.PROCESSING,
        idempotencyKey: `idem_wh_rep_${uniqueId()}`,
        requestedBy: user.id
      }
    });

    const eventId = `evt_wh_ref_rep_${uniqueId()}`;
    const webhookPayload = {
      entity: 'event',
      event: 'refund.processed',
      contains: ['refund'],
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: payment.providerPaymentId,
            amount: payment.amountMinorUnits,
            currency: 'INR',
            status: 'processed'
          }
        }
      }
    };

    const rawPayload = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawPayload);

    const res1 = await RazorpayWebhookService.handleWebhook(rawPayload, signature, eventId, webhookPayload);
    const res2 = await RazorpayWebhookService.handleWebhook(rawPayload, signature, eventId, webhookPayload);

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.idempotent, true);
  });

  // 28. Refund webhook amount mismatch becomes REQUIRES_REVIEW
  test('28. Refund webhook amount mismatch marks status REQUIRES_REVIEW without mutating payment', async () => {
    const { user, payment } = await createTestUserWithPayment();
    const providerRefundId = `rfnd_wh_mismatch_${uniqueId()}`;

    const pendingRefund = await prisma.billingRefund.create({
      data: {
        userId: user.id,
        paymentId: payment.id,
        provider: PaymentProvider.RAZORPAY,
        providerPaymentId: payment.providerPaymentId,
        providerRefundId,
        amountMinorUnits: payment.amountMinorUnits, // e.g. 50000
        currency: payment.currency,
        status: RefundStatus.PROCESSING,
        idempotencyKey: `idem_wh_mismatch_${uniqueId()}`,
        requestedBy: user.id
      }
    });

    const eventId = `evt_wh_ref_mismatch_${uniqueId()}`;
    const webhookPayload = {
      entity: 'event',
      event: 'refund.processed',
      contains: ['refund'],
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: payment.providerPaymentId,
            amount: 25000, // Discrepancy: provider reports different amount
            currency: 'INR',
            status: 'processed'
          }
        }
      }
    };

    const rawPayload = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawPayload);

    const result = await RazorpayWebhookService.handleWebhook(rawPayload, signature, eventId, webhookPayload);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'REQUIRES_REVIEW');

    const reviewedRefund = await prisma.billingRefund.findUnique({
      where: { id: pendingRefund.id }
    });
    assert.strictEqual(reviewedRefund?.status, RefundStatus.REQUIRES_REVIEW);
    assert.ok(reviewedRefund?.failureReason?.includes('amount mismatch'));

    const mismatchAudit = await prisma.auditEvent.findFirst({
      where: {
        userId: user.id,
        eventType: AuditEventType.REFUND_REQUIRES_REVIEW
      }
    });
    assert.ok(mismatchAudit);
  });

  // 29. Refund provider payment mismatch becomes REQUIRES_REVIEW
  test('29. Refund provider payment mismatch marks status REQUIRES_REVIEW', async () => {
    const { user, payment } = await createTestUserWithPayment();
    const providerRefundId = `rfnd_wh_pay_mismatch_${uniqueId()}`;

    const pendingRefund = await prisma.billingRefund.create({
      data: {
        userId: user.id,
        paymentId: payment.id,
        provider: PaymentProvider.RAZORPAY,
        providerPaymentId: payment.providerPaymentId,
        providerRefundId,
        amountMinorUnits: payment.amountMinorUnits,
        currency: payment.currency,
        status: RefundStatus.PROCESSING,
        idempotencyKey: `idem_wh_pay_mismatch_${uniqueId()}`,
        requestedBy: user.id
      }
    });

    const eventId = `evt_wh_ref_pay_mismatch_${uniqueId()}`;
    const webhookPayload = {
      entity: 'event',
      event: 'refund.processed',
      contains: ['refund'],
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: 'pay_rzp_completely_different_id',
            amount: payment.amountMinorUnits,
            currency: 'INR',
            status: 'processed'
          }
        }
      }
    };

    const rawPayload = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawPayload);

    const result = await RazorpayWebhookService.handleWebhook(rawPayload, signature, eventId, webhookPayload);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'REQUIRES_REVIEW');

    const reviewedRefund = await prisma.billingRefund.findUnique({
      where: { id: pendingRefund.id }
    });
    assert.strictEqual(reviewedRefund?.status, RefundStatus.REQUIRES_REVIEW);
    assert.ok(reviewedRefund?.failureReason?.includes('Payment ID mismatch'));
  });

  // 30. Original BillingPayment remains immutable
  test('30. Original BillingPayment remains immutable after full refund', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient();

    const originalAmount = payment.amountMinorUnits;
    const originalCurrency = payment.currency;
    const originalChargedAt = payment.chargedAt;
    const originalProviderPaymentId = payment.providerPaymentId;

    await BillingRefundService.requestRefund(
      user.id,
      { paymentId: payment.id, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
      { client: mockClient }
    );

    const freshPayment = await prisma.billingPayment.findUnique({
      where: { id: payment.id }
    });

    assert.strictEqual(freshPayment?.amountMinorUnits, originalAmount);
    assert.strictEqual(freshPayment?.currency, originalCurrency);
    assert.strictEqual(freshPayment?.chargedAt.getTime(), originalChargedAt.getTime());
    assert.strictEqual(freshPayment?.providerPaymentId, originalProviderPaymentId);
  });

  // 31. Existing subscription is not cancelled for normal refund unless terminateSubscription is set
  test('31. Existing subscription is not cancelled for normal refund', async () => {
    const { user, sub, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient();

    await BillingRefundService.requestRefund(
      user.id,
      { paymentId: payment.id, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
      { client: mockClient }
    );

    const unchangedSub = await prisma.subscription.findUnique({
      where: { id: sub.id }
    });
    assert.strictEqual(unchangedSub?.status, BillingStatus.ACTIVE);
  });

  // 32. Authorized immediate-refund policy terminates subscription safely
  test('32. Authorized immediate-refund with terminateSubscription=true terminates subscription without deleting resources', async () => {
    const { user, sub, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient();

    // Create server and device to verify Zero-Destruction Rule
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        deviceName: 'User Laptop',
        platform: 'WINDOWS'
      }
    });

    const server = await prisma.serverInstance.create({
      data: {
        deviceId: device.id,
        serverName: 'Work Server'
      }
    });

    await BillingRefundService.requestRefund(
      user.id,
      {
        paymentId: payment.id,
        reason: RefundReason.ADMIN_APPROVED_EXCEPTION,
        terminateSubscription: true,
        isAdmin: true
      },
      { client: mockClient }
    );

    const terminatedSub = await prisma.subscription.findUnique({
      where: { id: sub.id }
    });
    assert.strictEqual(terminatedSub?.status, BillingStatus.REFUNDED);

    const billingState = await prisma.accountBillingState.findUnique({
      where: { userId: user.id }
    });
    assert.strictEqual(billingState?.status, BillingStatus.FREE);

    // Verify Zero-Destruction Rule: Device and Server still exist
    const preservedDevice = await prisma.device.findUnique({ where: { id: device.id } });
    const preservedServer = await prisma.serverInstance.findUnique({ where: { id: server.id } });
    assert.ok(preservedDevice);
    assert.ok(preservedServer);
  });

  // 33. In-App notification emitted for processed refund
  test('33. In-App notification emitted for processed refund', async () => {
    const { user, payment } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient();

    await BillingRefundService.requestRefund(
      user.id,
      { paymentId: payment.id, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
      { client: mockClient }
    );

    const notif = await prisma.notificationRecord.findFirst({
      where: {
        userId: user.id,
        eventType: 'BILLING_REFUND_PROCESSED'
      }
    });
    assert.ok(notif);
    assert.strictEqual(notif.title, 'Refund Processed');
  });

  // 34. REST API: POST /api/v1/billing/refunds creates refund
  test('34. REST API: POST /api/v1/billing/refunds creates refund and returns 200', async () => {
    const { user, payment, session } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/refunds',
      headers: {
        authorization: `Bearer ${session.token}`
      },
      payload: {
        paymentId: payment.id,
        reason: 'ANNUAL_WITHIN_REFUND_WINDOW'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.success, true);
    assert.strictEqual(body.data.refund.paymentId, payment.id);
  });

  // 35. REST API: GET /api/v1/billing/refunds/:id returns refund details
  test('35. REST API: GET /api/v1/billing/refunds/:id returns refund details', async () => {
    const { user, payment, session } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient();

    const result = await BillingRefundService.requestRefund(
      user.id,
      { paymentId: payment.id, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
      { client: mockClient }
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/refunds/${result.refund.id}`,
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, result.refund.id);
  });

  // 36. REST API: GET /api/v1/billing/payments/:id/refunds returns payment refunds
  test('36. REST API: GET /api/v1/billing/payments/:id/refunds returns list of refunds', async () => {
    const { user, payment, session } = await createTestUserWithPayment({
      planInterval: BillingInterval.YEARLY,
      chargeDaysAgo: 2
    });
    const mockClient = createMockRazorpayClient();

    await BillingRefundService.requestRefund(
      user.id,
      { paymentId: payment.id, amountMinorUnits: 10000, reason: RefundReason.ANNUAL_WITHIN_REFUND_WINDOW },
      { client: mockClient }
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/payments/${payment.id}/refunds`,
      headers: {
        authorization: `Bearer ${session.token}`
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.strictEqual(body.data.length, 1);
  });
});
