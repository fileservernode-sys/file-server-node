import { prisma } from '../../config/database.js';
import { ErrorSeverity, IncidentStatus, AdminAuditAction, Prisma } from '@prisma/client';
import { AdminContext } from '../../middleware/admin-auth.js';
import { AdminAuditService } from './admin_audit_service.js';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/app-error.js';
import { createPaginatedResponse, PaginatedResult } from '../../routes/admin/operations/utils/pagination.js';
import { RequestContextStore } from '../../observability/request_context.js';


export interface IncidentQueryFilters {
  status?: IncidentStatus;
  severity?: ErrorSeverity;
  component?: string;
  errorCode?: string;
  fingerprintId?: string;
  fingerprint?: string;
  startDate?: string;
  endDate?: string;
  userId?: string;
  deviceId?: string;
  serverInstanceId?: string;
  gatewayNodeId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'lastSeenAt' | 'firstSeenAt' | 'severity' | 'status' | 'totalOccurrences' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface IncidentListItem {
  id: string;
  fingerprintId: string;
  status: IncidentStatus;
  severity: ErrorSeverity;
  title: string | null;
  summary: string | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  mutedAt: Date | null;
  mutedUntil: Date | null;
  mutedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  fingerprint: {
    id: string;
    fingerprint: string;
    component: string;
    errorCode: string | null;
    errorType: string | null;
    severity: ErrorSeverity;
    firstSeenAt: Date;
    lastSeenAt: Date;
    totalOccurrences: number;
    status: IncidentStatus;
  };
}

export class AdminErrorService {
  /**
   * Queries error incidents with multi-attribute filtering, bounded search, and secure pagination.
   */
  public static async listIncidents(
    filters: IncidentQueryFilters
  ): Promise<{
    items: IncidentListItem[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize || 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ErrorIncidentWhereInput = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.severity) {
      where.severity = filters.severity;
    }

    if (filters.fingerprintId) {
      where.fingerprintId = filters.fingerprintId;
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        if (!isNaN(start.getTime())) {
          where.createdAt.gte = start;
        }
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        if (!isNaN(end.getTime())) {
          where.createdAt.lte = end;
        }
      }
    }

    // Related Fingerprint & Occurrence Filters
    const fingerprintWhere: Prisma.ErrorFingerprintWhereInput = {};
    if (filters.component) {
      fingerprintWhere.component = filters.component.toUpperCase().trim();
    }
    if (filters.errorCode) {
      fingerprintWhere.errorCode = filters.errorCode.trim();
    }
    if (filters.fingerprint) {
      fingerprintWhere.fingerprint = filters.fingerprint.trim();
    }

    if (Object.keys(fingerprintWhere).length > 0) {
      where.fingerprint = fingerprintWhere;
    }

    // Occurrence-level context filters (userId, deviceId, serverInstanceId, gatewayNodeId)
    const occurrenceWhere: Prisma.ErrorOccurrenceWhereInput = {};
    if (filters.userId) {
      occurrenceWhere.userId = filters.userId.trim();
    }
    if (filters.deviceId) {
      occurrenceWhere.deviceId = filters.deviceId.trim();
    }
    if (filters.serverInstanceId) {
      occurrenceWhere.serverInstanceId = filters.serverInstanceId.trim();
    }
    if (filters.gatewayNodeId) {
      occurrenceWhere.gatewayNodeId = filters.gatewayNodeId.trim();
    }

    if (Object.keys(occurrenceWhere).length > 0) {
      where.occurrences = {
        some: occurrenceWhere
      };
    }

    // Safe Search over diagnostic fields
    if (filters.search && filters.search.trim().length > 0) {
      const searchTerm = filters.search.trim();
      where.OR = [
        { title: { contains: searchTerm } },
        { summary: { contains: searchTerm } },
        {
          fingerprint: {
            OR: [
              { errorCode: { contains: searchTerm } },
              { component: { contains: searchTerm } },
              { fingerprint: { contains: searchTerm } }
            ]
          }
        }
      ];
    }

