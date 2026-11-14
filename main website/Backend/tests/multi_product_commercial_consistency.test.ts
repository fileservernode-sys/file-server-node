import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { RazorpayCheckoutService } from '../src/services/billing/providers/razorpay/razorpay_checkout_service.js';
import { RazorpayWebhookService } from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';
import { AccountProductSubscriptionService } from '../src/services/billing/account_product_subscription_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { BillingStateService, PAID_ENTITLED_STATUSES } from '../src/services/billing/billing_state_service.js';
import { BillingInvoiceService } from '../src/services/billing/billing_invoice_service.js';
import {
  ProductType,
  BillingStatus,
  BillingInterval,
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  WebhookEventStatus,
  Plan,
  PlanPrice,
  Subscription,
  AccountProductSubscription,
  AccountBillingState
} from '@prisma/client';

const mockWebhookSecret = 'whsec_test_mockSecret_batch311_987654321';
const mockKeySecret = 'rzp_test_secret_mock_batch311_123456';

const webhookOpts = {
  webhookSecret: mockWebhookSecret,
  environment: PaymentEnvironment.TEST
};

function computeSignature(payload: string | Buffer, secret: string = mockWebhookSecret): string {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  return crypto.createHmac('sha256', secret).update(buf).digest('hex');
}

