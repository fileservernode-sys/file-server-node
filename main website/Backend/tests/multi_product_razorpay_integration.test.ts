import assert from 'node:assert';
import crypto from 'node:crypto';
import { test, describe, before, after, beforeEach } from 'node:test';
import { prisma } from '../src/config/database.js';
import {
  RazorpayCheckoutService,
  CreateCheckoutSessionParams,
  VerifyCheckoutPaymentParams
} from '../src/services/billing/providers/razorpay/razorpay_checkout_service.js';
import {
  RazorpayWebhookService
} from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';
import {
  AccountProductSubscriptionService,
  PopulatedProductSlot
} from '../src/services/billing/account_product_subscription_service.js';
import {
  EntitlementService,
  buildFreeMultiProductEntitlements
} from '../src/services/billing/entitlement_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { RazorpayProviderError } from '../src/services/billing/providers/razorpay/razorpay_error.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  DatabaseError
} from '../src/errors/app-error.js';
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

const mockWebhookSecret = 'whsec_test_mockSecret_batch31_1234567890';

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
    entitlements: []
  };
}

describe('Phase 19.3 Batch 3.1: Razorpay Multi-Product Checkout & Webhook Integration Suite', () => {
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
    priorityRelay: true
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

  // Stub state
  const mockUsers = new Map<string, any>();
  const mockBillingStates = new Map<string, any>();
  const mockBillingProfiles = new Map<string, any>();
  const mockSubscriptions = new Map<string, any>();
  const mockSlots = new Map<string, AccountProductSubscription>();
  const mockWebhookEvents = new Map<string, any>();
  const mockPayments = new Map<string, any>();
  const mockRefunds = new Map<string, any>();

  const testUserId1 = 'user_mp_rp_01';
  const testUserId2 = 'user_mp_rp_02';

  before(() => {
    // Setup test users
    mockUsers.set(testUserId1, { id: testUserId1, email: 'user1@zdexcloud.com' });
    mockUsers.set(testUserId2, { id: testUserId2, email: 'user2@zdexcloud.com' });

    const fullBillingState1 = {
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
    const fullBillingState2 = {
      ...fullBillingState1,
      userId: testUserId2
    };

    mockBillingStates.set(testUserId1, { ...fullBillingState1 });
    mockBillingStates.set(testUserId2, { ...fullBillingState2 });

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

    // Prisma stubbing
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

    (prisma as any).emailMessage = {
      create: async ({ data }: any) => ({ id: `email_${Date.now()}`, ...data }),
      findFirst: async () => null,
      findMany: async () => []
    };
    (prisma as any).channelDeliveryRecord = {
      create: async ({ data }: any) => ({ id: `cdr_${Date.now()}`, ...data }),
      findFirst: async () => null,
      findMany: async () => []
    };
    (prisma as any).notificationRecord = {
      create: async ({ data }: any) => ({ id: `notif_${Date.now()}`, ...data }),
      findFirst: async () => null,
      findMany: async () => []
    };
    (prisma as any).inAppNotification = {
      create: async ({ data }: any) => ({ id: `inapp_${Date.now()}`, ...data }),
      findFirst: async () => null,
      findMany: async () => []
    };
    (prisma as any).customerActivityEvent = {
      create: async ({ data }: any) => ({ id: `cae_${Date.now()}`, ...data }),
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => []
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

    (prisma.subscription as any).findMany = async ({ where }: any) => {
      const results: any[] = [];
      for (const sub of mockSubscriptions.values()) {
        let match = true;
        if (where?.userId && sub.userId !== where.userId) match = false;
        if (where?.status && where.status.in && !where.status.in.includes(sub.status)) match = false;
        if (where?.status && typeof where.status === 'string' && sub.status !== where.status) match = false;
        if (match) results.push(sub);
      }
      return results;
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

    (prisma.subscription as any).create = async ({ data }: any) => {
      const id = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const plan = await (prisma.plan as any).findUnique({ where: { id: data.planId } });
      const record = {
        ...data,
        id,
        plan,
        planPrice: plan?.prices?.[0] || null,
        user: mockUsers.get(data.userId) || null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      mockSubscriptions.set(id, record);
      return record;
    };

    (prisma.subscription as any).update = async ({ where, data }: any) => {
      const existing = mockSubscriptions.get(where.id);
      if (!existing) throw new Error(`Subscription ${where.id} not found`);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      mockSubscriptions.set(where.id, updated);
      return updated;
    };

    (prisma.accountProductSubscription as any).findUnique = async ({ where }: any) => {
      if (where.userId_productType) {
        const key = `${where.userId_productType.userId}_${where.userId_productType.productType}`;
        const slot = mockSlots.get(key);
        if (!slot) return null;
        const sub = mockSubscriptions.get(slot.subscriptionId);
        return {
          ...slot,
          subscription: sub ? {
            ...sub,
            plan: {
              ...sub.plan,
              entitlements: sub.plan?.entitlements || []
            }
          } : null
        };
      }
      if (where.subscriptionId) {
        for (const slot of mockSlots.values()) {
          if (slot.subscriptionId === where.subscriptionId) {
            const sub = mockSubscriptions.get(slot.subscriptionId);
            return {
              ...slot,
              subscription: sub ? {
                ...sub,
                plan: {
                  ...sub.plan,
                  entitlements: sub.plan?.entitlements || []
                }
              } : null
            };
          }
        }
      }
      return null;
    };

    (prisma.accountProductSubscription as any).findMany = async ({ where }: any) => {
      const results: any[] = [];
      for (const slot of mockSlots.values()) {
        if (!where?.userId || slot.userId === where.userId) {
          const sub = mockSubscriptions.get(slot.subscriptionId);
          results.push({
            ...slot,
            subscription: sub ? {
              ...sub,
              plan: {
                ...sub.plan,
                entitlements: sub.plan?.entitlements || []
              }
            } : null
          });
        }
      }
      return results;
    };

    (prisma.accountProductSubscription as any).upsert = async ({ where, create, update }: any) => {
      const key = `${where.userId_productType.userId}_${where.userId_productType.productType}`;
      const existing = mockSlots.get(key);
      const res = {
        id: existing?.id || `slot_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        ...(existing || create),
        ...update,
        updatedAt: new Date()
      };
      mockSlots.set(key, res);
      return res;
    };

    (prisma.accountProductSubscription as any).update = async ({ where, data }: any) => {
      for (const [key, slot] of mockSlots.entries()) {
        if (slot.id === where.id) {
          const updated = { ...slot, ...data, updatedAt: new Date() };
          mockSlots.set(key, updated);
          return updated;
        }
      }
      throw new Error('Slot not found');
    };

    (prisma.accountProductSubscription as any).delete = async ({ where }: any) => {
      const key = `${where.userId_productType.userId}_${where.userId_productType.productType}`;
      const existing = mockSlots.get(key);
      mockSlots.delete(key);
      return existing;
    };

    (prisma.billingProviderPlanMapping as any).findUnique = async () => null;

    (prisma.billingWebhookEvent as any).findUnique = async ({ where }: any) => {
      if (where.provider_environment_providerEventId) {
        const key = `${where.provider_environment_providerEventId.provider}_${where.provider_environment_providerEventId.environment}_${where.provider_environment_providerEventId.providerEventId}`;
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
      const key = `${data.provider}_${data.environment}_${data.providerEventId}`;
      if (mockWebhookEvents.has(key)) {
        const err: any = new Error('Unique constraint violation');
        err.code = 'P2002';
        throw err;
      }
      const record = { id: `wh_${Date.now()}`, ...data, createdAt: new Date() };
      mockWebhookEvents.set(key, record);
      return record;
    };

    (prisma.billingWebhookEvent as any).update = async ({ where, data }: any) => {
      for (const [k, v] of mockWebhookEvents.entries()) {
        if (v.id === where.id) {
          const updated = { ...v, ...data };
          mockWebhookEvents.set(k, updated);
          return updated;
        }
      }
      return null;
    };

    (prisma.billingPayment as any).findFirst = async ({ where }: any) => {
      for (const pay of mockPayments.values()) {
        if (where.providerPaymentId && pay.providerPaymentId === where.providerPaymentId) return pay;
        if (where.subscriptionId && pay.subscriptionId === where.subscriptionId) return pay;
      }
      return null;
    };

    (prisma.billingPayment as any).create = async ({ data }: any) => {
      const id = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const record = { id, ...data, createdAt: new Date() };
      mockPayments.set(id, record);
      return record;
    };

    (prisma.billingRefund as any).findUnique = async ({ where }: any) => {
      if (where.providerRefundId) return mockRefunds.get(where.providerRefundId) || null;
      return null;
    };
    (prisma.billingRefund as any).findFirst = async () => null;
    (prisma.billingRefund as any).update = async ({ where, data }: any) => {
      const existing = mockRefunds.get(where.id);
      if (existing) {
        const updated = { ...existing, ...data };
        mockRefunds.set(where.id, updated);
        return updated;
      }
      return null;
    };

    (prisma.billingReceipt as any).findFirst = async () => null;
    (prisma.auditEvent as any).create = async ({ data }: any) => ({ id: `audit_${Date.now()}`, ...data });
    (prisma.subscriptionPlanChange as any).findFirst = async () => null;

    // Direct mock for transaction to pass through
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: testUserId1 }];
  });

  beforeEach(() => {
    mockSubscriptions.clear();
    mockSlots.clear();
    mockWebhookEvents.clear();
    mockPayments.clear();
    mockRefunds.clear();
    mockBillingStates.set(testUserId1, {
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
    });
    mockBillingStates.set(testUserId2, {
      userId: testUserId2,
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
    });
  });

  // TC-RPC-01: Storage checkout compatibility
  test('TC-RPC-01: Storage checkout compatibility — PRO_MONTHLY creates valid checkout session', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'PRO_MONTHLY'
    });
    assert.ok(session);
    assert.strictEqual(session.planCode, 'PRO_MONTHLY');
    assert.strictEqual(session.currency, CurrencyCode.INR);
    assert.ok(session.subscriptionId.startsWith('sub_test_'));
    assert.ok(session.amountMinorUnits > 0);
  });

  // TC-RPC-02: Product mismatch rejection
  test('TC-RPC-02: Product mismatch rejection — requesting STORAGE plan with CAMERA productType throws ValidationError', async () => {
    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
          planCode: 'PRO_MONTHLY',
          productType: ProductType.CAMERA
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Product mismatch/i);
        return true;
      }
    );
  });

  // TC-RPC-03: Disabled plan rejection
  test('TC-RPC-03: Disabled plan rejection — inactive plan cannot enter checkout', async () => {
    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
          planCode: 'DISABLED_PLAN'
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /is not active/i);
        return true;
      }
    );
  });

  // TC-RPC-04: Price tampering rejection
  test('TC-RPC-04: Price tampering rejection — server derives amount authoritatively from internal catalog', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'PRO_MONTHLY'
    });
    // Base 4900 + 18% GST (882) + 2% Razorpay fee + 18% GST on fee (98 + 18 = 116) = 5898 minor units
    assert.strictEqual(session.amountMinorUnits, 5898);
  });

  // TC-RPC-05: Storage slot activation
  test('TC-RPC-05: Storage slot activation — verify checkout activates Storage slot and sets AccountBillingState.activeSubscriptionId', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'PRO_MONTHLY'
    });

    const verifyResult = await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_test_storage_123',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    assert.strictEqual(verifyResult.verified, true);
    assert.strictEqual(verifyResult.status, BillingStatus.ACTIVE);

    // Verify Storage slot was upserted
    const slot = await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.STORAGE);
    assert.ok(slot);
    assert.strictEqual(slot.status, BillingStatus.ACTIVE);

    // Verify AccountBillingState.activeSubscriptionId was set
    const billingState = mockBillingStates.get(testUserId1);
    assert.strictEqual(billingState?.status, BillingStatus.ACTIVE);
    assert.strictEqual(billingState?.activeSubscriptionId, slot.subscriptionId);
  });

  // TC-RPC-06: Camera slot activation
  test('TC-RPC-06: Camera slot activation — verifying Camera checkout activates slot and DOES NOT touch AccountBillingState.activeSubscriptionId', async () => {
    // 1. Setup pre-existing Storage subscription
    const storageSession = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'PRO_MONTHLY'
    });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_storage_active',
      subscriptionId: storageSession.subscriptionId,
      signature: 'test_signature'
    });

    const storageSlotBefore = await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.STORAGE);
    const billingStateBefore = mockBillingStates.get(testUserId1);
    assert.strictEqual(billingStateBefore?.activeSubscriptionId, storageSlotBefore?.subscriptionId);

    // 2. Checkout Camera subscription
    const cameraSession = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'CAMERA_PRO_MONTHLY',
      productType: ProductType.CAMERA
    });

    const verifyCamera = await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_camera_active',
      subscriptionId: cameraSession.subscriptionId,
      signature: 'test_signature'
    });

    assert.strictEqual(verifyCamera.verified, true);

    // Verify Camera slot was activated
    const cameraSlot = await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.CAMERA);
    assert.ok(cameraSlot);
    assert.strictEqual(cameraSlot.status, BillingStatus.ACTIVE);

    // Verify AccountBillingState.activeSubscriptionId STILL points to Storage!
    const billingStateAfter = mockBillingStates.get(testUserId1);
    assert.strictEqual(billingStateAfter?.activeSubscriptionId, storageSlotBefore?.subscriptionId);
    assert.notStrictEqual(billingStateAfter?.activeSubscriptionId, cameraSlot.subscriptionId);
  });

  // TC-RPC-07: Unified Pro dual contribution
  test('TC-RPC-07: Unified Pro dual contribution — entitles both Storage and Camera domains', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'UNIFIED_PRO_MONTHLY',
      productType: ProductType.UNIFIED_PRO
    });

    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_unified_123',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId1);
    assert.strictEqual(entitlements.storage.planCode, 'UNIFIED_PRO_MONTHLY');
    assert.strictEqual(entitlements.storage.maxServers, 5);
    assert.strictEqual(entitlements.camera.planCode, 'UNIFIED_PRO_MONTHLY');
    assert.strictEqual(entitlements.camera.maxCameras, 5);
  });

  // TC-RPC-08: Cross-user rejection
  test('TC-RPC-08: Cross-user rejection — user A cannot verify user B subscription', async () => {
    const sessionB = await RazorpayCheckoutService.createCheckoutSession(testUserId2, {
      planCode: 'PRO_MONTHLY'
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
          paymentId: 'pay_tamper_123',
          subscriptionId: sessionB.subscriptionId,
          signature: 'test_signature'
        });
      },
      (err: any) => {
        assert.ok(err instanceof ConflictError || err instanceof NotFoundError);
        return true;
      }
    );
  });

  // TC-RPC-09: Duplicate webhook idempotency
  test('TC-RPC-09: Duplicate webhook idempotency — repeated subscription.charged returns idempotent success', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'PRO_MONTHLY'
    });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_init_123',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    const payload = {
      entity: 'event',
      account_id: 'acc_test',
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: {
            id: session.subscriptionId,
            plan_id: 'plan_test_pro_monthly',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 30 * 86400
          }
        },
        payment: {
          entity: {
            id: 'pay_charged_123',
            amount: 5898,
            currency: 'INR'
          }
        }
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody, mockWebhookSecret);
    const eventId = 'evt_duplicate_test_01';

    // First delivery
    const res1 = await RazorpayWebhookService.handleWebhook(rawBody, signature, eventId, payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });
    assert.strictEqual(res1.success, true);

    // Second delivery (duplicate event ID)
    const res2 = await RazorpayWebhookService.handleWebhook(rawBody, signature, eventId, payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.idempotent, true);
  });

  // TC-RPC-10: Concurrent webhook delivery
  test('TC-RPC-10: Concurrent webhook delivery — race-protected event handling executes cleanly', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'PRO_MONTHLY'
    });

    const makePayload = (evtId: string) => {
      const p = {
        entity: 'event',
        event: 'subscription.activated',
        payload: {
          subscription: {
            entity: {
              id: session.subscriptionId,
              plan_id: 'plan_test_pro_monthly',
              current_start: Math.floor(Date.now() / 1000),
              current_end: Math.floor(Date.now() / 1000) + 30 * 86400
            }
          }
        }
      };
      const raw = JSON.stringify(p);
      return { raw, sig: computeSignature(raw, mockWebhookSecret), evtId, p };
    };

    const w1 = makePayload('evt_concurrent_01');
    const w2 = makePayload('evt_concurrent_02');

    const [r1, r2] = await Promise.all([
      RazorpayWebhookService.handleWebhook(w1.raw, w1.sig, w1.evtId, w1.p, {
        webhookSecret: mockWebhookSecret,
        environment: PaymentEnvironment.TEST
      }),
      RazorpayWebhookService.handleWebhook(w2.raw, w2.sig, w2.evtId, w2.p, {
        webhookSecret: mockWebhookSecret,
        environment: PaymentEnvironment.TEST
      })
    ]);

    assert.ok(r1.success);
    assert.ok(r2.success);
  });

  // TC-RPC-11: Stale event after replacement
  test('TC-RPC-11: Stale event after replacement — older subscription event does not overwrite newer subscription in slot', async () => {
    // 1. Initial subscription
    const s1 = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_s1',
      subscriptionId: s1.subscriptionId,
      signature: 'test_signature'
    });

    const s1Record = await prisma.subscription.findFirst({ where: { providerSubscriptionId: s1.subscriptionId } });

    // 2. Replace with newer subscription
    const s2 = await prisma.subscription.create({
      data: {
        userId: testUserId1,
        planId: storageYearlyPlan.id,
        planPriceId: storageYearlyPlan.prices[0].id,
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: 'sub_test_s2_newer',
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.YEARLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: 49000,
        priceVersion: 1,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 86400000),
        cancelAtPeriodEnd: false
      }
    });

    await AccountProductSubscriptionService.replaceProductSlotSubscription({
      userId: testUserId1,
      productType: ProductType.STORAGE,
      newSubscriptionId: s2.id,
      expectedCurrentSubscriptionId: s1Record!.id
    });

    // 3. Late webhook arrives for s1
    const res = await AccountProductSubscriptionService.updateSlotStatus({
      subscriptionId: s1Record!.id,
      status: BillingStatus.ACTIVE,
      userId: testUserId1,
      productType: ProductType.STORAGE
    });

    assert.strictEqual(res.modified, false);
    assert.strictEqual(res.reason, 'SUBSCRIPTION_MISMATCH');

    // Slot still points to s2
    const currentSlot = await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.STORAGE);
    assert.strictEqual(currentSlot?.subscriptionId, s2.id);
  });

  // TC-RPC-12: Delayed payment failure after renewal
  test('TC-RPC-12: Delayed payment failure after renewal — older failure event does not regress ACTIVE subscription', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_renewed',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    // Sub is ACTIVE starting now
    const payload = {
      entity: 'event',
      event: 'subscription.pending',
      payload: {
        subscription: {
          entity: {
            id: session.subscriptionId,
            current_start: Math.floor(Date.now() / 1000) - 100000 // 1 day before currentPeriodStart
          }
        },
        payment: {
          entity: {
            id: 'pay_old_fail',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Card declined'
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw, mockWebhookSecret);

    const res = await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_old_fail', payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'ACTIVE');

    // Slot remains ACTIVE
    const slot = await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.STORAGE);
    assert.strictEqual(slot?.status, BillingStatus.ACTIVE);
  });

  // TC-RPC-13: Old billing period rejection
  test('TC-RPC-13: Old billing period rejection — events with older period end are ignored by slot engine', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_s1',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    const sub = await prisma.subscription.findFirst({ where: { providerSubscriptionId: session.subscriptionId } });
    const futurePeriodEnd = new Date(Date.now() + 60 * 86400000);

    // Update slot with future period
    await AccountProductSubscriptionService.updateSlotStatus({
      subscriptionId: sub!.id,
      status: BillingStatus.ACTIVE,
      userId: testUserId1,
      productType: ProductType.STORAGE,
      eventPeriodEnd: futurePeriodEnd
    });

    // Try applying older period with degrading status
    const pastPeriodEnd = new Date(Date.now() + 10 * 86400000);
    const staleRes = await AccountProductSubscriptionService.updateSlotStatus({
      subscriptionId: sub!.id,
      status: BillingStatus.PAST_DUE,
      userId: testUserId1,
      productType: ProductType.STORAGE,
      eventPeriodEnd: pastPeriodEnd
    });

    assert.strictEqual(staleRes.modified, false);
    assert.strictEqual(staleRes.reason, 'SUPERSEDED_BY_NEWER_PERIOD');
  });

  // TC-RPC-14: Cancellation
  test('TC-RPC-14: Cancellation — subscription.cancelled with future period end transitions slot to CANCELLING', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_cancel_test',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    const payload = {
      entity: 'event',
      event: 'subscription.cancelled',
      payload: {
        subscription: {
          entity: {
            id: session.subscriptionId,
            ended_at: Math.floor(Date.now() / 1000) + 15 * 86400 // 15 days in the future
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw, mockWebhookSecret);

    const res = await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_cancel_sched', payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'CANCELLING');

    // Slot is CANCELLING but still entitles PRO until end
    const slot = await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.STORAGE);
    assert.strictEqual(slot?.status, BillingStatus.CANCELLING);

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId1);
    assert.strictEqual(entitlements.storage.planCode, 'PRO_MONTHLY');
    assert.strictEqual(entitlements.storage.status, BillingStatus.CANCELLING);
  });

  // TC-RPC-15: Expiration
  test('TC-RPC-15: Expiration — immediate cancellation/expiry transitions slot to EXPIRED and resets entitlements to FREE', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_expire_test',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    const payload = {
      entity: 'event',
      event: 'subscription.cancelled',
      payload: {
        subscription: {
          entity: {
            id: session.subscriptionId,
            ended_at: Math.floor(Date.now() / 1000) - 10 // Immediate
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw, mockWebhookSecret);

    const res = await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_expire_immediate', payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'EXPIRED');

    // Slot is EXPIRED
    const slot = await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.STORAGE);
    assert.strictEqual(slot?.status, BillingStatus.EXPIRED);

    // Entitlements reverted to FREE
    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId1);
    assert.strictEqual(entitlements.storage.planCode, 'FREE');
    assert.strictEqual(entitlements.storage.maxServers, 1);
  });

  // TC-RPC-16: Payment capture idempotency
  test('TC-RPC-16: Payment capture idempotency — duplicate payment capture webhook does not duplicate records', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    const verifyRes = await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_capture_idem',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });
    assert.ok(verifyRes.verified);

    // Verify again with same paymentId
    const verifyRes2 = await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_capture_idem',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });
    assert.strictEqual(verifyRes2.verified, true);
    assert.strictEqual(mockPayments.size, 1);
  });

  // TC-RPC-17: Payment failure
  test('TC-RPC-17: Payment failure — records failed payment and transitions Camera slot to PAST_DUE', async () => {
    const cameraSession = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'CAMERA_PRO_MONTHLY',
      productType: ProductType.CAMERA
    });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_cam_active',
      subscriptionId: cameraSession.subscriptionId,
      signature: 'test_signature'
    });

    const payload = {
      entity: 'event',
      event: 'subscription.pending',
      payload: {
        subscription: {
          entity: {
            id: cameraSession.subscriptionId,
            current_start: Math.floor(Date.now() / 1000)
          }
        },
        payment: {
          entity: {
            id: 'pay_cam_fail',
            amount: 4900,
            currency: 'INR',
            error_code: 'INSUFFICIENT_FUNDS',
            error_description: 'Insufficient funds'
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw, mockWebhookSecret);

    const res = await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_cam_fail_1', payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(res.success, true);
    const slot = await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.CAMERA);
    assert.strictEqual(slot?.status, BillingStatus.PAST_DUE);
  });

  // TC-RPC-18: Refund handling
  test('TC-RPC-18: Refund handling — refund.processed webhook synchronizes refund status', async () => {
    mockRefunds.set('rfnd_test_123', {
      id: 'rfnd_test_123',
      providerRefundId: 'rfnd_test_123',
      status: 'PROCESSING',
      amountMinorUnits: 4900,
      currency: CurrencyCode.INR,
      userId: testUserId1
    });

    const payload = {
      entity: 'event',
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_test_123',
            amount: 4900,
            status: 'processed'
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw, mockWebhookSecret);

    const res = await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_refund_proc', payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });

    assert.strictEqual(res.success, true);
    const updatedRefund = mockRefunds.get('rfnd_test_123');
    assert.strictEqual(updatedRefund?.status, 'PROCESSED');
  });

  // TC-RPC-19: Invoice creation idempotency
  test('TC-RPC-19: Invoice creation idempotency — duplicate charges do not produce duplicate invoices', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    const verify1 = await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_inv_123',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    const verify2 = await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_inv_123',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    assert.strictEqual(verify1.verified, true);
    assert.strictEqual(verify2.verified, true);
    assert.strictEqual(mockPayments.size, 1);
  });

  // TC-RPC-20: Legacy Storage pointer preservation
  test('TC-RPC-20: Legacy Storage pointer preservation — Camera lifecycle events never touch AccountBillingState.activeSubscriptionId', async () => {
    // 1. Activate Storage
    const storageSession = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_storage_p20',
      subscriptionId: storageSession.subscriptionId,
      signature: 'test_signature'
    });

    const storageSubId = mockBillingStates.get(testUserId1)?.activeSubscriptionId;
    assert.ok(storageSubId);

    // 2. Camera activated
    const cameraSession = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'CAMERA_PRO_MONTHLY',
      productType: ProductType.CAMERA
    });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_camera_p20',
      subscriptionId: cameraSession.subscriptionId,
      signature: 'test_signature'
    });

    assert.strictEqual(mockBillingStates.get(testUserId1)?.activeSubscriptionId, storageSubId);

    // 3. Camera cancelled
    const payload = {
      entity: 'event',
      event: 'subscription.cancelled',
      payload: {
        subscription: {
          entity: {
            id: cameraSession.subscriptionId,
            ended_at: Math.floor(Date.now() / 1000) - 10
          }
        }
      }
    };
    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw, mockWebhookSecret);

    await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_p20_cam_cancel', payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });

    // Storage pointer remains intact
    assert.strictEqual(mockBillingStates.get(testUserId1)?.activeSubscriptionId, storageSubId);
  });

  // TC-RPC-21: Legacy entitlement regression check
  test('TC-RPC-21: Legacy entitlement regression check — getEffectivePlan() continues returning active Storage plan', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_leg_21',
      subscriptionId: session.subscriptionId,
      signature: 'test_signature'
    });

    const effectivePlan = await BillingStateService.getEffectivePlan(testUserId1);
    assert.strictEqual(effectivePlan.planCode, 'PRO_MONTHLY');
    assert.strictEqual(effectivePlan.subscription?.plan.serverLimit, 5);
    assert.strictEqual(effectivePlan.subscription?.plan.priorityRelay, true);
  });

  // TC-RPC-22: Multi-product lifecycle isolation
  test('TC-RPC-22: Camera lifecycle isolation — cancelling Camera does not affect active Storage subscription', async () => {
    // Setup Storage
    const storageSession = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_iso_storage',
      subscriptionId: storageSession.subscriptionId,
      signature: 'test_signature'
    });

    // Setup Camera
    const cameraSession = await RazorpayCheckoutService.createCheckoutSession(testUserId1, {
      planCode: 'CAMERA_PRO_MONTHLY',
      productType: ProductType.CAMERA
    });
    await RazorpayCheckoutService.verifyCheckoutPayment(testUserId1, {
      paymentId: 'pay_iso_camera',
      subscriptionId: cameraSession.subscriptionId,
      signature: 'test_signature'
    });

    // Verify both are ACTIVE
    let entitlements = await EntitlementService.resolveUserEntitlements(testUserId1);
    assert.strictEqual(entitlements.storage.planCode, 'PRO_MONTHLY');
    assert.strictEqual(entitlements.camera.planCode, 'CAMERA_PRO_MONTHLY');

    // Cancel Camera immediately
    const payload = {
      entity: 'event',
      event: 'subscription.cancelled',
      payload: {
        subscription: {
          entity: {
            id: cameraSession.subscriptionId,
            ended_at: Math.floor(Date.now() / 1000) - 10
          }
        }
      }
    };
    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw, mockWebhookSecret);

    await RazorpayWebhookService.handleWebhook(raw, sig, 'evt_cam_iso_cancel', payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });

    // Re-resolve: Storage is still PRO, Camera is FREE (NONE)
    entitlements = await EntitlementService.resolveUserEntitlements(testUserId1);
    assert.strictEqual(entitlements.storage.planCode, 'PRO_MONTHLY');
    assert.strictEqual(entitlements.storage.maxServers, 5);
    assert.strictEqual(entitlements.camera.planCode, 'NONE');
    assert.strictEqual(entitlements.camera.maxCameras, 0);
  });

  // TC-RPC-23: Database outage propagation
  test('TC-RPC-23: Database outage propagation — P1001 database connection failure propagates as DatabaseError', async () => {
    const originalFindUnique = (prisma.accountProductSubscription as any).findUnique;
    (prisma.accountProductSubscription as any).findUnique = async () => {
      const err: any = new Error("Can't reach database server");
      err.code = 'P1001';
      throw err;
    };

    try {
      await assert.rejects(
        async () => {
          await AccountProductSubscriptionService.getProductSlot(testUserId1, ProductType.STORAGE);
        },
        (err: any) => {
          assert.ok(err instanceof DatabaseError);
          assert.match(err.message, /database connection unavailable/i);
          return true;
        }
      );
    } finally {
      (prisma.accountProductSubscription as any).findUnique = originalFindUnique;
    }
  });

  // TC-RPC-24: Webhook signature rejection
  test('TC-RPC-24: Webhook signature rejection — invalid HMAC signature is rejected with status 400', async () => {
    const payload = { entity: 'event', event: 'subscription.activated' };
    const raw = JSON.stringify(payload);
    const badSig = 'bad_forged_signature_hex';

    await assert.rejects(
      async () => {
        await RazorpayWebhookService.handleWebhook(raw, badSig, 'evt_bad_sig', payload, {
          webhookSecret: mockWebhookSecret,
          environment: PaymentEnvironment.TEST
        });
      },
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.errorCode, 'INVALID_SIGNATURE');
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });

  // TC-RPC-25: Backend restart / retry idempotency
  test('TC-RPC-25: Replay / Retry idempotency — reprocessing previously processed webhook returns idempotent success', async () => {
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId1, { planCode: 'PRO_MONTHLY' });
    const payload = {
      entity: 'event',
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: session.subscriptionId,
            plan_id: 'plan_test_pro_monthly',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 30 * 86400
          }
        }
      }
    };
    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw, mockWebhookSecret);
    const evtId = 'evt_replay_test_25';

    // First delivery
    const r1 = await RazorpayWebhookService.handleWebhook(raw, sig, evtId, payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });
    assert.strictEqual(r1.success, true);

    // Replay event
    const r2 = await RazorpayWebhookService.handleWebhook(raw, sig, evtId, payload, {
      webhookSecret: mockWebhookSecret,
      environment: PaymentEnvironment.TEST
    });
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r2.idempotent, true);
  });
});