    // Sorting
    const sortField = filters.sortBy || 'updatedAt';
    const sortOrder: Prisma.SortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';

    let orderBy: Prisma.ErrorIncidentOrderByWithRelationInput = { updatedAt: sortOrder };
    if (sortField === 'createdAt') {
      orderBy = { createdAt: sortOrder };
    } else if (sortField === 'status') {
      orderBy = { status: sortOrder };
    } else if (sortField === 'severity') {
      orderBy = { severity: sortOrder };
    } else if (sortField === 'firstSeenAt') {
      orderBy = { fingerprint: { firstSeenAt: sortOrder } };
    } else if (sortField === 'lastSeenAt') {
      orderBy = { fingerprint: { lastSeenAt: sortOrder } };
    } else if (sortField === 'totalOccurrences') {
      orderBy = { fingerprint: { totalOccurrences: sortOrder } };
    }

    const [total, incidents] = await Promise.all([
      prisma.errorIncident.count({ where }),
      prisma.errorIncident.findMany({
        where,
        include: {
          fingerprint: {
            select: {
              id: true,
              fingerprint: true,
              component: true,
              errorCode: true,
              errorType: true,
              severity: true,
              firstSeenAt: true,
              lastSeenAt: true,
              totalOccurrences: true,
              status: true
            }
          }
        },
        orderBy,
        skip,
        take: pageSize
      })
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      items: incidents,
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      }
    };
  }

  /**
   * Retrieves single incident details, fingerprint summary, and latest bounded occurrences.
   */
  public static async getIncidentDetail(incidentId: string) {
    const incident = await prisma.errorIncident.findUnique({
      where: { id: incidentId },
      include: {
        fingerprint: true,
        occurrences: {
          orderBy: { occurredAt: 'desc' },
          take: 20,
          select: {
            id: true,
            fingerprintId: true,
            incidentId: true,
            occurredAt: true,
            component: true,
            severity: true,
            errorCode: true,
            errorType: true,
            message: true,
            httpMethod: true,
            httpPath: true,
            httpStatus: true,
            requestId: true,
            userId: true,
            deviceId: true,
            serverInstanceId: true,
            gatewayNodeId: true,
            connectionId: true,
            sessionId: true,
            createdAt: true
          }
        }
      }
    });

    if (!incident) {
      throw new NotFoundError('Error incident not found', 'INCIDENT_NOT_FOUND');
    }

    return incident;
  }

