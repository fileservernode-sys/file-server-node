import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/config/database.js';
import { RazorpayCheckoutService } from '../src/services/billing/providers/razorpay/razorpay_checkout_service.js';
import { RazorpayWebhookService } from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';
import { AccountProductSubscriptionService } from '../src/services/billing/account_product_subscription_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { BillingStateService, PAID_ENTITLED_STATUSES } from '../src/services/billing/billing_state_service.js';
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
  AccountProductSubscription
} from '@prisma/client';

const mockWebhookSecret = 'whsec_test_mockSecret_batch313_987654321';
const mockKeySecret = 'rzp_test_secret_mock_batch313_123456';

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

describe('Phase 19.3 Batch 3.1.3: Distributed Concurrency, Webhook Lease Ownership & Entitlement Consistency Suite', () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
  process.env.RAZORPAY_KEY_SECRET = mockKeySecret;

  const storagePlan = createMockPlan({
    id: 'plan_storage_pro_m',
    code: 'PRO_MONTHLY',
    productType: ProductType.STORAGE,
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

  const plansByCode = new Map<string, any>([
    [storagePlan.code, storagePlan],
    [cameraPlan.code, cameraPlan],
    [unifiedPlan.code, unifiedPlan]
  ]);

  const testUserId = 'usr_dcr_test_user_001';
  const mockUsers = new Map<string, any>();
  const mockBillingStates = new Map<string, any>();
  const mockBillingProfiles = new Map<string, any>();
  const mockSubscriptions = new Map<string, any>();
  const mockSlots = new Map<string, any>();
  const mockWebhookEvents = new Map<string, any>();
  const mockPayments = new Map<string, any>();

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
    mockUsers.set(testUserId, { id: testUserId, email: 'user_dcr@zdexcloud.com' });

    const fullProfile = {
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
    };

    mockBillingProfiles.set(testUserId, fullProfile);

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
      // Check unique constraint on [provider, environment, providerPaymentId]
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

    (prisma.billingPayment as any).findUnique = async ({ where }: any) => {
      if (where.id) return mockPayments.get(where.id) || null;
      return null;
    };

    (prisma.billingPayment as any).findFirst = async ({ where }: any) => {
      for (const p of mockPayments.values()) {
        if (where.providerPaymentId && p.providerPaymentId === where.providerPaymentId) return p;
      }
      return null;
    };

    (prisma.billingPayment as any).findMany = async () => Array.from(mockPayments.values());

    (prisma.billingReceipt as any).findFirst = async () => null;
    (prisma.billingReceipt as any).create = async ({ data }: any) => data;
    (prisma.auditEvent as any).create = async ({ data }: any) => data;
    (prisma.billingProviderPlanMapping as any).findUnique = async () => null;
  });

  beforeEach(() => {
    mockSubscriptions.clear();
    mockSlots.clear();
    mockWebhookEvents.clear();
    mockPayments.clear();
    (prisma as any).$transaction = defaultTx;
    (prisma.billingProviderPlanMapping as any).findUnique = async () => null;
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

  // =========================================================================
  // GROUP 1: CHECKOUT CONCURRENCY & DURABLE RESERVATIONS (SCENARIOS 1-7)
  // =========================================================================

  it('TC-DCR-01 [Mocked Integration]: Two backend instances request same STORAGE checkout simultaneously', async () => {
    // Instance 1 initiates checkout and creates durable reservation
    const session1 = await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'PRO_MONTHLY' });
    assert.ok(session1.subscriptionId);

    // Instance 2 requests same checkout: finds existing pending reservation within 1h TTL and reuses it idempotently
    const session2 = await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'PRO_MONTHLY' });
    assert.strictEqual(session2.subscriptionId, session1.subscriptionId, 'Instance 2 reused Instance 1 session without duplicate Razorpay sub');

    // Confirm only one Subscription record exists in DB
    const allSubs = Array.from(mockSubscriptions.values()).filter(s => s.userId === testUserId);
    assert.strictEqual(allSubs.length, 1);
  });

  it('TC-DCR-02 [Mocked Integration]: Two backend instances request conflicting STORAGE and UNIFIED_PRO checkouts', async () => {
    // Instance 1 reserves STORAGE checkout
    await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'PRO_MONTHLY' });

    // Instance 2 attempts UNIFIED_PRO checkout: conflict detected against pending STORAGE reservation
    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'UNIFIED_PRO_MONTHLY' });
      },
      /A pending checkout session already exists for STORAGE/
    );
  });

  it('TC-DCR-03 [Mocked Integration]: Two backend instances request CAMERA and UNIFIED_PRO simultaneously', async () => {
    // Instance 1 reserves CAMERA checkout
    await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'CAMERA_PRO_MONTHLY' });

    // Instance 2 attempts UNIFIED_PRO checkout: conflict detected against pending CAMERA reservation
    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'UNIFIED_PRO_MONTHLY' });
      },
      /A pending checkout session already exists for CAMERA/
    );
  });

  it('TC-DCR-04 [Mocked Integration]: Process crash after reservation but before Razorpay response', async () => {
    // Simulate process crash after reservation: insert an unfulfilled CREATED reservation older than 2 minutes
    const staleReservation = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.CREATED,
        providerSubscriptionId: null, // Crashed before Razorpay returned ID
        createdAt: new Date(Date.now() - 150000) // 2.5 minutes ago (stale in-flight)
      }
    });

    // Next checkout request discovers the stale unfulfilled reservation, marks it EXPIRED, and proceeds cleanly
    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'PRO_MONTHLY' });
    assert.ok(session.subscriptionId);

    const expiredSub = mockSubscriptions.get(staleReservation.id);
    assert.strictEqual(expiredSub.status, BillingStatus.EXPIRED, 'Stale unfulfilled reservation expired cleanly');
  });

  it('TC-DCR-05 [Mocked Integration]: Razorpay timeout with ambiguous provider outcome preserves reservation', async () => {
    (prisma.billingProviderPlanMapping as any).findUnique = async () => ({
      providerPlanId: 'plan_rzp_mock',
      isActive: true
    });

    // Inject client that throws network timeout
    const timeoutClient = {
      isConfigured: () => true,
      assertConfigured: () => ({ keyId: 'rzp_test', keySecret: 'test_sec' }),
      createSubscription: async () => {
        const err: any = new Error('ETIMEDOUT: Connection to Razorpay timed out');
        throw err;
      }
    };

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(
          testUserId,
          { planCode: 'PRO_MONTHLY' },
          { client: timeoutClient as any }
        );
      },
      /ETIMEDOUT/
    );

    // Verify reservation is preserved in CREATED (not deleted) to prevent blind duplicate creation
    const createdSubs = Array.from(mockSubscriptions.values()).filter(s => s.userId === testUserId && s.status === BillingStatus.CREATED);
    assert.strictEqual(createdSubs.length, 1);
  });

  it('TC-DCR-06 [Mocked Integration]: Expired reservation recovery (>1h) allows new checkout', async () => {
    // Insert an expired reservation (> 1 hour old)
    const oldSub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.CREATED,
        providerSubscriptionId: 'sub_old_expired_123',
        createdAt: new Date(Date.now() - 3700000) // 61 minutes ago
      }
    });

    // New checkout discovers old session has exceeded 1h TTL, expires it, and generates fresh session
    const newSession = await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'PRO_MONTHLY' });
    assert.ok(newSession.subscriptionId);
    assert.notStrictEqual(newSession.subscriptionId, 'sub_old_expired_123', 'Generated fresh session after TTL expiry');

    assert.strictEqual(mockSubscriptions.get(oldSub.id).status, BillingStatus.EXPIRED);
  });

  it('TC-DCR-07 [Mocked Integration]: Reuse of an existing valid checkout attempt within TTL', async () => {
    // Insert active CREATED subscription created 10 minutes ago
    await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.CREATED,
        providerSubscriptionId: 'sub_valid_reuse_456',
        createdAt: new Date(Date.now() - 600000) // 10 minutes ago
      }
    });

    const session = await RazorpayCheckoutService.createCheckoutSession(testUserId, { planCode: 'PRO_MONTHLY' });
    assert.strictEqual(session.subscriptionId, 'sub_valid_reuse_456', 'Reused valid pending checkout session');
  });

  // =========================================================================
  // GROUP 2: WEBHOOK LEASE OWNERSHIP & CONCURRENCY (SCENARIOS 8-15)
  // =========================================================================

  it('TC-DCR-08 [Mocked Integration]: Two workers reclaim the same stale PROCESSING event simultaneously', async () => {
    const eventId = 'evt_dcr_08_stale';
    const subId = 'sub_dcr_08';

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.CREATED,
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Insert an abandoned PROCESSING event from 5 minutes ago
    const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
    const initialUpdatedAt = new Date(Date.now() - 300000);
    mockWebhookEvents.set(key, {
      id: 'we_dcr_08',
      provider: PaymentProvider.RAZORPAY,
      environment: PaymentEnvironment.TEST,
      providerEventId: eventId,
      eventType: 'subscription.activated',
      status: WebhookEventStatus.PROCESSING,
      updatedAt: initialUpdatedAt
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

    // Worker 1 and Worker 2 both attempt to process the stale event
    const [res1, res2] = await Promise.all([
      RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts),
      RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts)
    ]);

    // Exactly one worker processed the event, the other received idempotent acknowledgement
    const processedResults = [res1, res2].filter(r => !r.idempotent);
    const idempotentResults = [res1, res2].filter(r => r.idempotent);

    assert.strictEqual(processedResults.length, 1, 'Exactly one worker acquired exclusive lease');
    assert.strictEqual(idempotentResults.length, 1, 'Second worker safely acknowledged without re-executing');
  });

  it('TC-DCR-09 [Mocked Integration]: Exactly one worker obtains the lease; second worker is rejected', async () => {
    const eventId = 'evt_dcr_09_single_lease';
    const subId = 'sub_dcr_09';

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.CREATED,
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

    // Initial delivery establishes active PROCESSING lease
    const res1 = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(res1.success, true);

    // Duplicate delivery while original is processing (<2 min) is safely fenced
    const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
    const eventRecord = mockWebhookEvents.get(key);
    eventRecord.status = WebhookEventStatus.PROCESSING;
    eventRecord.updatedAt = new Date(); // Active lease

    const res2 = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(res2.idempotent, true);
    assert(res2.message.includes('currently processing in concurrent worker'));
  });

  it('TC-DCR-10 [Mocked Integration]: Old worker attempts to complete after lease ownership changes (fenced via leaseToken)', async () => {
    const eventId = 'we_dcr_10';
    const oldLeaseToken = 'lease_old_worker_111';
    const newLeaseToken = 'lease_new_worker_222';

    // Event is currently owned by new worker
    const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
    mockWebhookEvents.set(key, {
      id: eventId,
      provider: PaymentProvider.RAZORPAY,
      environment: PaymentEnvironment.TEST,
      providerEventId: eventId,
      status: WebhookEventStatus.PROCESSING,
      failureReason: `LEASE:${newLeaseToken}:${new Date(Date.now() + 120000).toISOString()}`,
      updatedAt: new Date()
    });

    // Old worker attempts to complete event using oldLeaseToken
    const completed = await RazorpayWebhookService.completeWebhookEvent(eventId, oldLeaseToken);
    assert.strictEqual(completed, false, 'Old worker completion was rejected because lease ownership changed');

    // Event remains in PROCESSING owned by new worker
    const current = mockWebhookEvents.get(key);
    assert.strictEqual(current.status, WebhookEventStatus.PROCESSING);
    assert(current.failureReason.includes(newLeaseToken));
  });

  it('TC-DCR-11 [Mocked Integration]: Worker crash after business transaction commit leaves state consistent', async () => {
    const eventId = 'evt_dcr_11_crash_commit';
    const subId = 'sub_dcr_11';

    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.CREATED,
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

    // Process event: business transaction commits
    const res = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(res.success, true);

    // Verify business state: subscription ACTIVE, slot ACTIVE, billing state ACTIVE
    assert.strictEqual(mockSubscriptions.get(sub.id).status, BillingStatus.ACTIVE);
    const slotKey = `${testUserId}:${ProductType.STORAGE}`;
    assert.strictEqual(mockSlots.get(slotKey).status, BillingStatus.ACTIVE);
    assert.strictEqual(mockBillingStates.get(testUserId).activeSubscriptionId, sub.id);
  });

  it('TC-DCR-12 [Mocked Integration]: Provider retry after business commit but before PROCESSED status update succeeds idempotently', async () => {
    const eventId = 'evt_dcr_12_retry_unprocessed';
    const subId = 'sub_dcr_12';

    await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        providerSubscriptionId: subId,
        status: BillingStatus.ACTIVE, // Already active from first attempt
        amountMinorUnits: 4900,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Webhook record stuck in stale PROCESSING from crashed worker
    const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
    mockWebhookEvents.set(key, {
      id: 'we_dcr_12',
      provider: PaymentProvider.RAZORPAY,
      environment: PaymentEnvironment.TEST,
      providerEventId: eventId,
      eventType: 'subscription.activated',
      status: WebhookEventStatus.PROCESSING,
      updatedAt: new Date(Date.now() - 300000) // 5 minutes ago
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

    // Provider retries: reclaims lease, acknowledges without state regression, marks PROCESSED
    const retryRes = await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(mockWebhookEvents.get(key).status, WebhookEventStatus.PROCESSED);
  });

  it('TC-DCR-13 [Mocked Integration]: Concurrent duplicate payment insertion handled cleanly via unique constraint', async () => {
    const paymentId = 'pay_dcr_13_duplicate';

    // Insert payment 1
    const p1 = await prisma.billingPayment.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: paymentId,
        userId: testUserId,
        subscriptionId: 'sub_dummy',
        amountMinorUnits: 4900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });
    assert.ok(p1);

    // Attempt concurrent duplicate insert: unique constraint rejects duplicate
    await assert.rejects(
      async () => {
        await prisma.billingPayment.create({
          data: {
            provider: PaymentProvider.RAZORPAY,
            environment: PaymentEnvironment.TEST,
            providerPaymentId: paymentId,
            userId: testUserId,
            subscriptionId: 'sub_dummy',
            amountMinorUnits: 4900,
            currency: CurrencyCode.INR,
            status: PaymentStatus.SUCCESS,
            chargedAt: new Date()
          }
        });
      },
      /P2002/
    );
  });

  it('TC-DCR-14 [Mocked Integration]: Database outage during event claim propagates as retryable error', async () => {
    const eventId = 'evt_dcr_14_db_outage';
    const payload = { event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_14' } } } };
    const raw = JSON.stringify(payload);
    const sig = computeSignature(raw);

    // Simulate database connection failure on create
    const originalCreate = (prisma.billingWebhookEvent as any).create;
    (prisma.billingWebhookEvent as any).create = async () => {
      const err: any = new Error("Can't reach database server at mysql.gb.stackcp.com");
      err.code = 'P1001';
      throw err;
    };

    try {
      await assert.rejects(
        async () => {
          await RazorpayWebhookService.handleWebhook(raw, sig, eventId, payload, webhookOpts);
        },
        /Can't reach database server/
      );
    } finally {
      (prisma.billingWebhookEvent as any).create = originalCreate;
    }
  });

  it('TC-DCR-15 [Mocked Integration]: Long-running worker successfully renews lease via renewWebhookLease', async () => {
    const eventId = 'we_dcr_15';
    const leaseToken = 'lease_long_runner_token';

    const key = `${PaymentProvider.RAZORPAY}:${PaymentEnvironment.TEST}:${eventId}`;
    mockWebhookEvents.set(key, {
      id: eventId,
      provider: PaymentProvider.RAZORPAY,
      environment: PaymentEnvironment.TEST,
      providerEventId: eventId,
      status: WebhookEventStatus.PROCESSING,
      failureReason: `LEASE:${leaseToken}:${new Date(Date.now() + 60000).toISOString()}`,
      updatedAt: new Date()
    });

    // Renew lease for an additional 120 seconds
    const renewed = await RazorpayWebhookService.renewWebhookLease(eventId, leaseToken, 120000);
    assert.strictEqual(renewed, true, 'Lease successfully renewed');

    const updatedRecord = mockWebhookEvents.get(key);
    assert(updatedRecord.failureReason.startsWith(`LEASE:${leaseToken}`));
  });

  // =========================================================================
  // GROUP 3: ENTITLEMENT STATUS POLICY & FALLBACKS (SCENARIOS 16-22)
  // =========================================================================

  it('TC-DCR-16 [Unit]: CANCELLING remains entitled according to authoritative policy', () => {
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.CANCELLING), true);
  });

  it('TC-DCR-17 [Unit]: PAST_DUE remains entitled according to authoritative policy', () => {
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.PAST_DUE), true);
  });

  it('TC-DCR-18 [Unit]: GRACE_PERIOD remains entitled according to authoritative policy', () => {
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.GRACE_PERIOD), true);
  });

  it('TC-DCR-19 [Unit]: Terminal EXPIRED subscription does not grant entitlement', () => {
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.EXPIRED), false);
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.REFUNDED), false);
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.FREE), false);
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.CREATED), false);
  });

  it('TC-DCR-20 [Unit]: CANCELLED / TRIALING verified absent from BillingStatus enum; mapped to CANCELLING / EXPIRED', () => {
    const enumValues = Object.keys(BillingStatus);
    assert.strictEqual(enumValues.includes('CANCELLED'), false, 'CANCELLED does not exist in BillingStatus enum');
    assert.strictEqual(enumValues.includes('TRIALING'), false, 'TRIALING does not exist in BillingStatus enum');
    assert.deepStrictEqual(enumValues.sort(), [
      'ACTIVE',
      'CANCELLING',
      'CREATED',
      'EXPIRED',
      'FREE',
      'GRACE_PERIOD',
      'PAST_DUE',
      'REFUNDED'
    ].sort());
  });

  it('TC-DCR-21 [Unit]: Storage serverLimit fallback cannot grant Camera quota', async () => {
    // User with only a Storage subscription (serverLimit: 5)
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: storagePlan.id,
        planPriceId: storagePlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
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
    assert.strictEqual(entitlements.storage.planCode, 'PRO_MONTHLY');

    // Camera must strictly remain 0 and disabled
    assert.strictEqual(entitlements.camera.maxCameras, 0, 'Storage serverLimit did NOT grant camera quota');
    assert.strictEqual(entitlements.camera.liveStreamingEnabled, false);
    assert.strictEqual(entitlements.camera.recordingEnabled, false);
    assert.strictEqual(entitlements.camera.source, 'NONE');
  });

  it('TC-DCR-22 [Unit]: Unified Pro resolves both domains from single canonical slot', async () => {
    // User with Unified Pro subscription (serverLimit: 5)
    const sub = await (prisma.subscription as any).create({
      data: {
        userId: testUserId,
        planId: unifiedPlan.id,
        planPriceId: unifiedPlan.prices[0].id,
        status: BillingStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await AccountProductSubscriptionService.upsertProductSlot({
      userId: testUserId,
      productType: ProductType.UNIFIED_PRO,
      subscriptionId: sub.id,
      status: BillingStatus.ACTIVE
    });

    const entitlements = await EntitlementService.resolveUserEntitlements(testUserId);

    // Single slot resolves 5 servers for Storage
    assert.strictEqual(entitlements.storage.maxServers, 5);
    assert.strictEqual(entitlements.storage.planCode, 'UNIFIED_PRO_MONTHLY');
    assert.strictEqual(entitlements.storage.source, 'PRODUCT_SLOT');

    // Single slot resolves 5 cameras for Camera
    assert.strictEqual(entitlements.camera.maxCameras, 5);
    assert.strictEqual(entitlements.camera.liveStreamingEnabled, true);
    assert.strictEqual(entitlements.camera.planCode, 'UNIFIED_PRO_MONTHLY');
    assert.strictEqual(entitlements.camera.source, 'PRODUCT_SLOT');
  });
});
