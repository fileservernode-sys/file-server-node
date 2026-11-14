import {
  Prisma,
  CameraStatus,
  CameraEndpointStatus,
  CameraStreamSessionStatus,
  CameraAuditEventType,
  CameraTransportType,
  CameraUsageCategory
} from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError } from '../../../../errors/app-error.js';
import { createPaginatedResponse, PaginatedResult } from '../utils/pagination.js';
import { AdminAuditSanitizer } from '../../../../services/admin/admin_audit_sanitizer.js';
import { defaultCameraSignalingService } from '../../../../services/camera_signaling_service.js';
import { defaultCameraReconciliationWorker } from '../../../../services/camera_reconciliation_worker.js';
import {
  CameraListQuery,
  CameraSessionListQuery,
  CameraAuditListQuery,
  CameraUsageListQuery
} from './schemas.js';

export interface CameraSummaryItem {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string | null;
  deviceId: string | null;
  deviceName: string | null;
  devicePlatform: string | null;
  deviceStatus: string | null;
  cameraName: string | null;
  status: CameraStatus;
  resolution: string | null;
  fps: number | null;
  audioEnabled: boolean;
  lensFacing: string | null;
  lastSeenAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
  endpointCount: number;
  sessionCount: number;
}

export interface CameraDetailResult {
  id: string;
  userId: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    status: string;
  };
  deviceId: string | null;
  device: {
    id: string;
    deviceName: string;
    platform: string;
    status: string;
    lastSeenAt: string | null;
  } | null;
  cameraName: string | null;
  status: CameraStatus;
  resolution: string | null;
  fps: number | null;
  audioEnabled: boolean;
  lensFacing: string | null;
  lastSeenAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
  endpoints: Array<{
    id: string;
    status: CameraEndpointStatus;
    ipAddress: string | null;
    lastHeartbeatAt: string | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    createdAt: string;
  }>;
  subscription: {
    id: string;
    status: string;
    allocatedAt: string;
    revokedAt: string | null;
  } | null;
  metadata: Record<string, unknown> | null;
  sessionSummary: {
    totalSessions: number;
    activeSessions: number;
  };
}