  /**
   * Retrieves single granular error occurrence with full diagnostic context.
   */
  public static async getOccurrenceDetail(occurrenceId: string) {
    const occurrence = await prisma.errorOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        fingerprint: {
          select: {
            id: true,
            fingerprint: true,
            component: true,
            errorCode: true,
            errorType: true,
            severity: true,
            status: true,
            totalOccurrences: true,
            firstSeenAt: true,
            lastSeenAt: true
          }
        },
        incident: {
          select: {
            id: true,
            status: true,
            severity: true,
            title: true,
            acknowledgedAt: true,
            acknowledgedBy: true,
            resolvedAt: true,
            resolvedBy: true,
            mutedAt: true,
            mutedUntil: true
          }
        }
      }
    });

    if (!occurrence) {
      throw new NotFoundError('Error occurrence not found', 'OCCURRENCE_NOT_FOUND');
    }

    return occurrence;
  }

  /**
   * Retrieves single error fingerprint with active incidents summary.
   */
  public static async getFingerprintDetail(fingerprintId: string) {
    const fingerprint = await prisma.errorFingerprint.findUnique({
      where: { id: fingerprintId },
      include: {
        incidents: {
          orderBy: { updatedAt: 'desc' },
          take: 10
        }
      }
    });

    if (!fingerprint) {
      throw new NotFoundError('Error fingerprint not found', 'FINGERPRINT_NOT_FOUND');
    }

    return fingerprint;
  }

  /**
   * Acknowledges an active incident with cryptographic audit logging.
   */
  public static async acknowledgeIncident(
    incidentId: string,
    admin: AdminContext,
    clientIp?: string,
    userAgent?: string
  ) {
    const reqId = RequestContextStore.getRequestId();

    const result = await prisma.$transaction(async (tx) => {
      const incident = await tx.errorIncident.findUnique({
        where: { id: incidentId }
      });

      if (!incident) {
        throw new NotFoundError('Error incident not found', 'INCIDENT_NOT_FOUND');
      }

      if (incident.status === IncidentStatus.RESOLVED) {
        throw new ValidationError('Cannot acknowledge a resolved incident. Reopen or create a new incident.');
      }

      // Idempotent if already acknowledged
      if (incident.status === IncidentStatus.ACKNOWLEDGED) {
        return incident;
      }

      const updated = await tx.errorIncident.update({
        where: { id: incidentId },
        data: {
          status: IncidentStatus.ACKNOWLEDGED,
          acknowledgedAt: new Date(),
          acknowledgedBy: admin.id
        }
      });

      return updated;
    });

    // Write audit log entry
    await AdminAuditService.logEvent({
      adminId: admin.id,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      status: 'SUCCESS',
      ipAddress: clientIp || null,
      userAgent: userAgent || null,
      metadata: {
        errorAction: 'ERROR_INCIDENT_ACKNOWLEDGED',
        targetResourceType: 'ERROR_INCIDENT',
        targetResourceId: incidentId,
        newStatus: IncidentStatus.ACKNOWLEDGED,
        requestId: reqId
      }
    }).catch(err => console.error('[AdminErrorService] Audit log failure on acknowledge:', err));

    return result;
  }

  /**
   * Resolves an incident with resolution notes and cryptographic audit logging.
   */
  public static async resolveIncident(
    incidentId: string,
    input: { resolutionNotes?: string },
    admin: AdminContext,
    clientIp?: string,
    userAgent?: string
  ) {
    const reqId = RequestContextStore.getRequestId();

    const result = await prisma.$transaction(async (tx) => {
      const incident = await tx.errorIncident.findUnique({
        where: { id: incidentId }
      });

      if (!incident) {
        throw new NotFoundError('Error incident not found', 'INCIDENT_NOT_FOUND');
      }

      const notes = input.resolutionNotes ? input.resolutionNotes.trim().substring(0, 2000) : null;

      const updated = await tx.errorIncident.update({
        where: { id: incidentId },
        data: {
          status: IncidentStatus.RESOLVED,
          resolvedAt: new Date(),
          resolvedBy: admin.id,
          resolutionNotes: notes
        }
      });

      // Check if all incidents for the fingerprint are resolved; if so, resolve fingerprint status
      const remainingOpen = await tx.errorIncident.count({
        where: {
          fingerprintId: incident.fingerprintId,
          status: { in: [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED] }
        }
      });

      if (remainingOpen === 0) {
        await tx.errorFingerprint.update({
          where: { id: incident.fingerprintId },
          data: { status: IncidentStatus.RESOLVED }
        });
      }

      return updated;
    });

    // Write audit log entry
    await AdminAuditService.logEvent({
      adminId: admin.id,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      status: 'SUCCESS',
      ipAddress: clientIp || null,
      userAgent: userAgent || null,
      metadata: {
        errorAction: 'ERROR_INCIDENT_RESOLVED',
        targetResourceType: 'ERROR_INCIDENT',
        targetResourceId: incidentId,
        newStatus: IncidentStatus.RESOLVED,
        resolutionNotes: input.resolutionNotes || undefined,
        requestId: reqId
      }
    }).catch(err => console.error('[AdminErrorService] Audit log failure on resolve:', err));

    return result;
  }

  /**
   * Mutes an incident with duration limit and cryptographic audit logging.
   */
  public static async muteIncident(
    incidentId: string,
    input: { mutedUntil?: string | null; reason?: string },
    admin: AdminContext,
    clientIp?: string,
    userAgent?: string
  ) {
    const reqId = RequestContextStore.getRequestId();

    let parsedMutedUntil: Date | null = null;
    if (input.mutedUntil) {
      const d = new Date(input.mutedUntil);
      if (isNaN(d.getTime())) {
        throw new ValidationError('Invalid mutedUntil date format');
      }
      const now = new Date();
      if (d.getTime() <= now.getTime()) {
        throw new ValidationError('mutedUntil must be a date in the future');
      }
      // Maximum 90 days mute limit
      const maxMute = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      if (d.getTime() > maxMute.getTime()) {
        throw new ValidationError('Mute duration cannot exceed 90 days');
      }
      parsedMutedUntil = d;
    }

    const result = await prisma.$transaction(async (tx) => {
      const incident = await tx.errorIncident.findUnique({
        where: { id: incidentId }
      });

      if (!incident) {
        throw new NotFoundError('Error incident not found', 'INCIDENT_NOT_FOUND');
      }

      const updated = await tx.errorIncident.update({
        where: { id: incidentId },
        data: {
          status: IncidentStatus.MUTED,
          mutedAt: new Date(),
          mutedUntil: parsedMutedUntil,
          mutedBy: admin.id
        }
      });

      return updated;
    });

    // Write audit log entry
    await AdminAuditService.logEvent({
      adminId: admin.id,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      status: 'SUCCESS',
      ipAddress: clientIp || null,
      userAgent: userAgent || null,
      metadata: {
        errorAction: 'ERROR_INCIDENT_MUTED',
        targetResourceType: 'ERROR_INCIDENT',
        targetResourceId: incidentId,
        newStatus: IncidentStatus.MUTED,
        mutedUntil: input.mutedUntil || null,
        reason: input.reason ? input.reason.trim().substring(0, 500) : undefined,
        requestId: reqId
      }
    }).catch(err => console.error('[AdminErrorService] Audit log failure on mute:', err));

    return result;
  }

  /**
   * Unmutes an incident, restoring active triage state with cryptographic audit logging.
   */
  public static async unmuteIncident(
    incidentId: string,
    admin: AdminContext,
    clientIp?: string,
    userAgent?: string
  ) {
    const reqId = RequestContextStore.getRequestId();

    const result = await prisma.$transaction(async (tx) => {
      const incident = await tx.errorIncident.findUnique({
        where: { id: incidentId }
      });

      if (!incident) {
        throw new NotFoundError('Error incident not found', 'INCIDENT_NOT_FOUND');
      }

      if (incident.status !== IncidentStatus.MUTED) {
        throw new ValidationError('Incident is not currently muted');
      }

      const restoredStatus = incident.acknowledgedAt ? IncidentStatus.ACKNOWLEDGED : IncidentStatus.OPEN;

      const updated = await tx.errorIncident.update({
        where: { id: incidentId },
        data: {
          status: restoredStatus,
          mutedAt: null,
          mutedUntil: null,
          mutedBy: null
        }
      });

      return updated;
    });

    // Write audit log entry
    await AdminAuditService.logEvent({
      adminId: admin.id,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      status: 'SUCCESS',
      ipAddress: clientIp || null,
      userAgent: userAgent || null,
      metadata: {
        errorAction: 'ERROR_INCIDENT_UNMUTED',
        targetResourceType: 'ERROR_INCIDENT',
        targetResourceId: incidentId,
        previousStatus: IncidentStatus.MUTED,
        newStatus: result.status,
        requestId: reqId
      }
    }).catch(err => console.error('[AdminErrorService] Audit log failure on unmute:', err));

    return result;
  }
}
