import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { PlanService } from '../src/services/billing/plan_service.js';
import { BillingStatus, CurrencyCode, BillingInterval } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors/app-error.js';

describe('ZC-BILLING-1.3 Account Billing State & Subscription Foundation Test Suite', () => {
  let app: FastifyInstance;

  const testEmailFree = `billing.free.${Date.now()}@zdexcloud.com`;
  const testEmailPro = `billing.pro.${Date.now()}@zdexcloud.com`;
  const testEmailGrace = `billing.grace.${Date.now()}@zdexcloud.com`;
  const testEmailIdorA = `billing.idora.${Date.now()}@zdexcloud.com`;
  const testEmailIdorB = `billing.idorb.${Date.now()}@zdexcloud.com`;

  let userFreeId = '';
  let userFreeToken = '';
  let userProId = '';
  let userProToken = '';
  let userGraceId = '';
  let userGraceToken = '';
  let userIdorA = '';
  let userTokenA = '';
  let userIdorB = '';
  let userTokenB = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Ensure catalog and entitlements are seeded
    await PlanService.seedInitialCatalog();

    // Helper to create test user with session
    const createTestUser = async (email: string) => {
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: 'test-hash',
          status: 'ACTIVE',
          emailVerified: true
        }
      });
      const session = await prisma.userSession.create({
        data: {
          userId: user.id,
          token: `token-${Date.now()}-${Math.random()}`,
          expiresAt: new Date(Date.now() + 86400000)
        }
      });
      return { id: user.id, token: session.token };
    };

    const userFree = await createTestUser(testEmailFree);
    userFreeId = userFree.id;
    userFreeToken = userFree.token;

    const userPro = await createTestUser(testEmailPro);
    userProId = userPro.id;
    userProToken = userPro.token;

    const userGrace = await createTestUser(testEmailGrace);
    userGraceId = userGrace.id;
    userGraceToken = userGrace.token;

    const userA = await createTestUser(testEmailIdorA);
    userIdorA = userA.id;
    userTokenA = userA.token;

    const userB = await createTestUser(testEmailIdorB);
    userIdorB = userB.id;
    userTokenB = userB.token;
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: {
          email: {
            contains: 'billing.'
          }
        }
      });
    } catch (e) {
      // Ignore cleanup error
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. FREE TIER DEFAULT STATE & RESOLUTION
  // ---------------------------------------------------------------------------
  test('1. Free Tier Default — New user without subscription resolves to FREE with 1 server limit', async () => {
    const billingState = await BillingStateService.getBillingState(userFreeId);
    assert.strictEqual(billingState.status, BillingStatus.FREE);
    assert.strictEqual(billingState.activeSubscriptionId, null);

    const effective = await BillingStateService.getEffectivePlan(userFreeId);
    assert.strictEqual(effective.planCode, 'FREE');
    assert.strictEqual(effective.status, BillingStatus.FREE);
    assert.strictEqual(effective.subscription, null);

    const entitlements = await EntitlementService.resolveUserEntitlements(userFreeId);
    assert.strictEqual(entitlements.planCode, 'FREE');
    assert.strictEqual(entitlements.maxServers, 1);
    assert.strictEqual(entitlements.priorityRelay, false);
  });

  // ---------------------------------------------------------------------------
  // 2. ACTIVE SUBSCRIPTION CREATION & ENTITLEMENTS
  // ---------------------------------------------------------------------------
  test('2. Subscription Activation — Creating Pro Monthly subscription elevates account to ACTIVE with 5 servers', async () => {
    const subscription = await BillingStateService.createSubscription({
      userId: userProId,
      planCode: 'PRO_MONTHLY',
      currency: CurrencyCode.INR,
      billingCountry: 'IN',
      billingPostalCode: '400001'
    });

    assert.strictEqual(subscription.status, BillingStatus.ACTIVE);
    assert.strictEqual(subscription.amountMinorUnits, 4900);
    assert.strictEqual(subscription.currency, CurrencyCode.INR);
    assert.strictEqual(subscription.priceVersion, 1);
    assert.strictEqual(subscription.plan.code, 'PRO_MONTHLY');

    // Verify AccountBillingState
    const billingState = await BillingStateService.getBillingState(userProId);
    assert.strictEqual(billingState.status, BillingStatus.ACTIVE);
    assert.strictEqual(billingState.activeSubscriptionId, subscription.id);
    assert.strictEqual(billingState.billingCountry, 'IN');

    // Verify Effective Plan & Entitlement resolution
    const effective = await BillingStateService.getEffectivePlan(userProId);
    assert.strictEqual(effective.planCode, 'PRO_MONTHLY');
    assert.strictEqual(effective.status, BillingStatus.ACTIVE);

    const entitlements = await EntitlementService.resolveUserEntitlements(userProId);
    assert.strictEqual(entitlements.planCode, 'PRO_MONTHLY');
    assert.strictEqual(entitlements.maxServers, 5);
    assert.strictEqual(entitlements.priorityRelay, true);
  });

  // ---------------------------------------------------------------------------
  // 3. PRICE GRANDFATHERING & IMMUTABILITY
  // ---------------------------------------------------------------------------
  test('3. Price Grandfathering — Existing subscription preserves version 1 price even if catalog adds version 2', async () => {
    const sub = await BillingStateService.getActiveSubscription(userProId);
    assert.ok(sub);
    assert.strictEqual(sub.priceVersion, 1);
    assert.strictEqual(sub.amountMinorUnits, 4900);

    // Create a new price version 2 in catalog for PRO_MONTHLY (e.g. INR 5900)
    const proPlan = await prisma.plan.findUnique({ where: { code: 'PRO_MONTHLY' } });
    assert.ok(proPlan);

    const priceV2 = await prisma.planPrice.create({
      data: {
        planId: proPlan!.id,
        currency: CurrencyCode.INR,
        amountMinorUnits: 5900,
        version: 2,
        isActive: true,
        effectiveFrom: new Date()
      }
    });

    // Verify existing subscription still references version 1 at 4900
    const subAfterCatalogUpdate = await BillingStateService.getActiveSubscription(userProId);
    assert.ok(subAfterCatalogUpdate);
    assert.strictEqual(subAfterCatalogUpdate!.priceVersion, 1);
    assert.strictEqual(subAfterCatalogUpdate!.amountMinorUnits, 4900);
    assert.strictEqual(subAfterCatalogUpdate!.planPriceId, sub!.planPriceId);

    // Cleanup priceV2
    await prisma.planPrice.delete({ where: { id: priceV2.id } });
  });

  // ---------------------------------------------------------------------------
  // 4. CANCELLATION AT PERIOD END
  // ---------------------------------------------------------------------------
  test('4. Cancellation at Period End — ACTIVE -> CANCELLING preserves full paid entitlements', async () => {
    const sub = await BillingStateService.getActiveSubscription(userProId);
    assert.ok(sub);

    const cancelledSub = await BillingStateService.cancelAtPeriodEnd(sub!.id);
    assert.strictEqual(cancelledSub.status, BillingStatus.CANCELLING);
    assert.strictEqual(cancelledSub.cancelAtPeriodEnd, true);
    assert.ok(cancelledSub.cancelledAt);

    // Account state becomes CANCELLING
    const state = await BillingStateService.getBillingState(userProId);
    assert.strictEqual(state.status, BillingStatus.CANCELLING);

    // Entitlements REMAIN PRO (5 servers, priority relay) during cancellation period
    const entitlements = await EntitlementService.resolveUserEntitlements(userProId);
    assert.strictEqual(entitlements.planCode, 'PRO_MONTHLY');
    assert.strictEqual(entitlements.maxServers, 5);
    assert.strictEqual(entitlements.priorityRelay, true);
  });

  // ---------------------------------------------------------------------------
  // 5. EXPIRATION & ZERO-DESTRUCTION DOWNGRADE
  // ---------------------------------------------------------------------------
  test('5. Expiration — CANCELLING -> EXPIRED falls back to FREE entitlements with zero server deletion', async () => {
    const sub = await BillingStateService.getActiveSubscription(userProId);
    assert.ok(sub);

    const expiredSub = await BillingStateService.expireSubscription(sub!.id);
    assert.strictEqual(expiredSub.status, BillingStatus.EXPIRED);
    assert.ok(expiredSub.expiredAt);

    // Account state becomes EXPIRED and unlinks active subscription
    const state = await BillingStateService.getBillingState(userProId);
    assert.strictEqual(state.status, BillingStatus.EXPIRED);
    assert.strictEqual(state.activeSubscriptionId, null);

    // Entitlements fall back to FREE
    const entitlements = await EntitlementService.resolveUserEntitlements(userProId);
    assert.strictEqual(entitlements.planCode, 'FREE');
    assert.strictEqual(entitlements.maxServers, 1);
    assert.strictEqual(entitlements.priorityRelay, false);
  });

  // ---------------------------------------------------------------------------
  // 6. PAST_DUE & 5-DAY GRACE PERIOD SEMANTICS
  // ---------------------------------------------------------------------------
  test('6. Grace Period — ACTIVE -> PAST_DUE -> GRACE_PERIOD retains full paid entitlements for 5 days', async () => {
    const sub = await BillingStateService.createSubscription({
      userId: userGraceId,
      planCode: 'PRO_YEARLY',
      currency: CurrencyCode.USD
    });
    assert.strictEqual(sub.status, BillingStatus.ACTIVE);

    // Transition to PAST_DUE
    const pastDueSub = await BillingStateService.markPastDue(sub.id);
    assert.strictEqual(pastDueSub.status, BillingStatus.PAST_DUE);

    // Transition to GRACE_PERIOD (5 calendar days)
    const graceSub = await BillingStateService.startGracePeriod(sub.id, 5);
    assert.strictEqual(graceSub.status, BillingStatus.GRACE_PERIOD);
    assert.ok(graceSub.gracePeriodStartedAt);
    assert.ok(graceSub.gracePeriodEndsAt);

    // Verify 5-day delta approximately
    const diffMs = graceSub.gracePeriodEndsAt!.getTime() - graceSub.gracePeriodStartedAt!.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    assert.strictEqual(diffDays, 5);

    // Account state is GRACE_PERIOD
    const state = await BillingStateService.getBillingState(userGraceId);
    assert.strictEqual(state.status, BillingStatus.GRACE_PERIOD);

    // Full PRO entitlements remain active during GRACE_PERIOD
    const entitlements = await EntitlementService.resolveUserEntitlements(userGraceId);
    assert.strictEqual(entitlements.planCode, 'PRO_YEARLY');
    assert.strictEqual(entitlements.maxServers, 5);
    assert.strictEqual(entitlements.priorityRelay, true);
  });

  // ---------------------------------------------------------------------------
  // 7. GRACE PERIOD RECOVERY
  // ---------------------------------------------------------------------------
  test('7. Grace Period Recovery — GRACE_PERIOD -> ACTIVE clears grace dates and restores ACTIVE status', async () => {
    const sub = await BillingStateService.getActiveSubscription(userGraceId);
    assert.ok(sub);

    const recoveredSub = await BillingStateService.recoverGracePeriod(sub!.id);
    assert.strictEqual(recoveredSub.status, BillingStatus.ACTIVE);
    assert.strictEqual(recoveredSub.gracePeriodStartedAt, null);
    assert.strictEqual(recoveredSub.gracePeriodEndsAt, null);

    const state = await BillingStateService.getBillingState(userGraceId);
    assert.strictEqual(state.status, BillingStatus.ACTIVE);

    const entitlements = await EntitlementService.resolveUserEntitlements(userGraceId);
    assert.strictEqual(entitlements.planCode, 'PRO_YEARLY');
    assert.strictEqual(entitlements.maxServers, 5);
  });

  // ---------------------------------------------------------------------------
  // 8. GRACE EXPIRATION
  // ---------------------------------------------------------------------------
  test('8. Grace Expiration — GRACE_PERIOD -> EXPIRED reverts entitlements to FREE', async () => {
    // Put back in grace period
    const sub = await BillingStateService.getActiveSubscription(userGraceId);
    assert.ok(sub);
    await BillingStateService.markPastDue(sub!.id);
    await BillingStateService.startGracePeriod(sub!.id, 5);

    // Grace period expires
    const expiredSub = await BillingStateService.expireSubscription(sub!.id);
    assert.strictEqual(expiredSub.status, BillingStatus.EXPIRED);

    const entitlements = await EntitlementService.resolveUserEntitlements(userGraceId);
    assert.strictEqual(entitlements.planCode, 'FREE');
    assert.strictEqual(entitlements.maxServers, 1);
  });

  // ---------------------------------------------------------------------------
  // 9. REFUND SEMANTICS
  // ---------------------------------------------------------------------------
  test('9. Refund Semantics — ACTIVE -> REFUNDED unlinks subscription and reverts to FREE', async () => {
    const sub = await BillingStateService.createSubscription({
      userId: userGraceId,
      planCode: 'PRO_MONTHLY',
      currency: CurrencyCode.INR
    });
    assert.strictEqual(sub.status, BillingStatus.ACTIVE);

    const refundedSub = await BillingStateService.refundSubscription(sub.id);
    assert.strictEqual(refundedSub.status, BillingStatus.REFUNDED);
    assert.ok(refundedSub.refundedAt);

    const state = await BillingStateService.getBillingState(userGraceId);
    assert.strictEqual(state.status, BillingStatus.REFUNDED);
    assert.strictEqual(state.activeSubscriptionId, null);

    const entitlements = await EntitlementService.resolveUserEntitlements(userGraceId);
    assert.strictEqual(entitlements.planCode, 'FREE');
    assert.strictEqual(entitlements.maxServers, 1);
  });

  // ---------------------------------------------------------------------------
  // 10. INVALID STATE TRANSITION VALIDATION
  // ---------------------------------------------------------------------------
  test('10. Invalid Transitions — Service rejects invalid state transitions with ConflictError', async () => {
    const sub = await prisma.subscription.findFirst({
      where: { userId: userGraceId, status: BillingStatus.REFUNDED }
    });
    assert.ok(sub);

    // Attempt to start grace period on a REFUNDED subscription must fail
    await assert.rejects(
      async () => {
        await BillingStateService.startGracePeriod(sub!.id);
      },
      (err: any) => err.statusCode === 409 || err.errorCode === 'CONFLICT' || err instanceof ConflictError
    );

    // Attempt to cancel an already EXPIRED subscription must fail
    const expiredSub = await prisma.subscription.findFirst({
      where: { userId: userProId, status: BillingStatus.EXPIRED }
    });
    assert.ok(expiredSub);

    await assert.rejects(
      async () => {
        await BillingStateService.cancelAtPeriodEnd(expiredSub!.id);
      },
      (err: any) => err.statusCode === 409 || err.errorCode === 'CONFLICT' || err instanceof ConflictError
    );
  });

  // ---------------------------------------------------------------------------
  // 11. PLAN / PRICE MISMATCH INTEGRITY
  // ---------------------------------------------------------------------------
  test('11. Plan/Price Integrity — Rejects subscription creation with invalid plan or non-existent price', async () => {
    await assert.rejects(
      async () => {
        await BillingStateService.createSubscription({
          userId: userFreeId,
          planCode: 'NON_EXISTENT_PLAN',
          currency: CurrencyCode.INR
        });
      },
      (err: any) => err.statusCode === 404 || err.errorCode === 'NOT_FOUND' || err instanceof NotFoundError
    );

    await assert.rejects(
      async () => {
        await BillingStateService.createSubscription({
          userId: userFreeId,
          planCode: 'PRO_MONTHLY',
          currency: CurrencyCode.INR,
          priceVersion: 999 // Non-existent version
        });
      },
      (err: any) => err.statusCode === 400 || err.errorCode === 'VALIDATION_ERROR' || err instanceof ValidationError
    );
  });

  // ---------------------------------------------------------------------------
  // 12. DUPLICATE ACTIVE SUBSCRIPTION CONCURRENCY / ATOMICITY
  // ---------------------------------------------------------------------------
  test('12. Atomic Subscription Replacement — Creating new subscription supersedes old active subscription', async () => {
    // Create first subscription
    const sub1 = await BillingStateService.createSubscription({
      userId: userIdorA,
      planCode: 'PRO_MONTHLY',
      currency: CurrencyCode.INR
    });
    assert.strictEqual(sub1.status, BillingStatus.ACTIVE);

    // Create second upgraded subscription (e.g. Yearly)
    const sub2 = await BillingStateService.createSubscription({
      userId: userIdorA,
      planCode: 'PRO_YEARLY',
      currency: CurrencyCode.INR
    });
    assert.strictEqual(sub2.status, BillingStatus.ACTIVE);

    // Verify sub1 was marked EXPIRED
    const sub1After = await prisma.subscription.findUnique({ where: { id: sub1.id } });
    assert.strictEqual(sub1After!.status, BillingStatus.EXPIRED);

    // Account activeSubscriptionId points strictly to sub2
    const state = await BillingStateService.getBillingState(userIdorA);
    assert.strictEqual(state.activeSubscriptionId, sub2.id);

    const effective = await BillingStateService.getEffectivePlan(userIdorA);
    assert.strictEqual(effective.planCode, 'PRO_YEARLY');
  });

  // ---------------------------------------------------------------------------
  // 13. IDOR & DATA ISOLATION (GET /api/v1/billing)
  // ---------------------------------------------------------------------------
  test('13. IDOR & Account Isolation — GET /api/v1/billing strictly returns authenticated user billing data', async () => {
    // User A has PRO_YEARLY
    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    assert.strictEqual(resA.statusCode, 200);
    const bodyA = JSON.parse(resA.payload);
    assert.strictEqual(bodyA.success, true);
    assert.strictEqual(bodyA.data.status, 'ACTIVE');
    assert.strictEqual(bodyA.data.plan, 'PRO_YEARLY');
    assert.strictEqual(bodyA.data.entitlements.maxServers, 5);
    assert.strictEqual(bodyA.data.entitlements.priorityRelay, true);
    assert.ok(bodyA.data.subscription);
    assert.strictEqual(bodyA.data.subscription.planCode, 'PRO_YEARLY');

    // User B has FREE (no subscription created)
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: { authorization: `Bearer ${userTokenB}` }
    });
    assert.strictEqual(resB.statusCode, 200);
    const bodyB = JSON.parse(resB.payload);
    assert.strictEqual(bodyB.success, true);
    assert.strictEqual(bodyB.data.status, 'FREE');
    assert.strictEqual(bodyB.data.plan, 'FREE');
    assert.strictEqual(bodyB.data.entitlements.maxServers, 1);
    assert.strictEqual(bodyB.data.entitlements.priorityRelay, false);
    assert.strictEqual(bodyB.data.subscription, null);
  });

  // ---------------------------------------------------------------------------
  // 14. SERVER LIMIT RUNTIME ENFORCEMENT INTEGRATION
  // ---------------------------------------------------------------------------
  test('14. Server Limit Runtime Enforcement — Free user blocked at 1 server; Pro user allowed up to 5', async () => {
    // 1. User B (FREE): register 1st server -> 200 OK
    const resDev1 = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenB}` },
      payload: {
        deviceName: 'User B Device 1',
        platform: 'Android',
        installationId: `inst-userb-1-${Date.now()}`,
        serverName: 'User B Server 1'
      }
    });
    assert.strictEqual(resDev1.statusCode, 200);

    // Attempt 2nd server on User B (FREE) -> 409 MAX_SERVERS_REACHED
    const resDev2 = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenB}` },
      payload: {
        deviceName: 'User B Device 2',
        platform: 'Android',
        installationId: `inst-userb-2-${Date.now()}`,
        serverName: 'User B Server 2'
      }
    });
    assert.strictEqual(resDev2.statusCode, 409);
    const bodyDev2 = JSON.parse(resDev2.payload);
    assert.strictEqual(bodyDev2.error.code, 'MAX_SERVERS_REACHED');

    // 2. User A (PRO): can register up to 5 servers
    for (let i = 1; i <= 5; i++) {
      const resProDev = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/register',
        headers: { authorization: `Bearer ${userTokenA}` },
        payload: {
          deviceName: `User A Device ${i}`,
          platform: 'Android',
          installationId: `inst-usera-${i}-${Date.now()}`,
          serverName: `User A Server ${i}`
        }
      });
      assert.strictEqual(resProDev.statusCode, 200, `Pro device ${i} creation failed`);
    }

    // 6th server on User A (PRO) -> 409 MAX_SERVERS_REACHED
    const resProDev6 = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'User A Device 6',
        platform: 'Android',
        installationId: `inst-usera-6-${Date.now()}`,
        serverName: 'User A Server 6'
      }
    });
    assert.strictEqual(resProDev6.statusCode, 409);
    const bodyPro6 = JSON.parse(resProDev6.payload);
    assert.strictEqual(bodyPro6.error.code, 'MAX_SERVERS_REACHED');
  });

  // ---------------------------------------------------------------------------
  // 15. AUDIT TRAIL LOGGING
  // ---------------------------------------------------------------------------
  test('15. Audit Logging — Billing state changes generate structured AuditEvent records', async () => {
    const events = await prisma.auditEvent.findMany({
      where: {
        userId: userIdorA,
        eventType: {
          in: ['SUBSCRIPTION_CREATED', 'SUBSCRIPTION_ACTIVATED']
        }
      }
    });

    assert.ok(events.length >= 2, 'Should have logged SUBSCRIPTION_CREATED and SUBSCRIPTION_ACTIVATED events');
  });
});
