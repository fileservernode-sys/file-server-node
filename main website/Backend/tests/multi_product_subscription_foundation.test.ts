import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { PlanService, APPROVED_INITIAL_CATALOG } from '../src/services/billing/plan_service.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { ProductType, BillingStatus, BillingInterval, CurrencyCode } from '@prisma/client';

describe('Phase 19.3 Batch 1: Multi-Product Subscription Database Foundation Test Suite', () => {
  let app: FastifyInstance;
  let isMigrationDeployed = false;
  const timestamp = Date.now();
  const testUserEmailA = `multiproduct.user.a.${timestamp}@zdexcloud.com`;
  const testUserEmailB = `multiproduct.user.b.${timestamp}@zdexcloud.com`;

  let userAId = '';
  let userBId = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Determine if migration 20261105120000 has been applied to connected database
    try {
      const checkResult: any = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Plan' AND COLUMN_NAME = 'productType'`
      );
      const count = Number(checkResult[0]?.cnt || checkResult[0]?.CNT || 0);
      isMigrationDeployed = count > 0;
    } catch {
      isMigrationDeployed = false;
    }

    if (isMigrationDeployed) {
      // Ensure catalog is seeded in database
      await PlanService.seedInitialCatalog();

      // Create test user A
      const userA = await prisma.user.create({
        data: {
          email: testUserEmailA,
          passwordHash: 'test-hash-a',
          status: 'ACTIVE',
          emailVerified: true
        }
      });
      userAId = userA.id;

      // Create test user B
      const userB = await prisma.user.create({
        data: {
          email: testUserEmailB,
          passwordHash: 'test-hash-b',
          status: 'ACTIVE',
          emailVerified: true
        }
      });
      userBId = userB.id;
    }
  });

  after(async () => {
    if (isMigrationDeployed) {
      if (userAId) {
        await prisma.user.delete({ where: { id: userAId } }).catch(() => {});
      }
      if (userBId) {
        await prisma.user.delete({ where: { id: userBId } }).catch(() => {});
      }
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // STATIC & SCHEMA FOUNDATION VALIDATIONS (Always Execute)
  // ---------------------------------------------------------------------------

  test('TC-MPD-S1: ProductType enum is exported and contains STORAGE, CAMERA, UNIFIED_PRO', () => {
    assert.strictEqual(ProductType.STORAGE, 'STORAGE');
    assert.strictEqual(ProductType.CAMERA, 'CAMERA');
    assert.strictEqual(ProductType.UNIFIED_PRO, 'UNIFIED_PRO');
    assert.strictEqual(Object.keys(ProductType).length, 3);
  });

  test('TC-MPD-S2: schema.prisma defines ProductType, Plan.productType, and AccountProductSubscription model', () => {
    const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
    assert.ok(fs.existsSync(schemaPath), 'schema.prisma must exist');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    // Verify ProductType enum definition
    assert.ok(schemaContent.includes('enum ProductType {'), 'Enum ProductType must be in schema');
    assert.ok(schemaContent.includes('STORAGE'), 'STORAGE must be enum value');
    assert.ok(schemaContent.includes('CAMERA'), 'CAMERA must be enum value');
    assert.ok(schemaContent.includes('UNIFIED_PRO'), 'UNIFIED_PRO must be enum value');

    // Verify Plan model additions
    assert.ok(/productType\s+ProductType\s+@default\(STORAGE\)/.test(schemaContent), 'Plan.productType must default to STORAGE');
    assert.ok(schemaContent.includes('@@index([productType])'), 'Plan must index productType');

    // Verify AccountProductSubscription model
    assert.ok(schemaContent.includes('model AccountProductSubscription {'), 'AccountProductSubscription model must exist');
    assert.ok(schemaContent.includes('@@unique([userId, productType]'), 'Must have composite unique on [userId, productType]');
    assert.ok(/subscriptionId\s+String\s+@unique/.test(schemaContent), 'subscriptionId must be @unique');
    assert.ok(schemaContent.includes('onDelete: Cascade'), 'Must specify cascade delete');

    // Verify User and Subscription relations
    assert.ok(/productSubscriptions\s+AccountProductSubscription\[\]/.test(schemaContent), 'User must have productSubscriptions relation');
    assert.ok(/productSlot\s+AccountProductSubscription\?/.test(schemaContent), 'Subscription must have productSlot relation');
  });

  test('TC-MPD-S3: Migration SQL file exists, is syntactically sound, non-destructive, and includes safe backfill', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../prisma/migrations/20261105120000_add_multi_product_subscription_foundation/migration.sql'
    );
    assert.ok(fs.existsSync(migrationPath), 'Migration SQL file must exist at exact expected path');
    const sqlContent = fs.readFileSync(migrationPath, 'utf8');

    // Verify non-destructive ALTER TABLE
    assert.ok(sqlContent.includes('ALTER TABLE `Plan`'), 'Must alter Plan table');
    assert.ok(sqlContent.includes("ADD COLUMN `productType` ENUM('STORAGE', 'CAMERA', 'UNIFIED_PRO') NOT NULL DEFAULT 'STORAGE'"), 'Must add productType column');
    assert.ok(sqlContent.includes('CREATE INDEX `Plan_productType_idx` ON `Plan`(`productType`)'), 'Must create index on Plan');

    // Verify AccountProductSubscription DDL
    assert.ok(sqlContent.includes('CREATE TABLE `AccountProductSubscription`'), 'Must create AccountProductSubscription table');
    assert.ok(sqlContent.includes('UNIQUE INDEX `account_product_sub_subscription_uniq`(`subscriptionId`)'), 'Must have subscriptionId unique index');
    assert.ok(sqlContent.includes('UNIQUE INDEX `account_product_sub_user_product_uniq`(`userId`, `productType`)'), 'Must have composite unique index');

    // Verify Foreign keys with CASCADE
    assert.ok(sqlContent.includes('FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE'), 'User FK must cascade');
    assert.ok(sqlContent.includes('FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE CASCADE'), 'Subscription FK must cascade');

    // Verify idempotent backfill from AccountBillingState
    assert.ok(sqlContent.includes('INSERT IGNORE INTO `AccountProductSubscription`'), 'Must use INSERT IGNORE for idempotent backfill');
    assert.ok(sqlContent.includes("'STORAGE'"), "Backfill must default existing subscriptions to 'STORAGE'");
    assert.ok(sqlContent.includes('FROM `AccountBillingState`'), 'Backfill source must be AccountBillingState');
  });

  test('TC-MPD-S4: APPROVED_INITIAL_CATALOG retains original plan codes and invariants', () => {
    const planCodes = APPROVED_INITIAL_CATALOG.map(p => p.code);
    assert.ok(planCodes.includes('FREE'), 'FREE must be in initial catalog');
    assert.ok(planCodes.includes('PRO_MONTHLY'), 'PRO_MONTHLY must be in initial catalog');
    assert.ok(planCodes.includes('PRO_YEARLY'), 'PRO_YEARLY must be in initial catalog');

    const freePlan = APPROVED_INITIAL_CATALOG.find(p => p.code === 'FREE');
    assert.strictEqual(freePlan?.serverLimit, 1);
    assert.strictEqual(freePlan?.priorityRelay, false);

    const proMonthly = APPROVED_INITIAL_CATALOG.find(p => p.code === 'PRO_MONTHLY');
    assert.strictEqual(proMonthly?.serverLimit, 5);
    assert.strictEqual(proMonthly?.priorityRelay, true);
    assert.strictEqual(proMonthly?.interval, BillingInterval.MONTHLY);

    const proYearly = APPROVED_INITIAL_CATALOG.find(p => p.code === 'PRO_YEARLY');
    assert.strictEqual(proYearly?.serverLimit, 5);
    assert.strictEqual(proYearly?.priorityRelay, true);
    assert.strictEqual(proYearly?.interval, BillingInterval.YEARLY);
  });

  // ---------------------------------------------------------------------------
  // INTEGRATION TEST CASES (Execute when migration is deployed)
  // ---------------------------------------------------------------------------

  test('TC-MPD-1: Existing catalog plans must retain original codes and be classified as STORAGE by default', async (t) => {
    if (!isMigrationDeployed) {
      t.skip('Pending operational migration deployment (npx prisma migrate deploy). Remote database unmutated per Phase 19.3 safety directive.');
      return;
    }

    const plans = await PlanService.getActivePlans();
    
    // 1. Verify standard plan codes exist unchanged
    const planCodes = plans.map(p => p.code);
    assert.ok(planCodes.includes('FREE'), 'Plan FREE must exist');
    assert.ok(planCodes.includes('PRO_MONTHLY'), 'Plan PRO_MONTHLY must exist');
    assert.ok(planCodes.includes('PRO_YEARLY'), 'Plan PRO_YEARLY must exist');

    // 2. Verify all existing plans have productType = STORAGE
    for (const plan of plans) {
      assert.strictEqual(
        plan.productType, 
        ProductType.STORAGE, 
        `Plan ${plan.code} must have productType STORAGE by default`
      );
    }

    // 3. Verify specific plan parameters remain unchanged
    const proMonthly = await PlanService.getPlanByCode('PRO_MONTHLY');
    assert.ok(proMonthly, 'PRO_MONTHLY plan must be retrievable');
    assert.strictEqual(proMonthly.interval, BillingInterval.MONTHLY);
    assert.strictEqual(proMonthly.serverLimit, 5);
    assert.strictEqual(proMonthly.productType, ProductType.STORAGE);

    const proYearly = await PlanService.getPlanByCode('PRO_YEARLY');
    assert.ok(proYearly, 'PRO_YEARLY plan must be retrievable');
    assert.strictEqual(proYearly.interval, BillingInterval.YEARLY);
    assert.strictEqual(proYearly.serverLimit, 5);
    assert.strictEqual(proYearly.productType, ProductType.STORAGE);
  });

  test('TC-MPD-2: Multiple product subscriptions can coexist concurrently for a single user', async (t) => {
    if (!isMigrationDeployed) {
      t.skip('Pending operational migration deployment (npx prisma migrate deploy). Remote database unmutated per Phase 19.3 safety directive.');
      return;
    }

    const proMonthlyPlan = await prisma.plan.findUniqueOrThrow({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    const inrPrice = proMonthlyPlan.prices.find(p => p.currency === CurrencyCode.INR) || proMonthlyPlan.prices[0];

    // 1. Create a Storage Subscription for User A
    const storageSub = await prisma.subscription.create({
      data: {
        userId: userAId,
        planId: proMonthlyPlan.id,
        planPriceId: inrPrice.id,
        providerSubscriptionId: `sub_storage_${timestamp}`,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: inrPrice.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    const storageSlot = await prisma.accountProductSubscription.create({
      data: {
        userId: userAId,
        productType: ProductType.STORAGE,
        subscriptionId: storageSub.id,
        status: BillingStatus.ACTIVE
      }
    });

    // 2. Create a Camera Subscription for User A
    const cameraSub = await prisma.subscription.create({
      data: {
        userId: userAId,
        planId: proMonthlyPlan.id,
        planPriceId: inrPrice.id,
        providerSubscriptionId: `sub_camera_${timestamp}`,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: inrPrice.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    const cameraSlot = await prisma.accountProductSubscription.create({
      data: {
        userId: userAId,
        productType: ProductType.CAMERA,
        subscriptionId: cameraSub.id,
        status: BillingStatus.ACTIVE
      }
    });

    // 3. Query all active product subscriptions for User A
    const userSlots = await prisma.accountProductSubscription.findMany({
      where: { userId: userAId },
      include: {
        subscription: {
          include: { plan: true }
        }
      }
    });

    assert.strictEqual(userSlots.length, 2, 'User A must hold exactly 2 concurrent product slots');
    const slotProducts = userSlots.map(s => s.productType);
    assert.ok(slotProducts.includes(ProductType.STORAGE), 'User A must have STORAGE slot');
    assert.ok(slotProducts.includes(ProductType.CAMERA), 'User A must have CAMERA slot');
  });

  test('TC-MPD-3: Enforces uniqueness per [userId, productType] — prevents duplicate active subscriptions for same product', async (t) => {
    if (!isMigrationDeployed) {
      t.skip('Pending operational migration deployment (npx prisma migrate deploy). Remote database unmutated per Phase 19.3 safety directive.');
      return;
    }

    const proMonthlyPlan = await prisma.plan.findUniqueOrThrow({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    const price = proMonthlyPlan.prices[0];

    // Attempt to create a second STORAGE slot for User A
    const duplicateStorageSub = await prisma.subscription.create({
      data: {
        userId: userAId,
        planId: proMonthlyPlan.id,
        planPriceId: price.id,
        providerSubscriptionId: `sub_dup_storage_${timestamp}`,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: price.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    await assert.rejects(
      async () => {
        await prisma.accountProductSubscription.create({
          data: {
            userId: userAId,
            productType: ProductType.STORAGE,
            subscriptionId: duplicateStorageSub.id,
            status: BillingStatus.ACTIVE
          }
        });
      },
      (err: any) => {
        return err.code === 'P2002'; // Prisma unique constraint violation code
      },
      'Should reject duplicate slot for same [userId, productType]'
    );
  });

  test('TC-MPD-4: Enforces uniqueness per subscriptionId — single subscription cannot occupy two product slots', async (t) => {
    if (!isMigrationDeployed) {
      t.skip('Pending operational migration deployment (npx prisma migrate deploy). Remote database unmutated per Phase 19.3 safety directive.');
      return;
    }

    const proMonthlyPlan = await prisma.plan.findUniqueOrThrow({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    const price = proMonthlyPlan.prices[0];

    const multiSlotSub = await prisma.subscription.create({
      data: {
        userId: userAId,
        planId: proMonthlyPlan.id,
        planPriceId: price.id,
        providerSubscriptionId: `sub_multislot_${timestamp}`,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: price.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Create slot for UNIFIED_PRO
    await prisma.accountProductSubscription.create({
      data: {
        userId: userAId,
        productType: ProductType.UNIFIED_PRO,
        subscriptionId: multiSlotSub.id,
        status: BillingStatus.ACTIVE
      }
    });

    // Attempt to reuse same subscriptionId in another user's or slot
    await assert.rejects(
      async () => {
        await prisma.accountProductSubscription.create({
          data: {
            userId: userBId,
            productType: ProductType.STORAGE,
            subscriptionId: multiSlotSub.id,
            status: BillingStatus.ACTIVE
          }
        });
      },
      (err: any) => {
        return err.code === 'P2002';
      },
      'Should reject duplicate subscriptionId across product slots'
    );
  });

  test('TC-MPD-5: Backward compatibility — legacy AccountBillingState.activeSubscriptionId continues to work seamlessly', async (t) => {
    if (!isMigrationDeployed) {
      t.skip('Pending operational migration deployment (npx prisma migrate deploy). Remote database unmutated per Phase 19.3 safety directive.');
      return;
    }

    // Initialize billing state for User B via existing BillingStateService
    const billingState = await BillingStateService.getBillingState(userBId);
    assert.strictEqual(billingState.status, BillingStatus.FREE);
    assert.strictEqual(billingState.activeSubscriptionId, null);

    // Create a subscription for User B and link via legacy AccountBillingState
    const proMonthlyPlan = await prisma.plan.findUniqueOrThrow({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    const inrPrice = proMonthlyPlan.prices.find(p => p.currency === CurrencyCode.INR) || proMonthlyPlan.prices[0];

    const subB = await prisma.subscription.create({
      data: {
        userId: userBId,
        planId: proMonthlyPlan.id,
        planPriceId: inrPrice.id,
        providerSubscriptionId: `sub_legacy_user_b_${timestamp}`,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: inrPrice.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    // Update AccountBillingState using existing database model
    const updatedBillingState = await prisma.accountBillingState.update({
      where: { userId: userBId },
      data: {
        status: BillingStatus.ACTIVE,
        activeSubscriptionId: subB.id
      }
    });

    assert.strictEqual(updatedBillingState.status, BillingStatus.ACTIVE);
    assert.strictEqual(updatedBillingState.activeSubscriptionId, subB.id);

    // Verify existing getActiveSubscription and getEffectivePlan still resolve activeSubscription perfectly
    const activeSub = await BillingStateService.getActiveSubscription(userBId);
    assert.strictEqual(activeSub?.id, subB.id);
    assert.strictEqual(activeSub?.plan.code, 'PRO_MONTHLY');

    const effective = await BillingStateService.getEffectivePlan(userBId);
    assert.strictEqual(effective.status, BillingStatus.ACTIVE);
    assert.strictEqual(effective.planCode, 'PRO_MONTHLY');
    assert.strictEqual(effective.subscription?.id, subB.id);
  });

  test('TC-MPD-6: Foreign key cascade deletion — deleting User cascades to AccountProductSubscription', async (t) => {
    if (!isMigrationDeployed) {
      t.skip('Pending operational migration deployment (npx prisma migrate deploy). Remote database unmutated per Phase 19.3 safety directive.');
      return;
    }

    // Create temporary user C
    const userC = await prisma.user.create({
      data: {
        email: `multiproduct.user.c.${timestamp}@zdexcloud.com`,
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    const proMonthlyPlan = await prisma.plan.findUniqueOrThrow({
      where: { code: 'PRO_MONTHLY' },
      include: { prices: true }
    });
    const price = proMonthlyPlan.prices[0];

    const subC = await prisma.subscription.create({
      data: {
        userId: userC.id,
        planId: proMonthlyPlan.id,
        planPriceId: price.id,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: price.amountMinorUnits,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    const slotC = await prisma.accountProductSubscription.create({
      data: {
        userId: userC.id,
        productType: ProductType.STORAGE,
        subscriptionId: subC.id,
        status: BillingStatus.ACTIVE
      }
    });

    assert.ok(slotC.id);

    // Delete User C
    await prisma.user.delete({ where: { id: userC.id } });

    // Verify AccountProductSubscription was cascade-deleted
    const orphanedSlot = await prisma.accountProductSubscription.findUnique({
      where: { id: slotC.id }
    });
    assert.strictEqual(orphanedSlot, null, 'AccountProductSubscription must cascade-delete when user is deleted');
  });
});
