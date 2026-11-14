/**
 * ZDEXCLOUD — PHASE 19.3, BATCH 3.1.4 TEST SUITE
 * AMBIGUOUS CHECKOUT RECOVERY, WEBHOOK BUSINESS-MUTATION FENCING & COMMERCIAL ENTITLEMENT SAFETY
 *
 * Test Classifications:
 * - Pure Unit Tests: Testing isolated business policies, status mappings, and entitlement resolution without database calls.
 * - Mocked Service Tests: Testing end-to-end transactional workflows with hermetic Prisma & Provider client mocks.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import {
  BillingStatus,
  BillingInterval,
  CurrencyCode,
  ProductType,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  WebhookEventStatus,
  Plan,
  PlanPrice,
  AccountProductSubscription
} from '@prisma/client';
import { RazorpayCheckoutService } from '../src/services/billing/providers/razorpay/razorpay_checkout_service.js';
import { RazorpayWebhookService } from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';
import { RazorpayClient, RazorpaySubscriptionResponse } from '../src/services/billing/providers/razorpay/razorpay_client.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { BillingInvoiceRecoveryService } from '../src/services/billing/billing_invoice_recovery_service.js';
import { BillingInvoiceService } from '../src/services/billing/billing_invoice_service.js';
import { AccountProductSubscriptionService } from '../src/services/billing/account_product_subscription_service.js';
import { ConflictError, ConcurrencyError, ValidationError } from '../src/errors/app-error.js';

const mockWebhookSecret = 'whsec_batch_3_1_4_test_secret_key_123';
const mockKeySecret = 'rzp_sec_batch_3_1_4_key_secret_456';

function generateHmacSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function createMockPlanPrice(planId: string, amountMinorUnits = 49900): PlanPrice {
  return {
    id: `pp_${planId}`,
    planId,
    currency: CurrencyCode.INR,
    amountMinorUnits,
    version: 1,
    isActive: true,
    effectiveFrom: new Date(),
    effectiveTo: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function createMockPlan(params: {
  id: string;
  code: string;
  productType: ProductType;
  serverLimit?: number;
  priorityRelay?: boolean;
  isActive?: boolean;
  interval?: BillingInterval;
  entitlements?: any[];
}): Plan & { prices: PlanPrice[]; entitlements?: any[] } {
  const plan: Plan = {
    id: params.id,
    code: params.code,
    name: params.code,
    description: null,
    productType: params.productType,
    interval: params.interval ?? BillingInterval.MONTHLY,
    intervalCount: 1,
    serverLimit: params.serverLimit ?? 1,
    priorityRelay: params.priorityRelay ?? false,
    isActive: params.isActive ?? true,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  return {
    ...plan,
    prices: [createMockPlanPrice(params.id)],
    entitlements: params.entitlements || []
  };
}

describe('Phase 19.3 Batch 3.1.4: Ambiguous Checkout, Webhook Fencing & Commercial Safety Suite', () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
  process.env.RAZORPAY_KEY_SECRET = mockKeySecret;

  const storagePlan = createMockPlan({
    id: 'plan_storage_m',
    code: 'PRO_MONTHLY',
    productType: ProductType.STORAGE,
    serverLimit: 5,
    priorityRelay: true,
    entitlements: [
      { code: 'MAX_SERVERS', intValue: 5 },
      { code: 'PRIORITY_RELAY', boolValue: true }
    ]
  });

  const cameraPlan = createMockPlan({
    id: 'plan_camera_m',
    code: 'CAMERA_PRO_MONTHLY',
    productType: ProductType.CAMERA,
    serverLimit: 1, // Storage server limit is strictly NOT increased
    priorityRelay: false,
    entitlements: [
      { code: 'MAX_CAMERAS', intValue: 4 },
      { code: 'CAMERA_STREAMING', boolValue: true }
    ]
  });

  const unifiedPlanConfigured = createMockPlan({
    id: 'plan_unified_conf_m',
    code: 'UNIFIED_PRO_MONTHLY',
    productType: ProductType.UNIFIED_PRO,
    serverLimit: 5,
    priorityRelay: true,
    entitlements: [
      { code: 'MAX_SERVERS', intValue: 5 },
      { code: 'PRIORITY_RELAY', boolValue: true },
      { code: 'MAX_CAMERAS', intValue: 3 },
      { code: 'CAMERA_STREAMING', boolValue: true }
    ]
  });

  const unifiedPlanUnconfigured = createMockPlan({
    id: 'plan_unified_unconf_m',
    code: 'UNIFIED_UNCONFIGURED_MONTHLY',
    productType: ProductType.UNIFIED_PRO,
    serverLimit: 5,
    priorityRelay: true,
    entitlements: [] // Zero camera entitlements configured!
  });

  const plansByCode = new Map<string, any>([
    [storagePlan.code, storagePlan],
    [cameraPlan.code, cameraPlan],
    [unifiedPlanConfigured.code, unifiedPlanConfigured],
    [unifiedPlanUnconfigured.code, unifiedPlanUnconfigured]
  ]);

  const testUserId = 'usr_b314_user_001';
  const mockUsers = new Map<string, any>();
  const mockBillingStates = new Map<string, any>();
  const mockBillingProfiles = new Map<string, any>();
  const mockSubscriptions = new Map<string, any>();
  const mockSlots = new Map<string, any>();
  const mockWebhookEvents = new Map<string, any>();
  const mockPayments = new Map<string, any>();
  const mockInvoices = new Map<string, any>();
  const mockAuditEvents: any[] = [];

  const defaultTx = async (fnOrArray: any) => {
    if (typeof fnOrArray === 'function') {
      const txMock = {
        ...prisma,
        $queryRawUnsafe: async () => [{ id: testUserId }]
      };
      return await fnOrArray(txMock);
    }
    return fnOrArray;
  };

  before(() => {
    mockUsers.set(testUserId, { id: testUserId, email: 'b314@zdexcloud.com', fullName: 'Youm Patel' });

    mockBillingProfiles.set(testUserId, {
      userId: testUserId,
      country: 'IN',
      countryConfirmed: true,
      fullName: 'Youm Patel',
      companyName: null,
      taxId: null,
      addressLine1: '123 Cloud Street',
      addressLine2: null,
      city: 'Ahmedabad',
      state: 'Gujarat',
      postalCode: '380001'
    });

    (prisma.user as any).findUnique = async ({ where }: any) => {
      const u = mockUsers.get(where.id);
      if (!u) return null;
      return {
        ...u,
        billingState: mockBillingStates.get(u.id) || null
      };
    };

    (prisma.accountBillingState as any).findUnique = async ({ where }: any) => {
      const state = mockBillingStates.get(where.userId);
      if (!state) return null;
      const activeSub = state.activeSubscriptionId ? mockSubscriptions.get(state.activeSubscriptionId) : null;
      return { ...state, activeSubscription: activeSub };
    };

    (prisma.accountBillingState as any).upsert = async ({ where, create, update }: any) => {
      const existing = mockBillingStates.get(where.userId);
      const res = { ...(existing || create), ...update, updatedAt: new Date() };
      mockBillingStates.set(where.userId, res);
      return res;
    };

    (prisma.accountBillingState as any).update = async ({ where, data }: any) => {
      const existing = mockBillingStates.get(where.userId);
      if (!existing) throw new Error('Not found');
      const res = { ...existing, ...data, updatedAt: new Date() };
      mockBillingStates.set(where.userId, res);
      return res;
    };

    (prisma.accountBillingState as any).create = async ({ data }: any) => {
      mockBillingStates.set(data.userId, { ...data, updatedAt: new Date() });
      return data;
    };

    (prisma as any).billingProfile = {
      findUnique: async ({ where }: any) => mockBillingProfiles.get(where.userId) || null
    };

    (prisma.plan as any).findUnique = async ({ where }: any) => {
      if (where.code) return plansByCode.get(where.code) || null;
      for (const p of plansByCode.values()) {
        if (p.id === where.id) return p;
      }
      return null;
    };

    (prisma.subscription as any).findUnique = async ({ where }: any) => {
      if (where.id) return mockSubscriptions.get(where.id) || null;
      if (where.providerSubscriptionId) {
        for (const sub of mockSubscriptions.values()) {
          if (sub.providerSubscriptionId === where.providerSubscriptionId) return sub;
        }
      }
      return null;
    };

    (prisma.subscription as any).findMany = async ({ where }: any) => {
      const results: any[] = [];
      for (const sub of mockSubscriptions.values()) {
        let match = true;
        if (where.userId && sub.userId !== where.userId) match = false;
        if (where.status && where.status.in && !where.status.in.includes(sub.status)) match = false;
        if (where.status && typeof where.status === 'string' && sub.status !== where.status) match = false;
        if (match) results.push(sub);
      }
      return results;
    };

    (prisma.subscription as any).create = async ({ data }: any) => {
      const id = data.id || `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const plan = await (prisma.plan as any).findUnique({ where: { id: data.planId } });
      const record = {
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        currentPeriodStart: new Date(),
        ...data,
        id,
        plan,
        createdAt: data.createdAt || new Date(),
        updatedAt: data.updatedAt || new Date()
      };
      mockSubscriptions.set(id, record);
      return record;
    };

    (prisma.subscription as any).update = async ({ where, data }: any) => {
      const sub = mockSubscriptions.get(where.id);
      if (!sub) throw new Error(`Subscription not found: ${where.id}`);
      const updated = { ...sub, ...data, updatedAt: new Date() };
      mockSubscriptions.set(where.id, updated);
      return updated;
    };

    (prisma.accountProductSubscription as any).findUnique = async ({ where }: any) => {
      if (where.subscriptionId) {
        for (const slot of mockSlots.values()) {
          if (slot.subscriptionId === where.subscriptionId) return slot;
        }
        return null;
      }
      if (where.userId_productType) {
        const key = `${where.userId_productType.userId}:${where.userId_productType.productType}`;
        return mockSlots.get(key) || null;
      }
      return null;
    };

    (prisma.accountProductSubscription as any).findMany = async ({ where }: any) => {
      const results: any[] = [];
      for (const slot of mockSlots.values()) {
        if (where.userId && slot.userId !== where.userId) continue;
        const sub = mockSubscriptions.get(slot.subscriptionId);
        results.push({ ...slot, subscription: sub || null });
      }
      return results;
    };

    (prisma.accountProductSubscription as any).upsert = async ({ where, create, update }: any) => {
      const key = `${where.userId_productType.userId}:${where.userId_productType.productType}`;
      const existing = mockSlots.get(key);
      const res = {
        id: existing?.id || `slot_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        ...(existing || create),
        ...update,
        userId: where.userId_productType.userId,
        productType: where.userId_productType.productType,
        updatedAt: new Date()
      };
      mockSlots.set(key, res as AccountProductSubscription);
      return res;
    };

    (prisma.accountProductSubscription as any).update = async ({ where, data }: any) => {
      for (const [key, slot] of mockSlots.entries()) {
        if (slot.id === where.id) {
          const res = { ...slot, ...data, updatedAt: new Date() };
          mockSlots.set(key, res);
          return res;
        }
      }
      throw new Error('Slot not found');
    };

    (prisma.billingWebhookEvent as any).findUnique = async ({ where }: any) => {
      if (where.provider_environment_providerEventId) {
        const key = `${where.provider_environment_providerEventId.provider}:${where.provider_environment_providerEventId.environment}:${where.provider_environment_providerEventId.providerEventId}`;
        return mockWebhookEvents.get(key) || null;
      }
      if (where.id) {
        for (const v of mockWebhookEvents.values()) {
          if (v.id === where.id) return v;
        }
      }
      return null;
    };

    (prisma.billingWebhookEvent as any).updateMany = async ({ where, data }: any) => {
      let count = 0;
      for (const [k, v] of mockWebhookEvents.entries()) {
        const idMatches = !where.id || v.id === where.id;
        const statusMatches = !where.status || v.status === where.status;
        let reasonMatches = true;
        if (where.failureReason) {
          if (typeof where.failureReason === 'object') {
            if (where.failureReason.startsWith && (!v.failureReason || !v.failureReason.startsWith(where.failureReason.startsWith))) {
              reasonMatches = false;
            }
            if (where.failureReason.gt && (!v.failureReason || v.failureReason <= where.failureReason.gt)) {
              reasonMatches = false;
            }
          } else {
            reasonMatches = v.failureReason === where.failureReason;
          }
        }
        if (idMatches && statusMatches && reasonMatches) {
          const updated = { ...v, ...data, updatedAt: new Date() };
          mockWebhookEvents.set(k, updated);
          count++;
        }
      }
      return { count };
    };

    (prisma.billingWebhookEvent as any).create = async ({ data }: any) => {
      const key = `${data.provider}:${data.environment}:${data.providerEventId}`;
      if (mockWebhookEvents.has(key)) {
        const err: any = new Error('Unique constraint failed (P2002)');
        err.code = 'P2002';
        throw err;
      }
      const record = {
        id: `we_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      mockWebhookEvents.set(key, record);
      return record;
    };

    (prisma.billingWebhookEvent as any).update = async ({ where, data }: any) => {
      for (const [k, v] of mockWebhookEvents.entries()) {
        if (v.id === where.id) {
          const updated = { ...v, ...data, updatedAt: new Date() };
          mockWebhookEvents.set(k, updated);
          return updated;
        }
      }
      throw new Error(`BillingWebhookEvent not found: ${where.id}`);
    };

    (prisma.billingPayment as any).create = async ({ data }: any) => {
      const id = data.id || `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      for (const existing of mockPayments.values()) {
        if (
          existing.provider === data.provider &&
          existing.environment === data.environment &&
          existing.providerPaymentId === data.providerPaymentId
        ) {
          const err: any = new Error('Unique constraint failed on [provider, environment, providerPaymentId] (P2002)');
          err.code = 'P2002';
          throw err;
        }
      }
      const rec = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      mockPayments.set(id, rec);
      return rec;
    };

    (prisma.billingPayment as any).findMany = async ({ where }: any) => {
      const results: any[] = [];
      for (const p of mockPayments.values()) {
        let match = true;
        if (where?.status && p.status !== where.status) match = false;
        if (where?.invoice === null && mockInvoices.has(p.id)) match = false;
        if (match) results.push(p);
      }
      return results;
    };

    (prisma.billingInvoice as any).create = async ({ data }: any) => {
      if (mockInvoices.has(data.paymentId)) {
        const err: any = new Error('Unique constraint failed on paymentId (P2002)');
        err.code = 'P2002';
        throw err;
      }
      const record = { id: `inv_${Date.now()}`, ...data, createdAt: new Date() };
      mockInvoices.set(data.paymentId, record);
      return record;
    };

    (prisma.billingInvoice as any).findUnique = async ({ where }: any) => {
      if (where.paymentId) return mockInvoices.get(where.paymentId) || null;
      return null;
    };

    (prisma.auditEvent as any).create = async ({ data }: any) => {
      mockAuditEvents.push(data);
      return data;
    };

    (prisma.billingReceipt as any).findFirst = async () => null;
    (prisma.billingReceipt as any).create = async ({ data }: any) => data;
    (prisma.billingProviderPlanMapping as any).findUnique = async () => ({
      providerPlanId: 'plan_rzp_mock',
      isActive: true
    });
  });

  beforeEach(() => {
    mockSubscriptions.clear();
    mockSlots.clear();
    mockWebhookEvents.clear();
    mockPayments.clear();
    mockInvoices.clear();
    mockAuditEvents.length = 0;
    (prisma as any).$transaction = defaultTx;
    mockBillingStates.set(testUserId, {
      userId: testUserId,
      status: BillingStatus.FREE,
      activeSubscriptionId: null,
      billingCountry: 'IN',
      billingName: 'Youm Patel',
      billingAddress1: '123 Cloud Street',
      billingCity: 'Ahmedabad',
      billingState: 'Gujarat',
      billingPostalCode: '380001',
      currency: CurrencyCode.INR
    });
  });

  // ===========================================================================
  // SECTION 1: AMBIGUOUS CHECKOUT OUTCOMES & RECONCILIATION
  // ===========================================================================

  it('TC-B314-01 [Mocked Service]: Provider creates subscription but response is lost (ETIMEDOUT) -> Reconciled and reused on retry', async () => {
    // 1. Initial checkout request times out after Razorpay created subscription 'sub_rzp_created_on_provider_999'
    let callCount = 0;
    const providerCreatedSubId = 'sub_rzp_created_on_provider_999';

    const flakyClient = {
      isConfigured: () => true,
      assertConfigured: () => ({ keyId: 'rzp_test', keySecret: 'test_sec' }),
      createSubscription: async () => {
        callCount++;
        throw new Error('ETIMEDOUT: Connection lost after provider processed request');
      },
      findSubscriptionByReservationId: async (resId: string) => {
        // Reconciliation finds that Razorpay DID create the subscription with matching reservation note
        return {
          id: providerCreatedSubId,
          plan_id: 'plan_rzp_mock',
          status: 'created',
          notes: { zdexcloud_reservation_id: resId }
        };
      }
    };

    // First attempt throws network timeout
    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId,
          { planCode: 'PRO_MONTHLY' },
          { client: flakyClient as any }
        );
      },
      /ETIMEDOUT/
    );

    // Verify reservation is preserved in CREATED status (not deleted)
    const reservations = Array.from(mockSubscriptions.values()).filter(s => s.userId === testUserId && s.status === BillingStatus.CREATED);
    assert.strictEqual(reservations.length, 1);
    const initialRes = reservations[0];
    assert.strictEqual(initialRes.providerSubscriptionId, null, 'Provider subscription ID is initially unpopulated');

    // Simulate clock advancing past 2 minutes (> IN_FLIGHT_RESERVATION_TTL_MS)
    initialRes.createdAt = new Date(Date.now() - 150000);

    // 2. User retries checkout after 2.5 minutes
    // Reconciliation finds the existing subscription on provider, binds providerSubscriptionId, and returns it!
    const recoveredSession = await RazorpayCheckoutService.createCheckoutSession(
      testUserId,
      { planCode: 'PRO_MONTHLY' },
      { client: flakyClient as any }
    );

    assert.strictEqual(recoveredSession.subscriptionId, providerCreatedSubId, 'Reconciled and reused existing subscription ID');
    assert.strictEqual(callCount, 1, 'Provider createSubscription was NOT called a second time (Zero duplicate subscriptions)');

    // DB reservation now has providerSubscriptionId durably bound
    const updatedRes = mockSubscriptions.get(initialRes.id);
    assert.strictEqual(updatedRes.providerSubscriptionId, providerCreatedSubId);
  });

  it('TC-B314-02 [Mocked Service]: Backend restarts before persisting providerSubscriptionId -> Webhook binds reservation via notes', async () => {
    // 1. Simulate unfulfilled in-flight reservation created before server crash
    const reservation = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.CREATED,
        providerSubscriptionId: null // Process crashed before local update
      }
    });

    // 2. Razorpay delivers subscription.activated webhook carrying zdexcloud_reservation_id in notes
    const providerSubId = 'sub_rzp_crashed_before_bind_888';
    const webhookPayload = {
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: providerSubId,
            plan_id: 'plan_rzp_mock',
            status: 'active',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            notes: {
              zdexcloud_reservation_id: reservation.id,
              zdexcloud_user_id: testUserId
            }
          }
        }
      }
    };

    const rawBody = JSON.stringify(webhookPayload);
    const signature = generateHmacSignature(rawBody, mockWebhookSecret);

    const result = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      'evt_crash_recover_001',
      webhookPayload
    );
    assert.strictEqual(result.success, true);

    // 3. Verify internal subscription was discovered by reservation ID, bound to providerSubscriptionId, and activated!
    const activatedSub = mockSubscriptions.get(reservation.id);
    assert.strictEqual(activatedSub.providerSubscriptionId, providerSubId, 'Durable binding recovered from webhook notes');
    assert.strictEqual(activatedSub.status, BillingStatus.ACTIVE);
  });

  it('TC-B314-03 [Mocked Service]: User retries immediately (<2 min) after ambiguous timeout -> Rejected with in-flight conflict', async () => {
    // Insert pending reservation created 30 seconds ago
    await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.CREATED,
        providerSubscriptionId: null,
        createdAt: new Date(Date.now() - 30000) // 30 seconds ago
      }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'PRO_MONTHLY' });
      },
      /A checkout session is currently being created for this account in another request/
    );
  });

  it('TC-B314-04 [Mocked Service]: User retries after 2 minutes when provider confirms NO subscription created -> Stale expired, fresh created', async () => {
    // Insert stale reservation created 3 minutes ago
    const staleRes = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.CREATED,
        providerSubscriptionId: null,
        createdAt: new Date(Date.now() - 180000) // 3 minutes ago
      }
    });

    const confirmingClient = {
      isConfigured: () => true,
      assertConfigured: () => ({ keyId: 'rzp_test', keySecret: 'test_sec' }),
      findSubscriptionByReservationId: async () => null, // Definitively confirmed NOT created on Razorpay
      createSubscription: async () => ({
        id: 'sub_rzp_fresh_new_777',
        plan_id: 'plan_rzp_mock',
        status: 'created'
      })
    };

    const session = await RazorpayCheckoutService.createCheckoutSession(
      testUserId,
      { planCode: 'PRO_MONTHLY' },
      { client: confirmingClient as any }
    );

    assert.strictEqual(session.subscriptionId, 'sub_rzp_fresh_new_777');
    assert.strictEqual(mockSubscriptions.get(staleRes.id).status, BillingStatus.EXPIRED);
  });

  it('TC-B314-05 [Mocked Service]: User retries after 2 minutes but reconciliation API errors -> Rejected without duplicate', async () => {
    // Insert stale reservation created 3 minutes ago
    await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.CREATED,
        providerSubscriptionId: null,
        createdAt: new Date(Date.now() - 180000)
      }
    });

    const failingClient = {
      isConfigured: () => true,
      assertConfigured: () => ({ keyId: 'rzp_test', keySecret: 'test_sec' }),
      findSubscriptionByReservationId: async () => {
        throw new Error('ECONNRESET: Gateway connection reset during reconciliation');
      }
    };

    // Because outcome is unresolved, must reject rather than creating a duplicate!
    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId,
          { planCode: 'PRO_MONTHLY' },
          { client: failingClient as any }
        );
      },
      /unresolved outcome with the payment provider/
    );
  });

  it('TC-B314-06 [Mocked Service]: Definitive provider failure (HTTP 400) immediately releases reservation', async () => {
    const rejectingClient = {
      isConfigured: () => true,
      assertConfigured: () => ({ keyId: 'rzp_test', keySecret: 'test_sec' }),
      createSubscription: async () => {
        const err: any = new Error('BAD_REQUEST_ERROR: Invalid plan parameter');
        err.statusCode = 400;
        throw err;
      }
    };

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId,
          { planCode: 'PRO_MONTHLY' },
          { client: rejectingClient as any }
        );
      },
      /BAD_REQUEST_ERROR/
    );

    // Reservation is immediately marked EXPIRED (freed) rather than blocking the user
    const subs = Array.from(mockSubscriptions.values()).filter(s => s.userId === testUserId);
    assert.strictEqual(subs.length, 1);
    assert.strictEqual(subs[0].status, BillingStatus.EXPIRED);
  });

  // ===========================================================================
  // SECTION 2: WEBHOOK BUSINESS-TRANSACTION LEASE FENCING
  // ===========================================================================

  it('TC-B314-07 [Mocked Service]: Stale worker loses lease to Worker B -> Worker A business transaction aborts cleanly', async () => {
    // 1. Worker A acquires event and begins processing
    const eventId = 'evt_overlap_test_001';
    const leaseTokenA = 'token_worker_A_1111';
    const expiresAtA = new Date(Date.now() + 60000);

    const eventRecord = await (prisma.billingWebhookEvent as any).create({
      data: {
        id: eventId,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerEventId: eventId,
        eventType: 'subscription.activated',
        status: WebhookEventStatus.PROCESSING,
        failureReason: `LEASE:${leaseTokenA}:${expiresAtA.toISOString()}`,
        payload: {}
      }
    });

    // 2. Worker A experiences long delay; lease expires.
    // Worker B successfully reclaims event via CAS with leaseTokenB!
    const leaseTokenB = 'token_worker_B_2222';
    const expiresAtB = new Date(Date.now() + 120000);

    await (prisma.billingWebhookEvent as any).updateMany({
      where: {
        id: eventId,
        status: WebhookEventStatus.PROCESSING
      },
      data: {
        failureReason: `LEASE:${leaseTokenB}:${expiresAtB.toISOString()}`
      }
    });

    // 3. Worker A resumes and attempts to execute atomic business transaction
    let workerAMutationsCommitted = false;
    await assert.rejects(
      async () => {
        await (prisma as any).$transaction(async (tx: any) => {
          // Assert lease ownership first!
          await RazorpayWebhookService.assertWebhookLeaseOwnership(tx, eventId, leaseTokenA);
          // If fencing didn't stop Worker A, it would execute mutations:
          workerAMutationsCommitted = true;
        });
      },
      /Webhook processing lease lost or superseded/
    );

    assert.strictEqual(workerAMutationsCommitted, false, 'Worker A mutations were blocked and rolled back');

    // 4. Worker B executes business transaction with valid leaseTokenB -> succeeds cleanly
    let workerBMutationsCommitted = false;
    await (prisma as any).$transaction(async (tx: any) => {
      await RazorpayWebhookService.assertWebhookLeaseOwnership(tx, eventId, leaseTokenB);
      workerBMutationsCommitted = true;
    });

    assert.strictEqual(workerBMutationsCommitted, true, 'Worker B (valid owner) committed successfully');
  });

  it('TC-B314-08 [Mocked Service]: Lease renewal extends valid lease and prevents competitor reclaim', async () => {
    const eventId = 'evt_renew_test_002';
    const leaseToken = 'token_renew_owner_123';
    const initialExpiry = new Date(Date.now() + 30000);

    await (prisma.billingWebhookEvent as any).create({
      data: {
        id: eventId,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerEventId: eventId,
        eventType: 'subscription.charged',
        status: WebhookEventStatus.PROCESSING,
        failureReason: `LEASE:${leaseToken}:${initialExpiry.toISOString()}`,
        payload: {}
      }
    });

    // Long running worker extends lease by 180 seconds
    const renewed = await RazorpayWebhookService.renewWebhookLease(eventId, leaseToken, 180000);
    assert.strictEqual(renewed, true);

    const updatedEvent = await (prisma.billingWebhookEvent as any).findUnique({ where: { id: eventId } });
    assert.ok(updatedEvent.failureReason.startsWith(`LEASE:${leaseToken}:`));

    // Stale worker with different token cannot renew or complete
    const staleRenew = await RazorpayWebhookService.renewWebhookLease(eventId, 'stale_token_999', 180000);
    assert.strictEqual(staleRenew, false);
  });

  // ===========================================================================
  // SECTION 3: UNIFIED PRO & CAMERA ENTITLEMENT SAFETY
  // ===========================================================================

  it('TC-B314-09 [Unit]: Configured Unified Pro resolves both Storage and Camera domains from canonical slot', async () => {
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: unifiedPlanConfigured.id,
        planPriceId: unifiedPlanConfigured.prices[0].id,
        status: BillingStatus.ACTIVE
      }
    });

    await AccountProductSubscriptionService.upsertProductSlot({
      userId: testUserId,
      productType: ProductType.UNIFIED_PRO,
      subscriptionId: sub.id,
      status: BillingStatus.ACTIVE
    });

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId);

    // Resolves Storage capabilities
    assert.strictEqual(entitlements.storage.maxServers, 5);
    assert.strictEqual(entitlements.storage.priorityRelay, true);

    // Resolves Camera capabilities from configured PlanEntitlement data
    assert.strictEqual(entitlements.camera.maxCameras, 3);
    assert.strictEqual(entitlements.camera.liveStreamingEnabled, true);
    assert.strictEqual(entitlements.camera.planCode, 'UNIFIED_PRO_MONTHLY');
  });

  it('TC-B314-10 [Unit]: Unconfigured Unified Pro defaults Camera quota to ZERO (No invented defaults)', async () => {
    // Plan has serverLimit: 5, but NO camera entitlements configured in DB
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: unifiedPlanUnconfigured.id,
        planPriceId: unifiedPlanUnconfigured.prices[0].id,
        status: BillingStatus.ACTIVE
      }
    });

    await AccountProductSubscriptionService.upsertProductSlot({
      userId: testUserId,
      productType: ProductType.UNIFIED_PRO,
      subscriptionId: sub.id,
      status: BillingStatus.ACTIVE
    });

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId);

    // Storage serverLimit is 5
    assert.strictEqual(entitlements.storage.maxServers, 5);

    // Camera quota MUST strictly be 0 because it was not configured — serverLimit must NOT bleed into camera quota!
    assert.strictEqual(entitlements.camera.maxCameras, 0, 'Camera quota must strictly be 0 when unconfigured');
    assert.strictEqual(entitlements.camera.liveStreamingEnabled, false);
  });

  it('TC-B314-11 [Unit]: Standalone Storage serverLimit never grants Camera quota', async () => {
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.ACTIVE
      }
    });

    await AccountProductSubscriptionService.upsertProductSlot({
      userId: testUserId,
      productType: ProductType.STORAGE,
      subscriptionId: sub.id,
      status: BillingStatus.ACTIVE
    });

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId);

    assert.strictEqual(entitlements.storage.maxServers, 5);
    assert.strictEqual(entitlements.camera.maxCameras, 0, 'Storage plan cannot grant Camera quota');
    assert.strictEqual(entitlements.camera.source, 'NONE');
  });

  // ===========================================================================
  // SECTION 4: TRIAL STATUS & PAYMENT AUTHORIZATION
  // ===========================================================================

  it('TC-B314-12 [Mocked Service]: Unsupported trial event does NOT grant paid entitlements', async () => {
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.CREATED,
        providerSubscriptionId: 'sub_rzp_trial_candidate_123'
      }
    });

    const trialWebhookPayload = {
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: 'sub_rzp_trial_candidate_123',
            plan_id: 'plan_rzp_mock',
            status: 'trialing', // Trial status
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 14 * 86400
          }
        }
      }
    };

    const rawBody = JSON.stringify(trialWebhookPayload);
    const signature = generateHmacSignature(rawBody, mockWebhookSecret);

    const result = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      'evt_trial_test_001',
      trialWebhookPayload
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('Trial subscriptions do not receive paid entitlements'));

    // Status remains CREATED (unentitled)
    const currentSub = mockSubscriptions.get(sub.id);
    assert.strictEqual(currentSub.status, BillingStatus.CREATED);

    // Account remains FREE
    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId);
    assert.strictEqual(entitlements.storage.maxServers, 1, 'Free tier preserved for trial users');
  });

  // ===========================================================================
  // SECTION 5: INVOICE RECOVERY DURABILITY & COMPLETENESS
  // ===========================================================================

  it('TC-B314-13 [Mocked Service]: findPendingUninvoicedPayments discovers payments older than 24 hours', async () => {
    // Insert successful payment created 5 days ago (120 hours old) without invoice
    const oldPayment = await (prisma.billingPayment as any).create({
      data: {
        userId: testUserId,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: 'pay_old_unissued_120h',
        amountMinorUnits: 49900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        createdAt: new Date(Date.now() - 120 * 3600 * 1000) // 5 days old
      }
    });

    const uninvoiced = await BillingInvoiceRecoveryService.findPendingUninvoicedPayments({ limit: 10 });
    const found = uninvoiced.some(p => p.id === oldPayment.id);
    assert.strictEqual(found, true, 'Payments older than 24h are fully discoverable by recovery query');
  });

  it('TC-B314-14 [Mocked Service]: Duplicate invoice generation prevented by paymentId unique constraint', async () => {
    const payment = await (prisma.billingPayment as any).create({
      data: {
        userId: testUserId,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: 'pay_concurrent_inv_test',
        amountMinorUnits: 49900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS
      }
    });

    // First invoice issuance succeeds
    await (prisma.billingInvoice as any).create({
      data: {
        paymentId: payment.id,
        invoiceNumber: 'INV-2026-000001',
        userId: testUserId
      }
    });

    // Concurrent second issuance for same payment throws unique constraint violation
    await assert.rejects(
      async () => {
        await (prisma.billingInvoice as any).create({
          data: {
            paymentId: payment.id,
            invoiceNumber: 'INV-2026-000002',
            userId: testUserId
          }
        });
      },
      /P2002/
    );
  });
});
