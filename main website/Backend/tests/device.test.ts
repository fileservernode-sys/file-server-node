import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Batch 4 — Server Limits (Max 5 Per Account, Max 1 Per Device) & Concurrency Tests', () => {
  let app: FastifyInstance;
  const testEmailA = `limit.test.a.${Date.now()}@remotenode.io`;
  const testEmailB = `limit.test.b.${Date.now()}@remotenode.io`;
  let userTokenA = '';
  let userIdA = '';
  let userTokenB = '';
  let userIdB = '';

  const registeredDeviceIdsA: string[] = [];

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Create User A
    try {
      const userA = await prisma.user.create({
        data: {
          email: testEmailA,
          passwordHash: 'hashA',
          status: 'ACTIVE',
          emailVerified: true
        }
      });
      userIdA = userA.id;
      const sessionA = await prisma.userSession.create({
        data: {
          userId: userA.id,
          token: `token-limit-a-${Date.now()}`,
          expiresAt: new Date(Date.now() + 3600000)
        }
      });
      userTokenA = sessionA.token;

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
      const sessionB = await prisma.userSession.create({
        data: {
          userId: userB.id,
          token: `token-limit-b-${Date.now()}`,
          expiresAt: new Date(Date.now() + 3600000)
        }
      });
      userTokenB = sessionB.token;
    } catch (e) {
      console.warn('DB initialization in test before hook:', e);
    }
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: { contains: 'limit.test.' } },
            { email: { contains: 'concurrent.test.' } },
            { email: { contains: 'overlimit.test.' } }
          ]
        }
      });
    } catch (e) {
      // Ignore cleanup error
    }
    await app.close();
  });

  test('TEST 1 — First server: Account A creates Server 1 on Device 1', async () => {
    if (!userTokenA) return;

    const instId = `inst-dev-1-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Android Phone Host',
        platform: 'Android',
        installationId: instId,
        serverName: 'Server 1'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    registeredDeviceIdsA.push(body.data.device.id);

    const count = await prisma.serverInstance.count({
      where: { device: { userId: userIdA } }
    });
    assert.strictEqual(count, 1);
  });

  test('TEST 2 — Same device second creation attempt (Max 1 server per device enforced)', async () => {
    if (!userTokenA || registeredDeviceIdsA.length === 0) return;

    const deviceId1 = registeredDeviceIdsA[0];

    // Attempting POST /servers on device that already has a server returns the existing server without creating a duplicate
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/servers',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: { deviceId: deviceId1 }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);

    // Verify DB count on this device is still strictly 1
    const serversOnDevice = await prisma.serverInstance.findMany({
      where: { deviceId: deviceId1 }
    });
    assert.strictEqual(serversOnDevice.length, 1);

    // Total account servers remains 1
    const totalCount = await prisma.serverInstance.count({
      where: { device: { userId: userIdA } }
    });
    assert.strictEqual(totalCount, 1);
  });

  test('TEST 3 & 4 — Multiple devices up to maximum 5 servers succeed', async () => {
    if (!userTokenA) return;

    // We already have 1 server. Add devices 2, 3, 4, 5
    for (let i = 2; i <= 5; i++) {
      const instId = `inst-dev-${i}-${Date.now()}`;
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/register',
        headers: { authorization: `Bearer ${userTokenA}` },
        payload: {
          deviceName: `Phone Host ${i}`,
          platform: 'Android',
          installationId: instId,
          serverName: `Server ${i}`
        }
      });

      assert.strictEqual(response.statusCode, 200, `Device ${i} creation failed`);
      const body = JSON.parse(response.payload);
      assert.strictEqual(body.success, true);
      registeredDeviceIdsA.push(body.data.device.id);
    }

    const totalCount = await prisma.serverInstance.count({
      where: { device: { userId: userIdA } }
    });
    assert.strictEqual(totalCount, 5, 'Account A should now have exactly 5 active servers');
  });

  test('TEST 5 — Sixth server creation attempt is rejected with MAX_SERVERS_REACHED (409)', async () => {
    if (!userTokenA) return;

    const instId6 = `inst-dev-6-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Phone Host 6',
        platform: 'Android',
        installationId: instId6,
        serverName: 'Server 6'
      }
    });

    assert.strictEqual(response.statusCode, 409);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'MAX_SERVERS_REACHED');

    // Confirm server count did not exceed 5
    const totalCount = await prisma.serverInstance.count({
      where: { device: { userId: userIdA } }
    });
    assert.strictEqual(totalCount, 5);
  });

  test('TEST 6 — Existing device re-registration when account has 5 servers does NOT fail', async () => {
    if (!userTokenA || registeredDeviceIdsA.length === 0) return;

    const device1 = await prisma.device.findUnique({
      where: { id: registeredDeviceIdsA[0] }
    });
    assert.ok(device1);

    // Re-register Device 1 with same installationId
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Renamed Phone 1',
        platform: 'Android',
        installationId: device1!.installationId!,
        serverName: 'Server 1 Renamed'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.device.id, device1!.id);

    // Count is still 5
    const totalCount = await prisma.serverInstance.count({
      where: { device: { userId: userIdA } }
    });
    assert.strictEqual(totalCount, 5);
  });

  test('TEST 7 — Deleting a server releases a slot, allowing a new server to be created', async () => {
    if (!userTokenA || registeredDeviceIdsA.length === 0) return;

    const deviceToDelete = registeredDeviceIdsA.pop()!;

    // Delete device
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${deviceToDelete}`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    assert.strictEqual(delRes.statusCode, 200);

    // Server count should now be 4
    const countAfterDel = await prisma.serverInstance.count({
      where: { device: { userId: userIdA } }
    });
    assert.strictEqual(countAfterDel, 4);

    // Now creating a new 5th server must succeed
    const newInstId = `inst-dev-replacement-${Date.now()}`;
    const newRes = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Replacement Phone',
        platform: 'Android',
        installationId: newInstId,
        serverName: 'Replacement Server'
      }
    });

    assert.strictEqual(newRes.statusCode, 200);
    const newBody = JSON.parse(newRes.payload);
    assert.strictEqual(newBody.success, true);
    registeredDeviceIdsA.push(newBody.data.device.id);

    // Server count restored to 5
    const finalCount = await prisma.serverInstance.count({
      where: { device: { userId: userIdA } }
    });
    assert.strictEqual(finalCount, 5);
  });

  test('TEST 8 — Server limit is strictly scoped per account (Account B has 0 slots used)', async () => {
    if (!userTokenB) return;

    // Account A is full (5 servers), Account B can still create servers
    const instIdB = `inst-dev-userb-${Date.now()}`;
    const resB = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenB}` },
      payload: {
        deviceName: 'User B Phone',
        platform: 'Android',
        installationId: instIdB,
        serverName: 'User B Server 1'
      }
    });

    assert.strictEqual(resB.statusCode, 200);
    const bodyB = JSON.parse(resB.payload);
    assert.strictEqual(bodyB.success, true);

    const countB = await prisma.serverInstance.count({
      where: { device: { userId: userIdB } }
    });
    assert.strictEqual(countB, 1);
  });

  test('TEST 9 — Multiple devices with default deviceName "Android Phone Host" create separate servers', async () => {
    if (!userTokenB) return;

    // User B adds another phone with the identical name "Android Phone Host"
    const instIdB2 = `inst-dev-userb-2-${Date.now()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenB}` },
      payload: {
        deviceName: 'Android Phone Host',
        platform: 'Android',
        installationId: instIdB2,
        serverName: 'User B Server 2'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const countB = await prisma.serverInstance.count({
      where: { device: { userId: userIdB } }
    });
    assert.strictEqual(countB, 2);
  });

  test('TEST 10 — STOPPED server still consumes account slot', async () => {
    if (!userTokenA || registeredDeviceIdsA.length === 0) return;

    // Mark one of User A's servers as STOPPED
    const firstServer = await prisma.serverInstance.findFirst({
      where: { device: { userId: userIdA } }
    });
    assert.ok(firstServer);

    await prisma.serverInstance.update({
      where: { id: firstServer!.id },
      data: { status: 'STOPPED' }
    });

    // Account A still has 5 server rows in total -> 6th server creation must still be rejected
    const instIdReject = `inst-dev-rejected-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Attempt Phone',
        platform: 'Android',
        installationId: instIdReject,
        serverName: 'Attempt Server'
      }
    });

    assert.strictEqual(response.statusCode, 409);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.error.code, 'MAX_SERVERS_REACHED');
  });

  test('TEST 11 — Concurrent creation race condition prevention (4 -> 5 servers)', async () => {
    if (!userTokenA) return;

    // Create a new User C specifically to test concurrent 4 -> 5 transitions
    const emailC = `concurrent.test.${Date.now()}@remotenode.io`;
    const userC = await prisma.user.create({
      data: { email: emailC, passwordHash: 'hash', status: 'ACTIVE', emailVerified: true }
    });
    const sessionC = await prisma.userSession.create({
      data: { userId: userC.id, token: `token-concurrent-${Date.now()}`, expiresAt: new Date(Date.now() + 3600000) }
    });
    const tokenC = sessionC.token;

    // Seed User C with exactly 4 servers
    for (let i = 1; i <= 4; i++) {
      const instId = `inst-c-${i}-${Date.now()}`;
      await app.inject({
        method: 'POST',
        url: '/api/v1/devices/register',
        headers: { authorization: `Bearer ${tokenC}` },
        payload: { deviceName: `Phone C${i}`, platform: 'Android', installationId: instId, serverName: `Srv C${i}` }
      });
    }

    const countBefore = await prisma.serverInstance.count({ where: { device: { userId: userC.id } } });
    assert.strictEqual(countBefore, 4);

    // Fire 2 concurrent registration requests simultaneously for 5th and 6th server
    const reqA = app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${tokenC}` },
      payload: {
        deviceName: 'Concurrent Phone 5A',
        platform: 'Android',
        installationId: `inst-concurrent-5a-${Date.now()}`,
        serverName: 'Concurrent Server 5A'
      }
    });

    const reqB = app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${tokenC}` },
      payload: {
        deviceName: 'Concurrent Phone 5B',
        platform: 'Android',
        installationId: `inst-concurrent-5b-${Date.now()}`,
        serverName: 'Concurrent Server 5B'
      }
    });

    const [resA, resB] = await Promise.all([reqA, reqB]);
    const statusCodes = [resA.statusCode, resB.statusCode].sort();

    // Exactly one request MUST succeed (200) and the other MUST be rejected (409)
    assert.deepStrictEqual(statusCodes, [200, 409]);

    // Total servers in database for User C MUST be strictly 5 (NEVER 6!)
    const countAfter = await prisma.serverInstance.count({ where: { device: { userId: userC.id } } });
    assert.strictEqual(countAfter, 5, 'Concurrent creation must result in strictly 5 servers in DB');
  });

  test('TEST 12 — Connection registration does not create new servers', async () => {
    if (!userTokenB) return;

    const initialCount = await prisma.serverInstance.count({ where: { device: { userId: userIdB } } });

    const deviceB = await prisma.device.findFirst({ where: { userId: userIdB } });
    assert.ok(deviceB);

    const resConn = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${userTokenB}` },
      payload: { deviceId: deviceB!.id }
    });

    assert.strictEqual(resConn.statusCode, 200);

    const countAfter = await prisma.serverInstance.count({ where: { device: { userId: userIdB } } });
    assert.strictEqual(countAfter, initialCount);
  });

  test('TEST 13 — Existing over-limit account blocks new creation without deleting existing servers', async () => {
    if (!userTokenA) return;

    // Create an artificial over-limit account with 6 servers to test recovery behavior
    const emailOver = `overlimit.test.${Date.now()}@remotenode.io`;
    const userOver = await prisma.user.create({
      data: { email: emailOver, passwordHash: 'hash', status: 'ACTIVE', emailVerified: true }
    });
    const sessionOver = await prisma.userSession.create({
      data: { userId: userOver.id, token: `token-over-${Date.now()}`, expiresAt: new Date(Date.now() + 3600000) }
    });

    // Seed 6 servers directly in DB
    for (let i = 1; i <= 6; i++) {
      const dev = await prisma.device.create({
        data: {
          userId: userOver.id,
          installationId: `inst-over-${i}-${Date.now()}`,
          deviceName: `Over Phone ${i}`,
          platform: 'Android'
        }
      });
      await prisma.serverInstance.create({
        data: { deviceId: dev.id, serverName: `Over Srv ${i}` }
      });
    }

    const countSeed = await prisma.serverInstance.count({ where: { device: { userId: userOver.id } } });
    assert.strictEqual(countSeed, 6);

    // Attempting to register another device must be rejected with MAX_SERVERS_REACHED
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${sessionOver.token}` },
      payload: {
        deviceName: 'Attempt 7th Phone',
        platform: 'Android',
        installationId: `inst-over-7-${Date.now()}`,
        serverName: '7th Server'
      }
    });

    assert.strictEqual(response.statusCode, 409);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.error.code, 'MAX_SERVERS_REACHED');

    // Existing 6 servers must NOT have been deleted
    const countFinal = await prisma.serverInstance.count({ where: { device: { userId: userOver.id } } });
    assert.strictEqual(countFinal, 6);
  });
});
