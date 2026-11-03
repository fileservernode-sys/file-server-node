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

  test('TEST 9: Logout revokes master session token', async () => {
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
