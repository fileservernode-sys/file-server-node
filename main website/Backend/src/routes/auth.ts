import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import { hashPassword, verifyPassword, generateSessionToken, hashSessionToken } from '../utils/crypto.js';
import { issueEmailOtp, verifyEmailOtp } from '../utils/otp.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError } from '../errors/app-error.js';
import { accountEventProducer } from '../notifications/producers/account_producer.js';
import { resolveClientIp } from '../utils/ip.js';
import {
  CUSTOMER_SESSION_COOKIE_NAME,
  getCustomerSessionCookieOptions,
  getCustomerSessionCookieClearOptions
} from '../config/cookie.js';
import { extractCustomerToken, resolveCustomerSession } from '../middleware/customer-auth.js';
import { generateCsrfToken } from '../utils/csrf.js';
import {
  authStrictRateLimitConfig,
  authOtpVerifyRateLimitConfig,
  authResendOtpRateLimitConfig,
  customerStandardRateLimitConfig
} from '../middleware/rate_limit_presets.js';

// Input Validation Schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
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

const resetPasswordSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(6).max(6).optional(),
  code: z.string().min(6).max(6).optional(),
  otpCode: z.string().min(6).max(6).optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
}).refine(data => Boolean((data.otp || data.code || data.otpCode || '').trim()), {
  message: 'A 6-digit OTP verification code is required',
  path: ['otp']
});

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
      throw new ValidationError(body.error.errors[0]?.message || 'Invalid registration parameters');
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

    // Check registration or login OTP
    const regResult = await verifyEmailOtp(email, code, 'REGISTRATION_VERIFICATION');
    const loginResult = !regResult.valid ? await verifyEmailOtp(email, code, 'LOGIN_2FA') : { valid: false };

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

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new ValidationError('User account not found');
    }

    // Mark Email Verified & Active
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
    if (regResult.valid) {
      accountEventProducer.emitAccountCreated(updatedUser.id, updatedUser.email, updatedUser.fullName || undefined).catch(() => {});
    }
    accountEventProducer.emitSignIn(
      updatedUser.id,
      updatedUser.email,
      resolveClientIp(request),
      request.headers['user-agent'] as string,
      updatedUser.fullName || undefined
    ).catch(() => {});

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
      // Generic credentials error to prevent timing/enumeration leakage
      return reply.status(401).send(createErrorResponse('INVALID_CREDENTIALS', 'Invalid email or password'));
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

    if (user && user.status !== 'SUSPENDED') {
      try {
        await issueEmailOtp(user.id, email, 'PASSWORD_RESET');
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: 'PASSWORD_RESET_REQUESTED'
          }
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
      message: 'If an account exists for this email, a password reset code has been sent.'
    }));
  });

  /**
   * POST /api/v1/auth/verify-password-reset-otp
   * Validates 6-digit password reset OTP code before asking for the new password.
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

    if (code.length !== 6) {
      throw new ValidationError('A 6-digit OTP verification code is required');
    }

    const result = await verifyEmailOtp(email, code, 'PASSWORD_RESET');

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
   * Finalizes password reset: Verifies OTP, hashes new password, invalidates all sessions, and updates user.
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
      throw new ValidationError(body.error.errors[0]?.message || 'Invalid password reset parameters');
    }

    const email = body.data.email.trim().toLowerCase();
    const code = (body.data.otp || body.data.code || body.data.otpCode || '').trim();

    if (code.length !== 6) {
      throw new ValidationError('A 6-digit OTP verification code is required');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(400).send(createErrorResponse('INVALID_REQUEST', 'Password reset request cannot be completed'));
    }

    // Unconditionally verify OTP for password reset
    const result = await verifyEmailOtp(email, code, 'PASSWORD_RESET');
    if (!result.valid) {
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

    await prisma.$transaction(async (tx) => {
      // 1. Update User password and activation state
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newPasswordHash,
          status: 'ACTIVE',
          emailVerified: true
        }
      });

      // 2. Invalidate all active user sessions on password change
      await tx.userSession.deleteMany({
        where: { userId: user.id }
      });

      // 3. SEC-14.7-01: Revoke all active device credentials for the user
      await tx.deviceAuthCredential.updateMany({
        where: {
          userId: user.id,
          revokedAt: null
        },
        data: {
          revokedAt: now
        }
      });

      // 4. Audit Log for Password Reset
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          eventType: 'PASSWORD_RESET_SUCCESS'
        }
      });

      // 5. Audit Log for Device Credential Revocation
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

    // Clear any active browser session cookie upon password reset
    reply.clearCookie(
      CUSTOMER_SESSION_COOKIE_NAME,
      getCustomerSessionCookieClearOptions(config.NODE_ENV === 'production')
    );

    return reply.status(200).send(createSuccessResponse({
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
      const tokenHash = hashSessionToken(token);
      await prisma.userSession.deleteMany({ where: { tokenHash } });
    }

    // Always clear the customer browser session cookie upon logout
    reply.clearCookie(
      CUSTOMER_SESSION_COOKIE_NAME,
      getCustomerSessionCookieClearOptions(config.NODE_ENV === 'production')
    );

    return reply.status(200).send(createSuccessResponse({ message: 'Logged out successfully' }));
  });

}