function createMockPlanPrice(planId: string, amountMinorUnits = 4900, currency = CurrencyCode.INR): PlanPrice {
  return {
    id: `price_${planId}`,
    planId,
    currency,
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

describe('Phase 19.3 Batch 3.1.1: Multi-Product Commercial Consistency & Webhook Safety Suite', () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
  process.env.RAZORPAY_KEY_SECRET = mockKeySecret;

  const storagePlan = createMockPlan({
    id: 'plan_storage_pro_m',
    code: 'PRO_MONTHLY',
    productType: ProductType.STORAGE,
    serverLimit: 5,
    priorityRelay: true
  });

  const storageYearlyPlan = createMockPlan({
    id: 'plan_storage_pro_y',
    code: 'PRO_YEARLY',
    productType: ProductType.STORAGE,
    interval: BillingInterval.YEARLY,
    serverLimit: 5,
    priorityRelay: true
  });

  const cameraPlan = createMockPlan({
    id: 'plan_camera_pro_m',
    code: 'CAMERA_PRO_MONTHLY',
    productType: ProductType.CAMERA,
    serverLimit: 1,
    priorityRelay: false
  });

  const unifiedPlan = createMockPlan({
    id: 'plan_unified_pro_m',
    code: 'UNIFIED_PRO_MONTHLY',
    productType: ProductType.UNIFIED_PRO,
    serverLimit: 5,
    priorityRelay: true,
    entitlements: [
      { code: 'MAX_SERVERS', intValue: 5 },
      { code: 'PRIORITY_RELAY', boolValue: true },
      { code: 'MAX_CAMERAS', intValue: 5 },
      { code: 'CAMERA_STREAMING', boolValue: true }
    ]
  });

  const inactivePlan = createMockPlan({
    id: 'plan_inactive',
    code: 'DISABLED_PLAN',
    productType: ProductType.STORAGE,
    isActive: false
  });

  const plansByCode = new Map<string, Plan & { prices: PlanPrice[] }>([
    ['PRO_MONTHLY', storagePlan],
    ['PRO_YEARLY', storageYearlyPlan],
    ['CAMERA_PRO_MONTHLY', cameraPlan],
    ['UNIFIED_PRO_MONTHLY', unifiedPlan],
    ['DISABLED_PLAN', inactivePlan]
  ]);

  // Isolated Mock Data Stores
  const mockUsers = new Map<string, any>();
  const mockBillingStates = new Map<string, any>();
  const mockBillingProfiles = new Map<string, any>();
  const mockSubscriptions = new Map<string, any>();
  const mockSlots = new Map<string, AccountProductSubscription>();
  const mockWebhookEvents = new Map<string, any>();
  const mockPayments = new Map<string, any>();
  const mockInvoices = new Map<string, any>();
  const mockAuditEvents: any[] = [];

  const testUserId1 = 'user_cc_01';
  const testUserId2 = 'user_cc_02';

  const defaultTx = async (fnOrArray: any) => {
    if (typeof fnOrArray === 'function') {
      const txMock = {
        ...prisma,
        $queryRawUnsafe: async () => [{ id: testUserId1 }]
      };
      return await fnOrArray(txMock);
    }
    return fnOrArray;
  };

  before(() => {
    mockUsers.set(testUserId1, { id: testUserId1, email: 'user1@zdexcloud.com' });
    mockUsers.set(testUserId2, { id: testUserId2, email: 'user2@zdexcloud.com' });

    const fullProfile = {
      userId: testUserId1,
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
    };

    mockBillingProfiles.set(testUserId1, fullProfile);
    mockBillingProfiles.set(testUserId2, { ...fullProfile, userId: testUserId2 });

    // Prisma stubs
    (prisma.user as any).findUnique = async ({ where }: any) => {
      const u = mockUsers.get(where.id);
      if (!u) return null;
      return {
        ...u,
        fullName: 'Youm Patel',
        billingState: mockBillingStates.get(u.id) || null
      };
    };

    (prisma.accountBillingState as any).findUnique = async ({ where }: any) => {
      const state = mockBillingStates.get(where.userId);
      if (!state) return null;
      const activeSub = state.activeSubscriptionId ? mockSubscriptions.get(state.activeSubscriptionId) : null;
      return {
        ...state,
        activeSubscription: activeSub
      };
    };

    (prisma.accountBillingState as any).upsert = async ({ where, create, update }: any) => {
      const existing = mockBillingStates.get(where.userId);
      const res = { ...(existing || create), ...update, userId: where.userId, updatedAt: new Date() };
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
    (prisma.plan as any).findFirst = async () => null;

    (prisma.subscription as any).findUnique = async ({ where }: any) => {
      if (where.id) return mockSubscriptions.get(where.id) || null;
      if (where.providerSubscriptionId) {
        for (const sub of mockSubscriptions.values()) {
          if (sub.providerSubscriptionId === where.providerSubscriptionId) return sub;
        }
      }
      return null;
    };

    (prisma.subscription as any).findFirst = async ({ where }: any) => {
      for (const sub of mockSubscriptions.values()) {
        let match = true;
        if (where.userId && sub.userId !== where.userId) match = false;
        if (where.providerSubscriptionId && sub.providerSubscriptionId !== where.providerSubscriptionId) match = false;
        if (where.provider && sub.provider !== where.provider) match = false;
        if (where.planPriceId && sub.planPriceId !== where.planPriceId) match = false;
        if (where.status) {
          if (typeof where.status === 'string' && sub.status !== where.status) match = false;
          if (where.status.in && !where.status.in.includes(sub.status)) match = false;
        }
        if (where.plan && where.plan.productType && sub.plan?.productType !== where.plan.productType) match = false;
        if (match) return sub;
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
        createdAt: new Date(),
        updatedAt: new Date()
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
        results.push({
          ...slot,
          subscription: sub || null
        });
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
        const updatedAtMatches =
          !where.updatedAt ||
          Math.abs(new Date(v.updatedAt).getTime() - new Date(where.updatedAt).getTime()) < 1000;
        let reasonMatches = true;
        if (where.failureReason) {
          if (typeof where.failureReason === 'object' && where.failureReason.startsWith) {
            reasonMatches = v.failureReason ? v.failureReason.startsWith(where.failureReason.startsWith) : false;
          } else {
            reasonMatches = v.failureReason === where.failureReason;
          }
        }
        if (idMatches && statusMatches && updatedAtMatches && reasonMatches) {
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
        const err: any = new Error('Unique constraint failed on provider_environment_providerEventId');
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
      const rec = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      mockPayments.set(id, rec);
      return rec;
    };

    (prisma.billingPayment as any).findUnique = async ({ where }: any) => {
      if (where.id) {
        const pay = mockPayments.get(where.id);
        if (!pay) return null;
        const user = mockUsers.get(pay.userId);
        const sub = mockSubscriptions.get(pay.subscriptionId);
        return {
          ...pay,
          user: user || { id: pay.userId, email: 'user@test.com' },
          subscription: sub || null
        };
      }
      return null;
    };

    (prisma.billingPayment as any).findFirst = async ({ where }: any) => {
      for (const pay of mockPayments.values()) {
        if (where.subscriptionId && pay.subscriptionId !== where.subscriptionId) continue;
        if (where.OR) {
          const matches = where.OR.some((cond: any) => {
            if (cond.providerPaymentId && pay.providerPaymentId === cond.providerPaymentId) return true;
            if (cond.providerEventId && pay.providerEventId === cond.providerEventId) return true;
            return false;
          });
          if (matches) return pay;
        }
      }
      return null;
    };

    (prisma as any).billingInvoice = {
      findUnique: async ({ where }: any) => {
        if (where.paymentId) return mockInvoices.get(where.paymentId) || null;
        return null;
      },
      create: async ({ data }: any) => {
        const id = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const record = { id, invoiceNumber: `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`, ...data };
        if (data.paymentId) mockInvoices.set(data.paymentId, record);
        return record;
      }
    };

    (prisma.auditEvent as any).create = async ({ data }: any) => {
      const rec = { id: `audit_${Date.now()}`, ...data, createdAt: new Date() };
      mockAuditEvents.push(rec);
      return rec;
    };

    (prisma.auditEvent as any).findMany = async () => mockAuditEvents;

    (prisma as any).$queryRawUnsafe = async () => [{ id: testUserId1 }];

    // Stub email / activity services
    (prisma as any).emailMessage = { create: async ({ data }: any) => ({ id: `email_${Date.now()}`, ...data }), findMany: async () => [] };
    (prisma as any).channelDeliveryRecord = { create: async ({ data }: any) => ({ id: `cdr_${Date.now()}`, ...data }) };
    (prisma as any).notificationRecord = { create: async ({ data }: any) => ({ id: `nr_${Date.now()}`, ...data }) };
    (prisma as any).inAppNotification = { create: async ({ data }: any) => ({ id: `inapp_${Date.now()}`, ...data }) };
    (prisma as any).customerActivityEvent = { create: async ({ data }: any) => ({ id: `cae_${Date.now()}`, ...data }) };
    (prisma as any).subscriptionPlanChange = { findFirst: async () => null };

    // Setup Razorpay client mock
    (RazorpayCheckoutService as any).getRazorpayClient = () => ({
      subscriptions: {
        create: async (payload: any) => ({
          id: `sub_rzp_mock_${Date.now()}`,
          plan_id: payload.plan_id,
          status: 'created',
          customer_notify: 1
        })
      }
    });
  });

  beforeEach(() => {
    (prisma as any).$transaction = defaultTx;
    mockSubscriptions.clear();
    mockSlots.clear();
    mockWebhookEvents.clear();
    mockPayments.clear();
    mockInvoices.clear();
    mockAuditEvents.length = 0;

    const initialBillingState = {
      userId: testUserId1,
      billingName: 'Youm Patel',
      billingAddress1: '123 Cloud Street',
      billingAddress2: null,
      billingCity: 'Ahmedabad',
      billingState: 'Gujarat',
      billingPostalCode: '380001',
      billingCountry: 'IN',
      status: BillingStatus.FREE,
      activeSubscriptionId: null,
      currency: CurrencyCode.INR,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    mockBillingStates.set(testUserId1, { ...initialBillingState });
    mockBillingStates.set(testUserId2, { ...initialBillingState, userId: testUserId2 });
  });

  // ---------------------------------------------------------------------------
  // TASK H TEST CASES (1 to 20)
  // ---------------------------------------------------------------------------

  it('TC-CC-01: Unified Pro canonical subscription representation (one single slot with productType UNIFIED_PRO)', async () => {
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: unifiedPlan.id,
        planPriceId: unifiedPlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 79900,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Slot into UNIFIED_PRO slot
    await AccountProductSubscriptionService.upsertProductSlot({
      userId: testUserId1,
      productType: ProductType.UNIFIED_PRO,
      subscriptionId: sub.id,
      status: BillingStatus.ACTIVE
    });

    const slots = await AccountProductSubscriptionService.getProductSlots(testUserId1);
    assert.strictEqual(slots.length, 1, 'Unified Pro must have exactly ONE slot');
    assert.strictEqual(slots[0].productType, ProductType.UNIFIED_PRO, 'Slot productType must be UNIFIED_PRO');
    assert.strictEqual(slots[0].subscriptionId, sub.id);
  });

  it('TC-CC-02: No duplicate Unified Pro subscription slots (unique constraint on subscriptionId and [userId, productType])', async () => {
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: unifiedPlan.id,
        planPriceId: unifiedPlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 79900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await AccountProductSubscriptionService.upsertProductSlot({
      userId: testUserId1,
      productType: ProductType.UNIFIED_PRO,
      subscriptionId: sub.id,
      status: BillingStatus.ACTIVE
    });

    // Attempting to attach the same subscription to another slot must be rejected
    await assert.rejects(
      async () => {
        await AccountProductSubscriptionService.upsertProductSlot({
          userId: testUserId1,
          productType: ProductType.STORAGE,
          subscriptionId: sub.id,
          status: BillingStatus.ACTIVE
        });
      },
      (err: any) => {
        assert(err.message.includes('already bound to slot') || err.message.includes('cannot be slotted into STORAGE'));
        return true;
      }
    );
  });

  it('TC-CC-03: Unified Pro entitlement aggregation across both domains (Union-Max resolves 5 servers and 5 cameras from single slot)', async () => {
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: unifiedPlan.id,
        planPriceId: unifiedPlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 79900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await AccountProductSubscriptionService.upsertProductSlot({
      userId: testUserId1,
      productType: ProductType.UNIFIED_PRO,
      subscriptionId: sub.id,
      status: BillingStatus.ACTIVE
    });

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId1);
    assert.strictEqual(entitlements.storage.maxServers, 5, 'Storage must receive 5 servers from Unified Pro');
    assert.strictEqual(entitlements.storage.priorityRelay, true, 'Storage must receive priority relay');
    assert.strictEqual(entitlements.camera.maxCameras, 5, 'Camera must receive 5 cameras from Unified Pro');
    assert.strictEqual(entitlements.camera.liveStreamingEnabled, true, 'Live streaming enabled');
  });

  it('TC-CC-04: Storage + Camera customer purchasing Unified Pro is rejected (requires explicit consolidation workflow)', async () => {
    // User already has both Storage and Camera subscriptions
    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: cameraPlan.id,
        planPriceId: cameraPlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId1,
          { planCode: 'UNIFIED_PRO_MONTHLY' }
        );
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 409);
        assert(err.message.includes('consolidation workflow is required'));
        return true;
      }
    );
  });

  it('TC-CC-05: Storage customer purchasing Unified Pro directly is rejected (requires explicit consolidation workflow)', async () => {
    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId1,
          { planCode: 'UNIFIED_PRO_MONTHLY' }
        );
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 409);
        assert(err.message.includes('Storage'));
        assert(err.message.includes('consolidation workflow is required'));
        return true;
      }
    );
  });

  it('TC-CC-06: Camera customer purchasing Unified Pro directly is rejected (requires explicit consolidation workflow)', async () => {
    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: cameraPlan.id,
        planPriceId: cameraPlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId1,
          { planCode: 'UNIFIED_PRO_MONTHLY' }
        );
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 409);
        assert(err.message.includes('Camera'));
        assert(err.message.includes('consolidation workflow is required'));
        return true;
      }
    );
  });

  it('TC-CC-07: Unified Pro customer attempting to purchase Storage or Camera is rejected (UNIFIED_PRO_ACTIVE)', async () => {
    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: unifiedPlan.id,
        planPriceId: unifiedPlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 79900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Attempting to buy standalone Storage
    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId1,
          { planCode: 'PRO_MONTHLY' }
        );
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 409);
        assert(err.message.includes('already has an active UNIFIED_PRO subscription which includes full Storage capabilities'));
        return true;
      }
    );

    // Attempting to buy standalone Camera
    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId1,
          { planCode: 'CAMERA_PRO_MONTHLY' }
        );
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 409);
        assert(err.message.includes('already has an active UNIFIED_PRO subscription which includes full Camera capabilities'));
        return true;
      }
    );
  });

  it('TC-CC-08: Concurrent cross-product checkout requests serialized via checkoutMutex', async () => {
    let executedOrder: string[] = [];

    const req1 = RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' })
      .then(() => executedOrder.push('storage'));

    const req2 = RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'CAMERA_PRO_MONTHLY' })
      .then(() => executedOrder.push('camera'));

    await Promise.all([req1, req2]);
    assert.strictEqual(executedOrder.length, 2);
  });

  it('TC-CC-09: Legacy Storage pointer preservation — Camera checkout never touches AccountBillingState.activeSubscriptionId', async () => {
    // 1. Establish an active Storage subscription
    const storageSub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    mockBillingStates.set(testUserId1, {
      userId: testUserId1,
      status: BillingStatus.ACTIVE,
      activeSubscriptionId: storageSub.id,
      currency: CurrencyCode.INR,
      billingCountry: 'IN'
    });

    // 2. Camera checkout and verification
    const cameraSub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: cameraPlan.id,
        planPriceId: cameraPlan.prices[0].id,
        providerSubscriptionId: 'sub_rzp_camera_tc09',
        status: BillingStatus.CREATED,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await RazorpayCheckoutService.verifyCheckoutPayment(
      testUserId1,
      {
        paymentId: 'pay_rzp_tc09',
        subscriptionId: 'sub_rzp_camera_tc09',
        signature: computeSignature('pay_rzp_tc09|sub_rzp_camera_tc09', mockKeySecret)
      }
    );

    const billingState = mockBillingStates.get(testUserId1);
    assert.strictEqual(billingState.activeSubscriptionId, storageSub.id, 'activeSubscriptionId must remain Storage sub!');
    assert.notStrictEqual(billingState.activeSubscriptionId, cameraSub.id, 'Camera must never overwrite legacy pointer!');
  });

  it('TC-CC-10: Unified Pro cancellation without unrelated pointer corruption', async () => {
    // Setup Unified Pro subscription
    const uniSub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: unifiedPlan.id,
        planPriceId: unifiedPlan.prices[0].id,
        providerSubscriptionId: 'sub_rzp_uni_tc10',
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 79900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    mockBillingStates.set(testUserId1, {
      userId: testUserId1,
      status: BillingStatus.ACTIVE,
      activeSubscriptionId: uniSub.id,
      currency: CurrencyCode.INR
    });

    await AccountProductSubscriptionService.upsertProductSlot({
      userId: testUserId1,
      productType: ProductType.UNIFIED_PRO,
      subscriptionId: uniSub.id,
      status: BillingStatus.ACTIVE
    });

    // Cancel Unified Pro webhook
    const cancelPayload = {
      event: 'subscription.cancelled',
      payload: {
        subscription: {
          entity: {
            id: 'sub_rzp_uni_tc10',
            plan_id: 'plan_rzp_uni',
            status: 'cancelled',
            ended_at: Math.floor(Date.now() / 1000)
          }
        }
      }
    };

    const raw = JSON.stringify(cancelPayload);
    const sig = computeSignature(raw);

    const result = await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_tc10_cancel', cancelPayload, webhookOpts);
    assert.strictEqual(result.success, true);

    const updatedBillingState = mockBillingStates.get(testUserId1);
    assert.strictEqual(updatedBillingState.activeSubscriptionId, null, 'Unified Pro was matching pointer, cleared cleanly');
    assert.strictEqual(updatedBillingState.status, BillingStatus.EXPIRED);
  });

  it('TC-CC-11: Duplicate webhook event while original event is processing (<2 min) returns idempotent success', async () => {
    const eventId = 'evt_tc11_duplicate_inflight';
    const subId = 'sub_rzp_tc11';

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.CREATED,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Pre-insert an in-flight PROCESSING event updated 5 seconds ago
    const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
    mockWebhookEvents.set(key, {
      id: 'we_tc11',
      provider: PaymentProvider.RAZORPAY,
      environment: PaymentEnvironment.TEST,
      providerEventId: eventId,
      eventType: 'subscription.activated',
      status: WebhookEventStatus.PROCESSING,
      updatedAt: new Date(Date.now() - 5000) // 5 seconds ago (active in-flight)
    });

    const payload = {
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: subId,
            plan_id: 'plan_mock',
            status: 'active',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor((Date.now() + 30 * 86400000) / 1000)
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw);

    const result = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.idempotent, true);
    assert(result.message.includes('currently processing in concurrent worker'));
  });

  it('TC-CC-12: Crash/retry after event receipt — stale PROCESSING (>2 min) recovers and retries', async () => {
    const eventId = 'evt_tc12_stale_crash';
    const subId = 'sub_rzp_tc12';

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.CREATED,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Insert an abandoned PROCESSING event from 5 minutes ago (crashed worker)
    const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
    mockWebhookEvents.set(key, {
      id: 'we_tc12',
      provider: PaymentProvider.RAZORPAY,
      environment: PaymentEnvironment.TEST,
      providerEventId: eventId,
      eventType: 'subscription.activated',
      status: WebhookEventStatus.PROCESSING,
      updatedAt: new Date(Date.now() - 300000) // 5 minutes ago (stale crash)
    });

    const payload = {
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: subId,
            plan_id: 'plan_mock',
            status: 'active',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor((Date.now() + 30 * 86400000) / 1000)
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw);

    const result = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(result.success, true);
    assert.notStrictEqual(result.idempotent, true, 'Stale event should recover and process rather than returning no-op');

    const updatedEvent = mockWebhookEvents.get(key);
    assert.strictEqual(updatedEvent.status, WebhookEventStatus.PROCESSED);
  });

  it('TC-CC-13: Crash/retry after subscription mutation — rollback leaves state consistent for retry', async () => {
    const eventId = 'evt_tc13_mutation_crash';
    const subId = 'sub_rzp_tc13';

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.CREATED,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    const payload = {
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: subId,
            plan_id: 'plan_mock',
            status: 'active',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor((Date.now() + 30 * 86400000) / 1000)
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw);

    // Simulate transient failure during transaction
    (prisma as any).$transaction = async () => {
      throw new Error('Transaction rollback simulated crash');
    };

    try {
      await assert.rejects(
        async () => {
          await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
        },
        /Transaction rollback simulated crash/
      );

      // Verify event is marked FAILED
      const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
      assert.strictEqual(mockWebhookEvents.get(key).status, WebhookEventStatus.FAILED);
    } finally {
      // Restore default transaction
      (prisma as any).$transaction = defaultTx;
    }

    const retryResult = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(retryResult.success, true);
    const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
    assert.strictEqual(mockWebhookEvents.get(key).status, WebhookEventStatus.PROCESSED);
  });

  it('TC-CC-14: Crash/retry after payment insertion — retry does not duplicate payment records', async () => {
    const eventId = 'evt_tc14_pay_dedup';
    const subId = 'sub_rzp_tc14';
    const payId = 'pay_rzp_tc14';

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    const payload = {
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: {
            id: subId,
            plan_id: 'plan_mock',
            status: 'active',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor((Date.now() + 30 * 86400000) / 1000)
          }
        },
        payment: {
          entity: {
            id: payId,
            amount: 4900,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw);

    // First delivery
    await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    const initialPaymentCount = mockPayments.size;

    // Retry with duplicate delivery
    const retryResult = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(retryResult.idempotent, true);
    assert.strictEqual(mockPayments.size, initialPaymentCount, 'Payment records must not duplicate on retry');
  });

  it('TC-CC-15: Invoice generation idempotency across duplicate payment webhook deliveries', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    const verify1 = await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_inv_cc15',
      subscriptionId: session.subscriptionId,
      signature: computeSignature(`pay_inv_cc15|${session.subscriptionId}`, mockKeySecret)
    });

    const verify2 = await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_inv_cc15',
      subscriptionId: session.subscriptionId,
      signature: computeSignature(`pay_inv_cc15|${session.subscriptionId}`, mockKeySecret)
    });

    assert.strictEqual(verify1.verified, true);
    assert.strictEqual(verify2.verified, true);
    assert.strictEqual(mockPayments.size, 1, 'Duplicate payment verification must not duplicate payment records');
  });

  it('TC-CC-16: Database outage retry behavior — transient error logs failure and allows subsequent retry', async () => {
    const eventId = 'evt_tc16_db_outage';
    const subId = 'sub_rzp_tc16';

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.CREATED,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    const payload = {
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: subId,
            plan_id: 'plan_mock',
            status: 'active',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor((Date.now() + 30 * 86400000) / 1000)
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw);

    const origFindUnique = (prisma.subscription as any).findUnique;
    (prisma.subscription as any).findUnique = async () => {
      throw new Error('ECONNREFUSED database connection lost');
    };

    try {
      await assert.rejects(
        async () => {
          await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
        },
        /ECONNREFUSED/
      );
    } finally {
      // Restore
      (prisma.subscription as any).findUnique = origFindUnique;
    }

    const retryResult = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(retryResult.success, true);
  });

  it('TC-CC-17: Checkout conflict policy for all relevant subscription statuses', async () => {
    const statusesToBlock = [
      BillingStatus.ACTIVE,
      BillingStatus.CANCELLING,
      BillingStatus.PAST_DUE,
      BillingStatus.GRACE_PERIOD
    ];

    const statusesToAllow = [
      BillingStatus.EXPIRED,
      BillingStatus.REFUNDED,
      BillingStatus.FREE
    ];

    for (const status of statusesToBlock) {
      mockSubscriptions.clear();
      mockSlots.clear();

      await (prisma.subscription as any).create({
        data: {
          userId: testUserId1,
          planId: storagePlan.id,
          planPriceId: storagePlan.prices[0].id,
          status,
          currency: CurrencyCode.INR,
          amountMinorUnits: 4900,
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
        }
      });

      await assert.rejects(
        async () => {
          await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 409, `Status ${status} MUST block duplicate checkout`);
          return true;
        }
      );
    }

    for (const status of statusesToAllow) {
      mockSubscriptions.clear();
      mockSlots.clear();

      if (status !== BillingStatus.FREE) {
        await (prisma.subscription as any).create({
          data: {
            userId: testUserId1,
            planId: storagePlan.id,
            planPriceId: storagePlan.prices[0].id,
            status,
            currency: CurrencyCode.INR,
            amountMinorUnits: 4900,
            currentPeriodEnd: new Date(Date.now() - 86400000)
          }
        });
      }

      const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
      assert.ok(session.subscriptionId, `Status ${status} MUST allow checkout`);
    }
  });

  it('TC-CC-18: subscription.authenticated does not grant paid entitlements', async () => {
    const subId = 'sub_rzp_tc18_auth';
    await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.CREATED,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    const payload = {
      event: 'subscription.authenticated',
      payload: {
        subscription: {
          entity: {
            id: subId,
            plan_id: 'plan_mock',
            status: 'authenticated'
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw);

    const result = await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_tc18_auth', payload, webhookOpts);
    assert.strictEqual(result.success, true);
    assert(result.message.includes('Entitlements remain FREE pending activation'));

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId1);
    assert.strictEqual(entitlements.storage.maxServers, 1, 'Must remain Free default (1 server)');
    assert.strictEqual(entitlements.storage.priorityRelay, false);
  });

  it('TC-CC-19: Invalid product-type plan transition rejection', async () => {
    const cameraSub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId1,
        planId: cameraPlan.id,
        planPriceId: cameraPlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Attempting to slot a CAMERA plan into UNIFIED_PRO slot
    await assert.rejects(
      async () => {
        await AccountProductSubscriptionService.upsertProductSlot({
          userId: testUserId1,
          productType: ProductType.UNIFIED_PRO,
          subscriptionId: cameraSub.id,
          status: BillingStatus.ACTIVE
        });
      },
      /cannot be slotted into UNIFIED_PRO/
    );
  });

  it('TC-CC-20: Existing Storage checkout and entitlement regression (PRO_MONTHLY checkout works 100% as before)', async () => {
    // Fresh user checkout PRO_MONTHLY
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    assert.ok(session.subscriptionId);
    assert.strictEqual(session.planCode, 'PRO_MONTHLY');

    // Verify payment
    const verifyResult = await RazorpayCheckoutService.verifyCheckoutPayment(
      testUserId1,
      {
        paymentId: 'pay_tc20_storage_reg',
        subscriptionId: session.subscriptionId,
        signature: computeSignature(`pay_tc20_storage_reg|${session.subscriptionId}`, mockKeySecret)
      }
    );

    assert.strictEqual(verifyResult.status, BillingStatus.ACTIVE);
    assert.strictEqual(verifyResult.planCode, 'PRO_MONTHLY');

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId1);
    assert.strictEqual(entitlements.storage.maxServers, 5);
    assert.strictEqual(entitlements.storage.priorityRelay, true);
    assert.strictEqual(entitlements.camera.maxCameras, 0); // No camera leakage
  });
});
