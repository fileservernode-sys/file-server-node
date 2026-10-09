/**
 * Administrative System Logs & Diagnostics Domain Service
 * Phase 17 Batch 17.5 — System Logs & Diagnostics
 *
 * Provides authoritative operational metrics, multi-column search/filtering across
 * error occurrences, incidents, gateway connection diagnostics, operational audit streams,
 * and controlled sanitized export with cryptographic SHA-256 audit logging.
 */

import { Prisma, ErrorSeverity, IncidentStatus, ConnectionStatus, AdminAuditAction } from '@prisma/client';
import { prisma } from '../../../../../config/database.js';
import { NotFoundError, ValidationError } from '../../../../../errors/app-error.js';
import { AdminOperationContext } from '../../types.js';
import { PaginatedResult, createPaginatedResponse } from '../../utils/pagination.js';
import { executeAdminOperation } from '../../utils/operation_executor.js';
import {
  SystemLogsMetrics,
  SystemErrorListItem,
  SystemErrorDetail,
  SystemEventListItem,
  GatewayDiagnosticListItem,
  SystemIncidentListItem,
  SystemErrorQuery,
  SystemEventQuery,
  GatewayDiagnosticsQuery,
  SystemIncidentQuery,
  SystemLogsExportQuery
} from './types.js';

