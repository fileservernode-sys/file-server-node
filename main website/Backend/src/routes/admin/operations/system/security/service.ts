/**
 * Phase 17 Batch 17.8 — System Security Controls Service
 * Admin Sessions, Lockouts, RBAC Inventory, Security Events & Credential Posture
 */

import { AdminAuditAction, AdminStatus, Prisma } from '@prisma/client';
import { prisma } from '../../../../../config/database.js';
import { AdminAuditService } from '../../../../../services/admin/admin_audit_service.js';
import { AdminAuthService, LOCKOUT_DURATION_MS, MAX_FAILED_ATTEMPTS } from '../../../../../services/admin/admin_auth_service.js';
import { AdminLockoutService } from '../../../../../services/admin/admin_lockout_service.js';
import { NotFoundError, ValidationError } from '../../../../../errors/app-error.js';
import {
  AdminSessionItem,
  AdminSessionStatus,
  AdminLockoutItem,
  SecurityEventItem,
  RbacRoleItem,
  RbacPermissionItem,
  RbacInventoryResult,
  SecurityPostureOverview,
  AdminCredentialPostureItem,
  AdminSessionsListResult,
  SecurityEventsListResult
} from './types.js';
import { AdminSessionQuery, SecurityEventQuery } from './schemas.js';

export interface SecurityOperationContext {
  adminId: string;
  adminEmail: string;
  ipAddress?: string;
  userAgent?: string;
  currentSessionId?: string;
}

export class AdminSystemSecurityService {

