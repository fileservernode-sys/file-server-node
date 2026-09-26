import crypto from 'node:crypto';
import { AdminStatus, AdminAuditAction, AdminOtpPurpose } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { config } from '../../config/env.js';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  generateOtpCode,
  hashOtp,
  verifyOtpCode,
  hashSessionToken
} from '../../utils/crypto.js';
import { emailService } from '../email.js';
import { UnauthorizedError, ValidationError, AppError } from '../../errors/app-error.js';

// Configuration constants for Admin Security
export const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
export const ADMIN_SESSION_ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours
export const ADMIN_OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface FailedAttemptRecord {
  count: number;
  lockedUntil: number | null;
  lastAttempt: number;
}

// In-memory rate limiting & brute-force tracking
const failedAttemptsMap: Map<string, FailedAttemptRecord> = new Map();

function getRateLimitKey(ip: string, email: string): string {
  return `${ip.trim()}_${email.trim().toLowerCase()}`;
}

export function checkBruteForceLock(ip: string, email: string): void {
  const key = getRateLimitKey(ip, email);
  const record = failedAttemptsMap.get(key);
  if (!record) return;

  const now = Date.now();
  if (record.lockedUntil && record.lockedUntil > now) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    const err = new AppError(`Too many failed login attempts. Account locked for ${remainingSec} seconds.`, 429, 'RATE_LIMIT_EXCEEDED');
    throw err;
  }
}

export function recordFailedAttempt(ip: string, email: string): void {
  const key = getRateLimitKey(ip, email);
  const now = Date.now();
  const record = failedAttemptsMap.get(key) || { count: 0, lockedUntil: null, lastAttempt: now };

  record.count += 1;
  record.lastAttempt = now;

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
  }

  failedAttemptsMap.set(key, record);
}

export function clearFailedAttempts(ip: string, email: string): void {
  const key = getRateLimitKey(ip, email);
  failedAttemptsMap.delete(key);
}

export interface AdminUserSanitized {
  id: string;
  email: string;
  name: string;
  status: AdminStatus;
  isSuperAdmin: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AdminLoginResult {
  requiresOtp?: boolean;
  challengeToken?: string;
  sessionToken?: string;
  expiresAt?: string;
  admin?: AdminUserSanitized;
  message?: string;
}

export class AdminAuthService {
  /**
   * Generates a signed challenge token for 2FA OTP verification
   */
  private static generateChallengeToken(adminId: string, email: string): string {
    const payload = `${adminId}:${email.toLowerCase()}:${Date.now() + ADMIN_OTP_EXPIRY_MS}`;
    const hmacSecret = process.env.ADMIN_AUTH_SECRET || process.env.INTERNAL_SERVICE_KEY || 'zdex-admin-hmac-secret';
    const signature = crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64url');
  }

  /**
   * Verifies and unpacks a 2FA challenge token
   */
  private static verifyChallengeToken(token: string): { adminId: string; email: string } {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const parts = decoded.split(':');
      if (parts.length !== 4) {
        throw new ValidationError('Invalid challenge token format');
      }

      const [adminId, email, expiresAtStr, signature] = parts;
      const payload = `${adminId}:${email}:${expiresAtStr}`;
      const hmacSecret = process.env.ADMIN_AUTH_SECRET || process.env.INTERNAL_SERVICE_KEY || 'zdex-admin-hmac-secret';
      const expectedSignature = crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        throw new UnauthorizedError('Invalid challenge token signature');
      }

      if (Number(expiresAtStr) < Date.now()) {
        throw new UnauthorizedError('2FA challenge token has expired. Please log in again.');
      }

