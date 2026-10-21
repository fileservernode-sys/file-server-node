// NOTE: These tests are NOT EXECUTED as per policy.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
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
      update: vi.fn()
    },
    userSession: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn()
    },
    deviceAuthCredential: {
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
  issuePasswordChangeOtp,
  verifyPasswordChangeOtp,
  verifyEmailOtp
} from '../src/utils/otp.js';
import {
  authRoutes,
  changePasswordRequestOtpSchema,
  changePasswordConfirmSchema
} from '../src/routes/auth.js';

describe('Phase 10.2 — Authenticated Password Change Workflow', () => {
  const testUserId = 'usr_alice_10_2';
  const otherUserId = 'usr_bob_10_2';
  const testEmail = 'alice@zdexcloud.test';
  const currentPlainPassword = 'CurrentPass123';
  const newPlainPassword = 'UpdatedStrongPass456';
  const rawSessionToken = 'a'.repeat(64);
  const sessionTokenHash = hashSessionToken(rawSessionToken);
  const sessionId = 'sess_alice_active_1';

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
    currentPasswordHash = hashPassword(currentPlainPassword);
    validCsrfToken = generateCsrfToken({
      id: sessionId,
      tokenHash: sessionTokenHash
    });

    const activeUser = {
      id: testUserId,
      email: testEmail,
      fullName: 'Alice Vance',
      passwordHash: currentPasswordHash,
      status: 'ACTIVE',
      emailVerified: true,
      createdAt: new Date('2026-01-10T00:00:00.000Z')
    };

    mockPrisma.userSession.findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.tokenHash === sessionTokenHash) {
        return {
          id: sessionId,
          userId: testUserId,
          tokenHash: sessionTokenHash,
          expiresAt: new Date(Date.now() + 3600_000),
          createdAt: new Date(),
          user: activeUser
        };
      }
      return null;
    });

    mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === testUserId || where?.email === testEmail) {
        return { ...activeUser, passwordHash: currentPasswordHash };
      }
      return null;
    });

    mockPrisma.emailOtp.findFirst.mockResolvedValue(null);
    mockPrisma.emailOtp.create.mockImplementation(async ({ data }: any) => ({
      id: 'otp_rec_1',
      ...data,
      createdAt: new Date()
    }));
    mockPrisma.emailOtp.update.mockResolvedValue({});
    mockPrisma.emailOtp.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditEvent.create.mockResolvedValue({});
    mockPrisma.user.update.mockImplementation(async ({ data }: any) => {
      if (data?.passwordHash) {
        currentPasswordHash = data.passwordHash;
      }
      return { ...activeUser, passwordHash: currentPasswordHash };
    });
    mockPrisma.userSession.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.deviceAuthCredential.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  });

  describe('1. Operation-Bound & User-Bound Cryptographic OTP Isolation', () => {
    it('hashes password-change OTPs with pwdchg:<userId>:<salt>:<hmac> and rejects cross-user or cross-operation verification', () => {
      const otp = '482910';
      const stored = hashPasswordChangeOtp(testUserId, otp);

      expect(stored.startsWith(`pwdchg:${testUserId}:`)).toBe(true);
      expect(stored).not.toContain(otp);

      // Valid for the exact user and OTP
      expect(verifyPasswordChangeOtpCode(testUserId, otp, stored)).toBe(true);

      // Rejected for wrong OTP
      expect(verifyPasswordChangeOtpCode(testUserId, '000000', stored)).toBe(false);

      // Rejected when verified under a different user ID
      expect(verifyPasswordChangeOtpCode(otherUserId, otp, stored)).toBe(false);

      // Rejected by standard registration/login/forgot-password verifyOtpCode
      expect(verifyOtpCode(otp, stored)).toBe(false);

      // Standard forgot-password OTP hash is rejected by verifyPasswordChangeOtpCode
      const standardResetHash = hashOtp(otp);
      expect(verifyPasswordChangeOtpCode(testUserId, otp, standardResetHash)).toBe(false);
    });

    it('rejects OTPs issued for forgot-password or another user during verifyPasswordChangeOtp', async () => {
      const otp = '739201';
      // Case A: OTP belongs to another user
      const bobHash = hashPasswordChangeOtp(otherUserId, otp);
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_bob',
        userId: otherUserId,
        email: testEmail,
        otpCode: bobHash,
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 0,
        used: false
      });

      const crossUserAttempt = await verifyPasswordChangeOtp(testUserId, testEmail, otp);
      expect(crossUserAttempt.valid).toBe(false);
      expect(crossUserAttempt.error).toBe('INVALID_OTP');

      // Case B: Password-change OTP cannot be consumed by unauthenticated verifyEmailOtp
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(null);
      const resetAttempt = await verifyEmailOtp(testEmail, otp, 'PASSWORD_RESET');
      expect(resetAttempt.valid).toBe(false);
    });
  });

  describe('2. Authentication & CSRF Enforcement', () => {
    it('rejects unauthenticated requests to both request-otp and confirm endpoints with 401', async () => {
      const app = await buildTestServer();

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });
      expect(res1.statusCode).toBe(401);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/confirm',
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword,
          otp: '123456'
        }
      });
      expect(res2.statusCode).toBe(401);

      await app.close();
    });

    it('rejects cookie-authenticated requests when X-CSRF-Token is missing or invalid with 403', async () => {
      const app = await buildTestServer();

      // Missing CSRF token
      const missingCsrfRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        cookies: {
          [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken
        },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });
      expect(missingCsrfRes.statusCode).toBe(403);
      expect(missingCsrfRes.json().error.code).toBe('CSRF_TOKEN_MISSING');

      // Invalid CSRF token
      const invalidCsrfRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/confirm',
        cookies: {
          [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken
        },
        headers: {
          'x-csrf-token': 'invalid_csrf_token_value'
        },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword,
          otp: '123456'
        }
      });
      expect(invalidCsrfRes.statusCode).toBe(403);
      expect(invalidCsrfRes.json().error.code).toBe('CSRF_TOKEN_INVALID');

      await app.close();
    });
  });

  describe('3. Current Password, Policy, Confirmation Match & Unchanged Password Validation', () => {
    it('rejects wrong current password without issuing an OTP or changing passwordHash', async () => {
      const app = await buildTestServer();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: 'WrongCurrentPassword999',
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(mockEmailService.sendPasswordChangeOtp).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects weak new passwords that violate length or character complexity requirements', async () => {
      const app = await buildTestServer();

      const weakPasswords = [
        'Short1A', // < 8 chars
        'alllowercase123', // missing uppercase
        'ALLUPPERCASE123', // missing lowercase
        'NoNumbersHereAbc' // missing digit
      ];

      for (const weak of weakPasswords) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/change-password/request-otp',
          cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
          headers: { 'x-csrf-token': validCsrfToken },
          payload: {
            currentPassword: currentPlainPassword,
            newPassword: weak,
            confirmPassword: weak
          }
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
      }

      expect(mockEmailService.sendPasswordChangeOtp).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects non-matching password confirmation', async () => {
      const app = await buildTestServer();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: 'DifferentConfirmPass789'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CONFIRMATION_MISMATCH');
      expect(mockEmailService.sendPasswordChangeOtp).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects new password equal to current password', async () => {
      const app = await buildTestServer();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: currentPlainPassword,
          confirmPassword: currentPlainPassword
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('PASSWORD_UNCHANGED');
      expect(mockEmailService.sendPasswordChangeOtp).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('4. OTP Verification Edge Cases (Wrong, Expired, Reused, Attempt Limits, Cooldown)', () => {
    it('enforces resend cooldown when requesting a second OTP within the cooldown window', async () => {
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_recent',
        userId: testUserId,
        email: testEmail,
        otpCode: hashPasswordChangeOtp(testUserId, '111222'),
        purpose: 'PASSWORD_RESET',
        createdAt: new Date(Date.now() - 10_000),
        expiresAt: new Date(Date.now() + 590_000),
        attempts: 0,
        used: false
      });

      const app = await buildTestServer();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('RESEND_COOLDOWN_ACTIVE');
      await app.close();
    });

    it('rejects wrong OTP, increments attempts, and locks out after reaching max attempts', async () => {
      const validOtp = '654321';
      const storedOtpHash = hashPasswordChangeOtp(testUserId, validOtp);

      // Wrong OTP on attempt 1
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_active_1',
        userId: testUserId,
        email: testEmail,
        otpCode: storedOtpHash,
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 0,
        used: false
      });

      const app = await buildTestServer();
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/confirm',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword,
          otp: '000000'
        }
      });

      expect(wrongRes.statusCode).toBe(400);
      expect(wrongRes.json().error.code).toBe('INVALID_OTP');
      expect(mockPrisma.emailOtp.update).toHaveBeenCalledWith({
        where: { id: 'otp_active_1' },
        data: { attempts: 1, used: false }
      });

      // Lockout when attempts >= OTP_MAX_ATTEMPTS (5)
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_active_1',
        userId: testUserId,
        email: testEmail,
        otpCode: storedOtpHash,
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 5,
        used: false
      });

      const lockedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/confirm',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword,
          otp: validOtp
        }
      });

      expect(lockedRes.statusCode).toBe(429);
      expect(lockedRes.json().error.code).toBe('TOO_MANY_ATTEMPTS');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects expired OTP and marks it used', async () => {
      const validOtp = '654321';
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_expired_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashPasswordChangeOtp(testUserId, validOtp),
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() - 5_000),
        attempts: 0,
        used: false
      });

      const app = await buildTestServer();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/confirm',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword,
          otp: validOtp
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('EXPIRED_OTP');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects reused OTP when atomic updateMany reports count === 0', async () => {
      const validOtp = '827364';
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_reused_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashPasswordChangeOtp(testUserId, validOtp),
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 0,
        used: false
      });
      // Simulate concurrent consumption where updateMany returns count: 0
      mockPrisma.emailOtp.updateMany.mockResolvedValueOnce({ count: 0 });

      const app = await buildTestServer();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/confirm',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword,
          otp: validOtp
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_OTP');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });
  });

  describe('5. End-to-End Authenticated Password Change Success, Session/Token Revocation & Activity/Audit Recording', () => {
    it('completes Step 1 (request-otp) and Step 2 (confirm), rotates passwordHash, revokes sessions & device tokens, and records audit + customer activity events', async () => {
      const app = await buildTestServer();

      // Step 1: Request OTP
      const step1Res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/request-otp',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      expect(step1Res.statusCode).toBe(200);
      const step1Body = step1Res.json();
      expect(step1Body.success).toBe(true);
      expect(step1Body.data.requiresOtp).toBe(true);
      expect(mockEmailService.sendPasswordChangeOtp).toHaveBeenCalledTimes(1);

      const dispatchedOtp = mockEmailService.sendPasswordChangeOtp.mock.calls[0][1];
      expect(dispatchedOtp).toMatch(/^\d{6}$/);

      // Ensure OTP is never returned in API response
      expect(JSON.stringify(step1Body)).not.toContain(dispatchedOtp);

      // Prepare stored OTP record for Step 2
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_step2_valid',
        userId: testUserId,
        email: testEmail,
        otpCode: hashPasswordChangeOtp(testUserId, dispatchedOtp),
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 0,
        used: false
      });

      // Step 2: Confirm OTP & Change Password
      const step2Res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password/confirm',
        cookies: { [CUSTOMER_SESSION_COOKIE_NAME]: rawSessionToken },
        headers: { 'x-csrf-token': validCsrfToken },
        payload: {
          currentPassword: currentPlainPassword,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword,
          otp: dispatchedOtp
        }
      });

      expect(step2Res.statusCode).toBe(200);
      const step2Body = step2Res.json();
      expect(step2Body.success).toBe(true);
      expect(step2Body.data.passwordChanged).toBe(true);
      expect(step2Body.data.sessionRevoked).toBe(true);
      expect(step2Body.data.deviceCredentialsRevoked).toBe(true);
      expect(step2Body.data.requiresReauthentication).toBe(true);

      // Verify password hash was updated and old password no longer verifies
      expect(verifyPassword(newPlainPassword, currentPasswordHash)).toBe(true);
      expect(verifyPassword(currentPlainPassword, currentPasswordHash)).toBe(false);

      // Verify all active UserSessions and DeviceAuthCredentials were revoked
      expect(mockPrisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: testUserId }
      });
      expect(mockPrisma.deviceAuthCredential.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: testUserId, revokedAt: null }
        })
      );

      // Verify AuditEvent entries
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: testUserId,
            eventType: 'PASSWORD_RESET_SUCCESS',
            metadata: { operation: 'AUTHENTICATED_PASSWORD_CHANGE' }
          })
        })
      );
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: testUserId,
            eventType: 'DEVICE_CREDENTIAL_REVOKED'
          })
        })
      );

      // Verify CustomerActivityService events (SECURITY.PASSWORD_CHANGED & SECURITY.DEVICE_CREDENTIALS_REVOKED)
      expect(CUSTOMER_ACTIVITY_TAXONOMY[CustomerActivityEventType.SECURITY_PASSWORD_CHANGED].capabilityStatus).toBe(
        'CONFIRMED_RECORDED'
      );
      expect(mockActivityService.recordEventSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          eventType: 'SECURITY.PASSWORD_CHANGED'
        })
      );
      expect(mockActivityService.recordEventSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          eventType: 'SECURITY.DEVICE_CREDENTIALS_REVOKED'
        })
      );

      // Verify security notification was emitted
      expect(mockAccountProducer.emitSecurityEvent).toHaveBeenCalledWith(
        testUserId,
        expect.stringContaining('password was changed')
      );

      // Verify Set-Cookie clears the session cookie
      const setCookieHeader = step2Res.headers['set-cookie'];
      expect(String(setCookieHeader)).toContain(CUSTOMER_SESSION_COOKIE_NAME);

      await app.close();
    });
  });

  describe('6. Frontend Settings UI & AuthService Integration Structure', () => {
    it('exposes requestPasswordChangeOtp and confirmPasswordChange in Frontend/js/auth.js and connects the 2-step OTP UI in pages/settings.html', () => {
      const authJsPath = path.resolve(__dirname, '../../Frontend/js/auth.js');
      const settingsHtmlPath = path.resolve(__dirname, '../../Frontend/pages/settings.html');

      const authJsContent = fs.readFileSync(authJsPath, 'utf8');
      const settingsHtmlContent = fs.readFileSync(settingsHtmlPath, 'utf8');

      expect(authJsContent).toContain('/auth/change-password/request-otp');
      expect(authJsContent).toContain('/auth/change-password/confirm');
      expect(authJsContent).toContain('requestPasswordChangeOtp');
      expect(authJsContent).toContain('confirmPasswordChange');

      // Verify Settings UI elements for all password-change states
      expect(settingsHtmlContent).toContain('id="password-change-panel"');
      expect(settingsHtmlContent).toContain('id="form-change-password"');
      expect(settingsHtmlContent).toContain('id="password-step-credentials"');
      expect(settingsHtmlContent).toContain('id="password-step-otp"');
      expect(settingsHtmlContent).toContain('id="password-change-otp"');
      expect(settingsHtmlContent).toContain('id="btn-confirm-password-change"');
      expect(settingsHtmlContent).toContain('id="btn-resend-password-otp"');
      expect(settingsHtmlContent).toContain('id="password-change-success-card"');
      expect(settingsHtmlContent).toContain('window.AuthService.requestPasswordChangeOtp');
      expect(settingsHtmlContent).toContain('window.AuthService.confirmPasswordChange');
    });
  });
});
