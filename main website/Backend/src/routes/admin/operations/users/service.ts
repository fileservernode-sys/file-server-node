import { Prisma, AdminAuditAction } from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ConflictError, ValidationError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';
import { createPaginatedResponse, PaginatedResult } from '../utils/pagination.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { UserListQuery } from './schemas.js';

export interface UserSummaryItem {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  emailVerified: boolean;
  deviceCount: number;
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserDetailResult {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  emailVerified: boolean;
  deviceCount: number;
  devices: Array<{
    id: string;
    deviceName: string;
    platform: string;
    status: string;
    lastSeenAt: string | null;
    createdAt: string;
  }>;
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

    const items: UserSummaryItem[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      status: u.status,
      emailVerified: u.emailVerified,
      deviceCount: u._count.devices,
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
        status: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        devices: {
          select: {
            id: true,
            deviceName: true,
            platform: true,
            status: true,
            lastSeenAt: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 20
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

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      emailVerified: user.emailVerified,
      deviceCount: user._count.devices,
      devices: user.devices.map((d) => ({
        id: d.id,
        deviceName: d.deviceName,
        platform: d.platform,
        status: d.status,
        lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
        createdAt: d.createdAt.toISOString()
      })),
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
}
