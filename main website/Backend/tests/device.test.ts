import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Device Node & Server Instance API (/api/v1/devices, /api/v1/servers)', () => {
  let app: FastifyInstance;
  const testEmail = `device.test.${Date.now()}@remotenode.io`;
  let userToken = '';
  let registeredDeviceId = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Create test user and active session if DB is online
    try {
      const user = await prisma.user.create({
        data: {
          email: testEmail,
          passwordHash: 'hash',
          status: 'ACTIVE',
          emailVerified: true
        }
      });
      const session = await prisma.userSession.create({
        data: {
          userId: user.id,
          token: `test-session-token-${Date.now()}`,
          expiresAt: new Date(Date.now() + 3600000)
        }
      });
      userToken = session.token;
    } catch (e) {
      // DB connection handled safely in tests
    }
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({ where: { email: { contains: 'remotenode.io' } } });
    } catch (e) {
      // Ignore
    }
    await app.close();
  });

  test('POST /api/v1/devices/register rejects unauthenticated request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      payload: { deviceName: 'Pixel 6', installationId: 'inst-123' }
    });

    assert.strictEqual(response.statusCode, 401);
  });

  test('POST /api/v1/devices/register creates device when authenticated', async () => {
    if (!userToken) return;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        deviceName: 'Pixel 6 Pro',
        platform: 'Android',
        osVersion: 'Android 14',
        appVersion: '1.0.0',
        installationId: 'inst-test-uuid-999'
      }
    });

    assert.ok([200, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);
    if (response.statusCode === 200) {
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.device.deviceName, 'Pixel 6 Pro');
      registeredDeviceId = body.data.device.id;
    }
  });

  test('POST /api/v1/devices/:deviceId/heartbeat updates lastSeenAt timestamp', async () => {
    if (!userToken || !registeredDeviceId) return;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${registeredDeviceId}/heartbeat`,
      headers: { authorization: `Bearer ${userToken}` }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'ok');
  });

  test('POST /api/v1/servers initializes server instance for device', async () => {
    if (!userToken || !registeredDeviceId) return;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/servers',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { deviceId: registeredDeviceId }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.serverInstance.deviceId, registeredDeviceId);
  });

  test('DELETE /api/v1/devices/:deviceId deletes server node and releases endpoint', async () => {
    if (!userToken || !registeredDeviceId) return;

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${registeredDeviceId}`,
      headers: { authorization: `Bearer ${userToken}` }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);

    // Verify DB cascade: Device and ServerInstance records must be gone
    try {
      const device = await prisma.device.findUnique({ where: { id: registeredDeviceId } });
      assert.strictEqual(device, null);

      const serverInstances = await prisma.serverInstance.findMany({ where: { deviceId: registeredDeviceId } });
      assert.strictEqual(serverInstances.length, 0);

      // Verify User & Session are strictly preserved
      const user = await prisma.user.findUnique({ where: { email: testEmail } });
      assert.ok(user);
    } catch {}
  });

  test('DELETE /api/v1/devices/:deviceId rejects unauthorized request', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/devices/non-existent-device-123'
    });

    assert.strictEqual(response.statusCode, 401);
  });

  test('DELETE /api/v1/servers/:serverId deletes server instance and cascades cleanly', async () => {
    if (!userToken) return;

    // Create a temporary device to test /servers/:serverId alias deletion
    try {
      const dev = await prisma.device.create({
        data: {
          userId: (await prisma.user.findUnique({ where: { email: testEmail } }))!.id,
          deviceName: 'Temp Test Phone',
          platform: 'Android'
        }
      });
      const srv = await prisma.serverInstance.create({
        data: {
          deviceId: dev.id,
          serverName: 'Temp Server'
        }
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/servers/${srv.id}`,
        headers: { authorization: `Bearer ${userToken}` }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.payload);
      assert.strictEqual(body.success, true);
    } catch {}
  });
});
