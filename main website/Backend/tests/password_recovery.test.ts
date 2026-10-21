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
  issueEmailOtp,
  verifyEmailOtp,
  verifyPasswordChangeOtp
} from '../src/utils/otp.js';
import {
  authRoutes,
  forgotPasswordSchema,
  verifyPasswordResetOtpSchema,
  resetPasswordSchema
} from '../src/routes/auth.js';

describe('Phase 10.3 — Forgot Password and Account Recovery Workflow', () => {
  const testUserId = 'usr_alice_10_3';
  const otherUserId = 'usr_bob_10_3';
  const testEmail = 'alice@zdexcloud.test';
  const unknownEmail = 'unknown@zdexcloud.test';
  const oldPlainPassword = 'OldRecoveryPass123';
  const newPlainPassword = 'NewRecoveryStrongPass456';
  const rawSessionToken = 'b'.repeat(64);
  const sessionTokenHash = hashSessionToken(rawSessionToken);
  const sessionId = 'sess_alice_recovery_1';

  let oldPasswordHash: string;
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
    oldPasswordHash = hashPassword(oldPlainPassword);
    validCsrfToken = generateCsrfToken({
      sessionId,
      userId: testUserId
    });

    mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id === testUserId || where.email === testEmail) {
        return {
          id: testUserId,
          email: testEmail,
          passwordHash: oldPasswordHash,
          status: 'ACTIVE',
          emailVerified: true,
          twoFactorEnabled: false,
          tokenVersion: 1
        };
      }
      return null;
    });

    mockPrisma.userSession.findUnique.mockImplementation(async ({ where }: { where: { tokenHash?: string } }) => {
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

  describe('1. Non-Consuming Recovery OTP Pre-Verification & Purpose Isolation (`otp.ts`)', () => {
    it('supports non-consuming verification (`consume: false`) without marking the OTP as used', async () => {
      const code = '739182';
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

      const result = await verifyEmailOtp(testEmail, code, 'PASSWORD_RESET', { consume: false });
      expect(result).toEqual({
        valid: true,
        userId: testUserId,
        otpRecordId: 'otp_rec_1'
      });
      expect(mockPrisma.emailOtp.update).not.toHaveBeenCalled();
    });

    it('excludes `pwdchg:` password-change OTPs when querying recovery `PASSWORD_RESET` OTPs', async () => {
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(null);

      const result = await verifyEmailOtp(testEmail, '123456', 'PASSWORD_RESET', { consume: false });
      expect(result).toEqual({
        valid: false,
        reason: 'NO_ACTIVE_OTP'
      });
      expect(mockPrisma.emailOtp.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: testEmail,
            purpose: 'PASSWORD_RESET',
            used: false,
            NOT: {
              otpCode: {
                startsWith: 'pwdchg:'
              }
            }
          })
        })
      );
    });

    it('rejects a recovery `PASSWORD_RESET` OTP when passed to `verifyPasswordChangeOtp`', async () => {
      const code = '482910';
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(null);

      const result = await verifyPasswordChangeOtp(testUserId, testEmail, code);
      expect(result).toEqual({
        valid: false,
        reason: 'NO_ACTIVE_OTP'
      });
      expect(mockPrisma.emailOtp.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            otpCode: {
              startsWith: 'pwdchg:'
            }
          })
        })
      );
    });

    it('rejects cross-user OTPs when `expectedUserId` does not match the OTP owner', async () => {
      const code = '591023';
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_bob_1',
        userId: otherUserId,
        email: testEmail,
        otpCode: hashOtp(code),
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      });

      const result = await verifyEmailOtp(testEmail, code, 'PASSWORD_RESET', {
        consume: false,
        expectedUserId: testUserId
      });
      expect(result).toEqual({
        valid: false,
        reason: 'NO_ACTIVE_OTP'
      });
    });
  });

  describe('2. Unknown-Email Response Consistency & Account Enumeration Prevention', () => {
    it('returns identical status and response structure for known, unknown, and suspended emails on `POST /api/v1/auth/forgot-password`', async () => {
      const app = await buildTestServer();

      // 1) Unknown email
      const unknownRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: unknownEmail }
      });

      // 2) Known active email
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(null);
      mockPrisma.emailOtp.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.emailOtp.create.mockResolvedValueOnce({
        id: 'otp_known_1',
        expiresAt: new Date(Date.now() + 600_000)
      });

      const knownRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: testEmail }
      });

      // 3) Suspended account
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'usr_suspended_1',
        email: 'suspended@zdexcloud.test',
        passwordHash: oldPasswordHash,
        status: 'SUSPENDED'
      });

      const suspendedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'suspended@zdexcloud.test' }
      });

      expect(unknownRes.statusCode).toBe(200);
      expect(knownRes.statusCode).toBe(200);
      expect(suspendedRes.statusCode).toBe(200);

      const unknownBody = unknownRes.json();
      const knownBody = knownRes.json();
      const suspendedBody = suspendedRes.json();

      expect(unknownBody).toEqual(knownBody);
      expect(suspendedBody).toEqual(knownBody);
      expect(knownBody.data).toEqual({
        message: 'If an account exists for this email, a password reset code has been sent.',
        expiresInSeconds: 600,
        cooldownSeconds: 60
      });

      // Email and activity recording only invoked once (for the known active user)
      expect(mockEmailService.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
      expect(mockActivityService.recordEventSafe).toHaveBeenCalledTimes(1);
      expect(mockActivityService.recordEventSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          eventType: CustomerActivityEventType.SECURITY_PASSWORD_RESET_REQUESTED
        })
      );

      await app.close();
    });

    it('returns identical `400 INVALID_OTP` error on `POST /api/v1/auth/reset-password` for unknown or suspended accounts without leaking account existence', async () => {
      const app = await buildTestServer();

      // Unknown account
      const unknownRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: unknownEmail,
          code: '123456',
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      // Known active account with invalid/missing OTP
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(null);
      const knownInvalidOtpRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code: '123456',
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      // Suspended account
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'usr_suspended_1',
        email: 'suspended@zdexcloud.test',
        passwordHash: oldPasswordHash,
        status: 'SUSPENDED'
      });
      const suspendedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: 'suspended@zdexcloud.test',
          code: '123456',
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      expect(unknownRes.statusCode).toBe(400);
      expect(knownInvalidOtpRes.statusCode).toBe(400);
      expect(suspendedRes.statusCode).toBe(400);

      expect(unknownRes.json()).toEqual({
        error: 'INVALID_OTP',
        message: 'Invalid or expired password reset code'
      });
      expect(knownInvalidOtpRes.json()).toEqual(unknownRes.json());
      expect(suspendedRes.json()).toEqual(unknownRes.json());

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('3. Complete 3-Step Recovery Workflow (`forgot-password` -> `verify-password-reset-otp` -> `reset-password`)', () => {
    it('completes Step 1, Step 2 (non-consuming OTP verification), and Step 3 (atomic OTP consumption, password update, session & device revocation, audit & activity logging)', async () => {
      const app = await buildTestServer();

      // Step 1: Request reset OTP
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(null);
      mockPrisma.emailOtp.updateMany.mockResolvedValueOnce({ count: 0 });
      let issuedOtpHash = '';
      mockPrisma.emailOtp.create.mockImplementationOnce(async ({ data }: { data: { otpCode: string } }) => {
        issuedOtpHash = data.otpCode;
        return {
          id: 'otp_recovery_flow_1',
          expiresAt: new Date(Date.now() + 600_000)
        };
      });

      const step1Res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: '  ALICE@zdexcloud.test ' }
      });

      expect(step1Res.statusCode).toBe(200);
      expect(mockEmailService.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
      const sentOtpCode = mockEmailService.sendPasswordResetOtp.mock.calls[0][1] as string;
      expect(sentOtpCode).toMatch(/^\d{6}$/);
      expect(verifyOtpCode(sentOtpCode, issuedOtpHash)).toBe(true);

      // Step 2: Pre-verify OTP (`POST /api/v1/auth/verify-password-reset-otp`)
      const activeOtpRecord = {
        id: 'otp_recovery_flow_1',
        userId: testUserId,
        email: testEmail,
        otpCode: issuedOtpHash,
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      };
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(activeOtpRecord);

      const step2Res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-password-reset-otp',
        payload: {
          email: testEmail,
          code: sentOtpCode
        }
      });

      expect(step2Res.statusCode).toBe(200);
      expect(step2Res.json().data).toEqual({
        verified: true,
        message: 'Verification code confirmed. You may now set your new password.'
      });
      // Must NOT mark OTP as used during Step 2
      expect(mockPrisma.emailOtp.update).not.toHaveBeenCalled();

      // Step 3: Reset Password (`POST /api/v1/auth/reset-password`)
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(activeOtpRecord);
      mockPrisma.emailOtp.updateMany
        .mockResolvedValueOnce({ count: 1 }) // Atomic conditional consumption of `otp_recovery_flow_1`
        .mockResolvedValueOnce({ count: 0 }); // Invalidate remaining unused recovery OTPs

      let savedPasswordHash = '';
      mockPrisma.user.update.mockImplementationOnce(async ({ data }: { data: { passwordHash: string } }) => {
        savedPasswordHash = data.passwordHash;
        return { id: testUserId };
      });
      mockPrisma.userSession.deleteMany.mockResolvedValueOnce({ count: 2 });
      mockPrisma.deviceAuthCredential.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.auditEvent.create.mockResolvedValue({ id: 'aud_rec_1' });

      const step3Res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code: sentOtpCode,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      expect(step3Res.statusCode).toBe(200);
      const step3Body = step3Res.json();
      expect(step3Body).toEqual({
        success: true,
        data: {
          message: 'Password reset successfully. Please sign in with your new password.',
          sessionsRevoked: true
        }
      });

      // Verify password hash was updated with scrypt and old password no longer matches
      expect(savedPasswordHash).toBeTruthy();
      expect(savedPasswordHash).not.toBe(oldPasswordHash);
      expect(verifyPassword(newPlainPassword, savedPasswordHash)).toBe(true);
      expect(verifyPassword(oldPlainPassword, savedPasswordHash)).toBe(false);

      // Verify atomic OTP consumption
      expect(mockPrisma.emailOtp.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'otp_recovery_flow_1',
          userId: testUserId,
          purpose: 'PASSWORD_RESET',
          used: false,
          NOT: {
            otpCode: {
              startsWith: 'pwdchg:'
            }
          }
        },
        data: { used: true }
      });

      // Verify session & device credential revocation
      expect(mockPrisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: testUserId }
      });
      expect(mockPrisma.deviceAuthCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: testUserId, revokedAt: null },
        data: expect.objectContaining({
          revokedAt: expect.any(Date)
        })
      });

      // Verify AuditEvent records created
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.auditEvent.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: testUserId,
            eventType: 'PASSWORD_RESET_SUCCESS',
            metadata: { operation: 'FORGOT_PASSWORD_RECOVERY' }
          })
        })
      );
      expect(mockPrisma.auditEvent.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: testUserId,
            eventType: 'DEVICE_CREDENTIAL_REVOKED'
          })
        })
      );

      // Verify CustomerActivityService events (`SECURITY.PASSWORD_RESET_COMPLETED` + `SECURITY.DEVICE_CREDENTIALS_REVOKED`)
      expect(mockActivityService.recordEventSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          eventType: CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED,
          metadata: { sessionsInvalidated: true }
        })
      );
      expect(mockActivityService.recordEventSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          eventType: CustomerActivityEventType.SECURITY_DEVICE_CREDENTIALS_REVOKED,
          metadata: { revokedCount: 1 }
        })
      );

      // Verify security notification dispatched
      expect(mockAccountProducer.emitSecurityEvent).toHaveBeenCalledWith(
        testUserId,
        'Your ZdexCloud account password was reset via email recovery and all active sessions were signed out.'
      );

      // Verify session cookie cleared and no sensitive values leaked
      const setCookieHeader = step3Res.headers['set-cookie'];
      expect(String(setCookieHeader)).toContain(CUSTOMER_SESSION_COOKIE_NAME);
      const serialized = JSON.stringify(step3Body);
      expect(serialized).not.toContain(newPlainPassword);
      expect(serialized).not.toContain(oldPlainPassword);
      expect(serialized).not.toContain(savedPasswordHash);
      expect(serialized).not.toContain(sentOtpCode);

      await app.close();
    });
  });

  describe('4. OTP Validation: Expiry, Wrong Code, Attempt Lockout, Single-Use, and Resend Cooldown', () => {
    it('rejects expired OTPs with `400 EXPIRED_OTP` on both Step 2 and Step 3', async () => {
      const app = await buildTestServer();
      const code = '334455';
      const expiredRecord = {
        id: 'otp_exp_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashOtp(code),
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() - 5_000),
        createdAt: new Date(Date.now() - 605_000)
      };

      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(expiredRecord);
      mockPrisma.emailOtp.update.mockResolvedValueOnce({});

      const step2Res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-password-reset-otp',
        payload: { email: testEmail, code }
      });

      expect(step2Res.statusCode).toBe(400);
      expect(step2Res.json().error).toBe('EXPIRED_OTP');

      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce(expiredRecord);
      mockPrisma.emailOtp.update.mockResolvedValueOnce({});

      const step3Res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      expect(step3Res.statusCode).toBe(400);
      expect(step3Res.json().error).toBe('EXPIRED_OTP');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('increments attempts on wrong OTP (`400 INVALID_OTP`) and locks out after 5 failed attempts (`429 TOO_MANY_ATTEMPTS`)', async () => {
      const app = await buildTestServer();
      const validCode = '918273';

      // Wrong attempt #1
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_attempts_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashOtp(validCode),
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      });
      mockPrisma.emailOtp.update.mockResolvedValueOnce({});

      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-password-reset-otp',
        payload: { email: testEmail, code: '000000' }
      });

      expect(wrongRes.statusCode).toBe(400);
      expect(wrongRes.json().error).toBe('INVALID_OTP');
      expect(mockPrisma.emailOtp.update).toHaveBeenCalledWith({
        where: { id: 'otp_attempts_1' },
        data: { attempts: { increment: 1 } }
      });

      // Attempt after reaching 5 failed attempts -> 429 TOO_MANY_ATTEMPTS
      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_attempts_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashOtp(validCode),
        purpose: 'PASSWORD_RESET',
        attempts: 5,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      });
      mockPrisma.emailOtp.update.mockResolvedValueOnce({});

      const lockedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-password-reset-otp',
        payload: { email: testEmail, code: validCode }
      });

      expect(lockedRes.statusCode).toBe(429);
      expect(lockedRes.json().error).toBe('TOO_MANY_ATTEMPTS');

      await app.close();
    });

    it('prevents OTP reuse if the code was already consumed in a concurrent request (`400 INVALID_OTP`)', async () => {
      const app = await buildTestServer();
      const code = '556677';

      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_race_1',
        userId: testUserId,
        email: testEmail,
        otpCode: hashOtp(code),
        purpose: 'PASSWORD_RESET',
        attempts: 0,
        used: false,
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date()
      });
      // Simulate concurrent consumption where updateMany returns count: 0
      mockPrisma.emailOtp.updateMany.mockResolvedValueOnce({ count: 0 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code,
          newPassword: newPlainPassword,
          confirmPassword: newPlainPassword
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_OTP');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });

    it('enforces 60-second resend cooldown on `POST /api/v1/auth/forgot-password` (`429 RESEND_COOLDOWN_ACTIVE`)', async () => {
      const app = await buildTestServer();

      mockPrisma.emailOtp.findFirst.mockResolvedValueOnce({
        id: 'otp_recent_1',
        createdAt: new Date(Date.now() - 20_000) // 20s ago (< 60s cooldown)
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: testEmail }
      });

      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('RESEND_COOLDOWN_ACTIVE');
      expect(mockEmailService.sendPasswordResetOtp).not.toHaveBeenCalled();

      await app.close();
    });
  });

  describe('5. Password Policy & Confirmation Validation Without Burning OTP', () => {
    it('rejects weak passwords (`400 VALIDATION_ERROR`) and mismatched confirmation (`400 CONFIRMATION_MISMATCH`) BEFORE touching the OTP record', async () => {
      const app = await buildTestServer();

      // Weak password (missing uppercase & digit)
      const weakRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code: '123456',
          newPassword: 'weakpassword',
          confirmPassword: 'weakpassword'
        }
      });
      expect(weakRes.statusCode).toBe(400);
      expect(weakRes.json().error).toBe('VALIDATION_ERROR');

      // Confirmation mismatch
      const mismatchRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        payload: {
          email: testEmail,
          code: '123456',
          newPassword: 'ValidPass123',
          confirmPassword: 'DifferentValidPass123'
        }
      });
      expect(mismatchRes.statusCode).toBe(400);
      expect(mismatchRes.json().error).toBe('CONFIRMATION_MISMATCH');

      // Neither failure queried or incremented the OTP record
      expect(mockPrisma.emailOtp.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.emailOtp.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      await app.close();
    });
  });

  describe('6. Taxonomy & Frontend Integration (`pages/forgot-password.html`, `pages/login.html`, `js/auth.js`)', () => {
    it('verifies `SECURITY.PASSWORD_RESET_REQUESTED` and `SECURITY.PASSWORD_RESET_COMPLETED` are customer-visible in the Phase 9 taxonomy', () => {
      const reqEntry = CUSTOMER_ACTIVITY_TAXONOMY[CustomerActivityEventType.SECURITY_PASSWORD_RESET_REQUESTED];
      const compEntry = CUSTOMER_ACTIVITY_TAXONOMY[CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED];

      expect(reqEntry.visibility).toBe('CUSTOMER_VISIBLE');
      expect(compEntry.visibility).toBe('CUSTOMER_VISIBLE');
      expect(compEntry.allowedMetadataKeys).toContain('sessionsInvalidated');
    });

    it('verifies `pages/forgot-password.html`, `pages/login.html`, and `js/auth.js` contain the complete 4-stage recovery journey and enumeration-safe copy', () => {
      const forgotHtmlPath = path.resolve(__dirname, '../../../Frontend/pages/forgot-password.html');
      const loginHtmlPath = path.resolve(__dirname, '../../../Frontend/pages/login.html');
      const authJsPath = path.resolve(__dirname, '../../../Frontend/js/auth.js');

      const forgotHtml = fs.readFileSync(forgotHtmlPath, 'utf8');
      const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');
      const authJs = fs.readFileSync(authJsPath, 'utf8');

      // 4-step structure & controls in forgot-password.html
      expect(forgotHtml).toContain('id="step1-form"');
      expect(forgotHtml).toContain('id="step2-form"');
      expect(forgotHtml).toContain('id="step3-form"');
      expect(forgotHtml).toContain('id="step4-complete"');
      expect(forgotHtml).toContain('id="recovery-step-badge"');
      expect(forgotHtml).toContain('id="btn-change-email"');
      expect(forgotHtml).toContain('id="reset-policy-length"');
      expect(forgotHtml).toContain('id="reset-policy-upper"');
      expect(forgotHtml).toContain('id="reset-policy-lower"');
      expect(forgotHtml).toContain('id="reset-policy-number"');
      expect(forgotHtml).toContain('login.html?reset=true');

      // Enumeration-safe wording
      expect(forgotHtml).toContain('If an account exists for');

      // Login page reset confirmation handling
      expect(loginHtml).toContain("params.get('reset') === 'true'");

      // Auth client recovery methods
      expect(authJs).toContain('async function forgotPassword(email)');
      expect(authJs).toContain('async function verifyPasswordResetOtp(email, otp)');
      expect(authJs).toContain('async function resetPassword(email, otp, newPassword, confirmPassword)');
    });
  });
});