export interface CameraStreamSessionItem {
  id: string;
  cameraInstanceId: string;
  viewerUserId: string;
  viewerUser: {
    id: string;
    email: string;
    fullName: string | null;
  };
  status: CameraStreamSessionStatus;
  transportType: CameraTransportType;
  protocol: string;
  startedAt: string | null;
  endedAt: string | null;
  expiresAt: string | null;
  durationSeconds: number | null;
  bytesTransferred: number | null;
  terminationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CameraAuditEventItem {
  id: string;
  cameraInstanceId: string | null;
  userId: string | null;
  user: {
    id: string;
    email: string;
  } | null;
  actorType: string;
  eventType: CameraAuditEventType;
  action: string;
  result: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface CameraUsageRecordItem {
  id: string;
  cameraInstanceId: string | null;
  userId: string;
  category: CameraUsageCategory;
  quantity: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  updatedAt: string;
}

export interface CameraUsageSummary {
  byCategory: Record<string, number>;
  totalRecordedSeconds: number;
  distinctPeriods: number;
}

export interface CameraOperationalMetricsResult {
  scope: 'LOCAL_PROCESS_AND_DATABASE';
  processLocal: {
    signaling: ReturnType<typeof defaultCameraSignalingService.getMetrics>;
    reconciliationWorker: ReturnType<typeof defaultCameraReconciliationWorker.getMetrics>;
  };
  databaseAuthoritative: {
    registeredCameras: number;
    statusCounts: Record<CameraStatus, number>;
    activeEndpoints: number;
    activeSessions: number;
    totalUsageRecords: number;
    totalAuditEvents: number;
  };
  checkedAt: string;
}

export class AdminCameraService {
  /**
   * Retrieves comprehensive operational metrics for Camera subsystem:
   * process-local signaling & worker metrics combined with authoritative database counts.
   */
  static async getCameraSummaryMetrics(): Promise<CameraOperationalMetricsResult> {
    const statusCounts: Record<CameraStatus, number> = {
      OFFLINE: 0,
      CONNECTING: 0,
      ONLINE: 0,
      STREAMING: 0,
      RECONNECTING: 0,
      ERROR: 0
    };

    const [
      registeredCameras,
      groupedStatuses,
      activeEndpoints,
      activeSessions,
      totalUsageRecords,
      totalAuditEvents
    ] = await Promise.all([
      prisma.cameraInstance.count(),
      prisma.cameraInstance.groupBy({
        by: ['status'],
        _count: { _all: true }
      }),
      prisma.cameraEndpoint.count({
        where: {
          status: { in: [CameraEndpointStatus.READY, CameraEndpointStatus.CONNECTED] }
        }
      }),
      prisma.cameraStreamSession.count({
        where: {
          status: {
            in: [
              CameraStreamSessionStatus.INITIATED,
              CameraStreamSessionStatus.NEGOTIATING,
              CameraStreamSessionStatus.ACTIVE
            ]
          }
        }
      }),
      prisma.cameraUsageRecord.count(),
      prisma.cameraAccessAuditEvent.count()
    ]);

    for (const row of groupedStatuses) {
      if (row.status in statusCounts) {
        statusCounts[row.status] =
          typeof row._count === 'number'
            ? row._count
            : (row._count as any)?._all ?? 0;
      }
    }

    return {
      scope: 'LOCAL_PROCESS_AND_DATABASE',
      processLocal: {
        signaling: defaultCameraSignalingService.getMetrics(),
        reconciliationWorker: defaultCameraReconciliationWorker.getMetrics()
      },
      databaseAuthoritative: {
        registeredCameras,
        statusCounts,
        activeEndpoints,
        activeSessions,
        totalUsageRecords,
        totalAuditEvents
      },
      checkedAt: new Date().toISOString()
    };
  }

  /**
   * Lists Camera instances with safe allowlisted filters, search, and pagination.
   */
  static async listCameras(query: CameraListQuery): Promise<PaginatedResult<CameraSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.CameraInstanceWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.deviceId) {
      where.deviceId = query.deviceId;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { id: { contains: term } },
        { cameraName: { contains: term } },
        { deviceId: { contains: term } },
        { userId: { contains: term } },
        { user: { email: { contains: term } } }
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

    const orderBy: Prisma.CameraInstanceOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { id: 'desc' }
    ];

    const [total, cameras] = await Promise.all([
      prisma.cameraInstance.count({ where }),
      prisma.cameraInstance.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          user: {
            select: {
              email: true,
              fullName: true,
              status: true
            }
          },
          deviceId: true,
          device: {
            select: {
              deviceName: true,
              platform: true,
              status: true
            }
          },
          cameraName: true,
          status: true,
          resolution: true,
          fps: true,
          audioEnabled: true,
          lensFacing: true,
          lastSeenAt: true,
          startedAt: true,
          stoppedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              endpoints: true,
              streamSessions: true
            }
          }
        }
      })
    ]);

    const items: CameraSummaryItem[] = cameras.map((c) => ({
      id: c.id,
      userId: c.userId,
      userEmail: c.user?.email || 'unknown',
      userFullName: c.user?.fullName || null,
      deviceId: c.deviceId,
      deviceName: c.device?.deviceName || null,
      devicePlatform: c.device?.platform || null,
      deviceStatus: c.device?.status || null,
      cameraName: c.cameraName,
      status: c.status,
      resolution: c.resolution,
      fps: c.fps,
      audioEnabled: c.audioEnabled,
      lensFacing: c.lensFacing,
      lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
      startedAt: c.startedAt ? c.startedAt.toISOString() : null,
      stoppedAt: c.stoppedAt ? c.stoppedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      endpointCount: c._count.endpoints,
      sessionCount: c._count.streamSessions
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves operational details for a specific CameraInstance with strictly sanitized metadata.
   */
  static async getCameraDetail(cameraId: string): Promise<CameraDetailResult> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true
          }
        },
        deviceId: true,
        device: {
          select: {
            id: true,
            deviceName: true,
            platform: true,
            status: true,
            lastSeenAt: true
          }
        },
        cameraName: true,
        status: true,
        resolution: true,
        fps: true,
        audioEnabled: true,
        lensFacing: true,
        metadata: true,
        lastSeenAt: true,
        startedAt: true,
        stoppedAt: true,
        createdAt: true,
        updatedAt: true,
        endpoints: {
          select: {
            id: true,
            status: true,
            ipAddress: true,
            lastHeartbeatAt: true,
            connectedAt: true,
            disconnectedAt: true,
            createdAt: true
          },
          orderBy: { lastHeartbeatAt: 'desc' },
          take: 10
        },
        subscription: {
          select: {
            id: true,
            status: true,
            allocatedAt: true,
            revokedAt: true
          }
        }
      }
    });

    if (!camera) {
      throw new NotFoundError('Camera instance not found', 'CAMERA_NOT_FOUND');
    }

    const [totalSessions, activeSessions] = await Promise.all([
      prisma.cameraStreamSession.count({
        where: { cameraInstanceId: cameraId }
      }),
      prisma.cameraStreamSession.count({
        where: {
          cameraInstanceId: cameraId,
          status: {
            in: [
              CameraStreamSessionStatus.INITIATED,
              CameraStreamSessionStatus.NEGOTIATING,
              CameraStreamSessionStatus.ACTIVE
            ]
          }
        }
      })
    ]);

    // Sanitize metadata: scrub all tokens, credentials, and WebRTC payloads
    const rawMeta = (camera.metadata as Record<string, unknown>) || {};
    const sanitizedMeta = AdminAuditSanitizer.sanitizeMetadata(rawMeta) as Record<string, unknown>;

    return {
      id: camera.id,
      userId: camera.userId,
      user: camera.user,
      deviceId: camera.deviceId,
      device: camera.device
        ? {
            id: camera.device.id,
            deviceName: camera.device.deviceName,
            platform: camera.device.platform,
            status: camera.device.status,
            lastSeenAt: camera.device.lastSeenAt ? camera.device.lastSeenAt.toISOString() : null
          }
        : null,
      cameraName: camera.cameraName,
      status: camera.status,
      resolution: camera.resolution,
      fps: camera.fps,
      audioEnabled: camera.audioEnabled,
      lensFacing: camera.lensFacing,
      lastSeenAt: camera.lastSeenAt ? camera.lastSeenAt.toISOString() : null,
      startedAt: camera.startedAt ? camera.startedAt.toISOString() : null,
      stoppedAt: camera.stoppedAt ? camera.stoppedAt.toISOString() : null,
      createdAt: camera.createdAt.toISOString(),
      updatedAt: camera.updatedAt.toISOString(),
      endpoints: camera.endpoints.map((ep) => ({
        id: ep.id,
        status: ep.status,
        ipAddress: ep.ipAddress,
        lastHeartbeatAt: ep.lastHeartbeatAt ? ep.lastHeartbeatAt.toISOString() : null,
        connectedAt: ep.connectedAt ? ep.connectedAt.toISOString() : null,
        disconnectedAt: ep.disconnectedAt ? ep.disconnectedAt.toISOString() : null,
        createdAt: ep.createdAt.toISOString()
      })),
      subscription: camera.subscription
        ? {
            id: camera.subscription.id,
            status: camera.subscription.status,
            allocatedAt: camera.subscription.allocatedAt.toISOString(),
            revokedAt: camera.subscription.revokedAt ? camera.subscription.revokedAt.toISOString() : null
          }
        : null,
      metadata: sanitizedMeta,
      sessionSummary: {
        totalSessions,
        activeSessions
      }
    };
  }

  /**
   * Lists streaming sessions for a specific CameraInstance with pagination and status filtering.
   * Strictly excludes sessionTokenHash, SDP, ICE candidates, or private connection secrets.
   */
  static async listCameraStreamSessions(
    cameraId: string,
    query: CameraSessionListQuery
  ): Promise<PaginatedResult<CameraStreamSessionItem>> {
    const cameraExists = await prisma.cameraInstance.findUnique({
      where: { id: cameraId },
      select: { id: true }
    });

    if (!cameraExists) {
      throw new NotFoundError('Camera instance not found', 'CAMERA_NOT_FOUND');
    }

    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.CameraStreamSessionWhereInput = {
      cameraInstanceId: cameraId
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.viewerUserId) {
      where.viewerUserId = query.viewerUserId;
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

    const orderBy: Prisma.CameraStreamSessionOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { id: 'desc' }
    ];

    const [total, sessions] = await Promise.all([
      prisma.cameraStreamSession.count({ where }),
      prisma.cameraStreamSession.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          cameraInstanceId: true,
          viewerUserId: true,
          viewerUser: {
            select: {
              id: true,
              email: true,
              fullName: true
            }
          },
          status: true,
          transportType: true,
          protocol: true,
          startedAt: true,
          endedAt: true,
          expiresAt: true,
          durationSeconds: true,
          bytesTransferred: true,
          terminationReason: true,
          createdAt: true,
          updatedAt: true
        }
      })
    ]);

    const items: CameraStreamSessionItem[] = sessions.map((s) => ({
      id: s.id,
      cameraInstanceId: s.cameraInstanceId,
      viewerUserId: s.viewerUserId,
      viewerUser: s.viewerUser,
      status: s.status,
      transportType: s.transportType,
      protocol: s.protocol,
      startedAt: s.startedAt ? s.startedAt.toISOString() : null,
      endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
      durationSeconds: s.durationSeconds,
      bytesTransferred: s.bytesTransferred !== null ? Number(s.bytesTransferred) : null,
      terminationReason: s.terminationReason,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString()
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Lists CameraAccessAuditEvent records for a specific CameraInstance with pagination and sanitization.
   */
  static async listCameraAuditEvents(
    cameraId: string,
    query: CameraAuditListQuery
  ): Promise<PaginatedResult<CameraAuditEventItem>> {
    const cameraExists = await prisma.cameraInstance.findUnique({
      where: { id: cameraId },
      select: { id: true }
    });

    if (!cameraExists) {
      throw new NotFoundError('Camera instance not found', 'CAMERA_NOT_FOUND');
    }

    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.CameraAccessAuditEventWhereInput = {
      cameraInstanceId: cameraId
    };

    if (query.eventType) {
      where.eventType = query.eventType;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.result) {
      where.result = query.result;
    }

    if (query.actorType) {
      where.actorType = query.actorType;
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

    const orderBy: Prisma.CameraAccessAuditEventOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { id: 'desc' }
    ];

    const [total, events] = await Promise.all([
      prisma.cameraAccessAuditEvent.count({ where }),
      prisma.cameraAccessAuditEvent.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          cameraInstanceId: true,
          userId: true,
          user: {
            select: {
              id: true,
              email: true
            }
          },
          actorType: true,
          eventType: true,
          action: true,
          result: true,
          ipAddress: true,
          userAgent: true,
          metadata: true,
          createdAt: true
        }
      })
    ]);

    const items: CameraAuditEventItem[] = events.map((e) => ({
      id: e.id,
      cameraInstanceId: e.cameraInstanceId,
      userId: e.userId,
      user: e.user,
      actorType: e.actorType,
      eventType: e.eventType,
      action: e.action,
      result: e.result,
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      metadata: AdminAuditSanitizer.sanitizeMetadata(e.metadata),
      createdAt: e.createdAt.toISOString()
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves aggregate usage summary and paginated usage records for a specific CameraInstance.
   */
  static async getCameraUsage(
    cameraId: string,
    query: CameraUsageListQuery
  ): Promise<{ summary: CameraUsageSummary } & PaginatedResult<CameraUsageRecordItem>> {
    const cameraExists = await prisma.cameraInstance.findUnique({
      where: { id: cameraId },
      select: { id: true }
    });

    if (!cameraExists) {
      throw new NotFoundError('Camera instance not found', 'CAMERA_NOT_FOUND');
    }

    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.CameraUsageRecordWhereInput = {
      cameraInstanceId: cameraId
    };

    if (query.category) {
      where.category = query.category;
    }

    if (query.startDate || query.endDate) {
      where.periodStart = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (!isNaN(start.getTime())) where.periodStart.gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (!isNaN(end.getTime())) where.periodStart.lte = end;
      }
    }

    const orderBy: Prisma.CameraUsageRecordOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { id: 'desc' }
    ];

    const [total, records, categoryAggregates] = await Promise.all([
      prisma.cameraUsageRecord.count({ where }),
      prisma.cameraUsageRecord.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          cameraInstanceId: true,
          userId: true,
          category: true,
          quantity: true,
          unit: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.cameraUsageRecord.groupBy({
        by: ['category'],
        where: { cameraInstanceId: cameraId },
        _sum: { quantity: true }
      })
    ]);

    const byCategory: Record<string, number> = {};
    let totalRecordedSeconds = 0;

    for (const agg of categoryAggregates) {
      const sumVal = agg._sum?.quantity ? Number(agg._sum.quantity) : 0;
      byCategory[agg.category] = sumVal;
      if (agg.category === CameraUsageCategory.STREAMING_SECONDS) {
        totalRecordedSeconds += sumVal;
      }
    }

    const items: CameraUsageRecordItem[] = records.map((r) => ({
      id: r.id,
      cameraInstanceId: r.cameraInstanceId,
      userId: r.userId,
      category: r.category,
      quantity: Number(r.quantity),
      unit: r.unit,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString()
    }));

    const paginated = createPaginatedResponse(items, total, page, pageSize);

    return {
      summary: {
        byCategory,
        totalRecordedSeconds,
        distinctPeriods: total
      },
      ...paginated
    };
  }
}
