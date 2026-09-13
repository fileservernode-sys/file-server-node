import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { EntitlementService, DEFAULT_FREE_ENTITLEMENTS } from '../src/services/billing/entitlement_service.js';
import { PlanService } from '../src/services/billing/plan_service.js';

describe('ZC-BILLING-1.2 Entitlement Engine Test Suite', () => {
  let app: FastifyInstance;
  let freeUserId: string = '';
  let freeUserToken: string = '';
  let proUserId: string = '';
  let proUserToken: string = '';

  before(async () => {
    app = await buildApp();
    await app.ready();
    await PlanService.seedInitialCatalog();

    // Create a Free test user
    const freeUser = await prisma.user.create({
      data: {
        email: 'ent.free.' + Date.now() + '@zdex.cloud',
        passwordHash: 'hashFree',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    freeUserId = freeUser.id;
    const freeSession = await prisma.userSession.create({
      data: {
        userId: freeUser.id,
        token: 'token-ent-free-' + Date.now(),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });
    freeUserToken = freeSession.token;

    // Create a Pro test user
    const proUser = await prisma.user.create({
      data: {
        email: 'ent.pro.' + Date.now() + '@zdex.cloud',
        passwordHash: 'hashPro',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    proUserId = proUser.id;
    EntitlementService.setTestUserPlan(proUser.id, 'PRO_MONTHLY');

    const proSession = await prisma.userSession.create({
      data: {
        userId: proUser.id,
        token: 'token-ent-pro-' + Date.now(),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });
    proUserToken = proSession.token;
  });

  after(async () => {
    EntitlementService.clearTestUserPlans();
    try {
      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: { contains: 'ent.free.' } },
            { email: { contains: 'ent.pro.' } },
            { email: { contains: 'ent.manip.' } }
          ]
        }
      });
    } catch (e) {
      // Ignore cleanup error
    }
    await app.close();
  });

  test('1. Plan -> Entitlement Mapping (FREE, PRO_MONTHLY, PRO_YEARLY)', async () => {
    const freeEnt = await EntitlementService.resolvePlanEntitlements('FREE');
    assert.strictEqual(freeEnt.planCode, 'FREE');
    assert.strictEqual(freeEnt.maxServers, 1);
    assert.strictEqual(freeEnt.priorityRelay, false);
    assert.strictEqual(freeEnt.entitlements.MAX_SERVERS, 1);
    assert.strictEqual(freeEnt.entitlements.PRIORITY_RELAY, false);

    const proMonthlyEnt = await EntitlementService.resolvePlanEntitlements('PRO_MONTHLY');
    assert.strictEqual(proMonthlyEnt.planCode, 'PRO_MONTHLY');
    assert.strictEqual(proMonthlyEnt.maxServers, 5);
    assert.strictEqual(proMonthlyEnt.priorityRelay, true);
    assert.strictEqual(proMonthlyEnt.entitlements.MAX_SERVERS, 5);
    assert.strictEqual(proMonthlyEnt.entitlements.PRIORITY_RELAY, true);

    const proYearlyEnt = await EntitlementService.resolvePlanEntitlements('PRO_YEARLY');
    assert.strictEqual(proYearlyEnt.planCode, 'PRO_YEARLY');
    assert.strictEqual(proYearlyEnt.maxServers, 5);
    assert.strictEqual(proYearlyEnt.priorityRelay, true);
    assert.strictEqual(proYearlyEnt.entitlements.MAX_SERVERS, 5);
    assert.strictEqual(proYearlyEnt.entitlements.PRIORITY_RELAY, true);
  });

  test('2. Currency Independence — Entitlements are identical across INR and USD prices', async () => {
    const proPlanINR = await PlanService.getPlanByCode('PRO_MONTHLY', 'INR' as any);
    const proPlanUSD = await PlanService.getPlanByCode('PRO_MONTHLY', 'USD' as any);

    assert.ok(proPlanINR && proPlanUSD);
    assert.strictEqual(proPlanINR.entitlements?.maxServers, 5);
    assert.strictEqual(proPlanUSD.entitlements?.maxServers, 5);
    assert.strictEqual(proPlanINR.entitlements?.priorityRelay, true);
    assert.strictEqual(proPlanUSD.entitlements?.priorityRelay, true);
  });

  test('3. Type Safety — Entitlements distinguish INTEGER and BOOLEAN types', async () => {
    const ent = await EntitlementService.resolvePlanEntitlements('PRO_MONTHLY');
    assert.strictEqual(typeof ent.maxServers, 'number');
    assert.strictEqual(Number.isInteger(ent.maxServers), true);
    assert.strictEqual(typeof ent.priorityRelay, 'boolean');
    assert.strictEqual(typeof ent.entitlements.MAX_SERVERS, 'number');
    assert.strictEqual(typeof ent.entitlements.PRIORITY_RELAY, 'boolean');
  });

  test('4. Unknown / Inactive Plan safely falls back to FREE defaults', async () => {
    const ent = await EntitlementService.resolvePlanEntitlements('UNKNOWN_CUSTOM_PLAN');
    assert.strictEqual(ent.planCode, 'FREE');
    assert.strictEqual(ent.maxServers, 1);
    assert.strictEqual(ent.priorityRelay, false);
  });

  test('5. Missing Account Association safely defaults to FREE entitlements', async () => {
    const ent = await EntitlementService.resolveUserEntitlements(freeUserId);
    assert.strictEqual(ent.planCode, 'FREE');
    assert.strictEqual(ent.maxServers, 1);
    assert.strictEqual(ent.priorityRelay, false);
  });

  test('6. Client Manipulation Resistance — Client submitted limits are ignored', async () => {
    const userManip = await prisma.user.create({
      data: {
        email: 'ent.manip.' + Date.now() + '@zdex.cloud',
        passwordHash: 'hashManip',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    const sessionManip = await prisma.userSession.create({
      data: {
        userId: userManip.id,
        token: 'token-ent-manip-' + Date.now(),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // First server creation succeeds
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: 'Bearer ' + sessionManip.token },
      payload: {
        deviceName: 'Phone Host 1',
        platform: 'Android',
        installationId: 'inst-manip-1-' + Date.now(),
        serverName: 'Server 1',
        maxServers: 999,
        priorityRelay: true
      }
    });
    assert.strictEqual(res1.statusCode, 200);

    // Second server creation attempt with malicious client limits must be rejected with 409
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: 'Bearer ' + sessionManip.token },
      payload: {
        deviceName: 'Phone Host 2',
        platform: 'Android',
        installationId: 'inst-manip-2-' + Date.now(),
        serverName: 'Server 2',
        maxServers: 999,
        priorityRelay: true
      }
    });
    assert.strictEqual(res2.statusCode, 409);
    const body = JSON.parse(res2.payload);
    assert.strictEqual(body.error.code, 'MAX_SERVERS_REACHED');
  });

  test('7. Server Limit Enforcement — FREE account cannot create beyond 1 server', async () => {
    // Create first device + server for free user
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: 'Bearer ' + freeUserToken },
      payload: {
        deviceName: 'Free Device 1',
        platform: 'Android',
        installationId: 'inst-free-1-' + Date.now(),
        serverName: 'Free Server 1'
      }
    });
    assert.strictEqual(res1.statusCode, 200);

    // Attempt second device + server for free user -> must be rejected
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: 'Bearer ' + freeUserToken },
      payload: {
        deviceName: 'Free Device 2',
        platform: 'Android',
        installationId: 'inst-free-2-' + Date.now(),
        serverName: 'Free Server 2'
      }
    });
    assert.strictEqual(res2.statusCode, 409);
    const body = JSON.parse(res2.payload);
    assert.strictEqual(body.error.code, 'MAX_SERVERS_REACHED');
  });

  test('8. Server Limit Enforcement — PRO account can create up to 5 servers', async () => {
    // Register 5 devices for PRO user
    for (let i = 1; i <= 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/register',
        headers: { authorization: 'Bearer ' + proUserToken },
        payload: {
          deviceName: 'Pro Device ' + i,
          platform: 'Android',
          installationId: 'inst-pro-' + i + '-' + Date.now(),
          serverName: 'Pro Server ' + i
        }
      });
      assert.strictEqual(res.statusCode, 200, 'Pro device ' + i + ' creation failed');
    }

    const totalCount = await prisma.serverInstance.count({
      where: { device: { userId: proUserId } }
    });
    assert.strictEqual(totalCount, 5);

    // Sixth device registration attempt must be rejected with 409
    const res6 = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: 'Bearer ' + proUserToken },
      payload: {
        deviceName: 'Pro Device 6',
        platform: 'Android',
        installationId: 'inst-pro-6-' + Date.now(),
        serverName: 'Pro Server 6'
      }
    });
    assert.strictEqual(res6.statusCode, 409);
    const body6 = JSON.parse(res6.payload);
    assert.strictEqual(body6.error.code, 'MAX_SERVERS_REACHED');
  });

  test('9. Over-Limit Preservation — Resolving lower entitlement does not delete existing servers', async () => {
    // Check pro user server count before simulated downgrade
    const beforeCount = await prisma.serverInstance.count({
      where: { device: { userId: proUserId } }
    });
    assert.strictEqual(beforeCount, 5);

    // Simulate downgrade to FREE by setting test plan to FREE
    EntitlementService.setTestUserPlan(proUserId, 'FREE');
    const freeResolved = await EntitlementService.resolveUserEntitlements(proUserId);
    assert.strictEqual(freeResolved.maxServers, 1);

    // Verify all 5 servers still exist in the database unharmed
    const afterCount = await prisma.serverInstance.count({
      where: { device: { userId: proUserId } }
    });
    assert.strictEqual(afterCount, 5, 'Existing servers must NOT be deleted or destroyed on lower entitlement evaluation');
  });

  test('10. Idempotent Entitlement Seeding', async () => {
    // Run seeding multiple times
    await EntitlementService.seedInitialEntitlements();
    await EntitlementService.seedInitialEntitlements();

    const defCount = await prisma.entitlementDefinition.count();
    assert.strictEqual(defCount, 2);

    const planEntCount = await prisma.planEntitlement.count();
    assert.strictEqual(planEntCount, 6); // 2 entitlements * 3 plans
  });
});