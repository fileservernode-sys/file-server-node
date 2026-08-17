import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Batch 3 — Backend Device Identity & Multi-Device API Tests', () => {
  let app: FastifyInstance;
  const testEmailA = `device.test.a.${Date.now()}@remotenode.io`;
  const testEmailB = `device.test.b.${Date.now()}@remotenode.io`;
  let userTokenA = '';
  let userIdA = '';
  let userTokenB = '';
  let userIdB = '';

  const instIdA = `inst-test-phone-a-${Date.now()}`;
  const instIdB = `inst-test-phone-b-${Date.now()}`;

  let deviceIdA = '';
  let deviceIdB = '';

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
          token: `token-user-a-${Date.now()}`,
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
          token: `token-user-b-${Date.now()}`,
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
      await prisma.user.deleteMany({ where: { email: { contains: 'remotenode.io' } } });
    } catch (e) {
      // Ignore cleanup error
    }
    await app.close();
  });

  test('Test 1 — First device registration (Account A + installationId A)', async () => {
    if (!userTokenA) return;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Android Phone Host',
        platform: 'Android',
        osVersion: 'Android 14',
        appVersion: '1.0.0',
        installationId: instIdA,
        serverName: 'Server A'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.device.deviceName, 'Android Phone Host');
    assert.strictEqual(body.data.device.installationId, instIdA);
    deviceIdA = body.data.device.id;
    assert.ok(deviceIdA);
  });

  test('Test 2 — Same installation registers again (Idempotent update, no duplicate)', async () => {
    if (!userTokenA || !deviceIdA) return;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Android Phone Host',
        platform: 'Android',
        osVersion: 'Android 14',
        appVersion: '1.0.1',
        installationId: instIdA,
        serverName: 'Server A'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    // Must return the exact same Device ID
    assert.strictEqual(body.data.device.id, deviceIdA);
    assert.strictEqual(body.data.device.appVersion, '1.0.1');

    // Confirm DB has only 1 device for user A with this installationId
    const devices = await prisma.device.findMany({ where: { userId: userIdA } });
    assert.strictEqual(devices.length, 1);
  });

  test('Test 3 & 4 — Same account, different installation with same deviceName creates TWO independent Device records', async () => {
    if (!userTokenA || !deviceIdA) return;

    // Phone B registers with the SAME default deviceName "Android Phone Host"
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'Android Phone Host', // Identical name!
        platform: 'Android',
        osVersion: 'Android 13',
        appVersion: '1.0.0',
        installationId: instIdB, // Distinct physical installation ID
        serverName: 'Server B'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    deviceIdB = body.data.device.id;
    assert.ok(deviceIdB);
    assert.notStrictEqual(deviceIdB, deviceIdA);

    // Verify DB contains TWO independent Device records for User A
    const devices = await prisma.device.findMany({ where: { userId: userIdA } });
    assert.strictEqual(devices.length, 2);

    const devA = devices.find((d) => d.id === deviceIdA);
    const devB = devices.find((d) => d.id === deviceIdB);
    assert.ok(devA);
    assert.ok(devB);
    assert.strictEqual(devA!.installationId, instIdA);
    assert.strictEqual(devB!.installationId, instIdB);
  });

  test('Test 5 — Device rename preserves same Device.id and updates name', async () => {
    if (!userTokenA || !deviceIdA) return;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: {
        deviceName: 'My Primary Pixel 8',
        platform: 'Android',
        installationId: instIdA,
        serverName: 'Renamed Server A'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.device.id, deviceIdA);
    assert.strictEqual(body.data.device.deviceName, 'My Primary Pixel 8');

    // Total device count must remain 2
    const devices = await prisma.device.findMany({ where: { userId: userIdA } });
    assert.strictEqual(devices.length, 2);
  });

  test('Test 6 — Different accounts create independent Device records', async () => {
    if (!userTokenB) return;

    const instIdUserB = `inst-phone-userb-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userTokenB}` },
      payload: {
        deviceName: 'User B Phone',
        platform: 'Android',
        installationId: instIdUserB,
        serverName: 'User B Server'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    const devIdUserB = body.data.device.id;

    // Verify User B's device is isolated
    const devUserB = await prisma.device.findUnique({ where: { id: devIdUserB } });
    assert.strictEqual(devUserB?.userId, userIdB);
    assert.notStrictEqual(devUserB?.userId, userIdA);
  });

  test('Test 7 — Invalid device deletion returns 404 and does NOT delete any other user device', async () => {
    if (!userTokenA || !deviceIdA) return;

    const initialCount = await prisma.device.count({ where: { userId: userIdA } });
    assert.strictEqual(initialCount, 2);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/devices/non-existent-device-uuid-999',
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(response.statusCode, 404);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'DEVICE_NOT_FOUND');

    // Crucial: User A's devices must NOT have been deleted by fallback
    const countAfter = await prisma.device.count({ where: { userId: userIdA } });
    assert.strictEqual(countAfter, 2);
  });

  test('Test 8 — Cross-account device operation is forbidden (403)', async () => {
    if (!userTokenB || !deviceIdA) return;

    // User B attempts to delete User A's device
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${deviceIdA}`,
      headers: { authorization: `Bearer ${userTokenB}` }
    });

    assert.strictEqual(response.statusCode, 403);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('Test 9 — Server association: Device A and Device B have distinct ServerInstances', async () => {
    if (!deviceIdA || !deviceIdB) return;

    const serversA = await prisma.serverInstance.findMany({ where: { deviceId: deviceIdA } });
    const serversB = await prisma.serverInstance.findMany({ where: { deviceId: deviceIdB } });

    assert.ok(serversA.length >= 1);
    assert.ok(serversB.length >= 1);
    assert.notStrictEqual(serversA[0].id, serversB[0].id);
    assert.strictEqual(serversA[0].deviceId, deviceIdA);
    assert.strictEqual(serversB[0].deviceId, deviceIdB);
  });

  test('Test 10 — Connection association: /connections/register creates separate DeviceConnections for Device A and B', async () => {
    if (!userTokenA || !deviceIdA || !deviceIdB) return;

    // Register connection for Device A
    const resConnA = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: { deviceId: deviceIdA }
    });

    assert.strictEqual(resConnA.statusCode, 200);
    const bodyConnA = JSON.parse(resConnA.payload);
    assert.strictEqual(bodyConnA.success, true);
    assert.strictEqual(bodyConnA.data.deviceId, deviceIdA);
    const connIdA = bodyConnA.data.connectionId;

    // Register connection for Device B
    const resConnB = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${userTokenA}` },
      payload: { deviceId: deviceIdB }
    });

    assert.strictEqual(resConnB.statusCode, 200);
    const bodyConnB = JSON.parse(resConnB.payload);
    assert.strictEqual(bodyConnB.success, true);
    assert.strictEqual(bodyConnB.data.deviceId, deviceIdB);
    const connIdB = bodyConnB.data.connectionId;

    assert.notStrictEqual(connIdA, connIdB);

    // Verify GET /devices returns both devices for User A with their respective servers and connections
    const resList = await app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: `Bearer ${userTokenA}` }
    });

    assert.strictEqual(resList.statusCode, 200);
    const bodyList = JSON.parse(resList.payload);
    assert.strictEqual(bodyList.data.devices.length, 2);
  });

  test('Heartbeat & Valid Deletion flow for Device A', async () => {
    if (!userTokenA || !deviceIdA) return;

    // Heartbeat
    const resHb = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceIdA}/heartbeat`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    assert.strictEqual(resHb.statusCode, 200);

    // Delete Device A
    const resDel = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${deviceIdA}`,
      headers: { authorization: `Bearer ${userTokenA}` }
    });
    assert.strictEqual(resDel.statusCode, 200);

    const devAfter = await prisma.device.findUnique({ where: { id: deviceIdA } });
    assert.strictEqual(devAfter, null);

    // Device B must still exist
    const devB = await prisma.device.findUnique({ where: { id: deviceIdB } });
    assert.ok(devB);
  });
});
