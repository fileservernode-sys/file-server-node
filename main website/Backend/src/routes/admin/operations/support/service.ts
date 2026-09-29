import crypto from 'node:crypto';
import {
  Prisma,
  SupportCaseStatus,
  SupportCasePriority,
  SupportCaseCategory,
  AdminAuditAction,
  AdminStatus,
  UserStatus
} from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';
import { createPaginatedResponse, PaginatedResult } from '../utils/pagination.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { assertAdminCanOperateOnResource } from '../middleware/object_authorization.js';
import { AdminAuditService } from '../../../../services/admin/admin_audit_service.js';
import {
  SupportOverviewMetrics,
  SupportCaseSummaryItem,
  SupportCaseDetailResult,
  SupportCaseNoteItem,
  EligibleSupportAdminItem,
  SupportCustomerSummaryItem,
  SupportCustomerContextResult,
  SafeDeviceSupportContext,
  SafeServerSupportContext,
  SafeBillingSupportContext
} from './types.js';
import {
  SupportCaseListQuery,
  CreateSupportCaseInput,
  UpdateSupportCaseInput,
  AssignSupportCaseInput,
  AddSupportCaseNoteInput,
  SupportCustomerListQuery
} from './schemas.js';

/**
 * Valid state machine transitions for SupportCase lifecycle.
 */
export const VALID_SUPPORT_TRANSITIONS: Record<SupportCaseStatus, SupportCaseStatus[]> = {
  [SupportCaseStatus.OPEN]: [
    SupportCaseStatus.IN_PROGRESS,
    SupportCaseStatus.CLOSED
  ],
  [SupportCaseStatus.IN_PROGRESS]: [
    SupportCaseStatus.WAITING_ON_CUSTOMER,
    SupportCaseStatus.RESOLVED,
    SupportCaseStatus.OPEN,
    SupportCaseStatus.CLOSED
  ],
  [SupportCaseStatus.WAITING_ON_CUSTOMER]: [
    SupportCaseStatus.IN_PROGRESS,
    SupportCaseStatus.RESOLVED,
    SupportCaseStatus.CLOSED
  ],
  [SupportCaseStatus.RESOLVED]: [
    SupportCaseStatus.CLOSED,
    SupportCaseStatus.OPEN,
    SupportCaseStatus.IN_PROGRESS
  ],
  [SupportCaseStatus.CLOSED]: [
    SupportCaseStatus.OPEN
  ]
};

/**
 * Computes non-speculative, derived queue escalation and attention indicators.
 */
