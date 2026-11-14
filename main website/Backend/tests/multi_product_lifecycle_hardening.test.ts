import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  EntitlementService,
  buildFreeMultiProductEntitlements
} from '../src/services/billing/entitlement_service.js';
import {
  AccountProductSubscriptionService,
  PopulatedProductSlot,
  classifyPrismaError
} from '../src/services/billing/account_product_subscription_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  DeploymentMigrationPendingError
} from '../src/errors/app-error.js';
import {
  ProductType,
  BillingStatus,
  BillingInterval,
  CurrencyCode,
  Plan,
  PlanPrice,
  AccountProductSubscription
} from '@prisma/client';

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
}): Plan {
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
    updatedAt: new Date()
  };
}

function createMockSubscription(params: {
  id: string;
  userId: string;
  plan: Plan & { entitlements?: any[] };
  planPrice?: PlanPrice;
  status?: BillingStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  updatedAt?: Date;
}): PopulatedProductSlot['subscription'] {
  const price = params.planPrice ?? createMockPlanPrice(params.plan.id);
  const now = new Date();
  return {
    id: params.id,
    userId: params.userId,
    planId: params.plan.id,
    planPriceId: price.id,
    provider: 'RAZORPAY',
    providerEnvironment: 'TEST',
    providerSubscriptionId: `sub_prov_${params.id}`,
    providerPlanId: null,
    status: params.status ?? BillingStatus.ACTIVE,
    billingInterval: BillingInterval.MONTHLY,
    currency: CurrencyCode.INR,
    amountMinorUnits: price.amountMinorUnits,
    priceVersion: 1,
    currentPeriodStart: params.currentPeriodStart ?? now,
    currentPeriodEnd: params.currentPeriodEnd ?? new Date(now.getTime() + 30 * 86400000),
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    gracePeriodStartedAt: null,
    gracePeriodEndsAt: null,
    dunningMilestones: null,
    dunningLastEvaluatedAt: null,
    expiredAt: params.status === BillingStatus.EXPIRED ? now : null,
    refundedAt: null,
    createdAt: now,
    updatedAt: params.updatedAt ?? now,
    plan: params.plan,
    planPrice: price
  };
}

function createMockSlot(params: {
  id: string;
  userId: string;
  productType: ProductType;
  subscriptionId: string;
  status?: BillingStatus;
  updatedAt?: Date;
}): AccountProductSubscription {
  return {
    id: params.id,
    userId: params.userId,
    productType: params.productType,
    subscriptionId: params.subscriptionId,
    status: params.status ?? BillingStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: params.updatedAt ?? new Date()
  };
}

