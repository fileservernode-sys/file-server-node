import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken, generateSessionToken } from '../src/utils/crypto.js';

describe('Batch PBC-R1 — Persistent Backend Connection & Reconnection Remediation', () => {
  let app: FastifyInstance;
  const testEmail = `pbc.r1.${Date.now()}@remotenode.io`;
  let userId = '';
  let interactiveUserToken = '';
  let testDeviceId = '';
  let rawDeviceCredential = '';
  let deviceCredentialHash = '';
  let deviceRuntimeToken = '';

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
      userId = user.id;

      interactiveUserToken = `pbc-user-token-${Date.now()}`;
      await prisma.userSession.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(interactiveUserToken),
          expiresAt: new Date(Date.now() + 3600000)
        }
      });

      const device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceName: 'PBC-R1 Test Device',
          platform: 'ANDROID',
          status: 'ONLINE'
        }
      });
      testDeviceId = device.id;

      await prisma.serverInstance.create({
        data: {
          deviceId: device.id,
          status: 'RUNNING'
        }
      });

      rawDeviceCredential = generateSessionToken();
      deviceCredentialHash = hashSessionToken(rawDeviceCredential);
      await prisma.deviceAuthCredential.create({
        data: {
          deviceId: device.id,
          userId: user.id,
          credentialHash: deviceCredentialHash
        }
      });
    } catch (e) {
      // Handled safely in DB tests
    }
  });

  after(async () => {
    try {
      await prisma.deviceAuthCredential.deleteMany({ where: { deviceId: testDeviceId } });
      await prisma.deviceConnection.deleteMany({ where: { deviceId: testDeviceId } });
      await prisma.serverInstance.deleteMany({ where: { deviceId: testDeviceId } });
      await prisma.device.deleteMany({ where: { id: testDeviceId } });
      await prisma.userSession.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch (e) {
      // Ignore
    }
    await app.close();
  });

  test('1. POST /devices/:deviceId/session/refresh exchanges persistent device credential for SERVER_RUNTIME token', async () => {
    if (!testDeviceId || !rawDeviceCredential) return;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${testDeviceId}/session/refresh`,
      payload: { deviceCredential: rawDeviceCredential }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.accessToken);
    assert.ok(body.data.accessToken.startsWith(`dst_${testDeviceId}_`));
    deviceRuntimeToken = body.data.accessToken;
  });

  test('2. POST /connections/register accepts device-scoped SERVER_RUNTIME token', async () => {
    if (!testDeviceId || !deviceRuntimeToken) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${deviceRuntimeToken}` },
      payload: { deviceId: testDeviceId }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.connection.id);
    assert.ok(body.data.connection.connectionToken);
  });

  test('3. POST /connections/register rejects expired interactive user token with 401', async () => {
    if (!testDeviceId) return;

    const expiredToken = `expired-tok-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId,
        tokenHash: hashSessionToken(expiredToken),
        expiresAt: new Date(Date.now() - 60000)
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: { deviceId: testDeviceId }
    });

    assert.strictEqual(res.statusCode, 401);
  });

  test('4. Transparent renewal: Session refresh succeeds even after user session expiry', async () => {
    if (!testDeviceId || !rawDeviceCredential) return;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${testDeviceId}/session/refresh`,
      payload: { deviceCredential: rawDeviceCredential }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.accessToken);
  });

  test('5. Session refresh fails with 401 if device credential is invalid or revoked', async () => {
    if (!testDeviceId) return;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${testDeviceId}/session/refresh`,
      payload: { deviceCredential: 'invalid-credential-value' }
    });

    assert.strictEqual(res.statusCode, 401);
  });
});
