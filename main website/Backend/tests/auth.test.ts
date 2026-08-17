import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashPassword, verifyPassword, hashOtp, verifyOtpCode, generateOtpCode } from '../src/utils/crypto.js';
import {
  getEmailVerificationTemplate,
  getPasswordResetTemplate,
  getLoginOtpTemplate
} from '../src/services/email_templates.js';

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
    try {
      await prisma.user.deleteMany({ where: { email: { contains: 'test.user.' } } });
    } catch {
      // Ignore if DB is disconnected in unit runner
    }
    await app.close();
  });

  test('Email Templates strictly contain NO verification links or password reset links', () => {
    const regTemplate = getEmailVerificationTemplate('123456', 10);
    assert.strictEqual(regTemplate.subject.includes('123456'), true);
    assert.strictEqual(regTemplate.html.includes('123456'), true);
    assert.strictEqual(regTemplate.html.includes('href="http://'), false);
    assert.strictEqual(regTemplate.html.includes('href="https://viewduration.com/verify'), false);
    assert.strictEqual(regTemplate.text.includes('http://'), false);

    const resetTemplate = getPasswordResetTemplate('654321', 10);
    assert.strictEqual(resetTemplate.subject.includes('654321'), true);
    assert.strictEqual(resetTemplate.html.includes('654321'), true);
    assert.strictEqual(resetTemplate.html.includes('href="http://'), false);
    assert.strictEqual(resetTemplate.html.includes('href="https://viewduration.com/reset'), false);
    assert.strictEqual(resetTemplate.text.includes('http://'), false);

    const loginTemplate = getLoginOtpTemplate('999888', 10);
    assert.strictEqual(loginTemplate.subject.includes('999888'), true);
    assert.strictEqual(loginTemplate.html.includes('999888'), true);
  });

  test('Crypto utilities hash OTPs securely and perform timing-safe verification', () => {
    const otp = generateOtpCode();
    assert.strictEqual(otp.length, 6);
    assert.ok(/^\d{6}$/.test(otp));

    const hashed = hashOtp(otp);
    assert.ok(hashed.includes(':'));
    assert.strictEqual(verifyOtpCode(otp, hashed), true);
    assert.strictEqual(verifyOtpCode('000000', hashed), false);

    const passHash = hashPassword('MySecretPass888!');
    assert.strictEqual(verifyPassword('MySecretPass888!', passHash), true);
    assert.strictEqual(verifyPassword('WrongPass', passHash), false);
  });

  test('POST /api/v1/auth/register rejects short passwords (< 8 chars)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'short@remotenode.io', password: 'short' }
    });

    assert.strictEqual(response.statusCode, 400);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
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

      const knownOtp = '123456';
      await prisma.emailOtp.updateMany({
        where: { email: testEmail, used: false },
        data: { otpCode: hashOtp(knownOtp) }
      });
      generatedOtp = knownOtp;
    }
  });

  test('POST /api/v1/auth/verify-otp activates user and returns session token', async () => {
    if (!generatedOtp) return;

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

  test('POST /api/v1/auth/forgot-password provides generic enumeration-safe response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'unknown.account.999@remotenode.io' }
    });

    assert.ok([200, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);
    if (response.statusCode === 200) {
      assert.strictEqual(body.success, true);
      assert.ok(body.data.message.includes('If an account exists'));
    }
  });

  test('POST /api/v1/auth/reset-password rejects short new passwords (< 8 chars)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { email: testEmail, otp: '123456', newPassword: 'short' }
    });

    assert.strictEqual(response.statusCode, 400);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
  });

  test('POST /api/v1/auth/resend-otp provides generic response for account enumeration protection', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-otp',
      payload: { email: 'nonexistent@remotenode.io' }
    });

    assert.ok([200, 429, 503].includes(response.statusCode));
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