function computeCaseEscalationIndicators(c: {
  status: SupportCaseStatus;
  priority: SupportCasePriority;
  assignedAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const isUrgent = c.priority === SupportCasePriority.URGENT;
  const isUnassigned = c.assignedAdminId === null && c.status !== SupportCaseStatus.RESOLVED && c.status !== SupportCaseStatus.CLOSED;
  const ageMs = Date.now() - c.createdAt.getTime();
  const updateAgeMs = Date.now() - c.updatedAt.getTime();

  const needsAttention = isUrgent ||
    (c.status === SupportCaseStatus.OPEN && ageMs > 24 * 3600 * 1000) ||
    (c.status === SupportCaseStatus.WAITING_ON_CUSTOMER && updateAgeMs > 48 * 3600 * 1000);

  const isOverdue = c.status !== SupportCaseStatus.RESOLVED && c.status !== SupportCaseStatus.CLOSED && (
    (c.priority === SupportCasePriority.URGENT && ageMs > 4 * 3600 * 1000) ||
    (c.priority === SupportCasePriority.HIGH && ageMs > 12 * 3600 * 1000) ||
    (ageMs > 72 * 3600 * 1000)
  );

  return { isUrgent, isUnassigned, needsAttention, isOverdue };
}

export class AdminSupportService {
  /**
   * Generates a unique, standardized human-readable Case Number (e.g. ZDEX-SUP-8K92F1).
   */
  private static generateCaseNumber(): string {
    const timestampSegment = Date.now().toString(36).toUpperCase().slice(-4);
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `ZDEX-SUP-${timestampSegment}${randomHex}`;
  }

  /**
   * Returns operational summary metrics for all customer support cases.
   */
  static async getSupportOverview(): Promise<SupportOverviewMetrics> {
    const [
      totalCases,
      openCases,
      inProgressCases,
      waitingOnCustomerCases,
      resolvedCases,
      closedCases,
      urgentCases,
      highPriorityCases,
      unassignedCases,
      groupedByCategory,
      groupedByPriority,
      groupedByStatus
    ] = await Promise.all([
      prisma.supportCase.count(),
      prisma.supportCase.count({ where: { status: SupportCaseStatus.OPEN } }),
      prisma.supportCase.count({ where: { status: SupportCaseStatus.IN_PROGRESS } }),
      prisma.supportCase.count({ where: { status: SupportCaseStatus.WAITING_ON_CUSTOMER } }),
      prisma.supportCase.count({ where: { status: SupportCaseStatus.RESOLVED } }),
      prisma.supportCase.count({ where: { status: SupportCaseStatus.CLOSED } }),
      prisma.supportCase.count({ where: { priority: SupportCasePriority.URGENT } }),
      prisma.supportCase.count({ where: { priority: SupportCasePriority.HIGH } }),
      prisma.supportCase.count({ where: { assignedAdminId: null, status: { in: [SupportCaseStatus.OPEN, SupportCaseStatus.IN_PROGRESS] } } }),
      prisma.supportCase.groupBy({
        by: ['category'],
        _count: { id: true }
      }),
      prisma.supportCase.groupBy({
        by: ['priority'],
        _count: { id: true }
      }),
      prisma.supportCase.groupBy({
        by: ['status'],
        _count: { id: true }
      })
    ]);

    const casesByCategory = Object.values(SupportCaseCategory).reduce((acc, cat) => {
      acc[cat] = 0;
      return acc;
    }, {} as Record<SupportCaseCategory, number>);

    for (const group of groupedByCategory) {
      casesByCategory[group.category] = group._count.id;
    }

    const casesByPriority = Object.values(SupportCasePriority).reduce((acc, prio) => {
      acc[prio] = 0;
      return acc;
    }, {} as Record<SupportCasePriority, number>);

    for (const group of groupedByPriority) {
      casesByPriority[group.priority] = group._count.id;
    }

    const casesByStatus = Object.values(SupportCaseStatus).reduce((acc, st) => {
      acc[st] = 0;
      return acc;
    }, {} as Record<SupportCaseStatus, number>);

    for (const group of groupedByStatus) {
      casesByStatus[group.status] = group._count.id;
    }

    return {
      totalCases,
      openCases,
      inProgressCases,
      waitingOnCustomerCases,
      resolvedCases,
      closedCases,
      urgentCases,
      highPriorityCases,
      unassignedCases,
      casesByCategory,
      casesByPriority,
      casesByStatus
    };
  }

  /**
   * Lists customer support cases with safe allowlisted filters, search, and pagination.
   */
  static async listCases(query: SupportCaseListQuery): Promise<PaginatedResult<SupportCaseSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.SupportCaseWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.priority) {
      where.priority = query.priority;
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.assignedAdminId) {
      where.assignedAdminId = query.assignedAdminId;
    }

    if (query.unassigned === true) {
      where.assignedAdminId = null;
    }

    if (query.needsAttention === true) {
      where.OR = [
        { priority: SupportCasePriority.URGENT },
        { status: SupportCaseStatus.OPEN, createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } }
      ];
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { caseNumber: { contains: term } },
        { subject: { contains: term } },
        { user: { email: { contains: term } } },
        { user: { fullName: { contains: term } } }
      ];
    }

    const orderBy: Prisma.SupportCaseOrderByWithRelationInput[] = [];
    if (query.sortBy === 'priority') {
      orderBy.push({ priority: query.sortOrder || 'desc' });
    } else if (query.sortBy === 'updatedAt') {
      orderBy.push({ updatedAt: query.sortOrder || 'desc' });
    } else if (query.sortBy === 'status') {
      orderBy.push({ status: query.sortOrder || 'desc' });
    } else {
      orderBy.push({ createdAt: query.sortOrder || 'desc' });
    }
    orderBy.push({ id: 'asc' });

    const [total, cases] = await Promise.all([
      prisma.supportCase.count({ where }),
      prisma.supportCase.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          user: {
            select: {
              email: true,
              fullName: true
            }
          },
          assignedAdmin: {
            select: {
              name: true
            }
          },
          _count: {
            select: { notes: true }
          }
        }
      })
    ]);

    const items: SupportCaseSummaryItem[] = cases.map(c => {
      const indicators = computeCaseEscalationIndicators({
        status: c.status,
        priority: c.priority,
        assignedAdminId: c.assignedAdminId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      });

      return {
        id: c.id,
        caseNumber: c.caseNumber,
        userId: c.userId,
        userEmail: c.user.email,
        userFullName: c.user.fullName,
        subject: c.subject,
        category: c.category,
        priority: c.priority,
        status: c.status,
        assignedAdminId: c.assignedAdminId,
        assignedAdminName: c.assignedAdmin?.name || null,
        noteCount: c._count.notes,
        isUrgent: indicators.isUrgent,
        isUnassigned: indicators.isUnassigned,
        needsAttention: indicators.needsAttention,
        isOverdue: indicators.isOverdue,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
        closedAt: c.closedAt ? c.closedAt.toISOString() : null
      };
    });

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Creates a new Support Case for a customer with audit logging.
   */
  static async createCase(
    input: CreateSupportCaseInput,
    context: AdminOperationContext
  ): Promise<SupportCaseSummaryItem> {
    // 1. Verify User exists
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, fullName: true }
    });

    if (!user) {
      throw new NotFoundError(`Customer account with ID '${input.userId}' not found`);
    }

    // 2. Verify assigned admin exists if provided and has support permissions
    let assignedAdminName: string | null = null;
    if (input.assignedAdminId) {
      const admin = await prisma.adminUser.findUnique({
        where: { id: input.assignedAdminId },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: { permission: true }
                  }
                }
              }
            }
          }
        }
      });
      if (!admin) {
        throw new NotFoundError(`Admin user with ID '${input.assignedAdminId}' not found`);
      }
      if (admin.status !== AdminStatus.ACTIVE) {
        throw new ConflictError(`Target administrator account '${admin.name}' is not ACTIVE`);
      }
      const isEligible = admin.isSuperAdmin ||
        admin.userRoles.some(ur => ur.role.slug === 'SUPPORT' || ur.role.name.toUpperCase().includes('SUPPORT')) ||
        admin.userRoles.some(ur => ur.role.permissions.some(p => p.permission.slug.startsWith('support.')));
      if (!isEligible) {
        throw new ConflictError(`Target administrator '${admin.name}' lacks support permissions and is ineligible for case assignment`);
      }
      assignedAdminName = admin.name;
    }

    const caseNumber = this.generateCaseNumber();

    return executeAdminOperation({
      operationName: 'create_support_case',
      targetResourceType: 'SupportCase',
      targetResourceId: caseNumber,
      context,
      action: AdminAuditAction.ADMIN_SUPPORT_CASE_CREATED,
      metadata: {
        userId: input.userId,
        userEmail: user.email,
        subject: input.subject,
        category: input.category,
        priority: input.priority,
        assignedAdminId: input.assignedAdminId || null
      },
      execute: async (tx) => {
        const created = await tx.supportCase.create({
          data: {
            caseNumber,
            userId: input.userId,
            subject: input.subject,
            description: input.description,
            category: input.category,
            priority: input.priority,
            status: SupportCaseStatus.OPEN,
            assignedAdminId: input.assignedAdminId || null
          }
        });

        const indicators = computeCaseEscalationIndicators({
          status: created.status,
          priority: created.priority,
          assignedAdminId: created.assignedAdminId,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt
        });

        return {
          id: created.id,
          caseNumber: created.caseNumber,
          userId: created.userId,
          userEmail: user.email,
          userFullName: user.fullName,
          subject: created.subject,
          category: created.category,
          priority: created.priority,
          status: created.status,
          assignedAdminId: created.assignedAdminId,
          assignedAdminName,
          noteCount: 0,
          isUrgent: indicators.isUrgent,
          isUnassigned: indicators.isUnassigned,
          needsAttention: indicators.needsAttention,
          isOverdue: indicators.isOverdue,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
          resolvedAt: null,
          closedAt: null
        };
      }
    });
  }

  /**
   * Retrieves comprehensive details of a support case along with bounded safe customer summaries.
   * NEVER returns file tree browsing data, raw passwords, hashes, or sensitive provider keys.
   */
  static async getCaseDetail(
    caseId: string,
    context: AdminOperationContext
  ): Promise<SupportCaseDetailResult> {
    const supportCase = await prisma.supportCase.findUnique({
      where: { id: caseId },
      include: {
        user: {
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
                createdAt: true,
                servers: {
                  select: {
                    id: true,
                    deviceId: true,
                    serverName: true,
                    status: true,
                    startedAt: true,
                    lastHeartbeatAt: true,
                    createdAt: true
                  }
                }
              }
            },
            billingState: {
              select: {
                status: true,
                currency: true,
                billingCountry: true
              }
            },
            subscriptions: {
              where: { status: { in: ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING'] } },
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                plan: { select: { code: true } },
                currentPeriodEnd: true
              }
            },
            _count: {
              select: {
                payments: true,
                refunds: true
              }
            }
          }
        },
        assignedAdmin: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        notes: {
          orderBy: { createdAt: 'asc' },
          include: {
            admin: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    if (!supportCase) {
      throw new NotFoundError(`Support case '${caseId}' not found`);
    }

    // Object authorization check
    await assertAdminCanOperateOnResource({ context, resourceType: 'User', resourceId: supportCase.userId, operation: 'read' });
    await assertAdminCanOperateOnResource({ context, resourceType: 'SupportCase', resourceId: supportCase.id, operation: 'read' });

    // Log read audit event
    await AdminAuditService.logEvent({
      adminId: context.adminId,
      action: AdminAuditAction.ADMIN_SUPPORT_CASE_VIEWED,
      status: 'SUCCESS',
      ipAddress: context.clientIp,
      userAgent: context.userAgent,
      metadata: {
        caseId: supportCase.id,
        caseNumber: supportCase.caseNumber,
        userId: supportCase.userId
      }
    });

    const devices = supportCase.user.devices.map(d => ({
      id: d.id,
      deviceName: d.deviceName,
      platform: d.platform,
      status: d.status,
      lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
      serverCount: d.servers.length,
      createdAt: d.createdAt.toISOString()
    }));

    const servers = supportCase.user.devices.flatMap(d =>
      d.servers.map(s => ({
        id: s.id,
        deviceId: s.deviceId,
        serverName: s.serverName,
        status: s.status,
        startedAt: s.startedAt ? s.startedAt.toISOString() : null,
        lastHeartbeatAt: s.lastHeartbeatAt ? s.lastHeartbeatAt.toISOString() : null,
        createdAt: s.createdAt.toISOString()
      }))
    );

    const activeSub = supportCase.user.subscriptions[0] || null;

    const billing = supportCase.user.billingState ? {
      status: supportCase.user.billingState.status,
      currency: supportCase.user.billingState.currency,
      billingCountry: supportCase.user.billingState.billingCountry,
      activeSubscriptionId: activeSub?.id || null,
      activePlanCode: activeSub?.plan.code || null,
      currentPeriodEnd: activeSub?.currentPeriodEnd ? activeSub.currentPeriodEnd.toISOString() : null,
      totalPaymentsCount: supportCase.user._count.payments,
      totalRefundsCount: supportCase.user._count.refunds
    } : null;

    const notes: SupportCaseNoteItem[] = supportCase.notes.map(n => ({
      id: n.id,
      caseId: n.caseId,
      adminId: n.adminId,
      adminName: n.admin.name,
      note: n.note,
      isInternal: n.isInternal,
      createdAt: n.createdAt.toISOString()
    }));

    const indicators = computeCaseEscalationIndicators({
      status: supportCase.status,
      priority: supportCase.priority,
      assignedAdminId: supportCase.assignedAdminId,
      createdAt: supportCase.createdAt,
      updatedAt: supportCase.updatedAt
    });

    const allowedTransitions = VALID_SUPPORT_TRANSITIONS[supportCase.status] || [];

    return {
      id: supportCase.id,
      caseNumber: supportCase.caseNumber,
      userId: supportCase.userId,
      subject: supportCase.subject,
      description: supportCase.description,
      category: supportCase.category,
      priority: supportCase.priority,
      status: supportCase.status,
      assignedAdminId: supportCase.assignedAdminId,
      assignedAdmin: supportCase.assignedAdmin ? {
        id: supportCase.assignedAdmin.id,
        name: supportCase.assignedAdmin.name,
        email: supportCase.assignedAdmin.email
      } : null,
      resolutionNotes: supportCase.resolutionNotes,
      resolvedAt: supportCase.resolvedAt ? supportCase.resolvedAt.toISOString() : null,
      closedAt: supportCase.closedAt ? supportCase.closedAt.toISOString() : null,
      isUrgent: indicators.isUrgent,
      isUnassigned: indicators.isUnassigned,
      needsAttention: indicators.needsAttention,
      isOverdue: indicators.isOverdue,
      allowedTransitions,
      createdAt: supportCase.createdAt.toISOString(),
      updatedAt: supportCase.updatedAt.toISOString(),
      notes,
      customerContext: {
        user: {
          id: supportCase.user.id,
          email: supportCase.user.email,
          fullName: supportCase.user.fullName,
          status: supportCase.user.status,
          emailVerified: supportCase.user.emailVerified,
          createdAt: supportCase.user.createdAt.toISOString(),
          updatedAt: supportCase.user.updatedAt.toISOString()
        },
        devices,
        servers,
        billing
      }
    };
  }

  /**
   * Updates state, priority, category, or resolution notes of a support case.
   * Enforces strict state machine transition validation and field-level controls.
   */
  static async updateCase(
    caseId: string,
    input: UpdateSupportCaseInput,
    context: AdminOperationContext
  ): Promise<SupportCaseSummaryItem> {
    const existing = await prisma.supportCase.findUnique({
      where: { id: caseId },
      include: {
        user: { select: { email: true, fullName: true } },
        assignedAdmin: { select: { name: true } },
        _count: { select: { notes: true } }
      }
    });

    if (!existing) {
      throw new NotFoundError(`Support case '${caseId}' not found`);
    }

    // Object authorization check
    await assertAdminCanOperateOnResource({ context, resourceType: 'User', resourceId: existing.userId, operation: 'update' });
    await assertAdminCanOperateOnResource({ context, resourceType: 'SupportCase', resourceId: existing.id, operation: 'update' });

    const dataToUpdate: Prisma.SupportCaseUpdateInput = {};
    let auditAction: AdminAuditAction = AdminAuditAction.ADMIN_SUPPORT_CASE_UPDATED;

    if (input.status !== undefined && input.status !== existing.status) {
      const allowed = VALID_SUPPORT_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(input.status)) {
        throw new ConflictError(`Invalid status transition from '${existing.status}' to '${input.status}'`);
      }

      dataToUpdate.status = input.status;

      if (input.status === SupportCaseStatus.RESOLVED) {
        if (!existing.resolutionNotes && !input.resolutionNotes) {
          throw new ValidationError('Resolution notes are required when marking a support case as RESOLVED');
        }
        dataToUpdate.resolvedAt = new Date();
        auditAction = AdminAuditAction.ADMIN_SUPPORT_CASE_STATUS_CHANGED;
      } else if (input.status === SupportCaseStatus.CLOSED) {
        dataToUpdate.closedAt = new Date();
        auditAction = AdminAuditAction.ADMIN_SUPPORT_CASE_CLOSED;
      } else if (existing.status === SupportCaseStatus.CLOSED && input.status === SupportCaseStatus.OPEN) {
        dataToUpdate.closedAt = null;
        dataToUpdate.resolvedAt = null;
        auditAction = AdminAuditAction.ADMIN_SUPPORT_CASE_REOPENED;
      } else if (existing.status === SupportCaseStatus.RESOLVED && (input.status === SupportCaseStatus.OPEN || input.status === SupportCaseStatus.IN_PROGRESS)) {
        dataToUpdate.resolvedAt = null;
        auditAction = AdminAuditAction.ADMIN_SUPPORT_CASE_REOPENED;
      } else {
        auditAction = AdminAuditAction.ADMIN_SUPPORT_CASE_STATUS_CHANGED;
      }
    } else if (input.priority !== undefined && input.priority !== existing.priority) {
      auditAction = AdminAuditAction.ADMIN_SUPPORT_CASE_PRIORITY_CHANGED;
    }

    if (input.priority !== undefined) {
      dataToUpdate.priority = input.priority;
    }

    if (input.category !== undefined) {
      dataToUpdate.category = input.category;
    }

    if (input.resolutionNotes !== undefined) {
      dataToUpdate.resolutionNotes = input.resolutionNotes;
    }

    return executeAdminOperation({
      operationName: 'update_support_case',
      targetResourceType: 'SupportCase',
      targetResourceId: existing.id,
      context,
      action: auditAction,
      metadata: {
        caseId: existing.id,
        caseNumber: existing.caseNumber,
        previousStatus: existing.status,
        newStatus: input.status,
        previousPriority: existing.priority,
        newPriority: input.priority,
        category: input.category
      },
      execute: async (tx) => {
        const updated = await tx.supportCase.update({
          where: { id: existing.id },
          data: dataToUpdate
        });

        const indicators = computeCaseEscalationIndicators({
          status: updated.status,
          priority: updated.priority,
          assignedAdminId: updated.assignedAdminId,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt
        });

        return {
          id: updated.id,
          caseNumber: updated.caseNumber,
          userId: updated.userId,
          userEmail: existing.user.email,
          userFullName: existing.user.fullName,
          subject: updated.subject,
          category: updated.category,
          priority: updated.priority,
          status: updated.status,
          assignedAdminId: updated.assignedAdminId,
          assignedAdminName: existing.assignedAdmin?.name || null,
          noteCount: existing._count.notes,
          isUrgent: indicators.isUrgent,
          isUnassigned: indicators.isUnassigned,
          needsAttention: indicators.needsAttention,
          isOverdue: indicators.isOverdue,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
          closedAt: updated.closedAt ? updated.closedAt.toISOString() : null
        };
      }
    });
  }

  /**
   * Assigns a support case to an eligible admin operator or unassigns it.
   * Validates target admin eligibility server-side.
   */
  static async assignCase(
    caseId: string,
    input: AssignSupportCaseInput,
    context: AdminOperationContext
  ): Promise<SupportCaseSummaryItem> {
    const existing = await prisma.supportCase.findUnique({
      where: { id: caseId },
      include: {
        user: { select: { email: true, fullName: true } },
        _count: { select: { notes: true } }
      }
    });

    if (!existing) {
      throw new NotFoundError(`Support case '${caseId}' not found`);
    }

    // Object authorization check
    await assertAdminCanOperateOnResource({ context, resourceType: 'User', resourceId: existing.userId, operation: 'assign' });
    await assertAdminCanOperateOnResource({ context, resourceType: 'SupportCase', resourceId: existing.id, operation: 'assign' });

    let assignedAdminName: string | null = null;
    if (input.assignedAdminId) {
      const admin = await prisma.adminUser.findUnique({
        where: { id: input.assignedAdminId },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: { permission: true }
                  }
                }
              }
            }
          }
        }
      });

      if (!admin) {
        throw new NotFoundError(`Admin user with ID '${input.assignedAdminId}' not found`);
      }

      if (admin.status !== AdminStatus.ACTIVE) {
        throw new ConflictError(`Target administrator account '${admin.name}' is not ACTIVE`);
      }

      const isEligible = admin.isSuperAdmin ||
        admin.userRoles.some(ur => ur.role.slug === 'SUPPORT' || ur.role.name.toUpperCase().includes('SUPPORT')) ||
        admin.userRoles.some(ur => ur.role.permissions.some(p => p.permission.slug.startsWith('support.')));

      if (!isEligible) {
        throw new ConflictError(`Target administrator '${admin.name}' lacks support permissions and is ineligible for case assignment`);
      }

      assignedAdminName = admin.name;
    }

    return executeAdminOperation({
      operationName: 'assign_support_case',
      targetResourceType: 'SupportCase',
      targetResourceId: existing.id,
      context,
      action: AdminAuditAction.ADMIN_SUPPORT_CASE_ASSIGNED,
      metadata: {
        caseId: existing.id,
        caseNumber: existing.caseNumber,
        previousAssignedAdminId: existing.assignedAdminId,
        newAssignedAdminId: input.assignedAdminId
      },
      execute: async (tx) => {
        const updated = await tx.supportCase.update({
          where: { id: existing.id },
          data: {
            assignedAdminId: input.assignedAdminId
          }
        });

        const indicators = computeCaseEscalationIndicators({
          status: updated.status,
          priority: updated.priority,
          assignedAdminId: updated.assignedAdminId,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt
        });

        return {
          id: updated.id,
          caseNumber: updated.caseNumber,
          userId: updated.userId,
          userEmail: existing.user.email,
          userFullName: existing.user.fullName,
          subject: updated.subject,
          category: updated.category,
          priority: updated.priority,
          status: updated.status,
          assignedAdminId: updated.assignedAdminId,
          assignedAdminName,
          noteCount: existing._count.notes,
          isUrgent: indicators.isUrgent,
          isUnassigned: indicators.isUnassigned,
          needsAttention: indicators.needsAttention,
          isOverdue: indicators.isOverdue,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
          closedAt: updated.closedAt ? updated.closedAt.toISOString() : null
        };
      }
    });
  }

  /**
   * Lists eligible active administrators for support case assignment.
   */
  static async listEligibleAssignees(context: AdminOperationContext): Promise<EligibleSupportAdminItem[]> {
    const admins = await prisma.adminUser.findMany({
      where: { status: AdminStatus.ACTIVE },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true }
                }
              }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const eligible = admins.filter(a =>
      a.isSuperAdmin ||
      a.userRoles.some(ur => ur.role.slug === 'SUPPORT' || ur.role.name.toUpperCase().includes('SUPPORT')) ||
      a.userRoles.some(ur => ur.role.permissions.some(p => p.permission.slug.startsWith('support.')))
    );

    return eligible.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      status: a.status,
      isSuperAdmin: a.isSuperAdmin,
      roles: a.userRoles.map(ur => ur.role.name)
    }));
  }

  /**
   * Adds an internal operator note to a support case.
   */
  static async addCaseNote(
    caseId: string,
    input: AddSupportCaseNoteInput,
    context: AdminOperationContext
  ): Promise<SupportCaseNoteItem> {
    const existing = await prisma.supportCase.findUnique({
      where: { id: caseId },
      select: { id: true, userId: true, caseNumber: true }
    });

    if (!existing) {
      throw new NotFoundError(`Support case '${caseId}' not found`);
    }

    // Object authorization check
    await assertAdminCanOperateOnResource({ context, resourceType: 'User', resourceId: existing.userId, operation: 'note' });
    await assertAdminCanOperateOnResource({ context, resourceType: 'SupportCase', resourceId: existing.id, operation: 'note' });

    const admin = await prisma.adminUser.findUnique({
      where: { id: context.adminId },
      select: { id: true, name: true }
    });

    return executeAdminOperation({
      operationName: 'add_support_case_note',
      targetResourceType: 'SupportCaseNote',
      targetResourceId: existing.id,
      context,
      action: AdminAuditAction.ADMIN_SUPPORT_NOTE_ADDED,
      metadata: {
        caseId: existing.id,
        caseNumber: existing.caseNumber,
        isInternal: true
      },
      execute: async (tx) => {
        const note = await tx.supportCaseNote.create({
          data: {
            caseId: existing.id,
            adminId: context.adminId,
            note: input.note.trim(),
            isInternal: true
          }
        });

        return {
          id: note.id,
          caseId: note.caseId,
          adminId: note.adminId,
          adminName: admin?.name || 'Admin',
          note: note.note,
          isInternal: note.isInternal,
          createdAt: note.createdAt.toISOString()
        };
      }
    });
  }

  /**
   * Lists customer accounts for Support lookup with bounded search, counts, and privacy safeguards.
   * Permission required: 'support.read'
   */
  static async listSupportCustomers(
    query: SupportCustomerListQuery,
    context: AdminOperationContext
  ): Promise<PaginatedResult<SupportCustomerSummaryItem>> {
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
        { fullName: { contains: term } },
        { id: { equals: term } }
      ];

      // Log search audit event
      await AdminAuditService.logEvent({
        adminId: context.adminId,
        action: AdminAuditAction.ADMIN_SUPPORT_CUSTOMER_SEARCHED,
        status: 'SUCCESS',
        ipAddress: context.clientIp,
        userAgent: context.userAgent,
        metadata: {
          search: term,
          page,
          pageSize
        }
      });
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
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
              supportCases: {
                where: {
                  status: { in: [SupportCaseStatus.OPEN, SupportCaseStatus.IN_PROGRESS, SupportCaseStatus.WAITING_ON_CUSTOMER] }
                }
              }
            }
          },
          devices: {
            select: {
              _count: {
                select: {
                  servers: {
                    where: { status: 'RUNNING' }
                  }
                }
              }
            }
          },
          billingState: {
            select: {
              status: true
            }
          },
          subscriptions: {
            where: { status: { in: ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING'] } },
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              plan: { select: { code: true } }
            }
          }
        }
      })
    ]);

    const items: SupportCustomerSummaryItem[] = users.map(u => {
      const activeServerCount = u.devices.reduce((acc, d) => acc + d._count.servers, 0);
      const activePlanCode = u.subscriptions[0]?.plan.code || null;

      return {
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        status: u.status,
        emailVerified: u.emailVerified,
        deviceCount: u._count.devices,
        activeServerCount,
        openSupportCaseCount: u._count.supportCases,
        billingStatus: u.billingState?.status || null,
        activePlanCode,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString()
      };
    });

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Aggregates comprehensive customer diagnostic context for Support agents.
   * Performs object authorization and safe projections. NEVER returns file trees or raw secrets.
   */
  static async getSupportCustomerContext(
    userId: string,
    context: AdminOperationContext
  ): Promise<SupportCustomerContextResult> {
    // 1. Object authorization check
    await assertAdminCanOperateOnResource({
      resourceType: 'user',
      resourceId: userId,
      operation: 'read',
      context,
      targetOwnerUserId: userId
    });

    // 2. Fetch User with bounded relationships
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
          take: 50,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            deviceName: true,
            platform: true,
            osVersion: true,
            appVersion: true,
            status: true,
            lastSeenAt: true,
            createdAt: true,
            connections: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: {
                status: true,
                connectedAt: true,
                lastHeartbeatAt: true
              }
            },
            servers: {
              take: 20,
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                deviceId: true,
                serverName: true,
                status: true,
                startedAt: true,
                lastHeartbeatAt: true,
                createdAt: true,
                endpoints: {
                  take: 1,
                  orderBy: { createdAt: 'desc' },
                  select: {
                    hostname: true,
                    status: true
                  }
                }
              }
            }
          }
        },
        billingState: {
          select: {
            status: true,
            currency: true,
            billingCountry: true
          }
        },
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING'] } },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            plan: { select: { code: true } },
            currentPeriodEnd: true,
            status: true
          }
        },
        _count: {
          select: {
            payments: true,
            refunds: true
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundError(`Customer account with ID '${userId}' not found`);
    }

    // 3. Support Cases Aggregation
    const [totalCases, openCases, activeCases, resolvedCases, recentCasesRaw] = await Promise.all([
      prisma.supportCase.count({ where: { userId } }),
      prisma.supportCase.count({ where: { userId, status: SupportCaseStatus.OPEN } }),
      prisma.supportCase.count({ where: { userId, status: { in: [SupportCaseStatus.OPEN, SupportCaseStatus.IN_PROGRESS, SupportCaseStatus.WAITING_ON_CUSTOMER] } } }),
      prisma.supportCase.count({ where: { userId, status: { in: [SupportCaseStatus.RESOLVED, SupportCaseStatus.CLOSED] } } }),
      prisma.supportCase.findMany({
        where: { userId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true, fullName: true } },
          assignedAdmin: { select: { name: true } },
          _count: { select: { notes: true } }
        }
      })
    ]);

    // 4. Log Audit Event
    await AdminAuditService.logEvent({
      adminId: context.adminId,
      action: AdminAuditAction.ADMIN_SUPPORT_CUSTOMER_CONTEXT_VIEWED,
      status: 'SUCCESS',
      ipAddress: context.clientIp,
      userAgent: context.userAgent,
      metadata: {
        userId: user.id,
        userEmail: user.email,
        totalCases,
        deviceCount: user.devices.length
      }
    });

    // 5. Construct Safe Projections
    const devices: SafeDeviceSupportContext[] = user.devices.map(d => {
      const conn = d.connections[0] || null;
      return {
        id: d.id,
        deviceName: d.deviceName,
        platform: d.platform,
        osVersion: d.osVersion,
        appVersion: d.appVersion,
        status: d.status,
        lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
        serverCount: d.servers.length,
        connectionStatus: conn?.status || null,
        lastConnectedAt: conn?.connectedAt ? conn.connectedAt.toISOString() : null,
        lastHeartbeatAt: conn?.lastHeartbeatAt ? conn.lastHeartbeatAt.toISOString() : null,
        createdAt: d.createdAt.toISOString()
      };
    });

    const servers: SafeServerSupportContext[] = user.devices.flatMap(d =>
      d.servers.map(s => {
        const ep = s.endpoints[0] || null;
        return {
          id: s.id,
          deviceId: s.deviceId,
          deviceName: d.deviceName,
          serverName: s.serverName,
          status: s.status,
          endpointHostname: ep?.hostname || null,
          endpointStatus: ep?.status || null,
          startedAt: s.startedAt ? s.startedAt.toISOString() : null,
          lastHeartbeatAt: s.lastHeartbeatAt ? s.lastHeartbeatAt.toISOString() : null,
          createdAt: s.createdAt.toISOString()
        };
      })
    );

    const activeSub = user.subscriptions[0] || null;

    const billing: SafeBillingSupportContext | null = user.billingState ? {
      status: user.billingState.status,
      currency: user.billingState.currency,
      billingCountry: user.billingState.billingCountry,
      activeSubscriptionId: activeSub?.id || null,
      activePlanCode: activeSub?.plan.code || null,
      currentPeriodEnd: activeSub?.currentPeriodEnd ? activeSub.currentPeriodEnd.toISOString() : null,
      totalPaymentsCount: user._count.payments,
      totalRefundsCount: user._count.refunds,
      hasPastDue: activeSub?.status === 'PAST_DUE' || user.billingState.status === 'PAST_DUE'
    } : null;

    const recentCases: SupportCaseSummaryItem[] = recentCasesRaw.map(c => {
      const indicators = computeCaseEscalationIndicators(c);
      return {
        id: c.id,
        caseNumber: c.caseNumber,
        userId: c.userId,
        userEmail: c.user.email,
        userFullName: c.user.fullName,
        subject: c.subject,
        category: c.category,
        priority: c.priority,
        status: c.status,
        isUrgent: indicators.isUrgent,
        isUnassigned: indicators.isUnassigned,
        needsAttention: indicators.needsAttention,
        isOverdue: indicators.isOverdue,
        assignedAdminId: c.assignedAdminId,
        assignedAdminName: c.assignedAdmin?.name || null,
        noteCount: c._count.notes,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
        closedAt: c.closedAt ? c.closedAt.toISOString() : null
      };
    });

    return {
      customer: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      },
      devices,
      servers,
      billing,
      supportCases: {
        totalCount: totalCases,
        openCount: openCases,
        activeCount: activeCases,
        resolvedCount: resolvedCases,
        recentCases
      }
    };
  }
}