export class AdminSystemLogsService {
  /**
   * Sanitizes sensitive credentials, tokens, OTPs, API keys, and secret values from strings.
   */
  public static sanitizeString(input: string | null | undefined): string {
    if (!input) return '';
    return input
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
      .replace(/(?:password|passwd|pwd|secret|token|apiKey|api_key|auth|authorization|privateKey)[\s:=]+([^\s,;'"&]+)/gi, '$1=[REDACTED]')
      .replace(/\b\d{6}\b/g, '[OTP_REDACTED]')
      .replace(/(?:fcm_)[a-zA-Z0-9_\-:]{10,}/gi, 'fcm_[REDACTED_TOKEN]')
      .replace(/postgres(?:ql)?:\/\/[^@]+@[^/]+/gi, 'postgresql://[REDACTED_CREDENTIALS]@[HOST]');
  }

  /**
   * Aggregates authoritative operational health metrics across errors, incidents, gateway nodes, and events.
   */
  public static async getLogsMetrics(): Promise<SystemLogsMetrics> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalErrors24h,
      totalErrors7d,
      criticalErrors24h,
      openIncidentsCount,
      acknowledgedIncidentsCount,
      gatewayDisconnects24h,
      operationalEvents24h,
      componentAggs,
      errorCodeAggs
    ] = await Promise.all([
      prisma.errorOccurrence.count({
        where: { occurredAt: { gte: twentyFourHoursAgo } }
      }),
      prisma.errorOccurrence.count({
        where: { occurredAt: { gte: sevenDaysAgo } }
      }),
      prisma.errorOccurrence.count({
        where: {
          occurredAt: { gte: twentyFourHoursAgo },
          severity: ErrorSeverity.CRITICAL
        }
      }),
      prisma.errorIncident.count({
        where: { status: IncidentStatus.OPEN }
      }),
      prisma.errorIncident.count({
        where: { status: IncidentStatus.ACKNOWLEDGED }
      }),
      prisma.deviceConnection.count({
        where: {
          disconnectedAt: { gte: twentyFourHoursAgo },
          status: ConnectionStatus.DISCONNECTED
        }
      }),
      prisma.auditEvent.count({
        where: { createdAt: { gte: twentyFourHoursAgo } }
      }),
      prisma.errorOccurrence.groupBy({
        by: ['component'],
        where: { occurredAt: { gte: twentyFourHoursAgo } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5
      }),
      prisma.errorOccurrence.groupBy({
        by: ['errorCode'],
        where: {
          occurredAt: { gte: twentyFourHoursAgo },
          errorCode: { not: null }
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5
      })
    ]);

    return {
      totalErrors24h,
      totalErrors7d,
      criticalErrors24h,
      openIncidentsCount,
      acknowledgedIncidentsCount,
      gatewayDisconnects24h,
      operationalEvents24h,
      topComponents: componentAggs.map(c => ({
        component: c.component || 'UNKNOWN',
        count: c._count.id
      })),
      topErrorCodes: errorCodeAggs.map(e => ({
        errorCode: e.errorCode || 'UNKNOWN',
        count: e._count.id
      }))
    };
  }

  /**
   * Queries paginated error occurrences with multi-attribute filtering and bounded search.
   */
  public static async listErrors(
    query: SystemErrorQuery
  ): Promise<PaginatedResult<SystemErrorListItem>> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ErrorOccurrenceWhereInput = {};

    if (query.severity) where.severity = query.severity;
    if (query.component) where.component = { contains: query.component };
    if (query.errorCode) where.errorCode = { contains: query.errorCode };
    if (query.requestId) where.requestId = query.requestId;
    if (query.userId) where.userId = query.userId;
    if (query.deviceId) where.deviceId = query.deviceId;
    if (query.serverInstanceId) where.serverInstanceId = query.serverInstanceId;
    if (query.gatewayNodeId) where.gatewayNodeId = query.gatewayNodeId;

    if (query.status) {
      where.incident = { status: query.status };
    }

    if (query.startDate || query.endDate) {
      where.occurredAt = {};
      if (query.startDate) {
        const d = new Date(query.startDate);
        if (!isNaN(d.getTime())) where.occurredAt.gte = d;
      }
      if (query.endDate) {
        const d = new Date(query.endDate);
        if (!isNaN(d.getTime())) where.occurredAt.lte = d;
      }
    }

    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { message: { contains: s } },
        { errorCode: { contains: s } },
        { errorType: { contains: s } },
        { component: { contains: s } },
        { requestId: { contains: s } },
        { httpPath: { contains: s } }
      ];
    }

    const orderBy: Prisma.ErrorOccurrenceOrderByWithRelationInput = {};
    if (query.sortBy === 'occurredAt') orderBy.occurredAt = query.sortOrder;
    else if (query.sortBy === 'severity') orderBy.severity = query.sortOrder;
    else if (query.sortBy === 'component') orderBy.component = query.sortOrder;
    else if (query.sortBy === 'errorCode') orderBy.errorCode = query.sortOrder;
    else if (query.sortBy === 'httpStatus') orderBy.httpStatus = query.sortOrder;
    else orderBy.occurredAt = 'desc';

    const [total, rows] = await Promise.all([
      prisma.errorOccurrence.count({ where }),
      prisma.errorOccurrence.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          fingerprint: {
            select: {
              id: true,
              fingerprint: true
            }
          },
          incident: {
            select: {
              id: true,
              status: true
            }
          }
        }
      })
    ]);

    const items: SystemErrorListItem[] = rows.map(r => ({
      id: r.id,
      fingerprintId: r.fingerprintId,
      fingerprintHash: r.fingerprint?.fingerprint || '—',
      incidentId: r.incidentId,
      incidentStatus: r.incident?.status,
      occurredAt: r.occurredAt.toISOString(),
      component: r.component,
      severity: r.severity,
      errorCode: r.errorCode,
      errorType: r.errorType,
      message: this.sanitizeString(r.message),
      httpMethod: r.httpMethod,
      httpPath: r.httpPath,
      httpStatus: r.httpStatus,
      requestId: r.requestId,
      userId: r.userId,
      deviceId: r.deviceId,
      serverInstanceId: r.serverInstanceId,
      gatewayNodeId: r.gatewayNodeId
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves full sanitized diagnostic telemetry for a single error occurrence.
   */
  public static async getErrorDetail(occurrenceId: string): Promise<SystemErrorDetail> {
    const row = await prisma.errorOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        fingerprint: true,
        incident: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true
          }
        },
        device: {
          select: {
            id: true,
            deviceName: true,
            platform: true,
            appVersion: true
          }
        },
        serverInstance: {
          select: {
            id: true,
            serverName: true,
            status: true
          }
        },
        gatewayNode: {
          select: {
            id: true,
            hostname: true,
            region: true
          }
        }
      }
    });

    if (!row) {
      throw new NotFoundError(`Error occurrence with ID '${occurrenceId}' was not found`);
    }

    return {
      id: row.id,
      fingerprintId: row.fingerprintId,
      fingerprintHash: row.fingerprint?.fingerprint || '—',
      incidentId: row.incidentId,
      incidentStatus: row.incident?.status,
      occurredAt: row.occurredAt.toISOString(),
      component: row.component,
      severity: row.severity,
      errorCode: row.errorCode,
      errorType: row.errorType,
      message: this.sanitizeString(row.message),
      stackTrace: row.stackTrace ? this.sanitizeString(row.stackTrace) : null,
      httpMethod: row.httpMethod,
      httpPath: row.httpPath,
      httpStatus: row.httpStatus,
      requestId: row.requestId,
      userId: row.userId,
      deviceId: row.deviceId,
      serverInstanceId: row.serverInstanceId,
      gatewayNodeId: row.gatewayNodeId,
      connectionId: row.connectionId,
      sessionId: row.sessionId,
      metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null,
      linkedEntities: {
        user: row.user,
        device: row.device,
        serverInstance: row.serverInstance ? { ...row.serverInstance, status: String(row.serverInstance.status) } : null,
        gatewayNode: row.gatewayNode
      },
      fingerprintMetadata: row.fingerprint ? {
        id: row.fingerprint.id,
        totalOccurrences: row.fingerprint.totalOccurrences,
        firstSeenAt: row.fingerprint.firstSeenAt.toISOString(),
        lastSeenAt: row.fingerprint.lastSeenAt.toISOString(),
        status: row.fingerprint.status
      } : null,
      incidentMetadata: row.incident ? {
        id: row.incident.id,
        status: row.incident.status,
        title: row.incident.title,
        summary: row.incident.summary,
        acknowledgedAt: row.incident.acknowledgedAt ? row.incident.acknowledgedAt.toISOString() : null,
        acknowledgedBy: row.incident.acknowledgedBy,
        resolvedAt: row.incident.resolvedAt ? row.incident.resolvedAt.toISOString() : null,
        resolvedBy: row.incident.resolvedBy,
        resolutionNotes: row.incident.resolutionNotes
      } : null
    };
  }

  /**
   * Queries paginated operational and audit event stream.
   */
  public static async listEvents(
    query: SystemEventQuery
  ): Promise<PaginatedResult<SystemEventListItem>> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
    const skip = (page - 1) * pageSize;

    if (query.source === 'ADMIN_AUDIT') {
      const where: Prisma.AdminAuditLogWhereInput = {};
      if (query.adminId) where.adminId = query.adminId;
      if (query.startDate || query.endDate) {
        where.createdAt = {};
        if (query.startDate) {
          const d = new Date(query.startDate);
          if (!isNaN(d.getTime())) where.createdAt.gte = d;
        }
        if (query.endDate) {
          const d = new Date(query.endDate);
          if (!isNaN(d.getTime())) where.createdAt.lte = d;
        }
      }
      if (query.search) {
        where.OR = [
          { ipAddress: { contains: query.search } },
          { userAgent: { contains: query.search } }
        ];
      }

      const [total, rows] = await Promise.all([
        prisma.adminAuditLog.count({ where }),
        prisma.adminAuditLog.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { createdAt: 'desc' },
          include: {
            admin: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        })
      ]);

      const items: SystemEventListItem[] = rows.map(r => ({
        id: r.id,
        source: 'ADMIN_AUDIT',
        occurredAt: r.createdAt.toISOString(),
        eventType: r.action,
        status: r.status || 'SUCCESS',
        actor: {
          type: 'ADMIN',
          id: r.adminId,
          identifier: r.admin?.email || r.adminId || 'System'
        },
        targetEntity: {
          type: 'AdminControlPlane',
          id: null
        },
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        metadata: r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null
      }));

      return createPaginatedResponse(items, total, page, pageSize);
    }

    // Default or CUSTOMER_AUDIT stream
    const where: Prisma.AuditEventWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.deviceId) where.deviceId = query.deviceId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        const d = new Date(query.startDate);
        if (!isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (query.endDate) {
        const d = new Date(query.endDate);
        if (!isNaN(d.getTime())) where.createdAt.lte = d;
      }
    }

    const [total, rows] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true
            }
          },
          device: {
            select: {
              id: true,
              deviceName: true,
              platform: true
            }
          }
        }
      })
    ]);

    const items: SystemEventListItem[] = rows.map(r => ({
      id: r.id,
      source: 'CUSTOMER_AUDIT',
      occurredAt: r.createdAt.toISOString(),
      eventType: r.eventType,
      status: 'LOGGED',
      actor: {
        type: 'USER',
        id: r.userId,
        identifier: r.user?.email || r.userId || 'Anonymous'
      },
      targetEntity: {
        type: r.deviceId ? 'Device' : 'User',
        id: r.deviceId || r.userId
      },
      ipAddress: null,
      userAgent: null,
      metadata: r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Queries paginated gateway diagnostics and device connection sessions.
   */
  public static async getGatewayDiagnostics(
    query: GatewayDiagnosticsQuery
  ): Promise<PaginatedResult<GatewayDiagnosticListItem>> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.DeviceConnectionWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.gatewayNodeId) where.gatewayNodeId = query.gatewayNodeId;
    if (query.deviceId) where.deviceId = query.deviceId;

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        const d = new Date(query.startDate);
        if (!isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (query.endDate) {
        const d = new Date(query.endDate);
        if (!isNaN(d.getTime())) where.createdAt.lte = d;
      }
    }

    const [total, rows] = await Promise.all([
      prisma.deviceConnection.count({ where }),
      prisma.deviceConnection.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          gatewayNode: {
            select: {
              id: true,
              hostname: true,
              region: true
            }
          },
          device: {
            select: {
              id: true,
              deviceName: true,
              platform: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  email: true
                }
              }
            }
          }
        }
      })
    ]);

    const items: GatewayDiagnosticListItem[] = rows.map(r => {
      let durationSeconds: number | null = null;
      if (r.connectedAt) {
        const end = r.disconnectedAt ? r.disconnectedAt.getTime() : (r.lastHeartbeatAt ? r.lastHeartbeatAt.getTime() : Date.now());
        durationSeconds = Math.max(0, Math.floor((end - r.connectedAt.getTime()) / 1000));
      }

      return {
        id: r.id,
        gatewayNodeId: r.gatewayNodeId,
        gatewayHostname: r.gatewayNode?.hostname || null,
        gatewayRegion: r.gatewayNode?.region || null,
        deviceId: r.deviceId,
        deviceName: r.device?.deviceName || null,
        devicePlatform: r.device?.platform || null,
        userId: r.device?.userId || null,
        userEmail: r.device?.user?.email || null,
        connectionStatus: r.status,
        remoteEndpoint: r.remoteEndpoint,
        connectedAt: r.connectedAt ? r.connectedAt.toISOString() : null,
        disconnectedAt: r.disconnectedAt ? r.disconnectedAt.toISOString() : null,
        lastHeartbeatAt: r.lastHeartbeatAt ? r.lastHeartbeatAt.toISOString() : null,
        durationSeconds
      };
    });

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Queries paginated error incidents with linked fingerprint aggregates.
   */
  public static async listIncidents(
    query: SystemIncidentQuery
  ): Promise<PaginatedResult<SystemIncidentListItem>> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ErrorIncidentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.component) {
      where.fingerprint = { component: { contains: query.component } };
    }
    if (query.errorCode) {
      where.fingerprint = { errorCode: { contains: query.errorCode } };
    }

    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s } },
        { summary: { contains: s } },
        { fingerprint: { fingerprint: { contains: s } } },
        { fingerprint: { component: { contains: s } } }
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.errorIncident.count({ where }),
      prisma.errorIncident.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        include: {
          fingerprint: true
        }
      })
    ]);

    const items: SystemIncidentListItem[] = rows.map(r => ({
      id: r.id,
      fingerprintId: r.fingerprintId,
      fingerprintHash: r.fingerprint.fingerprint,
      component: r.fingerprint.component,
      errorCode: r.fingerprint.errorCode,
      errorType: r.fingerprint.errorType,
      severity: r.severity,
      status: r.status,
      title: r.title,
      summary: r.summary,
      totalOccurrences: r.fingerprint.totalOccurrences,
      firstSeenAt: r.fingerprint.firstSeenAt.toISOString(),
      lastSeenAt: r.fingerprint.lastSeenAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.toISOString() : null,
      acknowledgedBy: r.acknowledgedBy,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolvedBy: r.resolvedBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString()
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Generates a controlled, bounded, sanitized export (CSV or JSON) and records an immutable SHA-256 audit log.
   */
  public static async exportLogs(
    query: SystemLogsExportQuery,
    context: AdminOperationContext
  ): Promise<{ filename: string; mimeType: string; data: string; totalExported: number }> {
    const limit = Math.min(1000, Math.max(1, query.maxLimit || 500));

    let exportedData: Array<Record<string, unknown>> = [];

    if (query.category === 'errors') {
      const where: Prisma.ErrorOccurrenceWhereInput = {};
      if (query.severity) where.severity = query.severity;
      if (query.component) where.component = { contains: query.component };
      if (query.startDate || query.endDate) {
        where.occurredAt = {};
        if (query.startDate) where.occurredAt.gte = new Date(query.startDate);
        if (query.endDate) where.occurredAt.lte = new Date(query.endDate);
      }

      const rows = await prisma.errorOccurrence.findMany({
        where,
        take: limit,
        orderBy: { occurredAt: 'desc' }
      });

      exportedData = rows.map(r => ({
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        component: r.component,
        severity: r.severity,
        errorCode: r.errorCode || '',
        message: this.sanitizeString(r.message),
        httpMethod: r.httpMethod || '',
        httpPath: r.httpPath || '',
        httpStatus: r.httpStatus || '',
        requestId: r.requestId || '',
        userId: r.userId || '',
        deviceId: r.deviceId || ''
      }));
    } else if (query.category === 'events') {
      const rows = await prisma.auditEvent.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } }
      });

      exportedData = rows.map(r => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        eventType: r.eventType,
        userId: r.userId || '',
        userEmail: r.user?.email || '',
        deviceId: r.deviceId || ''
      }));
    } else {
      const rows = await prisma.deviceConnection.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { gatewayNode: { select: { hostname: true } } }
      });

      exportedData = rows.map(r => ({
        id: r.id,
        gateway: r.gatewayNode?.hostname || '',
        deviceId: r.deviceId,
        status: r.status,
        remoteEndpoint: r.remoteEndpoint || '',
        connectedAt: r.connectedAt ? r.connectedAt.toISOString() : '',
        disconnectedAt: r.disconnectedAt ? r.disconnectedAt.toISOString() : ''
      }));
    }

    // Audit the export action
    await executeAdminOperation({
      operationName: 'export_system_logs',
      targetResourceType: 'SystemLogs',
      targetResourceId: `export_${query.category}_${Date.now()}`,
      context,
      action: AdminAuditAction.ADMIN_AUDIT_EXPORT,
      metadata: {
        category: query.category,
        format: query.format,
        recordsExported: exportedData.length
      },
      execute: async () => {
        return { success: true };
      }
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `zdexcloud_system_logs_${query.category}_${timestamp}.${query.format}`;

    if (query.format === 'json') {
      return {
        filename,
        mimeType: 'application/json',
        data: JSON.stringify(exportedData, null, 2),
        totalExported: exportedData.length
      };
    }

    // CSV format
    if (exportedData.length === 0) {
      return {
        filename,
        mimeType: 'text/csv',
        data: 'id,message,timestamp\n',
        totalExported: 0
      };
    }

    const headers = Object.keys(exportedData[0]);
    const csvLines = [headers.join(',')];

    for (const item of exportedData) {
      const values = headers.map(h => {
        const val = item[h];
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      });
      csvLines.push(values.join(','));
    }

    return {
      filename,
      mimeType: 'text/csv',
      data: csvLines.join('\n'),
      totalExported: exportedData.length
    };
  }
}