      return { adminId, email };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new UnauthorizedError('Invalid or malformed challenge token');
    }
  }

  /**
   * Initiates Admin login with email & password.
   * If OTP is provided, verifies directly; otherwise issues 2FA OTP and returns challengeToken.
   */
  static async login(params: {
    email: string;
    password: string;
    otp?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AdminLoginResult> {
    const { email, password, otp, ipAddress, userAgent } = params;
    const normalizedEmail = email.trim().toLowerCase();
    const clientIp = ipAddress || '127.0.0.1';

    // 1. Check Brute-Force Lockout
    checkBruteForceLock(clientIp, normalizedEmail);

    // 2. Locate AdminUser
    const admin = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail }
    });

    // Timing-safe verification dummy
    const dummyHash = '1234567890abcdef:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const isPasswordValid = admin ? verifyPassword(password, admin.passwordHash) : verifyPassword(password, dummyHash);

    if (!admin || !isPasswordValid) {
      recordFailedAttempt(clientIp, normalizedEmail);

      await prisma.adminAuditLog.create({
        data: {
          adminId: admin?.id || null,
          action: AdminAuditAction.ADMIN_LOGIN_FAILURE,
          status: 'FAILED',
          ipAddress: clientIp,
          userAgent: userAgent || null,
          metadata: { email: normalizedEmail, reason: 'INVALID_CREDENTIALS' }
        }
      });

      throw new UnauthorizedError('Invalid email or password');
    }

    // 3. Verify Admin Status
    if (admin.status !== AdminStatus.ACTIVE) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.id,
          action: AdminAuditAction.ADMIN_AUTH_BLOCKED,
          status: 'BLOCKED',
          ipAddress: clientIp,
          userAgent: userAgent || null,
          metadata: { email: normalizedEmail, status: admin.status, reason: 'ACCOUNT_DISABLED' }
        }
      });

      throw new UnauthorizedError('Admin account is disabled');
    }

    // 4. If direct OTP was provided, verify it directly
    if (otp && otp.trim().length === 6) {
      return this.completeLoginWithOtp({
        admin,
        otp: otp.trim(),
        ipAddress: clientIp,
        userAgent
      });
    }

    // 5. Issue 2FA OTP & Challenge Token
    const otpCode = generateOtpCode();
    const otpHash = hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + ADMIN_OTP_EXPIRY_MS);

    // Invalidate prior unused OTPs
    await prisma.adminEmailOtp.updateMany({
      where: { adminId: admin.id, purpose: AdminOtpPurpose.ADMIN_LOGIN_2FA, isUsed: false },
      data: { isUsed: true }
    });

    // Persist hashed OTP
    await prisma.adminEmailOtp.create({
      data: {
        adminId: admin.id,
        email: normalizedEmail,
        otpHash,
        purpose: AdminOtpPurpose.ADMIN_LOGIN_2FA,
        expiresAt,
        isUsed: false,
        attempts: 0
      }
    });

    // Send email with OTP
    try {
      await emailService.sendLoginOtp(normalizedEmail, otpCode);
    } catch {
      // Allow delivery fallback without leaking secret
    }

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_OTP_SENT,
        status: 'SUCCESS',
        ipAddress: clientIp,
        userAgent: userAgent || null,
        metadata: { email: normalizedEmail }
      }
    });

    const challengeToken = this.generateChallengeToken(admin.id, normalizedEmail);

    return {
      requiresOtp: true,
      challengeToken,
      message: 'Two-factor verification code sent to admin email'
    };
  }

  /**
   * Completes 2FA OTP verification and establishes AdminSession
   */
  static async verifyOtpAndLogin(params: {
    challengeToken: string;
    otp: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AdminLoginResult> {
    const { challengeToken, otp, ipAddress, userAgent } = params;
    const clientIp = ipAddress || '127.0.0.1';

    const { adminId, email } = this.verifyChallengeToken(challengeToken);

    checkBruteForceLock(clientIp, email);

    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId }
    });

    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedError('Admin user not found or inactive');
    }

    return this.completeLoginWithOtp({
      admin,
      otp: otp.trim(),
      ipAddress: clientIp,
      userAgent
    });
  }

  /**
   * Internal helper to verify OTP and create AdminSession
   */
  private static async completeLoginWithOtp(params: {
    admin: any;
    otp: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<AdminLoginResult> {
    const { admin, otp, ipAddress, userAgent } = params;

    // Find active unused OTP
    const activeOtp = await prisma.adminEmailOtp.findFirst({
      where: {
        adminId: admin.id,
        purpose: AdminOtpPurpose.ADMIN_LOGIN_2FA,
        isUsed: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!activeOtp) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.id,
          action: AdminAuditAction.ADMIN_OTP_FAILED,
          status: 'FAILED',
          ipAddress,
          userAgent: userAgent || null,
          metadata: { reason: 'NO_ACTIVE_OTP' }
        }
      });
      throw new UnauthorizedError('Invalid or expired verification code');
    }

    // Check attempt limits on OTP
    if (activeOtp.attempts >= 5) {
      await prisma.adminEmailOtp.update({
        where: { id: activeOtp.id },
        data: { isUsed: true }
      });
      recordFailedAttempt(ipAddress, admin.email);
      throw new UnauthorizedError('Too many failed verification attempts. Please log in again.');
    }

    const isValid = verifyOtpCode(otp, activeOtp.otpHash);

    if (!isValid) {
      await prisma.adminEmailOtp.update({
        where: { id: activeOtp.id },
        data: { attempts: activeOtp.attempts + 1 }
      });

      recordFailedAttempt(ipAddress, admin.email);

      await prisma.adminAuditLog.create({
        data: {
          adminId: admin.id,
          action: AdminAuditAction.ADMIN_OTP_FAILED,
          status: 'FAILED',
          ipAddress,
          userAgent: userAgent || null,
          metadata: { attempt: activeOtp.attempts + 1 }
        }
      });

      throw new UnauthorizedError('Invalid verification code');
    }

    // Mark OTP as used
    await prisma.adminEmailOtp.update({
      where: { id: activeOtp.id },
      data: { isUsed: true }
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_OTP_VERIFIED,
        status: 'SUCCESS',
        ipAddress,
        userAgent: userAgent || null
      }
    });

    // Clear failed attempts upon successful authentication
    clearFailedAttempts(ipAddress, admin.email);

    // Create AdminSession with SHA-256 token hashing
    const rawToken = generateSessionToken();
    const sessionTokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_ABSOLUTE_LIFETIME_MS);
    const now = new Date();

    const session = await prisma.adminSession.create({
      data: {
        adminId: admin.id,
        sessionTokenHash,
        expiresAt,
        lastActivityAt: now,
        ipAddress,
        userAgent: userAgent || null
      }
    });

    // Update lastLoginAt on admin
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: now }
    });

    // Log Successful Login
    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_LOGIN_SUCCESS,
        status: 'SUCCESS',
        ipAddress,
        userAgent: userAgent || null,
        metadata: { sessionId: session.id }
      }
    });

    const sanitizedAdmin: AdminUserSanitized = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      status: admin.status,
      isSuperAdmin: admin.isSuperAdmin,
      lastLoginAt: now,
      createdAt: admin.createdAt
    };

    return {
      sessionToken: rawToken,
      expiresAt: expiresAt.toISOString(),
      admin: sanitizedAdmin
    };
  }

  /**
   * Resolves and validates an active AdminSession from a raw token
   */
  static async validateSession(rawToken: string, ipAddress?: string): Promise<{
    session: any;
    admin: AdminUserSanitized;
  } | null> {
    if (!rawToken || typeof rawToken !== 'string') return null;

    const tokenHash = hashSessionToken(rawToken);
    const session = await prisma.adminSession.findUnique({
      where: { sessionTokenHash: tokenHash },
      include: { admin: true }
    });

    if (!session || !session.admin) return null;

    // Check revocation
    if (session.revokedAt) {
      return null;
    }

    const now = Date.now();

    // Check absolute expiration
    if (session.expiresAt.getTime() <= now) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: session.adminId,
          action: AdminAuditAction.ADMIN_SESSION_EXPIRED,
          status: 'EXPIRED',
          ipAddress: ipAddress || null,
          metadata: { reason: 'ABSOLUTE_EXPIRATION' }
        }
      });
      return null;
    }

    // Check 15-minute idle timeout
    if (now - session.lastActivityAt.getTime() > ADMIN_IDLE_TIMEOUT_MS) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: session.adminId,
          action: AdminAuditAction.ADMIN_SESSION_EXPIRED,
          status: 'EXPIRED',
          ipAddress: ipAddress || null,
          metadata: { reason: 'IDLE_TIMEOUT', lastActivityAt: session.lastActivityAt.toISOString() }
        }
      });
      return null;
    }

    // Check Admin status
    if (session.admin.status !== AdminStatus.ACTIVE) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: session.adminId,
          action: AdminAuditAction.ADMIN_AUTH_BLOCKED,
          status: 'BLOCKED',
          ipAddress: ipAddress || null,
          metadata: { reason: 'ADMIN_DISABLED' }
        }
      });
      return null;
    }

    // Refresh lastActivityAt
    await prisma.adminSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() }
    });

    const sanitizedAdmin: AdminUserSanitized = {
      id: session.admin.id,
      email: session.admin.email,
      name: session.admin.name,
      status: session.admin.status,
      isSuperAdmin: session.admin.isSuperAdmin,
      lastLoginAt: session.admin.lastLoginAt,
      createdAt: session.admin.createdAt
    };

    return {
      session,
      admin: sanitizedAdmin
    };
  }

  /**
   * Revokes an active AdminSession
   */
  static async logout(rawToken: string, ipAddress?: string, userAgent?: string): Promise<boolean> {
    if (!rawToken) return true;

    const tokenHash = hashSessionToken(rawToken);
    const session = await prisma.adminSession.findUnique({
      where: { sessionTokenHash: tokenHash }
    });

    if (session && !session.revokedAt) {
      await prisma.adminSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() }
      });

      await prisma.adminAuditLog.create({
        data: {
          adminId: session.adminId,
          action: AdminAuditAction.ADMIN_LOGOUT,
          status: 'SUCCESS',
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
          metadata: { sessionId: session.id }
        }
      });
    }

    return true;
  }
}
