import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';

describe('Phase 5.3 — Customer Server Actions Test Suite (Stop, Rename, Delete & Cross-Account Isolation)', () => {
  let app: FastifyInstance;
  const testEmailA = `action.test.a.${Date.now()}@remotenode.io`;
  const testEmailB = `action.test.b.${Date.now()}@remotenode.io`;
  let userTokenA = '';
  let userIdA = '';
  let userTokenB = '';
  let userIdB = '';

  let deviceIdA = '';
  let serverIdA = '';
  let deviceIdB = '';
  let serverIdB = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Create User A
    const userA = await prisma.user.create({
      data: {
        email: testEmailA,
        passwordHash: 'hashA',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    userIdA = userA.id;
    EntitlementService.setTestUserPlan(userA.id, 'PRO_MONTHLY');

    userTokenA = `token-action-a-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: userA.id,
        tokenHash: hashSessionToken(userTokenA),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // Create User B
    const userB = await prisma.user.create({
      data: {
        email: testEmailB,
        passwordHash: 'hashB',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    userIdB = userB.id;
    EntitlementService.setTestUserPlan(userB.id, 'PRO_MONTHLY');

    userTokenB = `token-action-b-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: userB.id,
        tokenHash: hashSessionToken(userTokenB),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // Register Device & Server for User A
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Pixel 8 Pro A',
        platform: 'Android',
        installationId: `inst-act-a-${Date.now()}`,
        serverName: 'Primary Cloud Server A'
      }
    });
    const bodyA = JSON.parse(resA.payload);
    deviceIdA = bodyA.data.device.id;
    const serverInstanceA = await prisma.serverInstance.findFirst({ where: { deviceId: deviceIdA } });
    serverIdA = serverInstanceA!.id;

    // Register Device & Server for User B
    const resB = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenB}` },
      payload: {
        deviceName: 'Galaxy S24 Ultra B',
        platform: 'Android',
        installationId: `inst-act-b-${Date.now()}`,
        serverName: 'Work Server B'
      }
    });
    const bodyB = JSON.parse(resB.payload);
    deviceIdB = bodyB.data.device.id;
    const serverInstanceB = await prisma.serverInstance.findFirst({ where: { deviceId: deviceIdB } });
    serverIdB = serverInstanceB!.id;
  });

  after(async () => {
    EntitlementService.clearTestUserPlans();
    try {
      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: testEmailA },
            { email: testEmailB }
          ]
        }
      });
    } catch (_) {}
    await app.close();
  });

  test('TEST 1 — User A successfully renames their own server', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/servers/${serverIdA}`,
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        serverName: 'Office Storage Node A'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.server.serverName, 'Office Storage Node A');

    const updated = await prisma.serverInstance.findUnique({ where: { id: serverIdA } });
    assert.strictEqual(updated?.serverName, 'Office Storage Node A');

    const audit = await prisma.auditEvent.findFirst({
      where: { userId: userIdA, eventType: 'SERVER_CREATED' },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(audit);
    assert.strictEqual((audit?.metadata as any)?.action, 'SERVER_RENAMED');
    assert.strictEqual((audit?.metadata as any)?.newName, 'Office Storage Node A');
  });

  test('TEST 2 — Rename validation: empty and excessive strings are rejected', async () => {
    // Empty
    const resEmpty = await app.inject({
      method: 'PATCH',
      url: `/api/v1/servers/${serverIdA}`,
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: { serverName: '   ' }
    });
    assert.strictEqual(resEmpty.statusCode, 400);

    // Over 64 chars
    const resLong = await app.inject({
      method: 'PATCH',
      url: `/api/v1/servers/${serverIdA}`,
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: { serverName: 'A'.repeat(65) }
    });
    assert.strictEqual(resLong.statusCode, 400);
  });

  test('TEST 3 — Cross-Account Rename Protection: User A cannot rename User B server', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/servers/${serverIdB}`,
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: { serverName: 'Hacked Server Name' }
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);

    // Ensure User B's server name was not altered
    const unchanged = await prisma.serverInstance.findUnique({ where: { id: serverIdB } });
    assert.strictEqual(unchanged?.serverName, 'Work Server B');
  });

  test('TEST 4 — User A successfully stops their running server', async () => {
    // Put server A into RUNNING state first
    await prisma.serverInstance.update({
      where: { id: serverIdA },
      data: { status: 'RUNNING' }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/servers/${serverIdA}/stop`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'STOPPED');

    const updated = await prisma.serverInstance.findUnique({ where: { id: serverIdA } });
    assert.strictEqual(updated?.status, 'STOPPED');
  });

  test('TEST 5 — Cross-Account Stop Protection: User A cannot stop User B server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/servers/${serverIdB}/stop`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(res.statusCode, 403);
  });

  test('TEST 6 — Cross-Account Delete Protection: User A cannot delete User B device/server', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/servers/${serverIdB}`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(res.statusCode, 403);

    // Ensure User B device and server still exist
    const deviceB = await prisma.device.findUnique({ where: { id: deviceIdB } });
    assert.ok(deviceB);
  });

  test('TEST 7 — User A successfully deletes their server node', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/servers/${serverIdA}`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);

    // Verify cascade deletion
    const dev = await prisma.device.findUnique({ where: { id: deviceIdA } });
    assert.strictEqual(dev, null);

    const srv = await prisma.serverInstance.findUnique({ where: { id: serverIdA } });
    assert.strictEqual(srv, null);
  });
});
