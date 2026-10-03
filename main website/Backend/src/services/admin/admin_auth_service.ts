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
import { UnauthorizedError, ValidationError, ForbiddenError, NotFoundError, AppError } from '../../errors/app-error.js';
import { AdminLockoutService, DEFAULT_MAX_FAILED_ATTEMPTS, DEFAULT_LOCKOUT_DURATION_MS } from './admin_lockout_service.js';
import { AdminAuditService } from './admin_audit_service.js';

// Configuration constants for Admin Security
export const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
export const ADMIN_SESSION_ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours
export const ADMIN_OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_FAILED_ATTEMPTS = DEFAULT_MAX_FAILED_ATTEMPTS;
export const LOCKOUT_DURATION_MS = DEFAULT_LOCKOUT_DURATION_MS;

// Backward-compatible delegates to distributed AdminLockoutService
export async function checkBruteForceLock(ip: string | null | undefined, email: string): Promise<void> {
  return await AdminLockoutService.checkLockout(ip, email);
}

export async function recordFailedAttempt(ip: string | null | undefined, email: string): Promise<void> {
  await AdminLockoutService.recordFailure(ip, email);
}

export async function clearFailedAttempts(ip: string | null | undefined, email: string): Promise<void> {
  await AdminLockoutService.clearLockout(ip, email);
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
  sessionId?: string;
  sessionToken?: string;
  sessionTokenHash?: string;
  expiresAt?: string;
  admin?: AdminUserSanitized;
  message?: string;
}

function getAdminHmacSecret(): string {
  const secret = process.env.ADMIN_AUTH_SECRET || process.env.INTERNAL_SERVICE_KEY || process.env.ZDEX_CSRF_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Fatal Security Configuration: ADMIN_AUTH_SECRET or INTERNAL_SERVICE_KEY must be defined in production');
    }
    return 'zdex-admin-hmac-secret-development-fallback';
  }
  return secret;
}

