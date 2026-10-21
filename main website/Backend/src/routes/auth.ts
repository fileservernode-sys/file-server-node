import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import { hashPassword, verifyPassword, generateSessionToken, hashSessionToken } from '../utils/crypto.js';
import { issueEmailOtp, verifyEmailOtp, issuePasswordChangeOtp, verifyPasswordChangeOtp } from '../utils/otp.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError } from '../errors/app-error.js';
import { accountEventProducer } from '../notifications/producers/account_producer.js';
import { resolveClientIp } from '../utils/ip.js';
import {
  CUSTOMER_SESSION_COOKIE_NAME,
  getCustomerSessionCookieOptions,
  getCustomerSessionCookieClearOptions
} from '../config/cookie.js';
import { customerAuthenticate, extractCustomerToken, resolveCustomerSession } from '../middleware/customer-auth.js';
import { generateCsrfToken } from '../utils/csrf.js';
import {
  authStrictRateLimitConfig,
  authOtpVerifyRateLimitConfig,
  authResendOtpRateLimitConfig,
  customerStandardRateLimitConfig
} from '../middleware/rate_limit_presets.js';
import { CustomerActivityService } from '../services/activity/customer_activity_service.js';

// Unified Authoritative Password Policy across Registration, Password Change, and Account Recovery
export const AUTH_PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true
} as const;

export const PASSWORD_CHANGE_POLICY = AUTH_PASSWORD_POLICY;