describe('Phase 19.3 Batch 2.2: Final Lifecycle Ordering, Transaction Locking & Safety Test Suite', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // ===========================================================================
  // SECTION 1: MANDATORY SUBSCRIPTION ID (TASK A)
  // ===========================================================================

  test('TC-MPL-U1: Expiration without a subscription ID is rejected with ValidationError', async () => {
    await assert.rejects(
      async () => {
        // Calling expireProductSlot with empty subscriptionId
        await AccountProductSubscriptionService.expireProductSlot({
          userId: 'user_missing_sub',
          productType: ProductType.STORAGE,
          subscriptionId: '' as any
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /subscriptionId is required to expire a product slot/);
        return true;
      }
    );
  });

  // ===========================================================================
  // SECTION 2: STALE LIFECYCLE EVENT PROTECTION (TASKS A & B)
  // ===========================================================================

  test('TC-MPL-U2: Stale subscription expiration event for superseded sub_A is ignored; active sub_B retained', async () => {
    const userId = 'user_stale_exp_test';
    const currentSubId = 'sub_B_active';
    const staleSubId = 'sub_A_superseded';

    let currentSlot: AccountProductSubscription = createMockSlot({
      id: 'slot_storage_1',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: currentSubId,
      status: BillingStatus.ACTIVE
    });

    const origFindUnique = prisma.accountProductSubscription.findUnique;
    const origUpdate = prisma.accountProductSubscription.update;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma.accountProductSubscription as any).findUnique = async () => currentSlot;
    (prisma.accountProductSubscription as any).update = async (args: any) => {
      currentSlot = { ...currentSlot, ...args.data };
      return currentSlot;
    };
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: userId }];

    try {
      // Delayed webhook arrival for sub_A
      const result = await AccountProductSubscriptionService.expireProductSlot({
        userId,
        productType: ProductType.STORAGE,
        subscriptionId: staleSubId
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.modified, false);
      assert.strictEqual(result.reason, 'STALE_EVENT_IGNORED');
      assert.strictEqual(result.slot?.subscriptionId, currentSubId);
      assert.strictEqual(currentSlot.status, BillingStatus.ACTIVE);
      assert.strictEqual(currentSlot.subscriptionId, currentSubId);
    } finally {
      prisma.accountProductSubscription.findUnique = origFindUnique;
      prisma.accountProductSubscription.update = origUpdate;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  test('TC-MPL-U3: Stale cancellation event for superseded sub_A does not cancel active sub_B', async () => {
    const userId = 'user_stale_cancel_test';
    const currentSubId = 'sub_B_active';
    const staleSubId = 'sub_A_superseded';

    let currentSlot: AccountProductSubscription = createMockSlot({
      id: 'slot_storage_2',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: currentSubId,
      status: BillingStatus.ACTIVE
    });

    const origFindUnique = prisma.accountProductSubscription.findUnique;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma.accountProductSubscription as any).findUnique = async (args: any) => {
      if (args?.where?.subscriptionId) {
        return args.where.subscriptionId === currentSlot.subscriptionId ? currentSlot : null;
      }
      if (args?.where?.userId_productType) {
        return currentSlot;
      }
      return currentSlot;
    };
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: userId }];

    try {
      const result = await AccountProductSubscriptionService.updateSlotStatus({
        subscriptionId: staleSubId,
        status: BillingStatus.CANCELLING,
        userId,
        productType: ProductType.STORAGE
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.modified, false);
      assert.strictEqual(result.reason, 'SUBSCRIPTION_MISMATCH');
      assert.strictEqual(currentSlot.status, BillingStatus.ACTIVE);
      assert.strictEqual(currentSlot.subscriptionId, currentSubId);
    } finally {
      prisma.accountProductSubscription.findUnique = origFindUnique;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  test('TC-MPL-U4: Stale payment failure for superseded sub_A does not mark active sub_B PAST_DUE', async () => {
    const userId = 'user_stale_fail_test';
    const currentSubId = 'sub_B_active';
    const staleSubId = 'sub_A_superseded';

    let currentSlot: AccountProductSubscription = createMockSlot({
      id: 'slot_storage_3',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: currentSubId,
      status: BillingStatus.ACTIVE
    });

    const origFindUnique = prisma.accountProductSubscription.findUnique;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma.accountProductSubscription as any).findUnique = async (args: any) => {
      if (args?.where?.subscriptionId) {
        return args.where.subscriptionId === currentSlot.subscriptionId ? currentSlot : null;
      }
      if (args?.where?.userId_productType) {
        return currentSlot;
      }
      return currentSlot;
    };
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: userId }];

    try {
      const result = await AccountProductSubscriptionService.updateSlotStatus({
        subscriptionId: staleSubId,
        status: BillingStatus.PAST_DUE,
        userId,
        productType: ProductType.STORAGE
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.modified, false);
      assert.strictEqual(result.reason, 'SUBSCRIPTION_MISMATCH');
      assert.strictEqual(currentSlot.status, BillingStatus.ACTIVE);
    } finally {
      prisma.accountProductSubscription.findUnique = origFindUnique;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  // ===========================================================================
  // SECTION 3: OUT-OF-ORDER EVENTS FOR THE SAME SUBSCRIPTION (TASK B)
  // ===========================================================================

  test('TC-MPL-U5: Delayed payment-failure event cannot downgrade newer successful renewal for same subscription', async () => {
    const userId = 'user_order_same_sub';
    const subId = 'sub_same_123';

    // Subscription was renewed at T2 (updatedAt: 12:00:00)
    const renewalTime = new Date('2026-11-05T12:00:00Z');
    const delayedEventTime = new Date('2026-11-05T11:50:00Z'); // Created at T1 (10 minutes earlier)

    const currentSlot: AccountProductSubscription = createMockSlot({
      id: 'slot_storage_order',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: subId,
      status: BillingStatus.ACTIVE,
      updatedAt: renewalTime
    });

    const plan = createMockPlan({ id: 'plan_storage', code: 'PRO_MONTHLY', productType: ProductType.STORAGE });
    const subRecord = createMockSubscription({
      id: subId,
      userId,
      plan,
      status: BillingStatus.ACTIVE,
      updatedAt: renewalTime
    });

    const origSlotFindUnique = prisma.accountProductSubscription.findUnique;
    const origSubFindUnique = prisma.subscription.findUnique;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma.accountProductSubscription as any).findUnique = async () => currentSlot;
    (prisma.subscription as any).findUnique = async () => subRecord;
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: userId }];

    try {
      // Delayed payment failure arriving at T3 with creation time T1
      const result = await AccountProductSubscriptionService.updateSlotStatus({
        subscriptionId: subId,
        status: BillingStatus.PAST_DUE,
        userId,
        productType: ProductType.STORAGE,
        eventCreatedAt: delayedEventTime
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.modified, false);
      assert.strictEqual(result.reason, 'STALE_EVENT_IGNORED');
      assert.strictEqual(currentSlot.status, BillingStatus.ACTIVE);
    } finally {
      prisma.accountProductSubscription.findUnique = origSlotFindUnique;
      prisma.subscription.findUnique = origSubFindUnique;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  test('TC-MPL-U6: Older billing-period event cannot overwrite newer billing-period state', async () => {
    const userId = 'user_order_period';
    const subId = 'sub_period_123';

    // Current period runs until Dec 5, 2026
    const currentPeriodEnd = new Date('2026-12-05T00:00:00Z');
    // Event belongs to previous period ending Nov 5, 2026
    const oldPeriodEnd = new Date('2026-11-05T00:00:00Z');

    const currentSlot: AccountProductSubscription = createMockSlot({
      id: 'slot_storage_period',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: subId,
      status: BillingStatus.ACTIVE
    });

    const plan = createMockPlan({ id: 'plan_storage', code: 'PRO_MONTHLY', productType: ProductType.STORAGE });
    const subRecord = createMockSubscription({
      id: subId,
      userId,
      plan,
      status: BillingStatus.ACTIVE,
      currentPeriodEnd
    });

    const origSlotFindUnique = prisma.accountProductSubscription.findUnique;
    const origSubFindUnique = prisma.subscription.findUnique;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma.accountProductSubscription as any).findUnique = async () => currentSlot;
    (prisma.subscription as any).findUnique = async () => subRecord;
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: userId }];

    try {
      // Delayed failure webhook from old billing period
      const result = await AccountProductSubscriptionService.updateSlotStatus({
        subscriptionId: subId,
        status: BillingStatus.PAST_DUE,
        userId,
        productType: ProductType.STORAGE,
        eventPeriodEnd: oldPeriodEnd
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.modified, false);
      assert.strictEqual(result.reason, 'SUPERSEDED_BY_NEWER_PERIOD');
      assert.strictEqual(currentSlot.status, BillingStatus.ACTIVE);
    } finally {
      prisma.accountProductSubscription.findUnique = origSlotFindUnique;
      prisma.subscription.findUnique = origSubFindUnique;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  test('TC-MPL-U7: Duplicate webhook event delivery is idempotent (NO_OP)', async () => {
    const userId = 'user_idempotent_test';
    const currentSubId = 'sub_active_dup';

    const currentSlot: AccountProductSubscription = createMockSlot({
      id: 'slot_storage_dup',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: currentSubId,
      status: BillingStatus.ACTIVE
    });

    const origFindUnique = prisma.accountProductSubscription.findUnique;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma.accountProductSubscription as any).findUnique = async () => currentSlot;
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: userId }];

    try {
      const result = await AccountProductSubscriptionService.updateSlotStatus({
        subscriptionId: currentSubId,
        status: BillingStatus.ACTIVE,
        userId,
        productType: ProductType.STORAGE
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.modified, false);
      assert.strictEqual(result.reason, 'NO_OP');
      assert.strictEqual(result.slot?.status, BillingStatus.ACTIVE);
    } finally {
      prisma.accountProductSubscription.findUnique = origFindUnique;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  // ===========================================================================
  // SECTION 4: CONCURRENT SLOT MUTATION & TRANSACTION LOCKING (TASK C)
  // ===========================================================================

  test('TC-MPL-U8: Concurrent subscription replacements cannot overwrite each other (ConflictError)', async () => {
    const userId = 'user_conflict_test';

    const currentSlot: AccountProductSubscription = createMockSlot({
      id: 'slot_storage_replace_conflict',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: 'sub_already_replaced',
      status: BillingStatus.ACTIVE
    });

    const origFindUnique = prisma.accountProductSubscription.findUnique;
    const origSubFindUnique = prisma.subscription.findUnique;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma.accountProductSubscription as any).findUnique = async () => currentSlot;
    (prisma.subscription as any).findUnique = async () => ({
      id: 'sub_new_candidate',
      userId,
      status: BillingStatus.ACTIVE,
      plan: { productType: ProductType.STORAGE }
    });
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: userId }];

    try {
      await assert.rejects(
        async () => {
          await AccountProductSubscriptionService.replaceProductSlotSubscription({
            userId,
            productType: ProductType.STORAGE,
            newSubscriptionId: 'sub_new_candidate',
            expectedCurrentSubscriptionId: 'sub_original_stale'
          });
        },
        (err: any) => {
          assert.ok(err instanceof ConflictError);
          assert.match(err.message, /Concurrent replacement conflict/);
          return true;
        }
      );
    } finally {
      prisma.accountProductSubscription.findUnique = origFindUnique;
      prisma.subscription.findUnique = origSubFindUnique;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  test('TC-MPL-U9: Concurrent expiration and replacement cannot expire the replacement', async () => {
    const userId = 'user_race_exp_rep';
    const oldSubId = 'sub_old_racing';
    const newSubId = 'sub_new_winner';

    // Replacement committed first: slot points to newSubId
    let currentSlot: AccountProductSubscription = createMockSlot({
      id: 'slot_racing_1',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: newSubId,
      status: BillingStatus.ACTIVE
    });

    const origFindUnique = prisma.accountProductSubscription.findUnique;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma.accountProductSubscription as any).findUnique = async () => currentSlot;
    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: userId }];

    try {
      // Concurrent expiration attempt for oldSubId arrives
      const result = await AccountProductSubscriptionService.expireProductSlot({
        userId,
        productType: ProductType.STORAGE,
        subscriptionId: oldSubId
      });

      // Replacement remains active and protected!
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.modified, false);
      assert.strictEqual(result.reason, 'STALE_EVENT_IGNORED');
      assert.strictEqual(currentSlot.subscriptionId, newSubId);
      assert.strictEqual(currentSlot.status, BillingStatus.ACTIVE);
    } finally {
      prisma.accountProductSubscription.findUnique = origFindUnique;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  test('TC-MPL-U10: Correct Prisma query operation ($queryRawUnsafe) is used for row locking', async () => {
    const userId = 'user_locking_verify';
    const queriesExecuted: string[] = [];

    const origQueryRawUnsafe = prisma.$queryRawUnsafe;
    const origTransaction = prisma.$transaction;
    const origFindUnique = prisma.accountProductSubscription.findUnique;

    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async (sql: string, ...params: any[]) => {
      queriesExecuted.push(sql);
      return [{ id: userId }];
    };
    (prisma.accountProductSubscription as any).findUnique = async () => createMockSlot({
      id: 'slot_lock',
      userId,
      productType: ProductType.STORAGE,
      subscriptionId: 'sub_lock_test'
    });

    try {
      await AccountProductSubscriptionService.expireProductSlot({
        userId,
        productType: ProductType.STORAGE,
        subscriptionId: 'sub_lock_test'
      });

      // Verify that $queryRawUnsafe executed the SELECT ... FOR UPDATE
      assert.ok(queriesExecuted.length > 0);
      assert.ok(queriesExecuted.some((q) => q.includes('SELECT id FROM `User` WHERE id = ? FOR UPDATE')));
    } finally {
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
      prisma.$transaction = origTransaction;
      prisma.accountProductSubscription.findUnique = origFindUnique;
    }
  });

  // ===========================================================================
  // SECTION 5: ERROR CLASSIFICATION & OUTAGE PROTECTION (TASK D)
  // ===========================================================================

  test('TC-MPL-U11: Database outage cannot resolve a paid user as Free (throws DatabaseError)', async () => {
    const origGetSlots = AccountProductSubscriptionService.getProductSlots;

    AccountProductSubscriptionService.getProductSlots = async () => {
      const connErr: any = new Error('connect ECONNREFUSED 127.0.0.1:3306');
      connErr.code = 'P1001';
      throw new DatabaseError(
        `Database connection unavailable while retrieving product slots for user 'user_conn_err'`
      );
    };

    try {
      await assert.rejects(
        async () => {
          await EntitlementService.resolveUserEntitlements('user_conn_err');
        },
        (err: any) => {
          assert.ok(err instanceof DatabaseError);
          assert.match(err.message, /Database connection unavailable/);
          return true;
        }
      );
    } finally {
      AccountProductSubscriptionService.getProductSlots = origGetSlots;
    }
  });

  test('TC-MPL-U12: Missing migration structures produce an explicit DeploymentMigrationPendingError', async () => {
    const origGetSlots = AccountProductSubscriptionService.getProductSlots;
    const origGetActiveSub = BillingStateService.getActiveSubscription;

    AccountProductSubscriptionService.getProductSlots = async () => [];
    BillingStateService.getActiveSubscription = async () => {
      const schemaErr: any = new Error("Unknown column 'plan.productType' in 'field list'");
      schemaErr.code = 'ER_BAD_FIELD_ERROR';
      throw schemaErr;
    };

    try {
      await assert.rejects(
        async () => {
          await EntitlementService.resolveUserEntitlements('user_drift_test');
        },
        (err: any) => {
          assert.ok(err instanceof DeploymentMigrationPendingError);
          assert.match(err.message, /Database migration pending/);
          return true;
        }
      );
    } finally {
      AccountProductSubscriptionService.getProductSlots = origGetSlots;
      BillingStateService.getActiveSubscription = origGetActiveSub;
    }
  });

  test('TC-MPL-U13: Unknown errors propagate and are never converted into Free entitlements', async () => {
    const origGetSlots = AccountProductSubscriptionService.getProductSlots;
    const origGetActiveSub = BillingStateService.getActiveSubscription;

    AccountProductSubscriptionService.getProductSlots = async () => [];
    BillingStateService.getActiveSubscription = async () => {
      throw new Error('Fatal unexpected application crash in billing query');
    };

    try {
      await assert.rejects(
        async () => {
          await EntitlementService.resolveUserEntitlements('user_unknown_err');
        },
        (err: any) => {
          assert.strictEqual(err.message, 'Fatal unexpected application crash in billing query');
          return true;
        }
      );
    } finally {
      AccountProductSubscriptionService.getProductSlots = origGetSlots;
      BillingStateService.getActiveSubscription = origGetActiveSub;
    }
  });

  test('TC-MPL-U14: classifyPrismaError precisely separates structured codes, unique constraints, and conflicts', () => {
    // 1. Connectivity failures
    assert.strictEqual(classifyPrismaError({ code: 'P1000' }), 'CONNECTION_FAILURE');
    assert.strictEqual(classifyPrismaError({ code: 'P1001' }), 'CONNECTION_FAILURE');
    assert.strictEqual(classifyPrismaError({ code: 'P1002' }), 'CONNECTION_FAILURE');
    assert.strictEqual(classifyPrismaError({ code: 'P1017' }), 'CONNECTION_FAILURE');
    assert.strictEqual(classifyPrismaError({ code: 'ECONNREFUSED' }), 'CONNECTION_FAILURE');
    assert.strictEqual(classifyPrismaError({ message: 'connection timed out' }), 'CONNECTION_FAILURE');

    // 2. Missing migration structures
    assert.strictEqual(classifyPrismaError({ code: 'P2021' }), 'MIGRATION_PENDING');
    assert.strictEqual(classifyPrismaError({ code: 'P2022' }), 'MIGRATION_PENDING');
    assert.strictEqual(classifyPrismaError({ code: 'ER_NO_SUCH_TABLE' }), 'MIGRATION_PENDING');
    assert.strictEqual(classifyPrismaError({ code: 'ER_BAD_FIELD_ERROR' }), 'MIGRATION_PENDING');
    assert.strictEqual(
      classifyPrismaError({ message: "Table 'zdex.AccountProductSubscription' doesn't exist" }),
      'MIGRATION_PENDING'
    );
    assert.strictEqual(
      classifyPrismaError({ message: "Unknown column 'Plan.productType' in 'field list'" }),
      'MIGRATION_PENDING'
    );

    // 3. Unique constraint violations (P2002) - MUST NOT be MIGRATION_PENDING
    assert.strictEqual(classifyPrismaError({ code: 'P2002' }), 'UNIQUE_CONSTRAINT');

    // 4. Deadlock / Transaction Conflicts
    assert.strictEqual(classifyPrismaError({ code: 'P2034' }), 'TRANSACTION_CONFLICT');
    assert.strictEqual(classifyPrismaError({ code: 'ER_LOCK_DEADLOCK' }), 'TRANSACTION_CONFLICT');

    // 5. Unknown other errors
    assert.strictEqual(classifyPrismaError(new Error('Random syntax error')), 'OTHER');
    assert.strictEqual(classifyPrismaError(null), 'OTHER');
  });

  // ===========================================================================
  // SECTION 6: PRODUCT & SUBSCRIPTION OWNERSHIP INVARIANTS (TASK E)
  // ===========================================================================

  test('TC-MPL-U15: Product ownership and classification mismatches are strictly rejected', async () => {
    const origSubFindUnique = prisma.subscription.findUnique;
    const origTransaction = prisma.$transaction;
    const origQueryRawUnsafe = prisma.$queryRawUnsafe;

    (prisma as any).$transaction = async (fn: any) => fn(prisma);
    (prisma as any).$queryRawUnsafe = async () => [{ id: 'mock_user' }];

    try {
      // 1. STORAGE plan into CAMERA slot -> ValidationError
      (prisma.subscription as any).findUnique = async () => ({
        id: 'sub_storage_1',
        userId: 'user_mismatch_1',
        status: BillingStatus.ACTIVE,
        plan: { code: 'PRO_MONTHLY', productType: ProductType.STORAGE }
      });

      await assert.rejects(
        async () => {
          await AccountProductSubscriptionService.upsertProductSlot({
            userId: 'user_mismatch_1',
            productType: ProductType.CAMERA,
            subscriptionId: 'sub_storage_1'
          });
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.message, /cannot be slotted into CAMERA/);
          return true;
        }
      );

      // 2. CAMERA plan into STORAGE slot -> ValidationError
      (prisma.subscription as any).findUnique = async () => ({
        id: 'sub_camera_1',
        userId: 'user_mismatch_2',
        status: BillingStatus.ACTIVE,
        plan: { code: 'CAM_MONTHLY', productType: ProductType.CAMERA }
      });

      await assert.rejects(
        async () => {
          await AccountProductSubscriptionService.upsertProductSlot({
            userId: 'user_mismatch_2',
            productType: ProductType.STORAGE,
            subscriptionId: 'sub_camera_1'
          });
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.message, /cannot be slotted into STORAGE/);
          return true;
        }
      );

      // 3. Subscription belonging to user_A cannot be assigned to user_B -> ConflictError
      (prisma.subscription as any).findUnique = async () => ({
        id: 'sub_owner_mismatch',
        userId: 'user_actual_owner',
        status: BillingStatus.ACTIVE,
        plan: { code: 'PRO_MONTHLY', productType: ProductType.STORAGE }
      });

      await assert.rejects(
        async () => {
          await AccountProductSubscriptionService.upsertProductSlot({
            userId: 'user_attacker',
            productType: ProductType.STORAGE,
            subscriptionId: 'sub_owner_mismatch'
          });
        },
        (err: any) => {
          assert.ok(err instanceof ConflictError);
          assert.match(err.message, /does not belong to user/);
          return true;
        }
      );
    } finally {
      prisma.subscription.findUnique = origSubFindUnique;
      prisma.$transaction = origTransaction;
      prisma.$queryRawUnsafe = origQueryRawUnsafe;
    }
  });

  test('TC-MPL-U16: Unified Pro entitlement aggregation and legacy Storage compatibility remain intact', async () => {
    // 1. Verified Free user
    const origGetSlots = AccountProductSubscriptionService.getProductSlots;
    const origGetActiveSub = BillingStateService.getActiveSubscription;
    const origUserFindUnique = prisma.user.findUnique;

    AccountProductSubscriptionService.getProductSlots = async () => [];
    BillingStateService.getActiveSubscription = async () => null;
    (prisma.user as any).findUnique = async () => ({ id: 'verified_user' });

    try {
      const free = await EntitlementService.resolveUserEntitlements('verified_user');
      assert.strictEqual(free.planCode, 'FREE');
      assert.strictEqual(free.maxServers, 1);
      assert.strictEqual(free.priorityRelay, false);
      assert.strictEqual(free.camera.maxCameras, 0);
      assert.strictEqual(free.camera.liveStreamingEnabled, false);
      assert.strictEqual(free.isMultiProduct, false);
    } finally {
      AccountProductSubscriptionService.getProductSlots = origGetSlots;
      BillingStateService.getActiveSubscription = origGetActiveSub;
      prisma.user.findUnique = origUserFindUnique;
    }

    // 2. Legacy Storage fallback retains 5 servers for Pro user
    const mockLegacySub = {
      id: 'sub_legacy_pro',
      status: BillingStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      plan: {
        id: 'plan_pro',
        code: 'PRO_MONTHLY',
        productType: ProductType.STORAGE,
        serverLimit: 5,
        priorityRelay: true
      }
    };

    AccountProductSubscriptionService.getProductSlots = async () => [];
    BillingStateService.getActiveSubscription = async () => mockLegacySub as any;

    try {
      const legacyRes = await EntitlementService.resolveUserEntitlements('legacy_pro_user');
      assert.strictEqual(legacyRes.planCode, 'PRO_MONTHLY');
      assert.strictEqual(legacyRes.maxServers, 5);
      assert.strictEqual(legacyRes.priorityRelay, true);
      assert.strictEqual(legacyRes.storage.source, 'LEGACY_BILLING_STATE');
      assert.strictEqual(legacyRes.camera.maxCameras, 0); // Zero Camera leakage
    } finally {
      AccountProductSubscriptionService.getProductSlots = origGetSlots;
      BillingStateService.getActiveSubscription = origGetActiveSub;
    }
  });
});
