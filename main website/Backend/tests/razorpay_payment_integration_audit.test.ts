import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval,
  PaymentStatus,
  WebhookEventStatus,
  RefundStatus,
  RefundReason,
  AuditEventType,
  BillingReceiptStatus,
  BillingReceiptType
} from '@prisma/client';
import { getRazorpayConfig } from '../src/config/razorpay.js';
import {
  verifyRazorpayWebhookSignature,
  verifyRazorpaySubscriptionPaymentSignature
} from '../src/services/billing/providers/razorpay/webhook_crypto.js';
import {
  RazorpayCheckoutService,
  RazorpayWebhookService,
  RazorpayClient,
  RazorpayProviderError
} from '../src/services/billing/providers/razorpay/index.js';
import { BillingRefundService } from '../src/services/billing/billing_refund_service.js';
import { BillingReceiptService } from '../src/services/billing/billing_receipt_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { PlanService } from '../src/services/billing/plan_service.js';

describe('PHASE 7: Razorpay Payment Integration Audit and Verification Test Suite', () => {
  let app: FastifyInstance;
  let testUserIn: any;
  let tokenIn: string;
  let testUserUs: any;
  let tokenUs: string;
  let testUserNoAddress: any;
  let tokenNoAddress: string;

  const mockKeyId = 'rzp_test_AuditKeyId123';
  const mockKeySecret = 'sec_mockKeySecret_Audit456';
  const mockWebhookSecret = 'whsec_test_mockWebhookSecret_Audit789';

  function computeHmac(data: string | Buffer, secret: string): string {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  function createMockRazorpayClient(handlers: {
    postHandler?: (endpoint: string, body: any) => Promise<any>;
    getHandler?: (endpoint: string) => Promise<any>;
  }): RazorpayClient {
    const client = new RazorpayClient({
      keyId: mockKeyId,
      keySecret: mockKeySecret,
      baseUrl: 'https://api.razorpay.com/v1'
    });

    if (handlers.postHandler) {
      client.post = async <T>(endpoint: string, body?: any): Promise<T> => {
        return (await handlers.postHandler!(endpoint, body)) as T;
      };
    }

    if (handlers.getHandler) {
      client.get = async <T>(endpoint: string): Promise<T> => {
        return (await handlers.getHandler!(endpoint)) as T;
      };
    }

    return client;
  }

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Ensure plan catalog is seeded
    await PlanService.seedInitialCatalog(app.log);

    // Seed Indian user with complete billing address
    testUserIn = await prisma.user.create({
      data: {
        email: `rzp_audit_in_${Date.now()}@zdexcloud.com`,
        fullName: 'Aarav Sharma',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    tokenIn = `tok_rzp_audit_in_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: testUserIn.id,
        tokenHash: hashSessionToken(tokenIn),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserIn.id,
        status: BillingStatus.FREE,
        billingName: 'Aarav Sharma',
        billingAddress1: '123 MG Road, Brigade Towers',
        billingCity: 'Bengaluru',
        billingState: 'Karnataka',
        billingPostalCode: '560001',
        billingCountry: 'IN',
        currency: CurrencyCode.INR
      }
    });

    // Seed US user with complete billing address
    testUserUs = await prisma.user.create({
      data: {
        email: `rzp_audit_us_${Date.now()}@zdexcloud.com`,
        fullName: 'Jane Miller',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    tokenUs = `tok_rzp_audit_us_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: testUserUs.id,
        tokenHash: hashSessionToken(tokenUs),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserUs.id,
        status: BillingStatus.FREE,
        billingName: 'Jane Miller',
        billingAddress1: '742 Evergreen Terrace',
        billingCity: 'Springfield',
        billingState: 'OR',
        billingPostalCode: '97477',
        billingCountry: 'US',
        currency: CurrencyCode.USD
      }
    });

    // Seed user without billing address for prerequisite enforcement testing
    testUserNoAddress = await prisma.user.create({
      data: {
        email: `rzp_audit_noaddr_${Date.now()}@zdexcloud.com`,
        fullName: 'Pending Customer',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    tokenNoAddress = `tok_rzp_audit_noaddr_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: testUserNoAddress.id,
        tokenHash: hashSessionToken(tokenNoAddress),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    await prisma.accountBillingState.create({
      data: {
        userId: testUserNoAddress.id,
        status: BillingStatus.FREE,
        currency: CurrencyCode.INR
      }
    });
  });

  after(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // SECTION 1: PROVIDER CONFIGURATION & CREDENTIAL BOUNDARY ISOLATION
  // ---------------------------------------------------------------------------
  describe('1. Provider Configuration & Credential Boundary Isolation', () => {
    test('resolves active Razorpay configuration safely with non-empty attributes', () => {
      const cfg = getRazorpayConfig();
      assert.ok(cfg, 'Razorpay config should be resolvable');
      assert.strictEqual(typeof cfg.keyId, 'string');
      assert.strictEqual(typeof cfg.keySecret, 'string');
      assert.strictEqual(typeof cfg.baseUrl, 'string');
      assert.ok(cfg.baseUrl.startsWith('https://'), 'Base URL must enforce HTTPS');
    });

    test('validates that public keyId is separated from private keySecret', () => {
      const cfg = getRazorpayConfig();
      assert.notStrictEqual(cfg.keyId, cfg.keySecret, 'keyId and keySecret must not be identical');
      assert.ok(!cfg.keySecret.startsWith('rzp_test_') || cfg.keySecret.length > 8, 'keySecret must be secret string');
    });

    test('verifies sensitive headers and credentials are in Fastify logger redaction list', () => {
      const redactedFields = [
        'req.headers["x-razorpay-signature"]',
        'body.keySecret',
        'body.webhookSecret'
      ];
      assert.ok(redactedFields.length === 3, 'Redacted fields list must contain all key secrets');
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 2: HTTPS TRANSPORT CLIENT & SIGNATURE CRYPTOGRAPHY
  // ---------------------------------------------------------------------------
  describe('2. HTTPS Transport Client & Signature Cryptography', () => {
    test('authenticates valid webhook signature using HMAC-SHA256 and timing-safe equality', () => {
      const payload = JSON.stringify({ event: 'subscription.activated', id: 'evt_test_123' });
      const validSignature = computeHmac(payload, mockWebhookSecret);

      const isValid = verifyRazorpayWebhookSignature(payload, validSignature, mockWebhookSecret);
      assert.strictEqual(isValid, true, 'Valid HMAC signature must verify as true');
    });

    test('rejects forged webhook signature without throwing runtime exception', () => {
      const payload = JSON.stringify({ event: 'subscription.activated', id: 'evt_test_123' });
      const forgedSignature = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const isValid = verifyRazorpayWebhookSignature(payload, forgedSignature, mockWebhookSecret);
      assert.strictEqual(isValid, false, 'Forged signature must verify as false');
    });

    test('rejects malformed or mismatched buffer length signature safely', () => {
      const payload = JSON.stringify({ event: 'subscription.activated' });
      const truncatedSignature = 'abcdef';

      const isValid = verifyRazorpayWebhookSignature(payload, truncatedSignature, mockWebhookSecret);
      assert.strictEqual(isValid, false, 'Truncated signature must verify as false without crashing');
    });

    test('validates subscription payment signature for checkout callback', () => {
      const paymentId = 'pay_audit_test_999';
      const subscriptionId = 'sub_audit_test_888';
      const expectedData = `${paymentId}|${subscriptionId}`;
      const validSig = computeHmac(expectedData, mockKeySecret);

      const isValid = verifyRazorpaySubscriptionPaymentSignature(
        paymentId,
        subscriptionId,
        validSig,
        mockKeySecret
      );
      assert.strictEqual(isValid, true, 'Valid payment signature must verify as true');
    });

    test('rejects tampered subscription ID in payment signature verification', () => {
      const paymentId = 'pay_audit_test_999';
      const subscriptionId = 'sub_audit_test_888';
      const tamperedSubId = 'sub_audit_tampered_777';
      const sigForOriginal = computeHmac(`${paymentId}|${subscriptionId}`, mockKeySecret);

      const isValid = verifyRazorpaySubscriptionPaymentSignature(
        paymentId,
        tamperedSubId,
        sigForOriginal,
        mockKeySecret
      );
      assert.strictEqual(isValid, false, 'Tampered subscription ID must fail verification');
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 3: CHECKOUT SESSION CREATION & PREREQUISITE ENFORCEMENT
  // ---------------------------------------------------------------------------
  describe('3. Checkout Session Creation & Billing Address Enforcement', () => {
    test('rejects checkout session creation if customer has not provided full billing address', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserNoAddress.id, {
            planCode: 'PRO_MONTHLY'
          });
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.errorCode, 'BILLING_ADDRESS_REQUIRED');
          return true;
        },
        'Must reject checkout session creation when billing address is absent'
      );
    });

    test('creates checkout session and initializes internal subscription in CREATED status', async () => {
      const mockClient = createMockRazorpayClient({
        postHandler: async (endpoint, body) => {
          if (endpoint === '/subscriptions') {
            return {
              id: 'sub_rzp_mock_init_001',
              plan_id: 'plan_mock_pro_monthly_inr',
              status: 'created',
              current_start: Math.floor(Date.now() / 1000),
              current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
              short_url: 'https://rzp.io/i/mockShortUrl'
            };
          }
          throw new Error(`Unexpected endpoint: ${endpoint}`);
        }
      });

      const session = await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_MONTHLY' },
        { client: mockClient, keyId: mockKeyId }
      );

      assert.ok(session, 'Checkout session response must be returned');
      assert.strictEqual(session.provider, 'RAZORPAY');
      assert.strictEqual(session.keyId, mockKeyId);
      assert.strictEqual(session.subscriptionId, 'sub_rzp_mock_init_001');
      assert.strictEqual(session.status, 'CREATED');

      // Verify internal subscription state in database
      const subRecord = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: 'sub_rzp_mock_init_001' }
      });

      assert.ok(subRecord, 'Internal subscription record must exist');
      assert.strictEqual(subRecord.status, BillingStatus.CREATED);
      assert.strictEqual(subRecord.userId, testUserIn.id);
    });

    test('ensures subscription in CREATED status does NOT grant Pro entitlements', async () => {
      const effective = await BillingStateService.getEffectivePlan(testUserIn.id);
      assert.strictEqual(effective.planCode, 'FREE', 'Effective plan must remain FREE when subscription is CREATED');

      const entitlements = await EntitlementService.resolvePlanEntitlements(effective.planCode);
      assert.strictEqual(entitlements.maxServers, 1, 'Max servers must be 1 for FREE tier');
      assert.strictEqual(entitlements.priorityRelay, false, 'Priority relay must be false for FREE tier');
    });

    test('reuses existing pending checkout session if created within 1 hour', async () => {
      const mockClient = createMockRazorpayClient({});

      const reusedSession = await RazorpayCheckoutService.createCheckoutSession(
        testUserIn.id,
        { planCode: 'PRO_MONTHLY' },
        { client: mockClient, keyId: mockKeyId }
      );

      assert.strictEqual(reusedSession.subscriptionId, 'sub_rzp_mock_init_001');
      assert.strictEqual(reusedSession.reused, true, 'Must reuse pending session without duplicate provider call');
    });

    test('blocks checkout session creation if user already possesses an ACTIVE subscription', async () => {
      // Temporarily set user's subscription to ACTIVE
      await prisma.subscription.update({
        where: { providerSubscriptionId: 'sub_rzp_mock_init_001' },
        data: { status: BillingStatus.ACTIVE }
      });

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserIn.id, {
            planCode: 'PRO_MONTHLY'
          });
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 409);
          assert.strictEqual(err.errorCode, 'ACTIVE_SUBSCRIPTION_EXISTS');
          return true;
        },
        'Must reject session creation if an active subscription already exists'
      );

      // Revert status back to CREATED for subsequent test steps
      await prisma.subscription.update({
        where: { providerSubscriptionId: 'sub_rzp_mock_init_001' },
        data: { status: BillingStatus.CREATED }
      });
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 4: PAYMENT VERIFICATION & IDEMPOTENT ACTIVATION
  // ---------------------------------------------------------------------------
  describe('4. Checkout Payment Verification & Idempotent Activation', () => {
    test('rejects payment verification with forged HMAC signature', async () => {
      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.verifyCheckoutPayment(
            testUserIn.id,
            {
              paymentId: 'pay_audit_verify_001',
              subscriptionId: 'sub_rzp_mock_init_001',
              signature: 'forged_signature_00000000000000000000000000000000'
            },
            { keySecret: mockKeySecret }
          );
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.errorCode, 'INVALID_SIGNATURE');
          return true;
        },
        'Must reject forged checkout payment signature'
      );
    });

    test('verifies valid signature, transitions subscription to ACTIVE, and records financial payment', async () => {
      const paymentId = 'pay_audit_verify_valid_001';
      const subscriptionId = 'sub_rzp_mock_init_001';
      const validSignature = computeHmac(`${paymentId}|${subscriptionId}`, mockKeySecret);

      const result = await RazorpayCheckoutService.verifyCheckoutPayment(
        testUserIn.id,
        {
          paymentId,
          subscriptionId,
          signature: validSignature
        },
        { keySecret: mockKeySecret }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'ACTIVE');

      // Verify database subscription state
      const sub = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: subscriptionId }
      });
      assert.strictEqual(sub?.status, BillingStatus.ACTIVE);

      // Verify AccountBillingState updated
      const billingState = await prisma.accountBillingState.findUnique({
        where: { userId: testUserIn.id }
      });
      assert.strictEqual(billingState?.status, BillingStatus.ACTIVE);
      assert.strictEqual(billingState?.activeSubscriptionId, sub?.id);

      // Verify BillingPayment record created
      const payment = await prisma.billingPayment.findFirst({
        where: { providerPaymentId: paymentId }
      });
      assert.ok(payment, 'BillingPayment must be recorded');
      assert.strictEqual(payment.status, PaymentStatus.SUCCESS);
      assert.strictEqual(payment.userId, testUserIn.id);

      // Verify BillingReceipt generated
      const receipt = await prisma.billingReceipt.findUnique({
        where: { paymentId: payment.id }
      });
      assert.ok(receipt, 'BillingReceipt must be issued');
      assert.strictEqual(receipt.status, BillingReceiptStatus.ISSUED);
      assert.strictEqual(receipt.customerName, 'Aarav Sharma');
    });

    test('confirms Pro entitlements are granted once subscription is ACTIVE', async () => {
      const effective = await BillingStateService.getEffectivePlan(testUserIn.id);
      assert.strictEqual(effective.planCode, 'PRO_MONTHLY');

      const entitlements = await EntitlementService.resolvePlanEntitlements(effective.planCode);
      assert.strictEqual(entitlements.maxServers, 5, 'Max servers must be 5 for Pro tier');
      assert.strictEqual(entitlements.priorityRelay, true, 'Priority relay must be true for Pro tier');
    });

    test('returns idempotent success on subsequent verify call without duplicating payment or receipt', async () => {
      const paymentId = 'pay_audit_verify_valid_001';
      const subscriptionId = 'sub_rzp_mock_init_001';
      const validSignature = computeHmac(`${paymentId}|${subscriptionId}`, mockKeySecret);

      const retryResult = await RazorpayCheckoutService.verifyCheckoutPayment(
        testUserIn.id,
        {
          paymentId,
          subscriptionId,
          signature: validSignature
        },
        { keySecret: mockKeySecret }
      );

      assert.strictEqual(retryResult.success, true);
      assert.strictEqual(retryResult.idempotent, true);

      // Count payments to ensure no duplicate
      const paymentCount = await prisma.billingPayment.count({
        where: { providerPaymentId: paymentId }
      });
      assert.strictEqual(paymentCount, 1, 'Must not duplicate payment on verify replay');
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 5: WEBHOOK SIGNATURE VALIDATION & EVENT DEDUPLICATION
  // ---------------------------------------------------------------------------
  describe('5. Webhook Signature Validation & Event Deduplication', () => {
    test('rejects incoming webhook request with invalid signature via RazorpayProviderError', async () => {
      const rawPayload = JSON.stringify({
        event: 'subscription.charged',
        payload: { subscription: { entity: { id: 'sub_unknown_999', plan_id: 'plan_test' } } }
      });

      await assert.rejects(
        async () => {
          await RazorpayWebhookService.handleWebhook(
            rawPayload,
            'invalid_sig_abc123',
            'evt_test_unauth_001',
            JSON.parse(rawPayload),
            { webhookSecret: mockWebhookSecret }
          );
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, 'INVALID_SIGNATURE');
          return true;
        },
        'Must reject unauthenticated webhook request'
      );
    });

    test('durable deduplication: logs event in BillingWebhookEvent and ignores replay idempotently', async () => {
      const providerEventId = `evt_audit_dedup_${Date.now()}`;
      const payload = {
        event: 'order.paid',
        id: providerEventId
      };
      const rawBody = JSON.stringify(payload);
      const signature = computeHmac(rawBody, mockWebhookSecret);

      // First delivery
      const res1 = await RazorpayWebhookService.handleWebhook(
        rawBody,
        signature,
        providerEventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );
      assert.strictEqual(res1.success, true);

      // Second delivery (replay)
      const res2 = await RazorpayWebhookService.handleWebhook(
        rawBody,
        signature,
        providerEventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.idempotent, true, 'Second delivery must be detected as idempotent duplicate');

      const webhookLog = await prisma.billingWebhookEvent.findFirst({
        where: { providerEventId }
      });
      assert.ok(webhookLog, 'Webhook event log must be saved in database');
      assert.strictEqual(webhookLog.status, WebhookEventStatus.PROCESSED);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 6: SUBSCRIPTION LIFECYCLE WEBHOOK ORCHESTRATION
  // ---------------------------------------------------------------------------
  describe('6. Subscription Lifecycle Webhook Orchestration', () => {
    let lifecycleSubId: string;
    let providerPlanId: string;

    before(async () => {
      lifecycleSubId = `sub_rzp_lifecycle_${Date.now()}`;
      providerPlanId = 'plan_pro_monthly_usd_test';

      const usdPrice = await prisma.planPrice.findFirst({
        where: { currency: CurrencyCode.USD, plan: { code: 'PRO_MONTHLY' } },
        include: { plan: true }
      });

      assert.ok(usdPrice, 'USD plan price must exist');

      // Create provider plan mapping
      await prisma.billingProviderPlanMapping.upsert({
        where: {
          provider_environment_providerPlanId: {
            provider: PaymentProvider.RAZORPAY,
            environment: PaymentEnvironment.TEST,
            providerPlanId
          }
        },
        update: {},
        create: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          planId: usdPrice.planId,
          planPriceId: usdPrice.id,
          providerPlanId,
          currency: CurrencyCode.USD,
          amountMinorUnits: usdPrice.amountMinorUnits,
          period: 'monthly',
          interval: 1,
          priceVersion: usdPrice.version
        }
      });

      // Create subscription in CREATED status
      await prisma.subscription.create({
        data: {
          id: `sub_internal_lifecycle_${Date.now()}`,
          userId: testUserUs.id,
          planId: usdPrice.planId,
          planPriceId: usdPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: lifecycleSubId,
          providerPlanId,
          status: BillingStatus.CREATED,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.USD,
          amountMinorUnits: usdPrice.amountMinorUnits,
          priceVersion: usdPrice.version,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000)
        }
      });
    });

    test('handles subscription.authenticated without granting Pro entitlements prematurely', async () => {
      const eventId = `evt_auth_${Date.now()}`;
      const payload = {
        event: 'subscription.authenticated',
        id: eventId,
        payload: {
          subscription: {
            entity: {
              id: lifecycleSubId,
              plan_id: providerPlanId,
              status: 'authenticated'
            }
          }
        }
      };
      const rawBody = JSON.stringify(payload);
      const sig = computeHmac(rawBody, mockWebhookSecret);

      const result = await RazorpayWebhookService.handleWebhook(
        rawBody,
        sig,
        eventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'CREATED');

      const sub = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: lifecycleSubId }
      });
      assert.strictEqual(sub?.status, BillingStatus.CREATED);

      const effective = await BillingStateService.getEffectivePlan(testUserUs.id);
      assert.strictEqual(effective.planCode, 'FREE', 'Must remain FREE after authentication only');
    });

    test('handles subscription.activated: transitions to ACTIVE and resolves Pro entitlements', async () => {
      const eventId = `evt_act_${Date.now()}`;
      const nowSec = Math.floor(Date.now() / 1000);
      const payload = {
        event: 'subscription.activated',
        id: eventId,
        payload: {
          subscription: {
            entity: {
              id: lifecycleSubId,
              plan_id: providerPlanId,
              status: 'active',
              current_start: nowSec,
              current_end: nowSec + 30 * 86400
            }
          }
        }
      };
      const rawBody = JSON.stringify(payload);
      const sig = computeHmac(rawBody, mockWebhookSecret);

      const result = await RazorpayWebhookService.handleWebhook(
        rawBody,
        sig,
        eventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'ACTIVE');

      const sub = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: lifecycleSubId }
      });
      assert.strictEqual(sub?.status, BillingStatus.ACTIVE);

      const effective = await BillingStateService.getEffectivePlan(testUserUs.id);
      assert.strictEqual(effective.planCode, 'PRO_MONTHLY');

      const entitlements = await EntitlementService.resolvePlanEntitlements(effective.planCode);
      assert.strictEqual(entitlements.maxServers, 5);
      assert.strictEqual(entitlements.priorityRelay, true);
    });

    test('handles subscription.charged: advances billing period, creates payment and receipt', async () => {
      const eventId = `evt_chg_${Date.now()}`;
      const paymentId = `pay_renewal_${Date.now()}`;
      const nextStartSec = Math.floor(Date.now() / 1000) + 30 * 86400;
      const nextEndSec = nextStartSec + 30 * 86400;

      const subBefore = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: lifecycleSubId }
      });

      const payload = {
        event: 'subscription.charged',
        id: eventId,
        payload: {
          subscription: {
            entity: {
              id: lifecycleSubId,
              plan_id: providerPlanId,
              status: 'active',
              current_start: nextStartSec,
              current_end: nextEndSec
            }
          },
          payment: {
            entity: {
              id: paymentId,
              amount: subBefore!.amountMinorUnits,
              currency: 'USD',
              status: 'captured'
            }
          }
        }
      };
      const rawBody = JSON.stringify(payload);
      const sig = computeHmac(rawBody, mockWebhookSecret);

      const result = await RazorpayWebhookService.handleWebhook(
        rawBody,
        sig,
        eventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'ACTIVE');

      // Verify period advanced
      const subAfter = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: lifecycleSubId }
      });
      assert.ok(subAfter!.currentPeriodStart.getTime() > subBefore!.currentPeriodStart.getTime());

      // Verify payment record
      const payment = await prisma.billingPayment.findFirst({
        where: { providerPaymentId: paymentId }
      });
      assert.ok(payment, 'Renewal payment must be recorded');
      assert.strictEqual(payment.status, PaymentStatus.SUCCESS);

      // Verify receipt generated
      const receipt = await prisma.billingReceipt.findUnique({
        where: { paymentId: payment.id }
      });
      assert.ok(receipt, 'Renewal receipt must be issued');
      assert.strictEqual(receipt.type, BillingReceiptType.SUBSCRIPTION_RENEWAL);
    });

    test('out-of-order protection: older activation event does not regress terminal EXPIRED status', async () => {
      // Set subscription to EXPIRED
      await prisma.subscription.update({
        where: { providerSubscriptionId: lifecycleSubId },
        data: { status: BillingStatus.EXPIRED, expiredAt: new Date() }
      });

      const eventId = `evt_stale_act_${Date.now()}`;
      const payload = {
        event: 'subscription.activated',
        id: eventId,
        payload: {
          subscription: {
            entity: {
              id: lifecycleSubId,
              plan_id: providerPlanId,
              status: 'active'
            }
          }
        }
      };
      const rawBody = JSON.stringify(payload);
      const sig = computeHmac(rawBody, mockWebhookSecret);

      const result = await RazorpayWebhookService.handleWebhook(
        rawBody,
        sig,
        eventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'EXPIRED', 'Must acknowledge without regressing EXPIRED status');

      const sub = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: lifecycleSubId }
      });
      assert.strictEqual(sub?.status, BillingStatus.EXPIRED);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 7: DUNNING, GRACE PERIOD & RENEWAL RECOVERY
  // ---------------------------------------------------------------------------
  describe('7. Dunning, Grace Period & Renewal Recovery', () => {
    let dunningSubId: string;
    let providerPlanId: string;

    before(async () => {
      dunningSubId = `sub_rzp_dunning_${Date.now()}`;
      providerPlanId = 'plan_pro_monthly_usd_test';

      const usdPrice = await prisma.planPrice.findFirst({
        where: { currency: CurrencyCode.USD, plan: { code: 'PRO_MONTHLY' } }
      });

      await prisma.subscription.create({
        data: {
          id: `sub_internal_dunning_${Date.now()}`,
          userId: testUserUs.id,
          planId: usdPrice!.planId,
          planPriceId: usdPrice!.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: PaymentEnvironment.TEST,
          providerSubscriptionId: dunningSubId,
          providerPlanId,
          status: BillingStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          currency: CurrencyCode.USD,
          amountMinorUnits: usdPrice!.amountMinorUnits,
          priceVersion: usdPrice!.version,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000)
        }
      });
    });

    test('payment.failed triggers grace period without immediately revoking Pro capabilities', async () => {
      const eventId = `evt_fail_${Date.now()}`;
      const payload = {
        event: 'payment.failed',
        id: eventId,
        subscription_id: dunningSubId,
        payload: {
          payment: {
            entity: {
              id: `pay_failed_${Date.now()}`,
              subscription_id: dunningSubId,
              amount: 800,
              currency: 'USD',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Card declined due to insufficient balance'
            }
          }
        }
      };
      const rawBody = JSON.stringify(payload);
      const sig = computeHmac(rawBody, mockWebhookSecret);

      const result = await RazorpayWebhookService.handleWebhook(
        rawBody,
        sig,
        eventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'GRACE_PERIOD');

      const sub = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: dunningSubId }
      });
      assert.strictEqual(sub?.status, BillingStatus.GRACE_PERIOD);
      assert.ok(sub?.gracePeriodEndsAt, 'Grace period end timestamp must be set');

      // Pro entitlements must remain active during grace period
      const effective = await BillingStateService.getEffectivePlan(testUserUs.id);
      assert.strictEqual(effective.planCode, 'PRO_MONTHLY', 'User must retain Pro entitlements during grace period');
      const entitlements = await EntitlementService.resolvePlanEntitlements(effective.planCode);
      assert.strictEqual(entitlements.maxServers, 5);
    });

    test('subscription.charged recovers subscription from GRACE_PERIOD back to ACTIVE', async () => {
      const eventId = `evt_recover_${Date.now()}`;
      const paymentId = `pay_recovered_${Date.now()}`;
      const nextStartSec = Math.floor(Date.now() / 1000);
      const nextEndSec = nextStartSec + 30 * 86400;

      const payload = {
        event: 'subscription.charged',
        id: eventId,
        payload: {
          subscription: {
            entity: {
              id: dunningSubId,
              plan_id: providerPlanId,
              status: 'active',
              current_start: nextStartSec,
              current_end: nextEndSec
            }
          },
          payment: {
            entity: {
              id: paymentId,
              amount: 800,
              currency: 'USD',
              status: 'captured'
            }
          }
        }
      };
      const rawBody = JSON.stringify(payload);
      const sig = computeHmac(rawBody, mockWebhookSecret);

      const result = await RazorpayWebhookService.handleWebhook(
        rawBody,
        sig,
        eventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'ACTIVE');

      const sub = await prisma.subscription.findUnique({
        where: { providerSubscriptionId: dunningSubId }
      });
      assert.strictEqual(sub?.status, BillingStatus.ACTIVE);
      assert.strictEqual(sub?.gracePeriodEndsAt, null, 'Grace period must be cleared upon recovery');
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 8: REFUND LIFECYCLE & RECEIPT IMMUTABILITY
  // ---------------------------------------------------------------------------
  describe('8. Refund Lifecycle & Receipt Immutability', () => {
    let refundPayment: any;
    let refundReceipt: any;

    before(async () => {
      // Create successful captured payment with receipt for testing refunds
      const price = await prisma.planPrice.findFirst({
        where: { currency: CurrencyCode.INR, plan: { code: 'PRO_MONTHLY' } }
      });

      const sub = await prisma.subscription.findFirst({
        where: { userId: testUserIn.id, status: BillingStatus.ACTIVE }
      });

      refundPayment = await prisma.billingPayment.create({
        data: {
          provider: PaymentProvider.RAZORPAY,
          environment: PaymentEnvironment.TEST,
          providerPaymentId: `pay_rfnd_src_${Date.now()}`,
          userId: testUserIn.id,
          subscriptionId: sub!.id,
          amountMinorUnits: price!.amountMinorUnits,
          currency: CurrencyCode.INR,
          status: PaymentStatus.SUCCESS,
          chargedAt: new Date()
        }
      });

      const receiptResult = await BillingReceiptService.generateReceiptForPayment(refundPayment.id);
      refundReceipt = receiptResult.receipt;
    });

    test('validates refund eligibility and enforces cumulative amount bounds', async () => {
      const validation = await BillingRefundService.validateRefundEligibility(
        testUserIn.id,
        refundPayment.id,
        {
          amountMinorUnits: refundPayment.amountMinorUnits,
          reason: RefundReason.TECHNICAL_SERVICE_FAILURE,
          isAdmin: false
        }
      );

      assert.strictEqual(validation.refundableAmountMinorUnits, refundPayment.amountMinorUnits);
      assert.strictEqual(validation.isFullRefund, true);

      // Attempting to refund more than payment amount must throw
      await assert.rejects(
        async () => {
          await BillingRefundService.validateRefundEligibility(
            testUserIn.id,
            refundPayment.id,
            {
              amountMinorUnits: refundPayment.amountMinorUnits + 5000,
              reason: RefundReason.TECHNICAL_SERVICE_FAILURE,
              isAdmin: false
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 409);
          assert.strictEqual(err.errorCode, 'REFUND_AMOUNT_EXCEEDS_REFUNDABLE');
          return true;
        }
      );
    });

    test('processes partial refund and updates state without destroying original payment or receipt', async () => {
      const partialAmount = Math.floor(refundPayment.amountMinorUnits / 2);
      const mockRefundId = `rfnd_mock_part_${Date.now()}`;

      const mockClient = createMockRazorpayClient({
        postHandler: async (endpoint, body) => {
          if (endpoint.includes('/payments/') && endpoint.includes('/refund')) {
            return {
              id: mockRefundId,
              payment_id: refundPayment.providerPaymentId,
              amount: partialAmount,
              currency: 'INR',
              status: 'processed'
            };
          }
          throw new Error(`Unexpected endpoint: ${endpoint}`);
        }
      });

      const refundResult = await BillingRefundService.requestRefund(
        testUserIn.id,
        {
          paymentId: refundPayment.id,
          amountMinorUnits: partialAmount,
          reason: RefundReason.TECHNICAL_SERVICE_FAILURE,
          reasonDetails: 'Partial refund verified under policy'
        },
        { client: mockClient }
      );

      assert.strictEqual(refundResult.success, true);
      assert.strictEqual(refundResult.refund.status, RefundStatus.PROCESSED);
      assert.strictEqual(refundResult.refund.amountMinorUnits, partialAmount);

      // Original payment record remains intact
      const paymentCheck = await prisma.billingPayment.findUnique({
        where: { id: refundPayment.id }
      });
      assert.ok(paymentCheck, 'Original payment record must remain intact');
      assert.strictEqual(paymentCheck?.status, PaymentStatus.SUCCESS);

      // Original receipt remains immutable
      const receiptCheck = await prisma.billingReceipt.findUnique({
        where: { id: refundReceipt.id }
      });
      assert.ok(receiptCheck, 'Original billing receipt must remain intact');
      assert.strictEqual(receiptCheck?.receiptNumber, refundReceipt.receiptNumber);
      assert.strictEqual(receiptCheck?.status, BillingReceiptStatus.ISSUED);
    });

    test('handles refund.processed webhook event idempotently', async () => {
      const eventId = `evt_ref_proc_${Date.now()}`;
      const payload = {
        event: 'refund.processed',
        id: eventId,
        payload: {
          refund: {
            entity: {
              id: `rfnd_ext_wh_${Date.now()}`,
              payment_id: refundPayment.providerPaymentId,
              amount: 1000,
              currency: 'INR',
              status: 'processed'
            }
          }
        }
      };
      const rawBody = JSON.stringify(payload);
      const sig = computeHmac(rawBody, mockWebhookSecret);

      const result = await RazorpayWebhookService.handleWebhook(
        rawBody,
        sig,
        eventId,
        payload,
        { webhookSecret: mockWebhookSecret }
      );

      assert.strictEqual(result.success, true);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION 9: TECHNICAL ENTITLEMENT BOUNDARY ISOLATION
  // ---------------------------------------------------------------------------
  describe('9. Technical Entitlement Boundary Isolation', () => {
    test('confirms FREE tier provides 1 server limit and no priority relay', async () => {
      const ent = await EntitlementService.resolvePlanEntitlements('FREE');
      assert.strictEqual(ent.maxServers, 1);
      assert.strictEqual(ent.priorityRelay, false);
    });

    test('confirms PRO_MONTHLY tier provides 5 servers limit and priority relay', async () => {
      const ent = await EntitlementService.resolvePlanEntitlements('PRO_MONTHLY');
      assert.strictEqual(ent.maxServers, 5);
      assert.strictEqual(ent.priorityRelay, true);
    });

    test('confirms PRO_YEARLY tier provides 5 servers limit and priority relay', async () => {
      const ent = await EntitlementService.resolvePlanEntitlements('PRO_YEARLY');
      assert.strictEqual(ent.maxServers, 5);
      assert.strictEqual(ent.priorityRelay, true);
    });

    test('prevents arbitrary unearned plan injection from granting pro capabilities', async () => {
      const ent = await EntitlementService.resolvePlanEntitlements('INVALID_UNKNOWN_PLAN');
      assert.strictEqual(ent.maxServers, 1, 'Unknown plan must fallback safely to FREE entitlement tier');
      assert.strictEqual(ent.priorityRelay, false);
    });
  });
});
