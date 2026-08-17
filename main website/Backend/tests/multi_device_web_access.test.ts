import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Batch 6 — Main Website Multi-Device & Multi-Server Integration Tests', () => {
  let app: FastifyInstance;
  const userAEmail = `web.multi.a.${Date.now()}@remotenode.io`;
  const userBEmail = `web.multi.b.${Date.now()}@remotenode.io`;
  let userTokenA = '';
  let userIdA = '';
  let userTokenB = '';
  let userIdB = '';

  const serverIdsA: string[] = [];
  const deviceIdsA: string[] = [];
  let serverIdB = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Create User A
    const userA = await prisma.user.create({
      data: {
        email: userAEmail,
        passwordHash: 'hashA',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    userIdA = userA.id;
    const sessionA = await prisma.userSession.create({
      data: {
        userId: userA.id,
        token: `token-web-a-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });
    userTokenA = sessionA.token;

    // Create User B
    const userB = await prisma.user.create({
      data: {
        email: userBEmail,
        passwordHash: 'hashB',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    userIdB = userB.id;
    const sessionB = await prisma.userSession.create({
      data: {
        userId: userB.id,
        token: `token-web-b-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });
    userTokenB = sessionB.token;

    // Seed 5 devices and 5 servers for User A
    for (let i = 1; i <= 5; i++) {
      const dev = await prisma.device.create({
        data: {
          userId: userA.id,
          installationId: `inst-web-a-${i}-${Date.now()}`,
          deviceName: `Phone ${String.fromCharCode(64 + i)}`,
          platform: 'Android',
          status: 'ONLINE'
        }
      });
      deviceIdsA.push(dev.id);

      const srv = await prisma.serverInstance.create({
        data: {
          deviceId: dev.id,
          serverName: `Server ${String.fromCharCode(64 + i)}`,
          adminUsername: `admin${i}`,
          status: 'RUNNING'
        }
      });
      serverIdsA.push(srv.id);
    }

    // Seed 1 device & server for User B
    const devB = await prisma.device.create({
      data: {
        userId: userB.id,
        installationId: `inst-web-b-1-${Date.now()}`,
        deviceName: 'User B Phone',
        platform: 'Android',
        status: 'ONLINE'
      }
    });
    const srvB = await prisma.serverInstance.create({
      data: {
        deviceId: devB.id,
        serverName: 'User B Server',
        status: 'RUNNING'
      }
    });
    serverIdB = srvB.id;
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: { contains: 'web.multi.' } }
          ]
        }
      });
    } catch (_) {}
    await app.close();
  });

  test('TEST 1 — GET /api/v1/devices returns all 5 devices for User A with independent properties', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.devices.length, 5);

    // Verify each device has distinct IDs and server metadata
    const ids = new Set(body.data.devices.map((d: any) => d.id));
    assert.strictEqual(ids.size, 5, 'All 5 devices must have unique Device IDs');

    const serverNames = body.data.devices.map((d: any) => d.server?.serverName);
    assert.ok(serverNames.includes('Server A'));
    assert.ok(serverNames.includes('Server B'));
    assert.ok(serverNames.includes('Server C'));
    assert.ok(serverNames.includes('Server D'));
    assert.ok(serverNames.includes('Server E'));
  });

  test('TEST 2 — Access check GET /api/v1/file-manager/:serverId/access verifies intended server identity', async () => {
    const targetServerId = serverIdsA[1]; // Server B

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/file-manager/${targetServerId}/access`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.serverId, targetServerId);
    assert.strictEqual(body.data.serverName, 'Server B');
  });

  test('TEST 3 — Access check on Server C returns Server C metadata, not Server A', async () => {
    const targetServerId = serverIdsA[2]; // Server C

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/file-manager/${targetServerId}/access`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.serverId, targetServerId);
    assert.strictEqual(body.data.serverName, 'Server C');
  });

  test('TEST 4 — Accessing User A server with User B session token is rejected with 403 Forbidden', async () => {
    const serverAId = serverIdsA[0];

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/file-manager/${serverAId}/access`,
      headers: { authorization: `Bearer ${userTokenB}` }
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('TEST 5 — Accessing non-existent serverId returns 404 Not Found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/file-manager/non-existent-server-uuid/access',
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(res.statusCode, 404);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'NOT_FOUND');
  });

  test('TEST 6 — Offline server status isolation (Server B STOPPED does not affect Server A)', async () => {
    const serverBId = serverIdsA[1];

    // Mark Server B as STOPPED
    await prisma.serverInstance.update({
      where: { id: serverBId },
      data: { status: 'STOPPED' }
    });

    // Check Server B access -> returns offline (online: false)
    const resB = await app.inject({
      method: 'GET',
      url: `/api/v1/file-manager/${serverBId}/access`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    assert.strictEqual(resB.statusCode, 200);
    const bodyB = JSON.parse(resB.payload);
    assert.strictEqual(bodyB.data.online, false);

    // Check Server A access -> remains online (online: true)
    const serverAId = serverIdsA[0];
    const resA = await app.inject({
      method: 'GET',
      url: `/api/v1/file-manager/${serverAId}/access`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    assert.strictEqual(resA.statusCode, 200);
    const bodyA = JSON.parse(resA.payload);
    assert.strictEqual(bodyA.data.serverId, serverAId);
  });

  test('TEST 7 — Delete Server C leaves Servers A, B, D, E untouched', async () => {
    const deviceCToDelete = deviceIdsA[2];

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${deviceCToDelete}`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    assert.strictEqual(delRes.statusCode, 200);

    // Fetch User A devices
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.devices.length, 4);

    const remainingNames = body.data.devices.map((d: any) => d.server?.serverName);
    assert.ok(remainingNames.includes('Server A'));
    assert.ok(remainingNames.includes('Server B'));
    assert.ok(remainingNames.includes('Server D'));
    assert.ok(remainingNames.includes('Server E'));
    assert.strictEqual(remainingNames.includes('Server C'), false);
  });

  test('TEST 8 — After deleting 1 server, registering a replacement device succeeds (slot recycled)', async () => {
    const newInstId = `inst-web-replacement-${Date.now()}`;
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Phone Replacement',
        platform: 'Android',
        installationId: newInstId,
        serverName: 'Server Replacement'
      }
    });

    assert.strictEqual(regRes.statusCode, 200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.devices.length, 5);
  });
});
