import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  EntitlementService,
  DEFAULT_FREE_ENTITLEMENTS,
  DEFAULT_FREE_STORAGE_ENTITLEMENTS,
  DEFAULT_FREE_CAMERA_ENTITLEMENTS,
  buildFreeMultiProductEntitlements,
  MultiProductResolvedEntitlements
} from '../src/services/billing/entitlement_service.js';
import {
  AccountProductSubscriptionService,
  PopulatedProductSlot
} from '../src/services/billing/account_product_subscription_service.js';
import { PAID_ENTITLED_STATUSES } from '../src/services/billing/billing_state_service.js';
import { ProductType, BillingStatus, BillingInterval, CurrencyCode, Plan, PlanPrice } from '@prisma/client';

function createMockPlanPrice(planId: string, amountMinorUnits = 4900): PlanPrice {
  return {
    id: `price_${planId}`,
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
  entitlements?: any[];
}): Plan & { entitlements?: any[] } {
  return {
    id: params.id,
    code: params.code,
    name: params.code,
    description: null,
    productType: params.productType,
    interval: BillingInterval.MONTHLY,
    intervalCount: 1,
    serverLimit: params.serverLimit ?? 1,
    priorityRelay: params.priorityRelay ?? false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    entitlements: params.entitlements || []
  };
}

function createMockSubscription(params: {
  id: string;
  userId: string;
  plan: Plan & { entitlements?: any[] };
  planPrice: PlanPrice;
  status?: BillingStatus;
  interval?: BillingInterval;
}): PopulatedProductSlot['subscription'] {
  return {
    id: params.id,
    userId: params.userId,
    planId: params.plan.id,
    planPriceId: params.planPrice.id,
    provider: 'RAZORPAY',
    providerEnvironment: 'TEST',
    providerSubscriptionId: `sub_prov_${params.id}`,
    providerPlanId: null,
    status: params.status ?? BillingStatus.ACTIVE,
    billingInterval: params.interval ?? BillingInterval.MONTHLY,
    currency: CurrencyCode.INR,
    amountMinorUnits: params.planPrice.amountMinorUnits,
    priceVersion: 1,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    gracePeriodStartedAt: null,
    gracePeriodEndsAt: null,
    dunningMilestones: null,
    dunningLastEvaluatedAt: null,
    expiredAt: params.status === BillingStatus.EXPIRED ? new Date() : null,
    refundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    plan: params.plan,
    planPrice: params.planPrice
  };
}

function createMockSlot(params: {
  id: string;
  userId: string;
  productType: ProductType;
  subscription: PopulatedProductSlot['subscription'];
  status?: BillingStatus;
}): PopulatedProductSlot {
  return {
    id: params.id,
    userId: params.userId,
    productType: params.productType,
    subscriptionId: params.subscription.id,
    status: params.status ?? params.subscription.status,
    createdAt: new Date(),
    updatedAt: new Date(),
    subscription: params.subscription
  };
}

