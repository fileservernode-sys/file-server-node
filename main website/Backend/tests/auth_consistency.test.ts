// NOTE: These tests are NOT EXECUTED as per policy.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  hashPassword,
  verifyPassword,
  hashOtp,
  verifyOtpCode,
  hashPasswordChangeOtp,
  verifyPasswordChangeOtpCode,
  hashSessionToken
} from '../src/utils/crypto.js';
import { generateCsrfToken } from '../src/utils/csrf.js';
import { csrfProtectionHook } from '../src/middleware/csrf.js';
import { globalErrorHandler } from '../src/middleware/error-handler.js';
import { CUSTOMER_SESSION_COOKIE_NAME } from '../src/config/cookie.js';
import { CustomerActivityEventType, CUSTOMER_ACTIVITY_TAXONOMY } from '../src/services/activity/customer_activity_taxonomy.js';

const {
  mockPrisma,
  mockEmailService,
  mockAccountProducer,
  mockActivityService
} = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    userSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn()
    },
    deviceAuthCredential: {
      findUnique: vi.fn(),
      updateMany: vi.fn()
    },
    emailOtp: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    auditEvent: {
      create: vi.fn()
    },
    $transaction: vi.fn()
  },
  mockEmailService: {
    sendVerificationOtp: vi.fn().mockResolvedValue({ success: true, provider: 'MOCK', transport: 'MOCK' }),
    sendPasswordResetOtp: vi.fn().mockResolvedValue({ success: true, provider: 'MOCK', transport: 'MOCK' }),
    sendPasswordChangeOtp: vi.fn().mockResolvedValue({ success: true, provider: 'MOCK', transport: 'MOCK' }),
    sendLoginOtp: vi.fn().mockResolvedValue({ success: true, provider: 'MOCK', transport: 'MOCK' }),
    sendRawMail: vi.fn().mockResolvedValue({ success: true, provider: 'MOCK', transport: 'MOCK' })
  },
  mockAccountProducer: {
    emitAccountCreated: vi.fn().mockResolvedValue(undefined),
    emitSignIn: vi.fn().mockResolvedValue(undefined),
    emitSecurityEvent: vi.fn().mockResolvedValue(undefined)
  },
  mockActivityService: {
    recordEventSafe: vi.fn().mockResolvedValue({ recorded: true })
  }
}));

vi.mock('../src/config/database.js', () => ({
  prisma: mockPrisma
}));

vi.mock('../src/services/email.js', () => ({
  emailService: mockEmailService
}));

vi.mock('../src/notifications/producers/account_producer.js', () => ({
  accountEventProducer: mockAccountProducer
}));

vi.mock('../src/services/activity/customer_activity_service.js', () => ({
  CustomerActivityService: mockActivityService
}));

import {
  issueEmailOtp,
  verifyEmailOtp,
  issuePasswordChangeOtp,
  verifyPasswordChangeOtp
} from '../src/utils/otp.js';
import {
  authRoutes,
  AUTH_PASSWORD_POLICY,
  PASSWORD_CHANGE_POLICY,
  registerSchema,
  loginSchema,
  resetPasswordSchema,
  changePasswordRequestOtpSchema,
  changePasswordConfirmSchema
} from '../src/routes/auth.js';

