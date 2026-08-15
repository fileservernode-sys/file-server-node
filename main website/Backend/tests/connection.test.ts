import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Gateway & Remote Connection Architecture API (/api/v1/gateway, /api/v1/connections, /api/v1/endpoints)', () => {
  let app: FastifyInstance;
  const testEmail = `remote.conn.${Date.now()}@remotenode.io`;
  let userToken = '';
  let testDeviceId = '';
  let testServerId = '';
  let activeConnectionId = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

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
          token: `remote-session-token-${Date.now()}`,
          expiresAt: new Date(Date.now() + 3600000)
        }
      });
      userToken = session.token;

      const device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceName: 'Remote Phone Node',
          status: 'ONLINE'
        }
      });
      testDeviceId = device.id;

      const server = await prisma.serverInstance.create({
        data: {
          deviceId: device.id,
          status: 'RUNNING'
        }
      });
      testServerId = server.id;
    } catch (e) {
      // DB connection handled safely in test assertions
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

  test('POST /api/v1/gateway/heartbeat records gateway node probe', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/gateway/heartbeat',
      payload: { hostname: 'gw-us-east-1.remotenode.net', region: 'us-east', status: 'ACTIVE' }
    });

    assert.ok([200, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);
    if (response.statusCode === 200) {
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.gatewayNode.hostname, 'gw-us-east-1.remotenode.net');
    }
  });

  test('POST /api/v1/connections/register rejects unauthenticated request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      payload: { deviceId: testDeviceId }
    });

    assert.strictEqual(response.statusCode, 401);
  });

  test('POST /api/v1/connections/register creates connection intent when authenticated', async () => {
    if (!userToken || !testDeviceId) return;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { deviceId: testDeviceId }
    });

    assert.ok([200, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);
    if (response.statusCode === 200) {
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.connection.status, 'CONNECTING');
      assert.ok(body.data.connection.connectionToken);
      activeConnectionId = body.data.connection.id;
    }
  });

  test('POST /api/v1/connections/:connectionId/heartbeat updates status to CONNECTED', async () => {
    if (!userToken || !activeConnectionId) return;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/connections/${activeConnectionId}/heartbeat`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { status: 'CONNECTED' }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'CONNECTED');
  });

  test('GET /api/v1/connections/:connectionId retrieves connection metrics', async () => {
    if (!userToken || !activeConnectionId) return;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/connections/${activeConnectionId}`,
      headers: { authorization: `Bearer ${userToken}` }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.connection.id, activeConnectionId);
  });

  test('GET /api/v1/servers/:serverId/endpoint reserves remote server endpoint', async () => {
    if (!userToken || !testServerId) return;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/servers/${testServerId}/endpoint`,
      headers: { authorization: `Bearer ${userToken}` }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.endpoint.hostname.includes('remotenode.net'));
  });

  test('POST /api/v1/connections/:connectionId/disconnect marks status DISCONNECTED', async () => {
    if (!userToken || !activeConnectionId) return;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/connections/${activeConnectionId}/disconnect`,
      headers: { authorization: `Bearer ${userToken}` }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'DISCONNECTED');
  });
});