// Input Validation Schemas
export const registerSchema = z.object({
  email: z.string().email('Valid email address required'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(AUTH_PASSWORD_POLICY.minLength, 'Password must be at least 8 characters')
    .max(AUTH_PASSWORD_POLICY.maxLength, 'Password must not exceed 128 characters')
    .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
    .regex(/[a-z]/, 'Password must include at least one lowercase letter')
    .regex(/[0-9]/, 'Password must include at least one number'),
  confirmPassword: z
    .string()
    .max(AUTH_PASSWORD_POLICY.maxLength, 'Password confirmation must not exceed 128 characters')
    .optional(),
  fullName: z.string().min(1).optional()
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(6).max(6).optional(),
  code: z.string().min(6).max(6).optional(),
  otpCode: z.string().min(6).max(6).optional()
}).refine(data => Boolean((data.otp || data.code || data.otpCode || '').trim()), {
  message: 'A 6-digit OTP verification code is required',
  path: ['otp']
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const resendOtpSchema = z.object({
  email: z.string().email()
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const verifyPasswordResetOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(6).max(6).optional(),
  code: z.string().min(6).max(6).optional(),
  otpCode: z.string().min(6).max(6).optional()
}).refine(data => Boolean((data.otp || data.code || data.otpCode || '').trim()), {
  message: 'A 6-digit OTP verification code is required',
  path: ['otp']
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Valid email address required'),
  otp: z.string().optional(),
  code: z.string().optional(),
  otpCode: z.string().optional(),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(PASSWORD_CHANGE_POLICY.minLength, 'New password must be at least 8 characters')
    .max(PASSWORD_CHANGE_POLICY.maxLength, 'New password must not exceed 128 characters')
    .regex(/[A-Z]/, 'New password must include at least one uppercase letter')
    .regex(/[a-z]/, 'New password must include at least one lowercase letter')
    .regex(/[0-9]/, 'New password must include at least one number'),
  confirmPassword: z
    .string()
    .max(PASSWORD_CHANGE_POLICY.maxLength, 'Password confirmation must not exceed 128 characters')
    .optional()
}).refine(data => Boolean((data.otp || data.code || data.otpCode || '').trim()), {
  message: 'A 6-digit OTP verification code is required',
  path: ['otp']
});

export const changePasswordRequestOtpSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Current password is required' })
    .min(1, 'Current password is required')
    .max(PASSWORD_CHANGE_POLICY.maxLength, 'Current password must not exceed 128 characters'),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(PASSWORD_CHANGE_POLICY.minLength, 'New password must be at least 8 characters')
    .max(PASSWORD_CHANGE_POLICY.maxLength, 'New password must not exceed 128 characters')
    .regex(/[A-Z]/, 'New password must include at least one uppercase letter')
    .regex(/[a-z]/, 'New password must include at least one lowercase letter')
    .regex(/[0-9]/, 'New password must include at least one number'),
  confirmPassword: z
    .string({ required_error: 'Password confirmation is required' })
    .min(1, 'Please confirm your new password')
    .max(PASSWORD_CHANGE_POLICY.maxLength, 'Password confirmation must not exceed 128 characters')
});

export const changePasswordConfirmSchema = changePasswordRequestOtpSchema.extend({
  otp: z.string().optional(),
  code: z.string().optional(),
  otpCode: z.string().optional()
});

function maskEmailAddress(email: string): string {
  const trimmed = (email || '').trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return '***';
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const visibleLocal = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visibleLocal}${'*'.repeat(Math.max(2, Math.min(6, local.length - visibleLocal.length)))}@${domain}`;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/auth/register
   * Step 1 of Email/Password Account Creation: Creates PENDING_VERIFICATION user and dispatches 6-digit OTP.
   */
  app.post(
    '/auth/register',
    {
      config: {
        rateLimit: authStrictRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(
        createErrorResponse('VALIDATION_ERROR', body.error.errors[0]?.message || 'Invalid registration parameters')
      );
    }

    if (body.data.confirmPassword !== undefined && body.data.password !== body.data.confirmPassword) {
      return reply.status(400).send(
        createErrorResponse('CONFIRMATION_MISMATCH', 'Password and confirmation do not match')
      );
    }

    const email = body.data.email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser && existingUser.emailVerified && existingUser.status === 'ACTIVE') {
      return reply.status(409).send(createErrorResponse('USER_ALREADY_EXISTS', 'An account with this email already exists'));
    }

    const passwordHash = hashPassword(body.data.password);
    let user = existingUser;

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          fullName: body.data.fullName || null,
          passwordHash,
          status: 'PENDING_VERIFICATION',
          emailVerified: false
        }
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, fullName: body.data.fullName || user.fullName }
      });
    }

    // Issue 6-Digit Email OTP via Serverbyt SMTP
    await issueEmailOtp(user.id, email, 'REGISTRATION_VERIFICATION');

    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        eventType: 'OTP_SENT',
        metadata: { purpose: 'REGISTRATION_VERIFICATION' }
      }
    });

    return reply.status(200).send(createSuccessResponse({
      requiresOtp: true,
      email,
      message: 'Verification code sent to your email'
    }));
  });

  /**
   * Helper handler for Email OTP Verification
   */
  const handleVerifyOtp = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = verifyOtpSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError('Invalid OTP verification parameters');
    }

    const email = body.data.email.trim().toLowerCase();
    const code = (body.data.otp || body.data.code || body.data.otpCode || '').trim();

    if (code.length !== 6) {
      throw new ValidationError('A 6-digit OTP verification code is required');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(400).send(createErrorResponse('INVALID_OTP', 'Invalid or expired 6-digit OTP verification code'));
    }

    if (user.status === 'SUSPENDED') {
      return reply.status(403).send(createErrorResponse('ACCOUNT_SUSPENDED', 'This account has been suspended. Please contact support.'));
    }

    // Check registration or login OTP strictly bound to user.id
    const regResult = await verifyEmailOtp(email, code, 'REGISTRATION_VERIFICATION', { expectedUserId: user.id });
    const loginResult = !regResult.valid ? await verifyEmailOtp(email, code, 'LOGIN_2FA', { expectedUserId: user.id }) : { valid: false };

    const isValid = regResult.valid || loginResult.valid;
    const errorType = regResult.error || loginResult.error;

    if (!isValid) {
      if (errorType === 'TOO_MANY_ATTEMPTS') {
        return reply.status(429).send(createErrorResponse('TOO_MANY_ATTEMPTS', 'Too many invalid attempts. Please request a new code.'));
      }
      if (errorType === 'EXPIRED_OTP') {
        return reply.status(400).send(createErrorResponse('EXPIRED_OTP', 'Verification code has expired. Please request a new code.'));
      }
      return reply.status(400).send(createErrorResponse('INVALID_OTP', 'Invalid or expired 6-digit OTP verification code'));
    }

    // Mark Email Verified & Active for verified user
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    // Create Authenticated Session Token (Strict 24-Hour TTL / 1-Day Policy)
    const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const userSession = await prisma.userSession.create({
      data: {
        userId: updatedUser.id,
        tokenHash,
        expiresAt
      }
    });

    const csrfToken = generateCsrfToken({
      id: userSession.id,
      tokenHash: userSession.tokenHash
    });

    await prisma.auditEvent.create({
      data: {
        userId: updatedUser.id,
        eventType: 'EMAIL_VERIFIED'
      }
    });

    // Non-blocking notification event emissions
    const clientIp = resolveClientIp(request);
    const userAgentHeader = request.headers['user-agent'] as string | undefined;

    if (regResult.valid) {
      accountEventProducer.emitAccountCreated(updatedUser.id, updatedUser.email, updatedUser.fullName || undefined).catch(() => {});
      await CustomerActivityService.recordEventSafe({
        userId: updatedUser.id,
        eventType: 'ACCOUNT.CREATED',
        idempotencyKey: `acct_created_${updatedUser.id}`,
        metadata: { email: updatedUser.email }
      });
      await CustomerActivityService.recordEventSafe({
        userId: updatedUser.id,
        eventType: 'ACCOUNT.EMAIL_VERIFIED',
        idempotencyKey: `email_verified_${updatedUser.id}`,
        metadata: { email: updatedUser.email }
      });
    }
    accountEventProducer.emitSignIn(
      updatedUser.id,
      updatedUser.email,
      clientIp,
      userAgentHeader,
      updatedUser.fullName || undefined
    ).catch(() => {});
    await CustomerActivityService.recordEventSafe({
      userId: updatedUser.id,
      eventType: 'AUTH.SIGN_IN_SUCCEEDED',
      ipAddress: clientIp,
      userAgent: userAgentHeader,
      metadata: {
        authMethod: regResult.valid ? 'REGISTRATION_OTP' : 'EMAIL_OTP_2FA'
      }
    });

    // Attach HttpOnly, Secure, SameSite=Lax __Host-zdex_session cookie for browser clients
    reply.setCookie(
      CUSTOMER_SESSION_COOKIE_NAME,
      token,
      getCustomerSessionCookieOptions(config.NODE_ENV === 'production')
    );

    return reply.status(200).send(createSuccessResponse({
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        status: updatedUser.status,
        emailVerified: updatedUser.emailVerified,
        createdAt: updatedUser.createdAt.toISOString()
      },
      session: {
        accessToken: token,
        refreshToken: token,
        expiresAt: expiresAt.toISOString()
      },
      token,
      csrfToken
    }));
  };

  /**
   * POST /api/v1/auth/verify-otp & POST /api/v1/auth/verify-email
   * Step 2 of Email/Password Flow: Verifies 6-digit OTP code, marks user ACTIVE, and issues session token.
   */
  app.post(
    '/auth/verify-otp',
    {
      config: {
        rateLimit: authOtpVerifyRateLimitConfig
      }
    },
    handleVerifyOtp
  );
  app.post(
    '/auth/verify-email',
    {
      config: {
        rateLimit: authOtpVerifyRateLimitConfig
      }
    },
    handleVerifyOtp
  );

  /**
   * POST /api/v1/auth/login
   * Step 1 of Email/Password Login: Validates credentials and sends 6-digit Email OTP (Mandatory 2FA step).
   */
  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: authStrictRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError('Email and password required');
    }

    const email = body.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash || !verifyPassword(body.data.password, user.passwordHash)) {
      await prisma.auditEvent.create({
        data: {
          eventType: 'LOGIN_ATTEMPT_FAILED',
          metadata: { email }
        }
      });
      if (user) {
        await CustomerActivityService.recordEventSafe({
          userId: user.id,
          eventType: 'AUTH.SIGN_IN_FAILED',
          ipAddress: resolveClientIp(request),
          userAgent: request.headers['user-agent'] as string | undefined,
          metadata: { reasonLabel: 'Invalid password' }
        });
      }
      // Generic credentials error to prevent timing/enumeration leakage
      return reply.status(401).send(createErrorResponse('INVALID_CREDENTIALS', 'Invalid email or password'));
    }

    if (user.status === 'SUSPENDED') {
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          eventType: 'LOGIN_ATTEMPT_FAILED',
          metadata: { email, reason: 'ACCOUNT_SUSPENDED' }
        }
      });
      await CustomerActivityService.recordEventSafe({
        userId: user.id,
        eventType: 'AUTH.SIGN_IN_FAILED',
        ipAddress: resolveClientIp(request),
        userAgent: request.headers['user-agent'] as string | undefined,
        metadata: { reasonLabel: 'Account suspended' }
      });
      return reply.status(403).send(createErrorResponse('ACCOUNT_SUSPENDED', 'This account has been suspended. Please contact support.'));
    }

    // Issue 6-Digit Email OTP for 2FA
    await issueEmailOtp(user.id, email, 'LOGIN_2FA');

    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        eventType: 'OTP_SENT',
        metadata: { purpose: 'LOGIN_2FA' }
      }
    });

    return reply.status(200).send(createSuccessResponse({
      requiresOtp: true,
      email,
      message: 'OTP verification code sent to your email'
    }));
  });

  /**
   * POST /api/v1/auth/resend-otp & POST /api/v1/auth/resend-verification
   * Resends 6-digit OTP code with generic account enumeration protection and rate-limiting.
   */
  const handleResendOtp = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = resendOtpSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError('Valid email address required');
    }

    const email = body.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const purpose = user.emailVerified ? 'LOGIN_2FA' : 'REGISTRATION_VERIFICATION';
      try {
        await issueEmailOtp(user.id, email, purpose);
      } catch (err: any) {
        if (err?.code === 'RESEND_COOLDOWN_ACTIVE') {
          return reply.status(429).send(createErrorResponse('RESEND_COOLDOWN_ACTIVE', err.message));
        }
        throw err;
      }
    }

    // Always return generic response to prevent account enumeration
    return reply.status(200).send(createSuccessResponse({
      message: 'If an account exists, a new verification code has been dispatched.'
    }));
  };

  app.post(
    '/auth/resend-otp',
    {
      config: {
        rateLimit: authResendOtpRateLimitConfig
      }
    },
    handleResendOtp
  );
  app.post(
    '/auth/resend-verification',
    {
      config: {
        rateLimit: authResendOtpRateLimitConfig
      }
    },
    handleResendOtp
  );

  /**
   * POST /api/v1/auth/forgot-password
   * Dispatches 6-digit password reset OTP to user email.
   * Returns identical generic success response whether email exists or not to prevent account enumeration.
   */
  app.post(
    '/auth/forgot-password',
    {
      config: {
        rateLimit: authResendOtpRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const body = forgotPasswordSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError('Valid email address required');
    }

    const email = body.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.status === 'ACTIVE' && user.emailVerified) {
      try {
        await issueEmailOtp(user.id, email, 'PASSWORD_RESET');
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: 'PASSWORD_RESET_REQUESTED'
          }
        });
        await CustomerActivityService.recordEventSafe({
          userId: user.id,
          eventType: 'SECURITY.PASSWORD_RESET_REQUESTED',
          ipAddress: resolveClientIp(request),
          userAgent: request.headers['user-agent'] as string | undefined
        });
      } catch (err: any) {
        if (err?.code === 'RESEND_COOLDOWN_ACTIVE') {
          return reply.status(429).send(createErrorResponse('RESEND_COOLDOWN_ACTIVE', err.message));
        }
        throw err;
      }
    }

    // Generic response preventing email enumeration
    return reply.status(200).send(createSuccessResponse({
      message: 'If an account exists for this email, a password reset code has been sent.',
      expiresInSeconds: config.PASSWORD_RESET_OTP_EXPIRY_SECONDS,
      cooldownSeconds: config.OTP_RESEND_COOLDOWN_SECONDS
    }));
  });

  /**
   * POST /api/v1/auth/verify-password-reset-otp
   * Validates 6-digit password reset OTP code before asking for the new password.
   * Uses non-consuming verification (consume: false) while still enforcing expiry and attempt limits
   * so that the verified OTP remains available for atomic consumption in POST /api/v1/auth/reset-password.
   */
  app.post(
    '/auth/verify-password-reset-otp',
    {
      config: {
        rateLimit: authOtpVerifyRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const body = verifyPasswordResetOtpSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError('Invalid password reset parameters');
    }

    const email = body.data.email.trim().toLowerCase();
    const code = (body.data.otp || body.data.code || body.data.otpCode || '').trim();

    if (!/^\d{6}$/.test(code)) {
      throw new ValidationError('A valid 6-digit numeric verification code is required');
    }

    const result = await verifyEmailOtp(email, code, 'PASSWORD_RESET', { consume: false });

    if (!result.valid) {
      if (result.error === 'TOO_MANY_ATTEMPTS') {
        return reply.status(429).send(createErrorResponse('TOO_MANY_ATTEMPTS', 'Too many invalid attempts. Please request a new reset code.'));
      }
      if (result.error === 'EXPIRED_OTP') {
        return reply.status(400).send(createErrorResponse('EXPIRED_OTP', 'Reset code has expired. Please request a new code.'));
      }
      return reply.status(400).send(createErrorResponse('INVALID_OTP', 'Invalid or expired password reset code'));
    }

    return reply.status(200).send(createSuccessResponse({
      valid: true,
      email,
      message: 'Reset code verified successfully'
    }));
  });

  /**
   * POST /api/v1/auth/reset-password
   * Finalizes password reset: Validates authoritative password policy and confirmation, verifies and
   * atomically consumes the PASSWORD_RESET OTP, hashes new password, invalidates all sessions,
   * revokes device credentials, records audit/activity events, and emits security notification.
   */
  app.post(
    '/auth/reset-password',
    {
      config: {
        rateLimit: authStrictRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const body = resetPasswordSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(
        createErrorResponse('VALIDATION_ERROR', body.error.errors[0]?.message || 'Invalid password reset parameters')
      );
    }

    if (body.data.confirmPassword !== undefined && body.data.newPassword !== body.data.confirmPassword) {
      return reply.status(400).send(
        createErrorResponse('CONFIRMATION_MISMATCH', 'New password and confirmation do not match')
      );
    }

    const email = body.data.email.trim().toLowerCase();
    const code = (body.data.otp || body.data.code || body.data.otpCode || '').trim();

    if (!/^\d{6}$/.test(code)) {
      return reply.status(400).send(
        createErrorResponse('INVALID_OTP', 'A valid 6-digit numeric verification code is required')
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE' || !user.emailVerified) {
      // Return identical error to invalid OTP to avoid leaking account existence, verification, or status
      return reply.status(400).send(createErrorResponse('INVALID_OTP', 'Invalid or expired password reset code'));
    }

    // Disallow setting the exact same password as the current password
    if (user.passwordHash && verifyPassword(body.data.newPassword, user.passwordHash)) {
      return reply.status(400).send(
        createErrorResponse('PASSWORD_UNCHANGED', 'New password must be different from your current password')
      );
    }

    // Verify OTP for password reset (bound to user.id and PASSWORD_RESET purpose, excluding pwdchg: OTPs)
    const result = await verifyEmailOtp(email, code, 'PASSWORD_RESET', {
      consume: false,
      expectedUserId: user.id
    });
    if (!result.valid || !result.otpRecordId) {
      if (result.error === 'TOO_MANY_ATTEMPTS') {
        return reply.status(429).send(createErrorResponse('TOO_MANY_ATTEMPTS', 'Too many invalid attempts. Please request a new reset code.'));
      }
      if (result.error === 'EXPIRED_OTP') {
        return reply.status(400).send(createErrorResponse('EXPIRED_OTP', 'Reset code has expired. Please request a new code.'));
      }
      return reply.status(400).send(createErrorResponse('INVALID_OTP', 'Invalid or expired password reset code'));
    }

    // Update password hash & ensure account is active, invalidate sessions, and revoke device credentials atomically
    const newPasswordHash = hashPassword(body.data.newPassword);
    const now = new Date();
    const otpRecordId = result.otpRecordId;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Atomically consume the verified recovery OTP to prevent concurrent replay
        const consumed = await tx.emailOtp.updateMany({
          where: {
            id: otpRecordId,
            userId: user.id,
            purpose: 'PASSWORD_RESET',
            used: false,
            NOT: { otpCode: { startsWith: 'pwdchg:' } }
          },
          data: {
            used: true
          }
        });

        if (consumed.count !== 1) {
          const replayErr = new Error('Reset code has already been used');
          (replayErr as any).code = 'OTP_ALREADY_USED';
          throw replayErr;
        }

        // 2. Invalidate any other remaining unconsumed recovery OTPs for this user
        await tx.emailOtp.updateMany({
          where: {
            userId: user.id,
            purpose: 'PASSWORD_RESET',
            used: false,
            NOT: { otpCode: { startsWith: 'pwdchg:' } }
          },
          data: {
            used: true
          }
        });

        // 3. Update User passwordHash (preserving existing ACTIVE status and emailVerified)
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: newPasswordHash
          }
        });

        // 4. Invalidate all active user sessions on password reset
        await tx.userSession.deleteMany({
          where: { userId: user.id }
        });

        // 5. SEC-14.7-01: Revoke all active device credentials for the user
        await tx.deviceAuthCredential.updateMany({
          where: {
            userId: user.id,
            revokedAt: null
          },
          data: {
            revokedAt: now
          }
        });

        // 6. Audit Log for Password Reset
        await tx.auditEvent.create({
          data: {
            userId: user.id,
            eventType: 'PASSWORD_RESET_SUCCESS',
            metadata: {
              operation: 'FORGOT_PASSWORD_RECOVERY'
            }
          }
        });

        // 7. Audit Log for Device Credential Revocation
        await tx.auditEvent.create({
          data: {
            userId: user.id,
            eventType: 'DEVICE_CREDENTIAL_REVOKED',
            metadata: {
              reason: 'PASSWORD_RESET',
              revokedAt: now.toISOString()
            }
          }
        });
      });
    } catch (err: any) {
      if (err?.code === 'OTP_ALREADY_USED') {
        return reply.status(400).send(
          createErrorResponse('INVALID_OTP', 'Invalid or expired password reset code')
        );
      }
      throw err;
    }

    const resetIp = resolveClientIp(request);
    const resetUa = request.headers['user-agent'] as string | undefined;
    await CustomerActivityService.recordEventSafe({
      userId: user.id,
      eventType: 'SECURITY.PASSWORD_RESET_COMPLETED',
      ipAddress: resetIp,
      userAgent: resetUa,
      occurredAt: now,
      metadata: {
        sessionsInvalidated: true
      }
    });
    await CustomerActivityService.recordEventSafe({
      userId: user.id,
      eventType: 'SECURITY.DEVICE_CREDENTIALS_REVOKED',
      occurredAt: now,
      metadata: {
        deviceName: 'all linked devices',
        reasonLabel: 'Password reset'
      }
    });

    await accountEventProducer.emitSecurityEvent(
      user.id,
      'Your ZdexCloud account password was reset via email recovery and all active sessions were signed out.'
    ).catch(() => {});

    // Clear any active browser session cookie upon password reset
    reply.clearCookie(
      CUSTOMER_SESSION_COOKIE_NAME,
      getCustomerSessionCookieClearOptions(config.NODE_ENV === 'production')
    );

    return reply.status(200).send(createSuccessResponse({
      passwordReset: true,
      sessionRevoked: true,
      deviceCredentialsRevoked: true,
      message: 'Password has been reset successfully. You can now log in with your new password.'
    }));
  });

  /**
   * GET /api/v1/auth/me & POST /api/v1/auth/session/verify
   * Resolves currently authenticated user from Dual-Mode Credential (Bearer Token or HttpOnly Cookie)
   */
  const handleVerifySession = async (request: FastifyRequest) => {
    const { token, source } = extractCustomerToken(request);
    if (!token) {
      throw new UnauthorizedError('Missing or invalid authentication credential');
    }

    const resolved = await resolveCustomerSession(token);
    if (!resolved) {
      throw new UnauthorizedError('Session expired or invalid');
    }

    request.customerAuthSource = source || undefined;
    request.customerSession = resolved.session;

    const csrfToken = generateCsrfToken({
      id: resolved.session.id,
      tokenHash: resolved.session.tokenHash
    });

    return createSuccessResponse({
      user: {
        id: resolved.user.id,
        email: resolved.user.email,
        fullName: resolved.user.fullName,
        status: resolved.user.status,
        emailVerified: resolved.user.emailVerified,
        createdAt: resolved.user.createdAt.toISOString()
      },
      session: {
        accessToken: token,
        refreshToken: token,
        expiresAt: resolved.session.expiresAt.toISOString(),
        issuedAt: resolved.session.createdAt?.toISOString() || resolved.session.expiresAt.toISOString()
      },
      token,
      csrfToken
    });
  };

  app.get(
    '/auth/me',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    handleVerifySession
  );
  app.post(
    '/auth/session/verify',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    handleVerifySession
  );

  /**
   * POST /api/v1/auth/logout
   * Invalidates active session token in database and clears browser session cookie
   */
  app.post(
    '/auth/logout',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = extractCustomerToken(request);
    if (token) {
      const resolved = await resolveCustomerSession(token).catch(() => null);
      const tokenHash = hashSessionToken(token);
      await prisma.userSession.deleteMany({ where: { tokenHash } });
      if (resolved?.user?.id) {
        await CustomerActivityService.recordEventSafe({
          userId: resolved.user.id,
          eventType: 'AUTH.SIGN_OUT',
          ipAddress: resolveClientIp(request),
          userAgent: request.headers['user-agent'] as string | undefined
        });
      }
    }

    // Always clear the customer browser session cookie upon logout
    reply.clearCookie(
      CUSTOMER_SESSION_COOKIE_NAME,
      getCustomerSessionCookieClearOptions(config.NODE_ENV === 'production')
    );

    return reply.status(200).send(createSuccessResponse({ message: 'Logged out successfully' }));
  });

  /**
   * POST /api/v1/auth/change-password/request-otp
   * Step 1 of Authenticated Password Change:
   * - Requires active customer session (and CSRF token for cookie-authenticated sessions)
   * - Validates currentPassword, newPassword policy, confirmPassword match, and newPassword !== currentPassword
   * - Verifies currentPassword against the user's stored passwordHash
   * - Issues an operation-bound, user-bound 6-digit email OTP
   */
  app.post(
    '/auth/change-password/request-otp',
    {
      preHandler: [customerAuthenticate],
      config: {
        rateLimit: authResendOtpRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user?.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const parsed = changePasswordRequestOtpSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorResponse('VALIDATION_ERROR', parsed.error.errors[0]?.message || 'Invalid password change request')
        );
      }

      const { currentPassword, newPassword, confirmPassword } = parsed.data;

      if (newPassword !== confirmPassword) {
        return reply.status(400).send(
          createErrorResponse('CONFIRMATION_MISMATCH', 'New password and confirmation do not match')
        );
      }

      if (newPassword === currentPassword) {
        return reply.status(400).send(
          createErrorResponse('PASSWORD_UNCHANGED', 'New password must be different from your current password')
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: request.user.id }
      });

      if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
        throw new UnauthorizedError('Account is not active or cannot be authenticated');
      }

      const isCurrentPasswordValid = verifyPassword(currentPassword, user.passwordHash);
      if (!isCurrentPasswordValid) {
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: 'LOGIN_ATTEMPT_FAILED',
            metadata: {
              reason: 'INVALID_CURRENT_PASSWORD_ON_CHANGE'
            }
          }
        }).catch(() => {});

        return reply.status(400).send(
          createErrorResponse('INVALID_CURRENT_PASSWORD', 'The current password you entered is incorrect.')
        );
      }

      if (verifyPassword(newPassword, user.passwordHash)) {
        return reply.status(400).send(
          createErrorResponse('PASSWORD_UNCHANGED', 'New password must be different from your current password')
        );
      }

      try {
        await issuePasswordChangeOtp(user.id, user.email);
      } catch (err: any) {
        if (err?.code === 'RESEND_COOLDOWN_ACTIVE') {
          return reply.status(429).send(
            createErrorResponse('RESEND_COOLDOWN_ACTIVE', err.message)
          );
        }
        throw err;
      }

      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          eventType: 'OTP_SENT',
          metadata: {
            purpose: 'PASSWORD_CHANGE'
          }
        }
      }).catch(() => {});

      return reply.status(200).send(createSuccessResponse({
        requiresOtp: true,
        emailMasked: maskEmailAddress(user.email),
        expiresInSeconds: config.PASSWORD_RESET_OTP_EXPIRY_SECONDS,
        cooldownSeconds: config.OTP_RESEND_COOLDOWN_SECONDS,
        message: 'A 6-digit verification code has been sent to your account email.'
      }));
    }
  );

  /**
   * POST /api/v1/auth/change-password/confirm
   * Step 2 of Authenticated Password Change:
   * - Requires active customer session (and CSRF token for cookie-authenticated sessions)
   * - Re-validates currentPassword, newPassword policy, confirmPassword match, and newPassword !== currentPassword
   * - Verifies the operation-bound, user-bound 6-digit email OTP
   * - Atomically consumes OTP, updates passwordHash, deletes all active UserSession records,
   *   revokes all active DeviceAuthCredential records, and records AuditEvent entries
   * - Records CustomerActivityEvent entries and emits security notification
   * - Clears the customer session cookie so the user must sign in again with the new password
   */
  app.post(
    '/auth/change-password/confirm',
    {
      preHandler: [customerAuthenticate],
      config: {
        rateLimit: authStrictRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user?.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const parsed = changePasswordConfirmSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorResponse('VALIDATION_ERROR', parsed.error.errors[0]?.message || 'Invalid password change confirmation request')
        );
      }

      const { currentPassword, newPassword, confirmPassword } = parsed.data;
      const code = (parsed.data.otp || parsed.data.code || parsed.data.otpCode || '').trim();

      if (newPassword !== confirmPassword) {
        return reply.status(400).send(
          createErrorResponse('CONFIRMATION_MISMATCH', 'New password and confirmation do not match')
        );
      }

      if (newPassword === currentPassword) {
        return reply.status(400).send(
          createErrorResponse('PASSWORD_UNCHANGED', 'New password must be different from your current password')
        );
      }

      if (!/^\d{6}$/.test(code)) {
        return reply.status(400).send(
          createErrorResponse('INVALID_OTP', 'A valid 6-digit numeric verification code is required')
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: request.user.id }
      });

      if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
        throw new UnauthorizedError('Account is not active or cannot be authenticated');
      }

      const isCurrentPasswordValid = verifyPassword(currentPassword, user.passwordHash);
      if (!isCurrentPasswordValid) {
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: 'LOGIN_ATTEMPT_FAILED',
            metadata: {
              reason: 'INVALID_CURRENT_PASSWORD_ON_CHANGE_CONFIRM'
            }
          }
        }).catch(() => {});

        return reply.status(400).send(
          createErrorResponse('INVALID_CURRENT_PASSWORD', 'The current password you entered is incorrect.')
        );
      }

      if (verifyPassword(newPassword, user.passwordHash)) {
        return reply.status(400).send(
          createErrorResponse('PASSWORD_UNCHANGED', 'New password must be different from your current password')
        );
      }

      const otpResult = await verifyPasswordChangeOtp(user.id, user.email, code, { consume: false });
      if (!otpResult.valid || !otpResult.otpRecordId) {
        if (otpResult.error === 'TOO_MANY_ATTEMPTS') {
          return reply.status(429).send(
            createErrorResponse('TOO_MANY_ATTEMPTS', 'Too many invalid verification attempts. Please request a new verification code.')
          );
        }
        if (otpResult.error === 'EXPIRED_OTP') {
          return reply.status(400).send(
            createErrorResponse('EXPIRED_OTP', 'Verification code has expired. Please request a new code.')
          );
        }
        return reply.status(400).send(
          createErrorResponse('INVALID_OTP', 'Invalid or expired verification code.')
        );
      }

      const newPasswordHash = hashPassword(newPassword);
      const now = new Date();
      const otpRecordId = otpResult.otpRecordId;

      try {
        await prisma.$transaction(async (tx) => {
          // 1. Atomically consume the verified password-change OTP to prevent concurrent replay
          const consumed = await tx.emailOtp.updateMany({
            where: {
              id: otpRecordId,
              userId: user.id,
              used: false
            },
            data: {
              used: true
            }
          });

          if (consumed.count !== 1) {
            const replayErr = new Error('Verification code has already been used');
            (replayErr as any).code = 'OTP_ALREADY_USED';
            throw replayErr;
          }

          // 2. Invalidate any other remaining unconsumed password-change OTPs for this user
          await tx.emailOtp.updateMany({
            where: {
              userId: user.id,
              purpose: 'PASSWORD_RESET',
              otpCode: { startsWith: `pwdchg:${user.id}:` },
              used: false
            },
            data: {
              used: true
            }
          });

          // 3. Update User passwordHash
          await tx.user.update({
            where: { id: user.id },
            data: {
              passwordHash: newPasswordHash
            }
          });

          // 4. Revoke all active web/customer sessions for the user
          await tx.userSession.deleteMany({
            where: { userId: user.id }
          });

          // 5. Revoke all active paired device credentials for the user
          await tx.deviceAuthCredential.updateMany({
            where: {
              userId: user.id,
              revokedAt: null
            },
            data: {
              revokedAt: now
            }
          });

          // 6. Audit Log for Authenticated Password Change
          await tx.auditEvent.create({
            data: {
              userId: user.id,
              eventType: 'PASSWORD_RESET_SUCCESS',
              metadata: {
                operation: 'AUTHENTICATED_PASSWORD_CHANGE'
              }
            }
          });

          // 7. Audit Log for Device Credential Revocation
          await tx.auditEvent.create({
            data: {
              userId: user.id,
              eventType: 'DEVICE_CREDENTIAL_REVOKED',
              metadata: {
                reason: 'PASSWORD_CHANGE',
                revokedAt: now.toISOString()
              }
            }
          });
        });
      } catch (err: any) {
        if (err?.code === 'OTP_ALREADY_USED') {
          return reply.status(400).send(
            createErrorResponse('INVALID_OTP', 'Invalid or expired verification code.')
          );
        }
        throw err;
      }

      const clientIp = resolveClientIp(request);
      const clientUa = request.headers['user-agent'] as string | undefined;

      await CustomerActivityService.recordEventSafe({
        userId: user.id,
        eventType: 'SECURITY.PASSWORD_CHANGED',
        ipAddress: clientIp,
        userAgent: clientUa,
        occurredAt: now,
        metadata: {
          sessionsInvalidated: true
        }
      });

      await CustomerActivityService.recordEventSafe({
        userId: user.id,
        eventType: 'SECURITY.DEVICE_CREDENTIALS_REVOKED',
        occurredAt: now,
        metadata: {
          deviceName: 'all linked devices',
          reasonLabel: 'Password changed'
        }
      });

      await accountEventProducer.emitSecurityEvent(
        user.id,
        'Your ZdexCloud account password was changed from Account Settings and all active sessions were signed out.'
      ).catch(() => {});

      // Clear active browser session cookie since all sessions were revoked
      reply.clearCookie(
        CUSTOMER_SESSION_COOKIE_NAME,
        getCustomerSessionCookieClearOptions(config.NODE_ENV === 'production')
      );

      return reply.status(200).send(createSuccessResponse({
        passwordChanged: true,
        sessionRevoked: true,
        deviceCredentialsRevoked: true,
        requiresReauthentication: true,
        message: 'Your password has been changed successfully. All active sessions and linked device tokens have been revoked. Please sign in again with your new password.'
      }));
    }
  );

}