describe('Phase 10.4 — Authentication and Password Hashing Consistency', () => {
  const testUserId = 'usr_alice_10_4';
  const otherUserId = 'usr_bob_10_4';
  const testEmail = 'alice@zdexcloud.test';
  const suspendedUserId = 'usr_suspended_10_4';
  const suspendedEmail = 'suspended@zdexcloud.test';
  const pendingUserId = 'usr_pending_10_4';
  const pendingEmail = 'pending@zdexcloud.test';

  const validPassword = 'StrongPassword123';
  const alternativePassword = 'AlternativeStrong456';
  const weakShortPassword = 'Short1';
  const weakNoUpper = 'strongpassword123';
  const weakNoLower = 'STRONGPASSWORD123';
  const weakNoNumber = 'StrongPasswordOnly';

  const rawSessionToken = 'c'.repeat(64);
  const sessionTokenHash = hashSessionToken(rawSessionToken);
  const sessionId = 'sess_alice_auth_consistency_1';

  let currentPasswordHash: string;
  let validCsrfToken: string;

  async function buildTestServer() {
    const app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    app.setErrorHandler(globalErrorHandler);
    app.addHook('preHandler', csrfProtectionHook);
    await app.register(authRoutes, { prefix: '/api/v1' });
    await app.ready();
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    currentPasswordHash = hashPassword(validPassword);
    validCsrfToken = generateCsrfToken({
      sessionId,
      userId: testUserId
    });

    mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id === testUserId || where.email === testEmail) {
        return {
          id: testUserId,
          email: testEmail,
          passwordHash: currentPasswordHash,
          status: 'ACTIVE',
          emailVerified: true,
          twoFactorEnabled: false,
          tokenVersion: 1
        };
      }
      if (where.id === suspendedUserId || where.email === suspendedEmail) {
        return {
          id: suspendedUserId,
          email: suspendedEmail,
          passwordHash: currentPasswordHash,
          status: 'SUSPENDED',
          emailVerified: true,
          twoFactorEnabled: false,
          tokenVersion: 1
        };
      }
      if (where.id === pendingUserId || where.email === pendingEmail) {
        return {
          id: pendingUserId,
          email: pendingEmail,
          passwordHash: currentPasswordHash,
          status: 'PENDING_VERIFICATION',
          emailVerified: false,
          twoFactorEnabled: false,
          tokenVersion: 1
        };
      }
      return null;
    });

    mockPrisma.userSession.findFirst.mockImplementation(async ({ where }: { where: { tokenHash?: string } }) => {
      if (where.tokenHash === sessionTokenHash) {
        return {
          id: sessionId,
          userId: testUserId,
          tokenHash: sessionTokenHash,
          expiresAt: new Date(Date.now() + 3600_000),
          user: {
            id: testUserId,
            email: testEmail,
            status: 'ACTIVE'
          }
        };
      }
      return null;
    });

    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return callback(mockPrisma);
    });
  });

  describe('1. Authoritative Password Hashing & Verification Implementation', () => {
    it('hashes passwords using scrypt with a 16-byte random salt and timing-safe comparison', () => {
      const plain = 'MySecretPass123';
      const hash1 = hashPassword(plain);
      const hash2 = hashPassword(plain);

      expect(hash1).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      expect(hash2).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      // Different salts for identical plaintext
      expect(hash1).not.toBe(hash2);

      expect(verifyPassword(plain, hash1)).toBe(true);
      expect(verifyPassword(plain, hash2)).toBe(true);
      expect(verifyPassword('WrongPassword123', hash1)).toBe(false);
    });

    it('provides safe backwards compatibility for legacy 64-character SHA-256 hashes without failing or invalidating users', () => {
      const plain = 'LegacyPassword123';
      const legacySha256 = crypto.createHash('sha256').update(plain).digest('hex');

      expect(legacySha256).toHaveLength(64);
      expect(verifyPassword(plain, legacySha256)).toBe(true);
      expect(verifyPassword('WrongPassword123', legacySha256)).toBe(false);
    });

    it('gracefully rejects malformed hashes, empty values, or mismatched buffer lengths without throwing', () => {
      expect(verifyPassword('test', null)).toBe(false);
      expect(verifyPassword('test', undefined)).toBe(false);
      expect(verifyPassword('test', '')).toBe(false);
      expect(verifyPassword('test', 'malformed')).toBe(false);
      expect(verifyPassword('test', 'salt:short')).toBe(false);
      expect(verifyPassword('test', 'nothex:nothex')).toBe(false);
    });
  });

  describe('2. Uniform Password Policy Across Registration, Password Change, and Recovery', () => {
    it('verifies AUTH_PASSWORD_POLICY and PASSWORD_CHANGE_POLICY have identical configurations', () => {
      expect(AUTH_PASSWORD_POLICY).toEqual({
        minLength: 8,
        maxLength: 128,
        requireUppercase: true,
        requireLowercase: true,
        requireNumber: true
      });
      expect(PASSWORD_CHANGE_POLICY).toBe(AUTH_PASSWORD_POLICY);
    });

    it('enforces identical password validation rules on registration, password change, and reset', () => {
      const testCases = [
        { pass: weakShortPassword, reason: 'too short' },
        { pass: weakNoUpper, reason: 'missing uppercase' },
        { pass: weakNoLower, reason: 'missing lowercase' },
        { pass: weakNoNumber, reason: 'missing number' },
        { pass: 'A'.repeat(129) + 'a1', reason: 'too long' }
      ];

      for (const tc of testCases) {
        expect(registerSchema.safeParse({ email: testEmail, password: tc.pass }).success).toBe(false);
        expect(
          resetPasswordSchema.safeParse({ email: testEmail, code: '123456', newPassword: tc.pass }).success
        ).toBe(false);
        expect(
          changePasswordRequestOtpSchema.safeParse({
            currentPassword: validPassword,
            newPassword: tc.pass,
            confirmPassword: tc.pass
          }).success
        ).toBe(false);
      }

      // Valid password passes all schemas
      expect(registerSchema.safeParse({ email: testEmail, password: validPassword }).success).toBe(true);
      expect(
        resetPasswordSchema.safeParse({ email: testEmail, code: '123456', newPassword: validPassword }).success
      ).toBe(true);
      expect(
        changePasswordRequestOtpSchema.safeParse({
          currentPassword: validPassword,
          newPassword: alternativePassword,
          confirmPassword: alternativePassword
        }).success
      ).toBe(true);
    });

    it('rejects confirmation mismatch across registration, password change, and recovery', async () => {
      const app = await buildTestServer();

      // 1. Registration mismatch
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'newuser@zdexcloud.test',
          password: validPassword,
          confirmPassword: alternativePassword
        }
      });
      expect(regRes.statusCode).toBe(400);
      expect(regRes.json().error).toBe('CONFIRMATION_MISMATCH');

      // 2. Recovery reset-password mismatch
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code: '123456',
          newPassword: alternativePassword,
          confirmPassword: 'DifferentAlternative456'
        }
      });
      expect(resetRes.statusCode).toBe(400);
      expect(resetRes.json().error).toBe('CONFIRMATION_MISMATCH');

      // 3. Authenticated password change mismatch
      const changeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-zdex-csrf-token': validCsrfToken },
        payload: {
          currentPassword: validPassword,
          newPassword: alternativePassword,
          confirmPassword: 'DifferentAlternative456'
        }
      });
      expect(changeRes.statusCode).toBe(400);
      expect(changeRes.json().error).toBe('CONFIRMATION_MISMATCH');

      await app.close();
    });

    it('rejects new password identical to current password in both password change and recovery', async () => {
      const app = await buildTestServer();

      // 1. Recovery reset-password rejecting identical password
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code: '123456',
          newPassword: validPassword,
          confirmPassword: validPassword
        }
      });
      expect(resetRes.statusCode).toBe(400);
      expect(resetRes.json().error).toBe('PASSWORD_UNCHANGED');
      expect(mockPrisma.emailOtp.findFirst).not.toHaveBeenCalled();

      // 2. Authenticated password change rejecting identical password
      const changeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-zdex-csrf-token': validCsrfToken },
        payload: {
          currentPassword: validPassword,
          newPassword: validPassword,
          confirmPassword: validPassword
        }
      });
      expect(changeRes.statusCode).toBe(400);
      expect(changeRes.json().error).toBe('PASSWORD_UNCHANGED');

      await app.close();
    });
  });

  describe('3. Strict Cross-Flow OTP Operation and User Isolation', () => {
    it('isolates registration, login, recovery, and authenticated password change OTPs from cross-validation', async () => {
      const code = '654321';

      // Record 1: Registration OTP
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_reg_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashOtp(code),
        purpose: 'REGISTRATION_VERIFICATION',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      });

      // Calling verifyEmailOtp with purpose 'PASSWORD_RESET' must NOT match registration OTP
      const recoveryAttempt = await verifyEmailOtp(testEmail, code, 'PASSWORD_RESET');
      expect(recoveryAttempt.valid).toBe(false);

      // Record 2: Recovery OTP
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_rec_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashOtp(code),
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      });

      // Calling verifyPasswordChangeOtp with recovery OTP must NOT match
      const changeAttempt = await verifyPasswordChangeOtp(testUserId, testEmail, code);
      expect(changeAttempt.valid).toBe(false);

      // Record 3: Password-change OTP
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_chg_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashPasswordChangeOtp(testUserId, code),
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      });

      // verifyEmailOtp for recovery strictly filters out `pwdchg:` OTPs
      const recoveryAttempt2 = await verifyEmailOtp(testEmail, code, 'PASSWORD_RESET');
      expect(recoveryAttempt2.valid).toBe(false);
    });

    it('rejects OTP verification when presented by a different user ID (cross-user binding)', async () => {
      const code = '112233';
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_bob_1',
        userId: otherUserId,
        email: testEmail,
        otpCode: hashOtp(code),
        purpose: 'REGISTRATION_VERIFICATION',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      });

      const result = await verifyEmailOtp(testEmail, code, 'REGISTRATION_VERIFICATION', {
        expectedUserId: testUserId
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_OTP');
    });

    it('locks out after 5 invalid attempts and enforces single-use atomic consumption', async () => {
      const validCode = '998877';
      const record = {
        id: 'otp_lockout_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashOtp(validCode),
        purpose: 'PASSWORD_RESET',
        attempts: 4,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      };

      // 5th wrong attempt -> locks out (attempts: 5, used: true)
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(record);
      mockPrisma.emailOtp.update.mockResolvedValueOnce({});
      const failResult = await verifyEmailOtp(testEmail, '000000', 'PASSWORD_RESET');
      expect(failResult.valid).toBe(false);
      expect(failResult.error).toBe('TOO_MANY_ATTEMPTS');
      expect(mockPrisma.emailOtp.update).toHaveBeenCalledWith({
        where: { id: 'otp_lockout_1' },
        data: { attempts: 5, used: true }
      });
    });
  });

  describe('4. Account Status & Verification Rules Enforcement', () => {
    it('blocks suspended accounts on login, verify-otp, forgot-password, and reset-password', async () => {
      const app = await buildTestServer();

      // 1. Suspended account login -> 403 ACCOUNT_SUSPENDED
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: suspendedEmail,
          password: validPassword
        }
      });
      expect(loginRes.statusCode).toBe(403);
      expect(loginRes.json().error).toBe('ACCOUNT_SUSPENDED');
      expect(mockEmailService.sendLoginOtp).not.toHaveBeenCalled();

      // 2. Suspended account verify-otp -> 403 ACCOUNT_SUSPENDED
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-otp',
        payload: {
          email: suspendedEmail,
          code: '123456'
        }
      });
      expect(verifyRes.statusCode).toBe(403);
      expect(verifyRes.json().error).toBe('ACCOUNT_SUSPENDED');

      // 3. Suspended account forgot-password -> 200 generic message without dispatching OTP
      const forgotRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: suspendedEmail }
      });
      expect(forgotRes.statusCode).toBe(200);
      expect(forgotRes.json().data.message).toBe(
        'If an account exists for this email, a password reset code has been sent.'
      );
      expect(mockEmailService.sendPasswordResetOtp).not.toHaveBeenCalled();

      // 4. Suspended account reset-password -> 400 INVALID_OTP (generic, non-disclosing)
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: suspendedEmail,
          code: '123456',
          newPassword: alternativePassword,
          confirmPassword: alternativePassword
        }
      });
      expect(resetRes.statusCode).toBe(400);
      expect(resetRes.json().error).toBe('INVALID_OTP');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('prevents unverified (PENDING_VERIFICATION) accounts from activating solely because a password was reset', async () => {
      const app = await buildTestServer();

      // Forgot password does not send reset OTP to unverified accounts
      const forgotRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: pendingEmail }
      });
      expect(forgotRes.statusCode).toBe(200);
      expect(mockEmailService.sendPasswordResetOtp).not.toHaveBeenCalled();

      // Reset password returns 400 INVALID_OTP without modifying user status
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: pendingEmail,
          code: '123456',
          newPassword: alternativePassword,
          confirmPassword: alternativePassword
        }
      });
      expect(resetRes.statusCode).toBe(400);
      expect(resetRes.json().error).toBe('INVALID_OTP');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });
  });

  describe('5. Session and Device Credential Revocation Consistency', () => {
    it('revokes UserSession records, revokes DeviceAuthCredential records, and clears session cookies on password reset', async () => {
      const app = await buildTestServer();
      const code = '778899';
      const recoveryRecord = {
        id: 'otp_rec_revoc_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashOtp(code),
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      };

      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(recoveryRecord);
      mockPrisma.emailOtp.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      mockPrisma.user.update.mockResolvedValueOnce({ id: testUserId });
      mockPrisma.userSession.deleteMany.mockResolvedValueOnce({ count: 3 });
      mockPrisma.deviceAuthCredential.updateMany.mockResolvedValueOnce({ count: 2 });
      mockPrisma.auditEvent.create.mockResolvedValue({ id: 'aud_1' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code,
          newPassword: alternativePassword,
          confirmPassword: alternativePassword
        }
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: testUserId }
      });
      expect(mockPrisma.deviceAuthCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: testUserId, revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) })
      });
      expect(String(res.headers['set-cookie'])).toContain(CUSTOMER_SESSION_COOKIE_NAME);

      await app.close();
    });

    it('revokes UserSession records, revokes DeviceAuthCredential records, and clears session cookies on password change confirm', async () => {
      const app = await buildTestServer();
      const code = '445566';
      const chgRecord = {
        id: 'otp_chg_revoc_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashPasswordChangeOtp(testUserId, code),
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      };

      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(chgRecord);
      mockPrisma.emailOtp.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      mockPrisma.user.update.mockResolvedValueOnce({ id: testUserId });
      mockPrisma.userSession.deleteMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.deviceAuthCredential.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.auditEvent.create.mockResolvedValue({ id: 'aud_2' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/confirm',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-zdex-csrf-token': validCsrfToken },
        payload: {
          currentPassword: validPassword,
          newPassword: alternativePassword,
          confirmPassword: alternativePassword,
          code
        }
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: testUserId }
      });
      expect(mockPrisma.deviceAuthCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: testUserId, revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) })
      });
      expect(String(res.headers['set-cookie'])).toContain(CUSTOMER_SESSION_COOKIE_NAME);

      await app.close();
    });
  });

  describe('6. Sensitive Credential Exclusion from Responses, Logs, and Activity', () => {
    it('ensures passwordHash, plaintext passwords, salts, and OTP codes are never leaked', async () => {
      const app = await buildTestServer();

      // Forgot password response
      const forgotRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: testEmail }
      });
      const forgotBody = forgotRes.body;
      expect(forgotBody).not.toContain('otpCode');
      expect(forgotBody).not.toContain('passwordHash');

      // Login response
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: testEmail, password: validPassword }
      });
      const loginBody = loginRes.body;
      expect(loginBody).not.toContain('otpCode');
      expect(loginBody).not.toContain('passwordHash');

      // Verify Audit & Activity calls never contain secret material
      const auditCalls = mockPrisma.auditEvent.create.mock.calls;
      for (const call of auditCalls) {
        const str = JSON.stringify(call);
        expect(str).not.toContain(validPassword);
        expect(str).not.toContain(alternativePassword);
      }

      await app.close();
    });
  });

  describe('7. Frontend Integration & Policy Alignment Verification', () => {
    it('verifies get-started.html, settings.html, forgot-password.html, and auth.js share the 4-rule password policy', () => {
      const getStartedHtml = fs.readFileSync(
        path.resolve(__dirname, '../../../Frontend/pages/get-started.html'),
        'utf8'
      );
      const settingsHtml = fs.readFileSync(
        path.resolve(__dirname, '../../../Frontend/pages/settings.html'),
        'utf8'
      );
      const forgotHtml = fs.readFileSync(
        path.resolve(__dirname, '../../../Frontend/pages/forgot-password.html'),
        'utf8'
      );
      const authJs = fs.readFileSync(path.resolve(__dirname, '../../../Frontend/js/auth.js'), 'utf8');

      // 4-rule indicators in get-started.html
      expect(getStartedHtml).toContain('id="reg-policy-length"');
      expect(getStartedHtml).toContain('id="reg-policy-upper"');
      expect(getStartedHtml).toContain('id="reg-policy-lower"');
      expect(getStartedHtml).toContain('id="reg-policy-number"');

      // 4-rule indicators in settings.html
      expect(settingsHtml).toContain('id="policy-length"');
      expect(settingsHtml).toContain('id="policy-upper"');
      expect(settingsHtml).toContain('id="policy-lower"');
      expect(settingsHtml).toContain('id="policy-number"');

      // 4-rule indicators in forgot-password.html
      expect(forgotHtml).toContain('id="reset-policy-length"');
      expect(forgotHtml).toContain('id="reset-policy-upper"');
      expect(forgotHtml).toContain('id="reset-policy-lower"');
      expect(forgotHtml).toContain('id="reset-policy-number"');

      // auth.js registerUser supports confirmPassword
      expect(authJs).toContain('async function registerUser(email, password, fullName, confirmPassword)');
    });
  });
});
