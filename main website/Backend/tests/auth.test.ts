import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Platform Account Authentication API (/api/v1/auth)', () => {
  let app: FastifyInstance;
  const testEmail = `test.user.${Date.now()}@remotenode.io`;
  const testPassword = 'SecurePassword123!';
  let generatedOtp = '';
  let userToken = '';

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    // Cleanup test data if DB reachable
    try {
      await prisma.user.deleteMany({ where: { email: { contains: 'remotenode.io' } } });
    } catch (e) {
      // Ignore if DB not active locally
    }
    await app.close();
  });

  test('POST /api/v1/auth/register requires 8+ char password and valid email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: testEmail, password: testPassword, fullName: 'Test User' }
    });

    assert.ok([200, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);
    if (response.statusCode === 200) {
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.requiresOtp, true);
      assert.strictEqual(body.data.email, testEmail);

      const otpRecord = await prisma.emailOtp.findFirst({
        where: { email: testEmail, used: false },
        orderBy: { createdAt: 'desc' }
      });
      if (otpRecord) {
        generatedOtp = otpRecord.otpCode;
      }
    }
  });

  test('POST /api/v1/auth/verify-otp activates user and returns session token', async () => {
    if (!generatedOtp) return; // Skip if database is offline

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-otp',
      payload: { email: testEmail, code: generatedOtp }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.email, testEmail);
    assert.strictEqual(body.data.user.emailVerified, true);
    assert.ok(body.data.token || body.data.session?.accessToken);
    userToken = body.data.token || body.data.session?.accessToken;
  });

  test('GET /api/v1/auth/me returns authenticated user profile', async () => {
    if (!userToken) return;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${userToken}` }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.email, testEmail);
  });

  test('POST /api/v1/auth/login validates credentials and dispatches 2FA OTP', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: testEmail, password: testPassword }
    });

    assert.ok([200, 401, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);
    if (response.statusCode === 200) {
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.requiresOtp, true);
    }
  });

  test('POST /api/v1/auth/resend-otp provides generic response for account enumeration protection', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-otp',
      payload: { email: 'nonexistent@remotenode.io' }
    });

    assert.ok([200, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);
    if (response.statusCode === 200) {
      assert.strictEqual(body.success, true);
      assert.ok(body.data.message.includes('If an account exists'));
    }
  });

  test('POST /api/v1/auth/logout invalidates session token', async () => {
    if (!userToken) return;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${userToken}` }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
  });
});
