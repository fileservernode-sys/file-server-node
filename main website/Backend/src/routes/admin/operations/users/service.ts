import { Prisma, AdminAuditAction } from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ConflictError, ValidationError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';
import { createPaginatedResponse, PaginatedResult } from '../utils/pagination.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { UserListQuery } from './schemas.js';

export interface UserSummaryMetrics {
  totalAccounts: number;
  activeAccounts: number;
  suspendedAccounts: number;
  pendingAccounts: number;
  accountsWithDevices: number;
}

export interface UserSummaryItem {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  emailVerified: boolean;
  authProvider: string;
  deviceCount: number;
  serverCount: number;
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserDetailDeviceServer {
  id: string;
  serverName: string | null;
  status: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  endpoints: Array<{
    id: string;
    hostname: string;
    status: string;
  }>;
}

export interface UserDetailDevice {
  id: string;
  deviceName: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  servers: UserDetailDeviceServer[];
}

export interface UserDetailResult {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  emailVerified: boolean;
  authProvider: string;
  deviceCount: number;
  serverCount: number;
  devices: UserDetailDevice[];
  billing: {
    status: string | null;
    currency: string | null;
    billingCountry: string | null;
  } | null;
  totalAuditEvents: number;
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export class AdminUserService {
  /**
   * Retrieves summary metric counts across all customer accounts.
   */
  static async getUserSummaryMetrics(): Promise<UserSummaryMetrics> {
    const [totalAccounts, activeAccounts, suspendedAccounts, pendingAccounts, accountsWithDevices] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'SUSPENDED' } }),
      prisma.user.count({ where: { status: 'PENDING_VERIFICATION' } }),
      prisma.user.count({ where: { devices: { some: {} } } })
    ]);

    return {
      totalAccounts,
      activeAccounts,
      suspendedAccounts,
      pendingAccounts,
      accountsWithDevices
    };
  }

  /**
   * Lists customer user accounts with safe allowlisted filters, search, and pagination.
   */
  static async listUsers(query: UserListQuery): Promise<PaginatedResult<UserSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.emailVerified !== undefined) {
      where.emailVerified = query.emailVerified;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { email: { contains: term } },
        { fullName: { contains: term } }
      ];
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (!isNaN(start.getTime())) where.createdAt.gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (!isNaN(end.getTime())) where.createdAt.lte = end;
      }
    }

    const orderBy: Prisma.UserOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          email: true,
          fullName: true,
          passwordHash: true,
          status: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              devices: true,
              sessions: true
            }
          }
        }
      })
    ]);

    // Batch query server counts across user devices to prevent N+1 query loops
    const userIds = users.map((u) => u.id);
    let serverCountMap = new Map<string, number>();

    if (userIds.length > 0) {
      const userDevices = await prisma.device.findMany({
        where: { userId: { in: userIds } },
        select: {
          userId: true,
          _count: {
            select: {
              servers: true
            }
          }
        }
      });

      for (const d of userDevices) {
        const curr = serverCountMap.get(d.userId) || 0;
        serverCountMap.set(d.userId, curr + d._count.servers);
      }
    }

    const items: UserSummaryItem[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      status: u.status,
      emailVerified: u.emailVerified,
      authProvider: u.passwordHash ? 'EMAIL_PASSWORD' : 'SSO_OR_EXTERNAL',
      deviceCount: u._count.devices,
      serverCount: serverCountMap.get(u.id) || 0,
      activeSessionCount: u._count.sessions,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString()
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves operational metadata and resource overview for a specific customer account.
   * Never returns password hashes, OTPs, session tokens, or private customer file data.
   */
  static async getUserDetail(userId: string): Promise<UserDetailResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        passwordHash: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        devices: {
          select: {
            id: true,
            deviceName: true,
            platform: true,
            osVersion: true,
            appVersion: true,
            status: true,
            lastSeenAt: true,
            createdAt: true,
            servers: {
              select: {
                id: true,
                serverName: true,
                status: true,
                startedAt: true,
                lastHeartbeatAt: true,
                createdAt: true,
                endpoints: {
                  select: {
                    id: true,
                    hostname: true,
                    status: true
                  }
                }
              },
              orderBy: { createdAt: 'desc' }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 50
        },
        billingState: {
          select: {
            status: true,
            currency: true,
            billingCountry: true
          }
        },
        _count: {
          select: {
            devices: true,
            sessions: true,
            auditEvents: true
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundError(`User with ID '${userId}' not found`);
    }

    let totalServerInstances = 0;
    const formattedDevices: UserDetailDevice[] = user.devices.map((d) => {
      totalServerInstances += d.servers.length;
      return {
        id: d.id,
        deviceName: d.deviceName,
        platform: d.platform,
        osVersion: d.osVersion,
        appVersion: d.appVersion,
        status: d.status,
        lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
        createdAt: d.createdAt.toISOString(),
        servers: d.servers.map((s) => ({
          id: s.id,
          serverName: s.serverName,
          status: s.status,
          startedAt: s.startedAt ? s.startedAt.toISOString() : null,
          lastHeartbeatAt: s.lastHeartbeatAt ? s.lastHeartbeatAt.toISOString() : null,
          createdAt: s.createdAt.toISOString(),
          endpoints: s.endpoints.map((ep) => ({
            id: ep.id,
            hostname: ep.hostname,
            status: ep.status
          }))
        }))
      };
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      emailVerified: user.emailVerified,
      authProvider: user.passwordHash ? 'EMAIL_PASSWORD' : 'SSO_OR_EXTERNAL',
      deviceCount: user._count.devices,
      serverCount: totalServerInstances,
      devices: formattedDevices,
      billing: user.billingState
        ? {
            status: user.billingState.status,
            currency: user.billingState.currency,
            billingCountry: user.billingState.billingCountry
          }
        : null,
      totalAuditEvents: user._count.auditEvents,
      activeSessionCount: user._count.sessions,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    };
  }

  /**
   * Suspends a customer user account.
   * Enforces transition state checks, revokes active customer sessions, and records audit trail.
   */
  static async suspendUser(
    userId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{ id: string; email: string; status: string; previousStatus: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError(`User with ID '${userId}' not found`);
    }

    if (user.status === 'SUSPENDED') {
      throw new ConflictError(`User account '${user.email}' is already suspended`);
    }

    if (user.status === 'PENDING_VERIFICATION') {
      throw new ConflictError(`Cannot suspend an account pending email verification`);
    }

    const previousStatus = user.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative suspension';

    return executeAdminOperation({
      operationName: 'user_suspend',
      targetResourceType: 'user',
      targetResourceId: userId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        targetUserId: userId,
        targetEmail: user.email,
        previousStatus,
        newStatus: 'SUSPENDED',
        reason: finalReason
      },
      execute: async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: { status: 'SUSPENDED' },
          select: {
            id: true,
            email: true,
            status: true
          }
        });

        // Revoke all active customer sessions upon suspension
        await tx.userSession.deleteMany({
          where: { userId }
        });

        return {
          id: updated.id,
          email: updated.email,
          status: updated.status,
          previousStatus
        };
      }
    });
  }

  /**
   * Restores a suspended customer user account back to ACTIVE status.
   * Enforces transition state checks and records audit trail.
   */
  static async restoreUser(
    userId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{ id: string; email: string; status: string; previousStatus: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError(`User with ID '${userId}' not found`);
    }

    if (user.status === 'ACTIVE') {
      throw new ConflictError(`User account '${user.email}' is already active`);
    }

    if (user.status === 'PENDING_VERIFICATION') {
      throw new ConflictError(`Cannot restore an unverified account`);
    }

    const previousStatus = user.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative restoration';

    return executeAdminOperation({
      operationName: 'user_restore',
      targetResourceType: 'user',
      targetResourceId: userId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        targetUserId: userId,
        targetEmail: user.email,
        previousStatus,
        newStatus: 'ACTIVE',
        reason: finalReason
      },
      execute: async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: { status: 'ACTIVE' },
          select: {
            id: true,
            email: true,
            status: true
          }
        });

        return {
          id: updated.id,
          email: updated.email,
          status: updated.status,
          previousStatus
        };
      }
    });
  }

  /**
   * Forcefully revokes all active login sessions for a customer account.
   * Does not affect administrative sessions.
   */
  static async revokeUserSessions(
    userId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{ id: string; email: string; revokedSessionsCount: number }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true }
    });

    if (!user) {
      throw new NotFoundError(`User with ID '${userId}' not found`);
    }

    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative session revocation';

    return executeAdminOperation({
      operationName: 'user_revoke_sessions',
      targetResourceType: 'user',
      targetResourceId: userId,
      context,
      action: AdminAuditAction.ADMIN_SESSION_REVOKED,
      metadata: {
        targetUserId: userId,
        targetEmail: user.email,
        reason: finalReason
      },
      execute: async (tx) => {
        const result = await tx.userSession.deleteMany({
          where: { userId }
        });

        return {
          id: user.id,
          email: user.email,
          revokedSessionsCount: result.count
        };
      }
    });
  }
}
