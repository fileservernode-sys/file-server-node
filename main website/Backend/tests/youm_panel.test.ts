import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashOtp } from '../src/utils/crypto.js';
import { YOUM_PANEL_AUTHORIZED_EMAIL } from '../src/services/youm_panel_service.js';
import { OtpPurpose } from '@prisma/client';

describe('Youm Panel - Master Administrative & Analytics Control Plane', () => {
  let app: FastifyInstance;
  let masterToken = '';
  const fixedTestOtp = '123456';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Ensure master user exists
    let user = await prisma.user.findUnique({
      where: { email: YOUM_PANEL_AUTHORIZED_EMAIL }
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: YOUM_PANEL_AUTHORIZED_EMAIL,
          fullName: 'Youm Master Administrator',
          status: 'ACTIVE',
          emailVerified: true
        }
      });
    }

    // Clean any prior OTPs
    await prisma.emailOtp.deleteMany({
      where: { email: YOUM_PANEL_AUTHORIZED_EMAIL }
    });
  });

  after(async () => {
    if (app) {
      await app.close();
    }
  });

  test('TEST 1: Requesting OTP with unauthorized email is rejected with 403 Forbidden', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/youm-panel/auth/request-otp',
      payload: {
        email: 'intruder@example.com'
      }
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.ok(body.error.message.includes('fileservernode@gmail.com'));
  });

  test('TEST 2: Requesting OTP with fileservernode@gmail.com succeeds with 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/youm-panel/auth/request-otp',
      payload: {
        email: YOUM_PANEL_AUTHORIZED_EMAIL
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.email, YOUM_PANEL_AUTHORIZED_EMAIL);
    assert.ok(body.data.cooldownSeconds > 0);
  });

  test('TEST 3: Verifying with incorrect OTP is rejected with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/youm-panel/auth/verify-otp',
      payload: {
        email: YOUM_PANEL_AUTHORIZED_EMAIL,
        code: '999999'
      }
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
  });

  test('TEST 4: Verifying with valid OTP returns master session token (youm_...)', async () => {
    // Seed known active OTP
    const user = await prisma.user.findUnique({
      where: { email: YOUM_PANEL_AUTHORIZED_EMAIL }
    });
    assert.ok(user);

    await prisma.emailOtp.create({
      data: {
        userId: user.id,
        email: YOUM_PANEL_AUTHORIZED_EMAIL,
        otpCode: hashOtp(fixedTestOtp),
        purpose: OtpPurpose.LOGIN_2FA,
        expiresAt: new Date(Date.now() + 600000),
        attempts: 0,
        used: false
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/youm-panel/auth/verify-otp',
      payload: {
        email: YOUM_PANEL_AUTHORIZED_EMAIL,
        code: fixedTestOtp
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.token.startsWith('youm_'));
    assert.strictEqual(body.data.email, YOUM_PANEL_AUTHORIZED_EMAIL);
    masterToken = body.data.token;
  });

  test('TEST 5: Validating master session token via /auth/me succeeds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/youm-panel/auth/me',
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.authenticated, true);
    assert.strictEqual(body.data.email, YOUM_PANEL_AUTHORIZED_EMAIL);
  });

  test('TEST 6: Accessing analytics without token returns 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/youm-panel/analytics'
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
  });

  test('TEST 7: Accessing analytics with valid master token returns complete analytics payload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/youm-panel/analytics?range=30d&interval=day',
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);

    const data = body.data;
    // Check all required KPI fields
    assert.strictEqual(typeof data.kpis.totalUsers, 'number');
    assert.strictEqual(typeof data.kpis.totalServersCreated, 'number');
    assert.strictEqual(typeof data.kpis.totalServersOnline, 'number');
    assert.strictEqual(typeof data.kpis.totalEmailsSent, 'number');
    assert.strictEqual(typeof data.kpis.totalProMonthlyAccounts, 'number');
    assert.strictEqual(typeof data.kpis.totalProYearlyAccounts, 'number');
    assert.strictEqual(typeof data.kpis.totalActiveFreeAccounts, 'number');
    assert.strictEqual(typeof data.kpis.totalDevicesOnline, 'number');

    // Check timeSeries
    assert.ok(Array.isArray(data.timeSeries));
    assert.ok(data.timeSeries.length > 0);
    const samplePoint = data.timeSeries[0];
    assert.ok('key' in samplePoint);
    assert.ok('label' in samplePoint);
    assert.ok('users' in samplePoint);
    assert.ok('serversCreated' in samplePoint);
    assert.ok('emailsSent' in samplePoint);

    // Check breakdowns
    assert.ok('serverStatus' in data.breakdowns);
    assert.ok('subscriptions' in data.breakdowns);
    assert.ok('emailStatus' in data.breakdowns);

    // Check recent activity lists
    assert.ok(Array.isArray(data.recentActivity.users));
    assert.ok(Array.isArray(data.recentActivity.servers));
    assert.ok(Array.isArray(data.recentActivity.emails));
  });

  test('TEST 8: Switching intervals (daily/hour and 12m/month) adjusts buckets accordingly', async () => {
    const resHourly = await app.inject({
      method: 'GET',
      url: '/api/v1/youm-panel/analytics?range=24h&interval=hour',
      headers: {
        'x-youm-panel-token': masterToken
      }
    });
    assert.strictEqual(resHourly.statusCode, 200);
    const bodyHourly = JSON.parse(resHourly.body);
    assert.strictEqual(bodyHourly.data.filter.interval, 'hour');
    assert.ok(bodyHourly.data.timeSeries.length >= 24);

    const resMonthly = await app.inject({
      method: 'GET',
      url: '/api/v1/youm-panel/analytics?range=12m&interval=month',
      headers: {
        'x-youm-panel-token': masterToken
      }
    });
    assert.strictEqual(resMonthly.statusCode, 200);
    const bodyMonthly = JSON.parse(resMonthly.body);
    assert.strictEqual(bodyMonthly.data.filter.interval, 'month');
    assert.ok(bodyMonthly.data.timeSeries.length >= 12);
  });

  test('TEST 9: Accessing users directory without token returns 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/youm-panel/users'
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
  });

  test('TEST 10: Accessing users directory with valid token returns users, plan details, expiration days, and server specs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/youm-panel/users?page=1&limit=20',
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);

    const data = body.data;
    assert.ok('summary' in data);
    assert.strictEqual(typeof data.summary.totalUsers, 'number');
    assert.strictEqual(typeof data.summary.totalProMonthly, 'number');
    assert.strictEqual(typeof data.summary.totalProYearly, 'number');
    assert.strictEqual(typeof data.summary.totalFree, 'number');
    assert.strictEqual(typeof data.summary.totalServersAcrossAll, 'number');
    assert.strictEqual(typeof data.summary.onlineServersAcrossAll, 'number');

    assert.ok('pagination' in data);
    assert.strictEqual(data.pagination.page, 1);
    assert.ok(data.pagination.totalCount >= 1);

    assert.ok(Array.isArray(data.users));
    assert.ok(data.users.length >= 1);

    const firstUser = data.users[0];
    assert.ok('id' in firstUser);
    assert.ok('email' in firstUser);
    assert.ok('createdAt' in firstUser);
    assert.ok('createdAgoFormatted' in firstUser);

    // Plan & expiration fields
    assert.ok('plan' in firstUser);
    assert.ok('planCode' in firstUser.plan);
    assert.ok('expirationLabel' in firstUser.plan);
    assert.ok('expirationStatus' in firstUser.plan);
    assert.ok('amountFormatted' in firstUser.plan);

    // Servers & devices fields
    assert.ok(Array.isArray(firstUser.servers));
    assert.ok(Array.isArray(firstUser.devices));
    assert.strictEqual(typeof firstUser.totalServersCount, 'number');
    assert.strictEqual(typeof firstUser.onlineServersCount, 'number');
  });

  test('TEST 11: Filtering users directory by search query returns matched subset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/youm-panel/users?search=${encodeURIComponent(YOUM_PANEL_AUTHORIZED_EMAIL)}`,
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.users.some((u: any) => u.email === YOUM_PANEL_AUTHORIZED_EMAIL));
  });

  test('TEST 12: Retrieving deep user details via /users/:id returns complete dossier', async () => {
    // Get master user ID
    const masterUser = await prisma.user.findUnique({
      where: { email: YOUM_PANEL_AUTHORIZED_EMAIL }
    });
    assert.ok(masterUser);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/youm-panel/users/${masterUser.id}`,
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, masterUser.id);
    assert.strictEqual(body.data.email, YOUM_PANEL_AUTHORIZED_EMAIL);
    assert.ok('plan' in body.data);
    assert.ok('servers' in body.data);
    assert.ok('devices' in body.data);
    assert.ok('subscriptionHistory' in body.data);
    assert.ok('invoices' in body.data);
    assert.ok('payments' in body.data);
  });

  test('TEST 14: Master admin can edit user profile, status, plan, and expiration date', async () => {
    // 1. Create a transient test user
    const dummyEmail = `youm_edit_target_${Date.now()}@example.com`;
    const dummyUser = await prisma.user.create({
      data: {
        email: dummyEmail,
        fullName: 'Initial Name',
        passwordHash: 'dummy_hash',
        status: 'PENDING_VERIFICATION',
        emailVerified: false
      }
    });

    const targetExpiration = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 2. Perform admin update via PUT /api/v1/youm-panel/users/:id
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/youm-panel/users/${dummyUser.id}`,
      headers: {
        Authorization: `Bearer ${masterToken}`
      },
      payload: {
        fullName: 'Edited Target Name',
        status: 'ACTIVE',
        emailVerified: true,
        planCode: 'PRO_YEARLY',
        planExpirationDate: targetExpiration
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.id, dummyUser.id);
    assert.strictEqual(body.data.user.fullName, 'Edited Target Name');
    assert.strictEqual(body.data.user.status, 'ACTIVE');
    assert.strictEqual(body.data.user.emailVerified, true);
    assert.strictEqual(body.data.user.plan.planCode, 'PRO_YEARLY');
    assert.ok(body.data.user.plan.daysLeft >= 59);

    // Clean up dummy user if still present
    await prisma.subscription.deleteMany({ where: { userId: dummyUser.id } });
    await prisma.user.delete({ where: { id: dummyUser.id } });
  });

  test('TEST 15: Safety check blocks modifying or deleting master admin fileservernode@gmail.com', async () => {
    const masterUser = await prisma.user.findUnique({
      where: { email: YOUM_PANEL_AUTHORIZED_EMAIL }
    });
    assert.ok(masterUser);

    // 1. Attempt to change master email
    const resEditEmail = await app.inject({
      method: 'PUT',
      url: `/api/v1/youm-panel/users/${masterUser.id}`,
      headers: {
        Authorization: `Bearer ${masterToken}`
      },
      payload: {
        email: 'hijacked_master@example.com'
      }
    });
    assert.strictEqual(resEditEmail.statusCode, 403);
    const editErr = JSON.parse(resEditEmail.body);
    assert.strictEqual(editErr.success, false);
    assert.strictEqual(editErr.error.code, 'FORBIDDEN');

    // 2. Attempt to delete master user
    const resDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/youm-panel/users/${masterUser.id}`,
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });
    assert.strictEqual(resDelete.statusCode, 403);
    const delErr = JSON.parse(resDelete.body);
    assert.strictEqual(delErr.success, false);
    assert.strictEqual(delErr.error.code, 'FORBIDDEN');
  });

  test('TEST 16: Master admin can permanently delete a user and cascade their cluster resources', async () => {
    // 1. Create a dummy user with server and device
    const delEmail = `youm_delete_target_${Date.now()}@example.com`;
    const targetUser = await prisma.user.create({
      data: {
        email: delEmail,
        fullName: 'To Be Deleted',
        passwordHash: 'dummy_hash',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    const testDevice = await prisma.device.create({
      data: {
        userId: targetUser.id,
        deviceName: 'Test Pixel 8 Pro',
        installationId: `inst_${Date.now()}`,
        platform: 'Android',
        osVersion: 'Android 14',
        appVersion: '1.0.0'
      }
    });

    await prisma.serverInstance.create({
      data: {
        deviceId: testDevice.id,
        serverName: `del-server-${Date.now()}`,
        status: 'STOPPED'
      }
    });

    // 2. Call DELETE /api/v1/youm-panel/users/:id
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/youm-panel/users/${targetUser.id}`,
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);

    // 3. Verify user is removed from database
    const userInDb = await prisma.user.findUnique({
      where: { id: targetUser.id }
    });
    assert.strictEqual(userInDb, null);

    // 4. Verify GET /users/:id returns 404
    const resCheck = await app.inject({
      method: 'GET',
      url: `/api/v1/youm-panel/users/${targetUser.id}`,
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });
    assert.strictEqual(resCheck.statusCode, 404);
  });

  test('TEST 17: Logout revokes master session token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/youm-panel/auth/logout',
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);

    // Subsequent access fails
    const resMe = await app.inject({
      method: 'GET',
      url: '/api/v1/youm-panel/auth/me',
      headers: {
        Authorization: `Bearer ${masterToken}`
      }
    });
    assert.strictEqual(resMe.statusCode, 401);
  });
});