export class AdminAuthService {
  /**
   * Generates a signed challenge token for 2FA OTP verification
   */
  private static generateChallengeToken(adminId: string, email: string): string {
    const payload = `${adminId}:${email.toLowerCase()}:${Date.now() + ADMIN_OTP_EXPIRY_MS}`;
    const hmacSecret = getAdminHmacSecret();
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
      const hmacSecret = getAdminHmacSecret();
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
    const clientIp = ipAddress;

    // 1. Check Distributed Brute-Force Lockout
    await AdminLockoutService.checkLockout(clientIp, normalizedEmail);

    // 2. Locate AdminUser
    const admin = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail }
    });

    // Timing-safe verification dummy
    const dummyHash = '1234567890abcdef:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const isPasswordValid = admin ? verifyPassword(password, admin.passwordHash) : verifyPassword(password, dummyHash);

    if (!admin || !isPasswordValid) {
      const lockResult = await AdminLockoutService.recordFailure(clientIp, normalizedEmail);

      await AdminAuditService.logEvent({
        adminId: admin?.id || null,
        action: lockResult.locked ? AdminAuditAction.ADMIN_LOCKOUT_TRIGGERED : AdminAuditAction.ADMIN_LOGIN_FAILURE,
        status: 'FAILED',
        ipAddress: clientIp || null,
        userAgent: userAgent || null,
        metadata: {
          email: normalizedEmail,
          reason: 'INVALID_CREDENTIALS',
          attempts: lockResult.attempts,
          locked: lockResult.locked
        }
      });

      throw new UnauthorizedError('Invalid email or password');
    }

    // 3. Verify Admin Status
    if (admin.status !== AdminStatus.ACTIVE) {
      await AdminAuditService.logEvent({
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_AUTH_BLOCKED,
        status: 'BLOCKED',
        ipAddress: clientIp || null,
        userAgent: userAgent || null,
        metadata: { email: normalizedEmail, status: admin.status, reason: 'ACCOUNT_DISABLED' }
      });

      throw new UnauthorizedError('Admin account is disabled');
    }

    // Clear failed password attempts on successful primary authentication
    await AdminLockoutService.clearLockout(clientIp, normalizedEmail);

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
      await emailService.sendLoginOtp(normalizedEmail, otpCode, {
        userId: admin.id,
        sourcePipeline: 'OTP',
        emailType: 'ADMIN_LOGIN_OTP',
        templateId: 'LOGIN_2FA'
      });
    } catch {
      // Allow delivery fallback without leaking secret
    }

    await AdminAuditService.logEvent({
      adminId: admin.id,
      action: AdminAuditAction.ADMIN_OTP_SENT,
      status: 'SUCCESS',
      ipAddress: clientIp || null,
      userAgent: userAgent || null,
      metadata: { email: normalizedEmail }
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
    const clientIp = ipAddress;

    const { adminId, email } = this.verifyChallengeToken(challengeToken);

    await AdminLockoutService.checkLockout(clientIp, email);

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
    ipAddress?: string;
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
      await AdminAuditService.logEvent({
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_OTP_FAILED,
        status: 'FAILED',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: { reason: 'NO_ACTIVE_OTP' }
      });
      throw new UnauthorizedError('Invalid or expired verification code');
    }

    // Check attempt limits on OTP
    if (activeOtp.attempts >= 5) {
      await prisma.adminEmailOtp.update({
        where: { id: activeOtp.id },
        data: { isUsed: true }
      });
      await AdminLockoutService.recordFailure(ipAddress, admin.email);
      throw new UnauthorizedError('Too many failed verification attempts. Please log in again.');
    }

    const isValid = verifyOtpCode(otp, activeOtp.otpHash);

    if (!isValid) {
      await prisma.adminEmailOtp.update({
        where: { id: activeOtp.id },
        data: { attempts: activeOtp.attempts + 1 }
      });

      const lockResult = await AdminLockoutService.recordFailure(ipAddress, admin.email);

      await AdminAuditService.logEvent({
        adminId: admin.id,
        action: lockResult.locked ? AdminAuditAction.ADMIN_LOCKOUT_TRIGGERED : AdminAuditAction.ADMIN_OTP_FAILED,
        status: 'FAILED',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: { attempt: activeOtp.attempts + 1, locked: lockResult.locked }
      });

      throw new UnauthorizedError('Invalid verification code');
    }

    // Mark OTP as used
    await prisma.adminEmailOtp.update({
      where: { id: activeOtp.id },
      data: { isUsed: true }
    });

    await AdminAuditService.logEvent({
      adminId: admin.id,
      action: AdminAuditAction.ADMIN_OTP_VERIFIED,
      status: 'SUCCESS',
      ipAddress: ipAddress || null,
      userAgent: userAgent || null
    });

    // Clear failed attempts upon successful authentication
    await AdminLockoutService.clearLockout(ipAddress, admin.email);

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
        ipAddress: ipAddress || null,
        userAgent: userAgent || null
      }
    });

    // Update lastLoginAt on admin
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: now }
    });

    // Log Successful Login
    await AdminAuditService.logEvent({
      adminId: admin.id,
      action: AdminAuditAction.ADMIN_LOGIN_SUCCESS,
      status: 'SUCCESS',
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      metadata: { sessionId: session.id }
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
      sessionId: session.id,
      sessionToken: rawToken,
      sessionTokenHash,
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
      await AdminAuditService.logEvent({
        adminId: session.adminId,
        action: AdminAuditAction.ADMIN_SESSION_EXPIRED,
        status: 'EXPIRED',
        ipAddress: ipAddress || null,
        metadata: { reason: 'ABSOLUTE_EXPIRATION' }
      });
      return null;
    }

    // Check 15-minute idle timeout
    if (now - session.lastActivityAt.getTime() > ADMIN_IDLE_TIMEOUT_MS) {
      await AdminAuditService.logEvent({
        adminId: session.adminId,
        action: AdminAuditAction.ADMIN_SESSION_EXPIRED,
        status: 'EXPIRED',
        ipAddress: ipAddress || null,
        metadata: { reason: 'IDLE_TIMEOUT', lastActivityAt: session.lastActivityAt.toISOString() }
      });
      return null;
    }

    // Check Admin status
    if (session.admin.status !== AdminStatus.ACTIVE) {
      await AdminAuditService.logEvent({
        adminId: session.adminId,
        action: AdminAuditAction.ADMIN_AUTH_BLOCKED,
        status: 'BLOCKED',
        ipAddress: ipAddress || null,
        metadata: { reason: 'ADMIN_DISABLED' }
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
   * Bulk revokes all active sessions for a target Admin user.
   */
  static async revokeAllAdminSessions(params: {
    adminId: string;
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ revokedCount: number }> {
    const { adminId, reason = 'BULK_REVOCATION', ipAddress, userAgent } = params;

    const now = new Date();
    const updateResult = await prisma.adminSession.updateMany({
      where: {
        adminId,
        revokedAt: null
      },
      data: {
        revokedAt: now
      }
    });

    if (updateResult.count > 0) {
      await AdminAuditService.logEvent({
        adminId,
        action: AdminAuditAction.ADMIN_SESSION_REVOKED,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: {
          reason,
          revokedCount: updateResult.count,
          revokedAt: now.toISOString()
        }
      });
    }

    return { revokedCount: updateResult.count };
  }

  /**
   * Updates an Admin user's password and invalidates all existing active sessions for that admin.
   */
  static async updatePassword(params: {
    adminId: string;
    newPassword: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { adminId, newPassword, ipAddress, userAgent } = params;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters in length');
    }

    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId }
    });

    if (!admin) {
      throw new UnauthorizedError('Admin user not found');
    }

    const passwordHash = hashPassword(newPassword);

    await prisma.adminUser.update({
      where: { id: adminId },
      data: { passwordHash }
    });

    await AdminAuditService.logEvent({
      adminId,
      action: AdminAuditAction.ADMIN_PASSWORD_UPDATED,
      status: 'SUCCESS',
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      metadata: { reason: 'PASSWORD_CHANGE' }
    });

    // Invalidate all active sessions for this admin
    await this.revokeAllAdminSessions({
      adminId,
      reason: 'PASSWORD_MUTATION',
      ipAddress,
      userAgent
    });

    return {
      success: true,
      message: 'Admin password updated successfully. All existing sessions have been revoked.'
    };
  }

  /**
   * Updates an Admin user's status. If disabled, revokes all active sessions.
   */
  static async updateAdminStatus(params: {
    actor: { id: string; email: string; isSuperAdmin: boolean; status: AdminStatus };
    targetAdminId: string;
    newStatus: AdminStatus;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ success: boolean; message: string; admin: AdminUserSanitized }> {
    const { actor, targetAdminId, newStatus, ipAddress, userAgent } = params;

    if (actor.status !== AdminStatus.ACTIVE) {
      throw new ForbiddenError('Inactive admin cannot update admin status');
    }

    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: targetAdminId }
    });

    if (!targetAdmin) {
      throw new NotFoundError('Target admin user not found');
    }

    // Anti-escalation: Non-SuperAdmin cannot disable/enable a SuperAdmin
    if (targetAdmin.isSuperAdmin && !actor.isSuperAdmin) {
      throw new ForbiddenError('Only Super Administrators can modify SuperAdmin account status');
    }

    // Anti-self-modification: Non-SuperAdmin cannot disable themselves
    if (actor.id === targetAdminId && !actor.isSuperAdmin && newStatus !== AdminStatus.ACTIVE) {
      throw new ForbiddenError('Administrators cannot disable their own account');
    }

    const updatedAdmin = await prisma.adminUser.update({
      where: { id: targetAdminId },
      data: { status: newStatus }
    });

    await AdminAuditService.logEvent({
      adminId: actor.id,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      status: 'SUCCESS',
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      metadata: {
        targetAdminId,
        previousStatus: targetAdmin.status,
        newStatus
      }
    });

    // If status is transitioning to non-ACTIVE (e.g. DISABLED), revoke all active sessions immediately
    if (newStatus !== AdminStatus.ACTIVE) {
      await this.revokeAllAdminSessions({
        adminId: targetAdminId,
        reason: 'ACCOUNT_DISABLED',
        ipAddress,
        userAgent
      });
    }

    const sanitized: AdminUserSanitized = {
      id: updatedAdmin.id,
      email: updatedAdmin.email,
      name: updatedAdmin.name,
      status: updatedAdmin.status,
      isSuperAdmin: updatedAdmin.isSuperAdmin,
      lastLoginAt: updatedAdmin.lastLoginAt,
      createdAt: updatedAdmin.createdAt
    };

    return {
      success: true,
      message: `Admin status updated to ${newStatus}`,
      admin: sanitized
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

      await AdminAuditService.logEvent({
        adminId: session.adminId,
        action: AdminAuditAction.ADMIN_LOGOUT,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: { sessionId: session.id }
      });
    }

    return true;
  }
}
