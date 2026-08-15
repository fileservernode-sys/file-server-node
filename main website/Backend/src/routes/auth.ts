import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { hashPassword, verifyPassword, generateSessionToken } from '../utils/crypto.js';
import { issueEmailOtp, verifyEmailOtp } from '../utils/otp.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError } from '../errors/app-error.js';

// Input Validation Schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1).optional()
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(6).max(6).optional(),
  code: z.string().min(6).max(6).optional(),
  otpCode: z.string().min(6).max(6).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const resendOtpSchema = z.object({
  email: z.string().email()
});

export async function authRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/auth/register
   * Step 1 of Email/Password Account Creation: Creates PENDING_VERIFICATION user and dispatches OTP.
   */
  app.post('/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError('Invalid registration parameters: Email and 8+ character password required');
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
   * POST /api/v1/auth/verify-otp
   * Step 2 of Email/Password Flow: Verifies 6-digit OTP code, marks user ACTIVE, and issues session token.
   */
  app.post('/auth/verify-otp', async (request: FastifyRequest, reply: FastifyReply) => {
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
    const isRegValid = await verifyEmailOtp(email, code, 'REGISTRATION_VERIFICATION');
    const isLoginValid = !isRegValid ? await verifyEmailOtp(email, code, 'LOGIN_2FA') : true;

    if (!isRegValid && !isLoginValid) {
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

    // Create Authenticated Session Token (30-day TTL)
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.userSession.create({
      data: {
        userId: updatedUser.id,
        token,
        expiresAt
      }
    });

    await prisma.auditEvent.create({
      data: {
        userId: updatedUser.id,
        eventType: 'EMAIL_VERIFIED'
      }
    });

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
      token
    }));
  });

  /**
   * POST /api/v1/auth/login
   * Step 1 of Email/Password Login: Validates credentials and sends 6-digit Email OTP (Mandatory 2FA step).
   */
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
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
      // Generic credentials error
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
   * POST /api/v1/auth/resend-otp
   * Resends 6-digit OTP code with generic account enumeration protection.
   */
  app.post('/auth/resend-otp', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = resendOtpSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError('Valid email address required');
    }

    const email = body.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const purpose = user.emailVerified ? 'LOGIN_2FA' : 'REGISTRATION_VERIFICATION';
      await issueEmailOtp(user.id, email, purpose);
    }

    // Always return generic response to prevent account enumeration
    return reply.status(200).send(createSuccessResponse({
      message: 'If an account exists, a new verification code has been dispatched.'
    }));
  });

  /**
   * GET /api/v1/auth/me & POST /api/v1/auth/session/verify
   * Resolves currently authenticated user from Bearer Token
   */
  const handleVerifySession = async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization Bearer header');
    }

    const token = authHeader.substring(7).trim();
    const session = await prisma.userSession.findFirst({
      where: {
        token,
        expiresAt: { gt: new Date() }
      },
      include: {
        user: true
      }
    });

    if (!session || !session.user) {
      throw new UnauthorizedError('Session expired or invalid');
    }

    return createSuccessResponse({
      user: {
        id: session.user.id,
        email: session.user.email,
        fullName: session.user.fullName,
        status: session.user.status,
        emailVerified: session.user.emailVerified,
        createdAt: session.user.createdAt.toISOString()
      }
    });
  };

  app.get('/auth/me', handleVerifySession);
  app.post('/auth/session/verify', handleVerifySession);

  /**
   * POST /api/v1/auth/logout
   * Invalidates active session token
   */
  app.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      await prisma.userSession.deleteMany({ where: { token } });
    }

    return reply.status(200).send(createSuccessResponse({ message: 'Logged out successfully' }));
  });

}
