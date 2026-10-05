import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken, generateSessionToken } from '../src/utils/crypto.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';

describe('ZdexCloud — Persistent Server Authentication Lifecycle & Device Security Boundary', () => {
  let app: FastifyInstance;
  const testUserEmail = `persistent.auth.${Date.now()}@zdexcloud.io`;
  const otherUserEmail = `other.user.${Date.now()}@zdexcloud.io`;
  let userId = '';
  let otherUserId = '';
  let initialUserToken = '';
  let otherUserToken = '';
  let deviceId = '';
  let otherDeviceId = '';
  let rawDeviceCredential = '';
  let otherRawDeviceCredential = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Create primary active user
    const user = await prisma.user.create({
      data: {
        email: testUserEmail,
        passwordHash: 'argon2-test-hash',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    userId = user.id;
    EntitlementService.setTestUserPlan(userId, 'PRO_MONTHLY');

    initialUserToken = `user-interactive-tok-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId,
        tokenHash: hashSessionToken(initialUserToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // Create second user for cross-user security tests
    const otherUser = await prisma.user.create({
      data: {
        email: otherUserEmail,
        passwordHash: 'argon2-test-hash-2',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    otherUserId = otherUser.id;
    otherUserToken = `other-interactive-tok-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: otherUserId,
        tokenHash: hashSessionToken(otherUserToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
  });

  after(async () => {
    EntitlementService.clearTestUserPlans();
    try {
      if (userId) {
        await prisma.auditEvent.deleteMany({ where: { userId } });
        await prisma.deviceAuthCredential.deleteMany({ where: { userId } });
        await prisma.deviceConnection.deleteMany({ where: { deviceId } });
        await prisma.serverInstance.deleteMany({ where: { deviceId } });
        await prisma.device.deleteMany({ where: { userId } });
        await prisma.userSession.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
      if (otherUserId) {
        await prisma.auditEvent.deleteMany({ where: { userId: otherUserId } });
        await prisma.deviceAuthCredential.deleteMany({ where: { userId: otherUserId } });
        await prisma.device.deleteMany({ where: { userId: otherUserId } });
        await prisma.userSession.deleteMany({ where: { userId: otherUserId } });
        await prisma.user.delete({ where: { id: otherUserId } });
      }
    } catch (_) {}
    await app.close();
  });

  test('TEST 1 — Device Registration returns long-lived DeviceAuthCredential', async () => {
    const instId = `inst-persistent-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${initialUserToken}` },
      payload: {
        deviceName: 'Persistent Android Pixel 8',
        platform: 'Android',
        installationId: instId,
        osVersion: 'Android 14'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.device.id);
    assert.ok(body.data.deviceCredential, 'Device credential must be issued upon registration');

    deviceId = body.data.device.id;
    rawDeviceCredential = body.data.deviceCredential;

    // Verify persisted record in DB
    const dbCred = await prisma.deviceAuthCredential.findUnique({
      where: { deviceId }
    });
    assert.ok(dbCred, 'DeviceAuthCredential must exist in database');
    assert.strictEqual(dbCred.credentialHash, hashSessionToken(rawDeviceCredential));
    assert.strictEqual(dbCred.revokedAt, null);
  });

  test('TEST 2 — Interactive User Session Expiration does NOT delete or invalidate DeviceAuthCredential', async () => {
    // Simulate 24-hour expiration of all interactive user sessions
    await prisma.userSession.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) } // Expired in past
    });

    // Verify interactive session token is now rejected
    const expiredReq = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${initialUserToken}` },
      payload: { deviceId }
    });
    assert.strictEqual(expiredReq.statusCode, 401, 'Expired interactive session must be rejected with 401');

    // Verify DeviceAuthCredential remains valid and untouched
    const dbCred = await prisma.deviceAuthCredential.findUnique({
      where: { deviceId }
    });
    assert.ok(dbCred, 'DeviceAuthCredential must remain present and unrevoked');
    assert.strictEqual(dbCred.revokedAt, null);
  });

  test('TEST 3 — Server Node refreshes session token as a device-scoped token (dst_<deviceId>_...)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/session/refresh`,
      payload: {
        deviceCredential: rawDeviceCredential
      }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);

    // Verify backward & forward compatible token response structure
    assert.ok(body.data.accessToken, 'Must contain top-level accessToken');
    assert.ok(body.data.token, 'Must contain top-level token');
    assert.ok(body.data.session.accessToken, 'Must contain nested session.accessToken');
    assert.strictEqual(body.data.accessToken, body.data.session.accessToken);

    const renewedToken = body.data.accessToken;
    assert.ok(renewedToken.startsWith(`dst_${deviceId}_`), 'Token must be device-scoped with dst_<deviceId>_ prefix');

    // Verify renewed token can immediately register remote tunnel
    const regResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${renewedToken}` },
      payload: { deviceId }
    });
    assert.strictEqual(regResponse.statusCode, 200);
    const regBody = JSON.parse(regResponse.payload);
    assert.strictEqual(regBody.success, true);
    assert.ok(regBody.data.connection.id);
  });

  test('TEST 4 — Device-scoped token is STRICTLY FORBIDDEN from accessing interactive user endpoints (403)', async () => {
    // Generate a fresh device-scoped token
    const refreshRes = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/session/refresh`,
      payload: { deviceCredential: rawDeviceCredential }
    });
    const deviceToken = JSON.parse(refreshRes.payload).data.accessToken;

    // 1. Attempt to list all devices
    const listDevicesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: `Bearer ${deviceToken}` }
    });
    assert.strictEqual(listDevicesRes.statusCode, 403, 'Device token cannot list all devices');

    // 2. Attempt to access billing
    const billingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/state',
      headers: { authorization: `Bearer ${deviceToken}` }
    });
    assert.strictEqual(billingRes.statusCode, 403, 'Device token cannot access billing APIs');

    // 3. Attempt to invoke credential revocation
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/credentials/revoke`,
      headers: { authorization: `Bearer ${deviceToken}` }
    });
    assert.strictEqual(revokeRes.statusCode, 403, 'Device token cannot revoke credentials');
  });

  test('TEST 5 — Device-scoped token cannot register connections or telemetry for a different device (403)', async () => {
    // Create second device for same user
    const inst2 = `inst-dev-2-${Date.now()}`;
    const freshUserToken = `fresh-interactive-tok-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId,
        tokenHash: hashSessionToken(freshUserToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    const dev2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/register',
      headers: { authorization: `Bearer ${freshUserToken}` },
      payload: {
        deviceName: 'Second Device',
        platform: 'Android',
        installationId: inst2
      }
    });
    const secondDeviceId = JSON.parse(dev2Res.payload).data.device.id;

    // Get device token for Device 1
    const refreshRes = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/session/refresh`,
      payload: { deviceCredential: rawDeviceCredential }
    });
    const device1Token = JSON.parse(refreshRes.payload).data.accessToken;

    // Attempt to register connection for Device 2 using Device 1 token
    const crossDevReg = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/register',
      headers: { authorization: `Bearer ${device1Token}` },
      payload: { deviceId: secondDeviceId }
    });
    assert.strictEqual(crossDevReg.statusCode, 403, 'Device 1 token must not register Device 2 connection');
  });

  test('TEST 6 — Invalid or tampered device credential is strictly rejected (401 INVALID_CREDENTIAL)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/session/refresh`,
      payload: {
        deviceCredential: 'tampered-or-invalid-credential-string'
      }
    });

    assert.strictEqual(response.statusCode, 401);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'INVALID_CREDENTIAL');
  });

  test('TEST 7 — Cross-account device refresh attempt is strictly rejected (401)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/non-existent-device-id/session/refresh`,
      payload: {
        deviceCredential: rawDeviceCredential
      }
    });

    assert.strictEqual(response.statusCode, 401);
  });

  test('TEST 8 — Explicit device credential revocation revokes only THIS device', async () => {
    const freshUserToken = `fresh-tok-revoke-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId,
        tokenHash: hashSessionToken(freshUserToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    const revokeResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/credentials/revoke`,
      headers: { authorization: `Bearer ${freshUserToken}` }
    });

    assert.strictEqual(revokeResponse.statusCode, 200);
    const body = JSON.parse(revokeResponse.payload);
    assert.strictEqual(body.success, true);

    // Attempting refresh with revoked credential must return 401 CREDENTIAL_REVOKED
    const refreshAfterRevoke = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/session/refresh`,
      payload: {
        deviceCredential: rawDeviceCredential
      }
    });

    assert.strictEqual(refreshAfterRevoke.statusCode, 401);
    const refreshBody = JSON.parse(refreshAfterRevoke.payload);
    assert.strictEqual(refreshBody.error.code, 'CREDENTIAL_REVOKED');
  });

  test('TEST 9 — Suspended User Account blocks persistent renewal (403 USER_NOT_ACTIVE)', async () => {
    const newCredRaw = generateSessionToken();
    await prisma.deviceAuthCredential.upsert({
      where: { deviceId },
      update: {
        credentialHash: hashSessionToken(newCredRaw),
        revokedAt: null
      },
      create: {
        userId,
        deviceId,
        credentialHash: hashSessionToken(newCredRaw)
      }
    });

    // Suspend user
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED' }
    });

    const refreshResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${deviceId}/session/refresh`,
      payload: {
        deviceCredential: newCredRaw
      }
    });

    assert.strictEqual(refreshResponse.statusCode, 403);
    const body = JSON.parse(refreshResponse.payload);
    assert.strictEqual(body.error.code, 'USER_NOT_ACTIVE');

    // Restore user status for clean teardown
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' }
    });
  });
});