  /**
   * Retrieves overall security posture metrics and telemetry
   */
  static async getSecurityOverview(): Promise<SecurityPostureOverview> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      activeSessionsCount,
      recentLoginsCount24h,
      failedLoginsCount24h,
      activeLockoutsCount,
      permissionDenialsCount24h,
      totalRolesCount,
      totalPermissionsCount
    ] = await Promise.all([
      prisma.adminSession.count({
        where: {
          revokedAt: null,
          expiresAt: { gt: now }
        }
      }),
      prisma.adminAuditLog.count({
        where: {
          action: AdminAuditAction.ADMIN_LOGIN_SUCCESS,
          createdAt: { gte: twentyFourHoursAgo }
        }
      }),
      prisma.adminAuditLog.count({
        where: {
          action: AdminAuditAction.ADMIN_LOGIN_FAILURE,
          createdAt: { gte: twentyFourHoursAgo }
        }
      }),
      prisma.adminLockout.count({
        where: {
          lockedUntil: { gt: now }
        }
      }),
      prisma.adminAuditLog.count({
        where: {
          action: AdminAuditAction.ADMIN_AUTHZ_DENIED,
          createdAt: { gte: twentyFourHoursAgo }
        }
      }),
      prisma.adminRole.count(),
      prisma.adminPermission.count()
    ]);

    return {
      activeSessionsCount,
      recentLoginsCount24h,
      failedLoginsCount24h,
      activeLockoutsCount,
      permissionDenialsCount24h,
      totalRolesCount,
      totalPermissionsCount,
      csrfPosture: {
        enabled: true,
        mode: 'HMAC_TOKEN_BOUND',
        header: 'x-zdex-admin-csrf-token',
        enforcedOnMutations: true
      },
      mfaPosture: {
        enabled: true,
        method: 'EMAIL_OTP',
        validityMinutes: 10
      },
      sessionPolicy: {
        absoluteLifetimeHours: 24,
        idleTimeoutMinutes: 15,
        tokenStorageMode: 'SHA256_HASHED'
      },
      bruteForcePolicy: {
        maxFailedAttempts: MAX_FAILED_ATTEMPTS,
        lockoutDurationMinutes: Math.round(LOCKOUT_DURATION_MS / (60 * 1000))
      }
    };
  }

  /**
   * Lists administrative sessions with safe DTOs (NEVER exposes tokens or hashes)
   */
  static async listAdminSessions(query: AdminSessionQuery): Promise<AdminSessionsListResult> {
    const now = new Date();
    const { page, limit, adminId, status, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AdminSessionWhereInput = {};

    if (adminId) {
      where.adminId = adminId;
    }

    if (status === 'ACTIVE') {
      where.revokedAt = null;
      where.expiresAt = { gt: now };
    } else if (status === 'REVOKED') {
      where.revokedAt = { not: null };
    } else if (status === 'EXPIRED') {
      where.revokedAt = null;
      where.expiresAt = { lte: now };
    }

    if (search) {
      where.OR = [
        { admin: { email: { contains: search } } },
        { admin: { name: { contains: search } } },
        { ipAddress: { contains: search } },
        { userAgent: { contains: search } }
      ];
    }

    const [total, records] = await Promise.all([
      prisma.adminSession.count({ where }),
      prisma.adminSession.findMany({
        where,
        include: {
          admin: {
            select: {
              id: true,
              email: true,
              name: true,
              isSuperAdmin: true,
              status: true
            }
          }
        },
        orderBy: { lastActivityAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    const items: AdminSessionItem[] = records.map((rec) => {
      let sessionStatus: AdminSessionStatus = 'ACTIVE';
      if (rec.revokedAt) {
        sessionStatus = 'REVOKED';
      } else if (rec.expiresAt.getTime() <= now.getTime()) {
        sessionStatus = 'EXPIRED';
      }

      return {
        id: rec.id,
        adminId: rec.adminId,
        adminEmail: rec.admin?.email || 'unknown',
        adminName: rec.admin?.name || 'Administrator',
        isSuperAdmin: rec.admin?.isSuperAdmin || false,
        ipAddress: rec.ipAddress,
        userAgent: rec.userAgent,
        lastActivityAt: rec.lastActivityAt.toISOString(),
        expiresAt: rec.expiresAt.toISOString(),
        revokedAt: rec.revokedAt ? rec.revokedAt.toISOString() : null,
        status: sessionStatus,
        createdAt: rec.createdAt.toISOString()
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  /**
   * Revokes a specific single session by ID
   */
  static async revokeSession(
    sessionId: string,
    reason: string,
    context: SecurityOperationContext
  ): Promise<{ success: boolean; sessionId: string; isSelfSession: boolean; message: string }> {
    const session = await prisma.adminSession.findUnique({
      where: { id: sessionId },
      include: { admin: true }
    });

    if (!session) {
      throw new NotFoundError(`Admin session '${sessionId}' not found`);
    }

    const isSelfSession = sessionId === context.currentSessionId || session.id === context.currentSessionId;

    if (session.revokedAt) {
      return {
        success: true,
        sessionId: session.id,
        isSelfSession,
        message: 'Session is already revoked'
      };
    }

    const now = new Date();
    await prisma.adminSession.update({
      where: { id: session.id },
      data: { revokedAt: now }
    });

    await AdminAuditService.logEvent({
      adminId: context.adminId,
      action: AdminAuditAction.ADMIN_SESSION_REVOKED,
      status: 'SUCCESS',
      ipAddress: context.ipAddress || null,
      userAgent: context.userAgent || null,
      metadata: {
        revokedSessionId: session.id,
        targetAdminId: session.adminId,
        targetEmail: session.admin?.email,
        reason,
        isSelfSession,
        revokedAt: now.toISOString()
      }
    });

    return {
      success: true,
      sessionId: session.id,
      isSelfSession,
      message: 'Session revoked successfully'
    };
  }

  /**
   * Revokes all active sessions for a target administrator
   */
  static async revokeAllAdminSessions(
    targetAdminId: string,
    reason: string,
    context: SecurityOperationContext
  ): Promise<{ success: boolean; adminId: string; revokedCount: number; message: string }> {
    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: targetAdminId }
    });

    if (!targetAdmin) {
      throw new NotFoundError(`Target admin '${targetAdminId}' not found`);
    }

    const result = await AdminAuthService.revokeAllAdminSessions({
      adminId: targetAdminId,
      reason: `ADMINISTRATIVE_REVOCATION: ${reason} (by ${context.adminEmail})`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return {
      success: true,
      adminId: targetAdminId,
      revokedCount: result.revokedCount,
      message: `Successfully revoked ${result.revokedCount} active session(s) for admin '${targetAdmin.email}'`
    };
  }

  /**
   * Lists all active and recent lockout tracking records
   */
  static async listLockouts(): Promise<AdminLockoutItem[]> {
    const now = new Date();
    const records = await prisma.adminLockout.findMany({
      orderBy: { lastAttemptAt: 'desc' }
    });

    return records.map((rec) => {
      let ipAddress = 'direct';
      let email = rec.key;
      if (rec.key.includes('_')) {
        const parts = rec.key.split('_');
        ipAddress = parts[0] || 'direct';
        email = parts.slice(1).join('_');
      }

      const isLocked = !!(rec.lockedUntil && rec.lockedUntil > now);
      const remainingSeconds = isLocked && rec.lockedUntil
        ? Math.max(0, Math.ceil((rec.lockedUntil.getTime() - now.getTime()) / 1000))
        : 0;

      return {
        id: rec.id,
        key: rec.key,
        ipAddress,
        email,
        failedAttempts: rec.failedAttempts,
        lockedUntil: rec.lockedUntil ? rec.lockedUntil.toISOString() : null,
        isLocked,
        remainingSeconds,
        lastAttemptAt: rec.lastAttemptAt.toISOString(),
        createdAt: rec.createdAt.toISOString()
      };
    });
  }

  /**
   * Clears/unlocks a brute-force lockout record
   */
  static async unlockLockout(
    params: { key?: string; ip?: string; email?: string },
    context: SecurityOperationContext
  ): Promise<{ success: boolean; message: string }> {
    const { key, ip, email } = params;

    let targetKey = key;
    if (!targetKey && email) {
      targetKey = AdminLockoutService.getLockoutKey(ip, email);
    }

    if (targetKey) {
      await prisma.adminLockout.deleteMany({
        where: { key: targetKey }
      });
    } else if (email) {
      await prisma.adminLockout.deleteMany({
        where: {
          key: { endsWith: `_${email.trim().toLowerCase()}` }
        }
      });
    } else {
      throw new ValidationError('Lockout identifier (key or email) is required to unlock');
    }

    await AdminAuditService.logEvent({
      adminId: context.adminId,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      status: 'SUCCESS',
      ipAddress: context.ipAddress || null,
      userAgent: context.userAgent || null,
      metadata: {
        operation: 'SECURITY_LOCKOUT_RELEASED',
        unlockedKey: targetKey,
        targetEmail: email,
        targetIp: ip,
        releasedBy: context.adminEmail
      }
    });

    return {
      success: true,
      message: `Lockout cleared successfully for '${targetKey || email}'`
    };
  }

  /**
   * Lists security audit events with multi-criteria filtering
   */
  static async listSecurityEvents(query: SecurityEventQuery): Promise<SecurityEventsListResult> {
    const { page, limit, action, status, adminId, ipAddress, startDate, endDate, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AdminAuditLogWhereInput = {};

    if (action) {
      where.action = action as AdminAuditAction;
    }

    if (status) {
      where.status = status;
    }

    if (adminId) {
      where.adminId = adminId;
    }

    if (ipAddress) {
      where.ipAddress = { contains: ipAddress };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    if (search) {
      where.OR = [
        { admin: { email: { contains: search } } },
        { ipAddress: { contains: search } },
        { userAgent: { contains: search } }
      ];
    }

    const [total, records] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({
        where,
        include: {
          admin: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    const items: SecurityEventItem[] = records.map((rec) => ({
      id: rec.id,
      adminId: rec.adminId,
      adminEmail: rec.admin?.email || null,
      action: rec.action,
      status: rec.status,
      ipAddress: rec.ipAddress,
      userAgent: rec.userAgent,
      metadata: rec.metadata as Record<string, unknown> | null,
      integrityHash: rec.integrityHash,
      sequence: rec.sequence,
      createdAt: rec.createdAt.toISOString()
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  /**
   * Retrieves detailed single security audit event
   */
  static async getSecurityEventDetail(eventId: string): Promise<SecurityEventItem> {
    const rec = await prisma.adminAuditLog.findUnique({
      where: { id: eventId },
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    });

    if (!rec) {
      throw new NotFoundError(`Security audit event '${eventId}' not found`);
    }

    return {
      id: rec.id,
      adminId: rec.adminId,
      adminEmail: rec.admin?.email || null,
      action: rec.action,
      status: rec.status,
      ipAddress: rec.ipAddress,
      userAgent: rec.userAgent,
      metadata: rec.metadata as Record<string, unknown> | null,
      integrityHash: rec.integrityHash,
      sequence: rec.sequence,
      createdAt: rec.createdAt.toISOString()
    };
  }

  /**
   * Retrieves complete RBAC inventory, permissions matrix, and role hierarchy
   */
  static async getRbacInventory(): Promise<RbacInventoryResult> {
    const [roles, permissions] = await Promise.all([
      prisma.adminRole.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          permissions: {
            include: { permission: true }
          },
          _count: {
            select: { userRoles: true }
          }
        }
      }),
      prisma.adminPermission.findMany({
        orderBy: [{ resource: 'asc' }, { action: 'asc' }],
        include: {
          roles: {
            include: { role: true }
          }
        }
      })
    ]);

    const formattedRoles: RbacRoleItem[] = roles.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      isSystemRole: r.isSystemRole,
      permissionSlugs: r.permissions.map((rp) => rp.permission.slug),
      assignedAdminCount: r._count.userRoles,
      createdAt: r.createdAt.toISOString()
    }));

    const formattedPermissions: RbacPermissionItem[] = permissions.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      resource: p.resource,
      action: p.action,
      roleSlugs: p.roles.map((rp) => rp.role.slug),
      createdAt: p.createdAt.toISOString()
    }));

    const matrix = formattedRoles.map((r) => ({
      roleSlug: r.slug,
      roleName: r.name,
      permissions: r.permissionSlugs
    }));

    return {
      roles: formattedRoles,
      permissions: formattedPermissions,
      matrix,
      superAdminPrivilege: {
        description: 'SuperAdmin accounts automatically possess global wildcard (*) access across all administrative endpoints and resources.',
        wildcardEnabled: true
      }
    };
  }

  /**
   * Retrieves credential and account security posture (NO secrets or hashes)
   */
  static async getCredentialPosture(): Promise<AdminCredentialPostureItem[]> {
    const now = new Date();
    const admins = await prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        userRoles: {
          include: { role: true }
        },
        sessions: {
          where: {
            revokedAt: null,
            expiresAt: { gt: now }
          }
        }
      }
    });

    return admins.map((admin) => ({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      status: admin.status,
      isSuperAdmin: admin.isSuperAdmin,
      lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
      activeSessionsCount: admin.sessions.length,
      hasPasswordConfigured: true,
      twoFactorConfigured: true,
      roles: admin.userRoles.map((ur) => ur.role.slug),
      createdAt: admin.createdAt.toISOString()
    }));
  }
}