describe('Phase 19.3 Batch 2: Multi-Product Entitlement Engine & Slot Management Test Suite', () => {
  let app: FastifyInstance;
  let isMigrationDeployed = false;
  const timestamp = Date.now();
  const testUserId = `user_batch2_${timestamp}`;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Check if migration 20261105120000 has been applied to connected database
    try {
      const checkResult: any = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Plan' AND COLUMN_NAME = 'productType'`
      );
      const count = Number(checkResult[0]?.cnt || checkResult[0]?.CNT || 0);
      isMigrationDeployed = count > 0;
    } catch {
      isMigrationDeployed = false;
    }
  });

  after(async () => {
    EntitlementService.clearTestUserPlans();
    await app.close();
  });

  // ===========================================================================
  // SECTION 1: UNIT TESTS — PRODUCT ISOLATION & CONTRACTS
  // ===========================================================================

  test('TC-MPE-U1: Free account receives canonical default entitlements for both Storage and Camera', () => {
    const free = buildFreeMultiProductEntitlements('test_free_user');

    assert.strictEqual(free.userId, 'test_free_user');
    assert.strictEqual(free.planCode, 'FREE');
    assert.strictEqual(free.maxServers, 1);
    assert.strictEqual(free.priorityRelay, false);

    // Storage domain
    assert.strictEqual(free.storage.productType, ProductType.STORAGE);
    assert.strictEqual(free.storage.planCode, 'FREE');
    assert.strictEqual(free.storage.status, BillingStatus.FREE);
    assert.strictEqual(free.storage.maxServers, 1);
    assert.strictEqual(free.storage.priorityRelay, false);
    assert.strictEqual(free.storage.source, 'FREE_DEFAULT');

    // Camera domain
    assert.strictEqual(free.camera.productType, ProductType.CAMERA);
    assert.strictEqual(free.camera.planCode, 'NONE');
    assert.strictEqual(free.camera.status, BillingStatus.FREE);
    assert.strictEqual(free.camera.maxCameras, 0);
    assert.strictEqual(free.camera.liveStreamingEnabled, false);
    assert.strictEqual(free.camera.recordingEnabled, false);
    assert.strictEqual(free.camera.source, 'NONE');

    // Top-level raw entitlements dictionary
    assert.strictEqual(free.entitlements.MAX_SERVERS, 1);
    assert.strictEqual(free.entitlements.PRIORITY_RELAY, false);
    assert.strictEqual(free.entitlements.MAX_CAMERAS, 0);
    assert.strictEqual(free.entitlements.CAMERA_STREAMING, false);
    assert.strictEqual(free.entitlements.CAMERA_RECORDING, false);

    assert.strictEqual(free.isMultiProduct, false);
  });

  test('TC-MPE-U2: Paid entitled statuses match authoritative billing specification', () => {
    assert.ok(PAID_ENTITLED_STATUSES.has(BillingStatus.ACTIVE));
    assert.ok(PAID_ENTITLED_STATUSES.has(BillingStatus.CANCELLING));
    assert.ok(PAID_ENTITLED_STATUSES.has(BillingStatus.PAST_DUE));
    assert.ok(PAID_ENTITLED_STATUSES.has(BillingStatus.GRACE_PERIOD));

    // Non-entitled statuses
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.FREE), false);
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.EXPIRED), false);
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.REFUNDED), false);
    assert.strictEqual(PAID_ENTITLED_STATUSES.has(BillingStatus.CREATED), false);
  });

  test('TC-MPE-U3: Storage subscription grants Storage entitlements ONLY (Zero Camera Leakage)', async () => {
    const plan = createMockPlan({
      id: 'plan_storage_pro',
      code: 'PRO_MONTHLY',
      productType: ProductType.STORAGE,
      serverLimit: 5,
      priorityRelay: true
    });
    const price = createMockPlanPrice(plan.id, 4900);

    const sub = createMockSubscription({
      id: 'sub_storage_1',
      userId: 'user_storage_only',
      plan: {
        ...plan,
        entitlements: [
          {
            id: 'ent_1',
            planId: plan.id,
            entitlementDefinitionId: 'def_1',
            intValue: 5,
            boolValue: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            entitlementDefinition: {
              id: 'def_1',
              code: 'MAX_SERVERS' as any,
              name: 'Max Servers',
              description: null,
              valueType: 'INTEGER' as any,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          },
          {
            id: 'ent_2',
            planId: plan.id,
            entitlementDefinitionId: 'def_2',
            intValue: null,
            boolValue: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            entitlementDefinition: {
              id: 'def_2',
              code: 'PRIORITY_RELAY' as any,
              name: 'Priority Relay',
              description: null,
              valueType: 'BOOLEAN' as any,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          }
        ]
      },
      planPrice: price,
      status: BillingStatus.ACTIVE
    });

    const mockStorageSlot = createMockSlot({
      id: 'slot_storage_1',
      userId: 'user_storage_only',
      productType: ProductType.STORAGE,
      subscription: sub
    });

    const originalGetProductSlots = AccountProductSubscriptionService.getProductSlots;
    AccountProductSubscriptionService.getProductSlots = async (uid: string) => {
      if (uid === 'user_storage_only') return [mockStorageSlot];
      return [];
    };

    try {
      const result = await EntitlementService.resolveUserEntitlements('user_storage_only');

      // Verify Storage is upgraded to Pro
      assert.strictEqual(result.storage.planCode, 'PRO_MONTHLY');
      assert.strictEqual(result.storage.maxServers, 5);
      assert.strictEqual(result.storage.priorityRelay, true);
      assert.strictEqual(result.storage.status, BillingStatus.ACTIVE);
      assert.strictEqual(result.storage.source, 'PRODUCT_SLOT');

      // Verify Camera remains strictly zero and disabled
      assert.strictEqual(result.camera.planCode, 'NONE');
      assert.strictEqual(result.camera.maxCameras, 0);
      assert.strictEqual(result.camera.liveStreamingEnabled, false);
      assert.strictEqual(result.camera.recordingEnabled, false);
      assert.strictEqual(result.camera.source, 'NONE');

      // Top-level legacy fields match Storage
      assert.strictEqual(result.planCode, 'PRO_MONTHLY');
      assert.strictEqual(result.maxServers, 5);
      assert.strictEqual(result.priorityRelay, true);
      assert.strictEqual(result.isMultiProduct, false);
    } finally {
      AccountProductSubscriptionService.getProductSlots = originalGetProductSlots;
    }
  });

  test('TC-MPE-U4: Camera subscription grants Camera entitlements ONLY (Zero Storage Leakage)', async () => {
    const plan = createMockPlan({
      id: 'plan_camera_pro',
      code: 'CAMERA_MONTHLY',
      productType: ProductType.CAMERA,
      serverLimit: 1, // Storage server limit remains 1
      priorityRelay: false,
      entitlements: [
        { code: 'MAX_CAMERAS', intValue: 4 },
        { code: 'CAMERA_STREAMING', boolValue: true }
      ]
    });
    const price = createMockPlanPrice(plan.id, 4900);

    const sub = createMockSubscription({
      id: 'sub_camera_1',
      userId: 'user_camera_only',
      plan,
      planPrice: price,
      status: BillingStatus.ACTIVE
    });

    const mockCameraSlot = createMockSlot({
      id: 'slot_camera_1',
      userId: 'user_camera_only',
      productType: ProductType.CAMERA,
      subscription: sub
    });

    const originalGetProductSlots = AccountProductSubscriptionService.getProductSlots;
    AccountProductSubscriptionService.getProductSlots = async (uid: string) => {
      if (uid === 'user_camera_only') return [mockCameraSlot];
      return [];
    };

    try {
      const result = await EntitlementService.resolveUserEntitlements('user_camera_only');

      // Verify Camera receives 4 cameras and live streaming
      assert.strictEqual(result.camera.planCode, 'CAMERA_MONTHLY');
      assert.strictEqual(result.camera.maxCameras, 4);
      assert.strictEqual(result.camera.liveStreamingEnabled, true);
      assert.strictEqual(result.camera.status, BillingStatus.ACTIVE);

      // Verify Storage server limit is strictly NOT increased (must remain 1)
      assert.strictEqual(result.storage.planCode, 'FREE');
      assert.strictEqual(result.storage.maxServers, 1);
      assert.strictEqual(result.storage.priorityRelay, false);
      assert.strictEqual(result.storage.source, 'FREE_DEFAULT');

      // Top-level maxServers must remain 1
      assert.strictEqual(result.maxServers, 1);
      assert.strictEqual(result.priorityRelay, false);
    } finally {
      AccountProductSubscriptionService.getProductSlots = originalGetProductSlots;
    }
  });

  test('TC-MPE-U5: Concurrent Storage + Camera subscriptions operate independently under Union-Max', async () => {
    const planStorage = createMockPlan({
      id: 'plan_storage_pro_2',
      code: 'PRO_MONTHLY',
      productType: ProductType.STORAGE,
      serverLimit: 5,
      priorityRelay: true
    });
    const priceStorage = createMockPlanPrice(planStorage.id, 4900);

    const planCamera = createMockPlan({
      id: 'plan_camera_pro_2',
      code: 'CAMERA_MONTHLY',
      productType: ProductType.CAMERA,
      serverLimit: 1,
      priorityRelay: false,
      entitlements: [
        { code: 'MAX_CAMERAS', intValue: 3 },
        { code: 'CAMERA_STREAMING', boolValue: true }
      ]
    });
    const priceCamera = createMockPlanPrice(planCamera.id, 4900);

    const subStorage = createMockSubscription({
      id: 'sub_storage_2',
      userId: 'user_dual_sub',
      plan: planStorage,
      planPrice: priceStorage,
      status: BillingStatus.ACTIVE
    });

    const subCamera = createMockSubscription({
      id: 'sub_camera_2',
      userId: 'user_dual_sub',
      plan: planCamera,
      planPrice: priceCamera,
      status: BillingStatus.ACTIVE
    });

    const mockStorageSlot = createMockSlot({
      id: 'slot_storage_2',
      userId: 'user_dual_sub',
      productType: ProductType.STORAGE,
      subscription: subStorage
    });

    const mockCameraSlot = createMockSlot({
      id: 'slot_camera_2',
      userId: 'user_dual_sub',
      productType: ProductType.CAMERA,
      subscription: subCamera
    });

    const originalGetProductSlots = AccountProductSubscriptionService.getProductSlots;
    AccountProductSubscriptionService.getProductSlots = async (uid: string) => {
      if (uid === 'user_dual_sub') return [mockStorageSlot, mockCameraSlot];
      return [];
    };

    try {
      const result = await EntitlementService.resolveUserEntitlements('user_dual_sub');

      assert.strictEqual(result.storage.maxServers, 5);
      assert.strictEqual(result.storage.priorityRelay, true);
      assert.strictEqual(result.camera.maxCameras, 3);
      assert.strictEqual(result.camera.liveStreamingEnabled, true);

      assert.strictEqual(result.applicableSubscriptions.length, 2);
      assert.strictEqual(result.activeProducts.length, 2);
      assert.strictEqual(result.isMultiProduct, true);
    } finally {
      AccountProductSubscriptionService.getProductSlots = originalGetProductSlots;
    }
  });

  test('TC-MPE-U6: Unified Pro subscription contributes to BOTH Storage and Camera domains', async () => {
    const plan = createMockPlan({
      id: 'plan_unified_pro',
      code: 'UNIFIED_PRO_YEARLY',
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
    const price = createMockPlanPrice(plan.id, 9900);

    const sub = createMockSubscription({
      id: 'sub_unified_pro',
      userId: 'user_unified_pro',
      plan,
      planPrice: price,
      status: BillingStatus.ACTIVE,
      interval: BillingInterval.YEARLY
    });

    const mockUnifiedProSlot = createMockSlot({
      id: 'slot_unified_pro',
      userId: 'user_unified_pro',
      productType: ProductType.UNIFIED_PRO,
      subscription: sub
    });

    const originalGetProductSlots = AccountProductSubscriptionService.getProductSlots;
    AccountProductSubscriptionService.getProductSlots = async (uid: string) => {
      if (uid === 'user_unified_pro') return [mockUnifiedProSlot];
      return [];
    };

    try {
      const result = await EntitlementService.resolveUserEntitlements('user_unified_pro');

      // Storage domain satisfied
      assert.strictEqual(result.storage.planCode, 'UNIFIED_PRO_YEARLY');
      assert.strictEqual(result.storage.maxServers, 5);
      assert.strictEqual(result.storage.priorityRelay, true);

      // Camera domain satisfied
      assert.strictEqual(result.camera.planCode, 'UNIFIED_PRO_YEARLY');
      assert.strictEqual(result.camera.maxCameras, 5);
      assert.strictEqual(result.camera.liveStreamingEnabled, true);

      assert.strictEqual(result.planCode, 'UNIFIED_PRO_YEARLY');
      assert.strictEqual(result.maxServers, 5);
      assert.strictEqual(result.priorityRelay, true);
    } finally {
      AccountProductSubscriptionService.getProductSlots = originalGetProductSlots;
    }
  });

  test('TC-MPE-U7: Union-Max numeric quota aggregation uses maximum (NOT sum)', async () => {
    const planUP = createMockPlan({
      id: 'plan_up',
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
    const priceUP = createMockPlanPrice(planUP.id, 5000);

    const planSP = createMockPlan({
      id: 'plan_sp',
      code: 'PRO_MONTHLY',
      productType: ProductType.STORAGE,
      serverLimit: 5,
      priorityRelay: true
    });
    const priceSP = createMockPlanPrice(planSP.id, 4900);

    const subUP = createMockSubscription({
      id: 'sub_u_pro',
      userId: 'user_stacked',
      plan: planUP,
      planPrice: priceUP,
      status: BillingStatus.ACTIVE
    });

    const subSP = createMockSubscription({
      id: 'sub_st_pro',
      userId: 'user_stacked',
      plan: planSP,
      planPrice: priceSP,
      status: BillingStatus.ACTIVE
    });

    const slotA = createMockSlot({
      id: 'slot_u_pro',
      userId: 'user_stacked',
      productType: ProductType.UNIFIED_PRO,
      subscription: subUP
    });

    const slotB = createMockSlot({
      id: 'slot_st_pro',
      userId: 'user_stacked',
      productType: ProductType.STORAGE,
      subscription: subSP
    });

    const originalGetProductSlots = AccountProductSubscriptionService.getProductSlots;
    AccountProductSubscriptionService.getProductSlots = async (uid: string) => {
      if (uid === 'user_stacked') return [slotA, slotB];
      return [];
    };

    try {
      const result = await EntitlementService.resolveUserEntitlements('user_stacked');
      assert.strictEqual(result.storage.maxServers, 5, 'Union-Max must be max(5,5) = 5, not sum 10');
      assert.strictEqual(result.maxServers, 5);
    } finally {
      AccountProductSubscriptionService.getProductSlots = originalGetProductSlots;
    }
  });

  test('TC-MPE-U8: Camera cancellation or expiration does NOT remove Storage entitlements', async () => {
    const planST = createMockPlan({
      id: 'plan_st',
      code: 'PRO_MONTHLY',
      productType: ProductType.STORAGE,
      serverLimit: 5,
      priorityRelay: true
    });
    const priceST = createMockPlanPrice(planST.id, 4900);

    const planCAM = createMockPlan({
      id: 'plan_cam',
      code: 'CAMERA_MONTHLY',
      productType: ProductType.CAMERA,
      serverLimit: 4,
      priorityRelay: false
    });
    const priceCAM = createMockPlanPrice(planCAM.id, 4900);

    const subST = createMockSubscription({
      id: 'sub_st_active',
      userId: 'user_cam_expired',
      plan: planST,
      planPrice: priceST,
      status: BillingStatus.ACTIVE
    });

    const subCAM = createMockSubscription({
      id: 'sub_cam_exp',
      userId: 'user_cam_expired',
      plan: planCAM,
      planPrice: priceCAM,
      status: BillingStatus.EXPIRED
    });

    const storageSlot = createMockSlot({
      id: 'slot_st_active',
      userId: 'user_cam_expired',
      productType: ProductType.STORAGE,
      subscription: subST
    });

    const expiredCameraSlot = createMockSlot({
      id: 'slot_cam_exp',
      userId: 'user_cam_expired',
      productType: ProductType.CAMERA,
      subscription: subCAM
    });

    const originalGetProductSlots = AccountProductSubscriptionService.getProductSlots;
    AccountProductSubscriptionService.getProductSlots = async (uid: string) => {
      if (uid === 'user_cam_expired') return [storageSlot, expiredCameraSlot];
      return [];
    };

    try {
      const result = await EntitlementService.resolveUserEntitlements('user_cam_expired');

      // Storage remains completely intact with 5 servers
      assert.strictEqual(result.storage.maxServers, 5);
      assert.strictEqual(result.storage.priorityRelay, true);
      assert.strictEqual(result.storage.status, BillingStatus.ACTIVE);

      // Camera has dropped to 0 due to expiration
      assert.strictEqual(result.camera.maxCameras, 0);
      assert.strictEqual(result.camera.liveStreamingEnabled, false);
      assert.strictEqual(result.camera.status, BillingStatus.FREE);
    } finally {
      AccountProductSubscriptionService.getProductSlots = originalGetProductSlots;
    }
  });

  test('TC-MPE-U9: Deduplication ensures a subscription is NEVER counted twice', async () => {
    const planST = createMockPlan({
      id: 'plan_st',
      code: 'PRO_MONTHLY',
      productType: ProductType.STORAGE,
      serverLimit: 5,
      priorityRelay: true
    });
    const priceST = createMockPlanPrice(planST.id, 4900);

    const sub = createMockSubscription({
      id: 'same_sub_id_123',
      userId: 'user_dup_test',
      plan: planST,
      planPrice: priceST,
      status: BillingStatus.ACTIVE
    });

    const duplicateSlotA = createMockSlot({
      id: 'slot_dup_1',
      userId: 'user_dup_test',
      productType: ProductType.STORAGE,
      subscription: sub
    });

    const duplicateSlotB = createMockSlot({
      id: 'slot_dup_2',
      userId: 'user_dup_test',
      productType: ProductType.STORAGE,
      subscription: sub
    });

    const originalGetProductSlots = AccountProductSubscriptionService.getProductSlots;
    AccountProductSubscriptionService.getProductSlots = async (uid: string) => {
      if (uid === 'user_dup_test') return [duplicateSlotA, duplicateSlotB];
      return [];
    };

    try {
      const result = await EntitlementService.resolveUserEntitlements('user_dup_test');
      assert.strictEqual(result.applicableSubscriptions.length, 1, 'Duplicate subscriptionId must be deduplicated');
    } finally {
      AccountProductSubscriptionService.getProductSlots = originalGetProductSlots;
    }
  });

  // ===========================================================================
  // SECTION 2: DATABASE-BACKED INTEGRATION TESTS
  // ===========================================================================

  test('TC-MPE-I1: Database slot retrieval handles unmigrated table gracefully', async () => {
    const slots = await AccountProductSubscriptionService.getProductSlots('test_nonexistent_user');
    assert.ok(Array.isArray(slots));
  });

  test('TC-MPE-I2: Database legacy fallback resolves active subscription from AccountBillingState', async (t) => {
    if (!isMigrationDeployed) {
      t.skip('Pending operational migration deployment (npx prisma migrate deploy). Remote database unmutated per Phase 19.3 safety directive.');
      return;
    }

    const res = await EntitlementService.resolveUserEntitlements(testUserId);
    assert.strictEqual(res.planCode, 'FREE');
    assert.strictEqual(res.maxServers, 1);
  });
});
