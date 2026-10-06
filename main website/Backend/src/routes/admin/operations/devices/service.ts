import { Prisma, AdminAuditAction } from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ConflictError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';
import { createPaginatedResponse, PaginatedResult } from '../utils/pagination.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { defaultGatewayService } from '../../../../gateway/gateway_service.js';
import { DeviceListQuery } from './schemas.js';

export interface DeviceSummaryItem {
  id: string;
  userId: string;
  userEmail: string;
  installationId: string | null;
  deviceName: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  serverCount: number;
  connectionCount: number;
}

export interface DeviceSummaryMetrics {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  connectingDevices: number;
  androidDevices: number;
}

export interface DeviceDetailResult {
  id: string;
  userId: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    status: string;
  };
  installationId: string | null;
  deviceName: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  servers: Array<{
    id: string;
    serverName: string | null;
    status: string;
    startedAt: string | null;
    endpoints: Array<{
      hostname: string;
      status: string;
    }>;
  }>;
  activeConnection: {
    id: string;
    gatewayNodeId: string | null;
    remoteEndpoint: string | null;
    status: string;
    connectedAt: string | null;
    lastHeartbeatAt: string | null;
  } | null;
  totalConnections: number;
  totalAuditEvents: number;
}

export class AdminDeviceService {
  /**
   * Retrieves summary metric counts across all registered devices.
   */
  static async getDeviceSummaryMetrics(): Promise<DeviceSummaryMetrics> {
    const [totalDevices, onlineDevices, offlineDevices, connectingDevices, androidDevices] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: { status: 'ONLINE' } }),
      prisma.device.count({ where: { status: 'OFFLINE' } }),
      prisma.device.count({ where: { status: { in: ['CONNECTING', 'RECONNECTING'] } } }),
      prisma.device.count({ where: { platform: 'Android' } })
    ]);

    return {
      totalDevices,
      onlineDevices,
      offlineDevices,
      connectingDevices,
      androidDevices
    };
  }

  /**
   * Lists customer devices with safe allowlisted filters, search, and pagination.
   */
  static async listDevices(query: DeviceListQuery): Promise<PaginatedResult<DeviceSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.DeviceWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.platform) {
      where.platform = query.platform;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.installationId) {
      where.installationId = query.installationId;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { deviceName: { contains: term } },
        { installationId: { contains: term } },
        { osVersion: { contains: term } },
        { appVersion: { contains: term } },
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

    const orderBy: Prisma.DeviceOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder
    };

    const [total, devices] = await Promise.all([
      prisma.device.count({ where }),
      prisma.device.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          installationId: true,
          deviceName: true,
          platform: true,
          osVersion: true,
          appVersion: true,
          status: true,
          lastSeenAt: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              email: true
            }
          },
          _count: {
            select: {
              servers: true,
              connections: true
            }
          }
        }
      })
    ]);

    const items: DeviceSummaryItem[] = devices.map((d) => ({
      id: d.id,
      userId: d.userId,
      userEmail: d.user?.email || 'unknown',
      installationId: d.installationId,
      deviceName: d.deviceName,
      platform: d.platform,
      osVersion: d.osVersion,
      appVersion: d.appVersion,
      status: d.status,
      lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      serverCount: d._count.servers,
      connectionCount: d._count.connections
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves operational metadata and resource overview for a specific device.
   * Safe projection: Never returns server instance passwords/hashes or connection tokens.
   */
  static async getDeviceDetail(deviceId: string): Promise<DeviceDetailResult> {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        userId: true,
        installationId: true,
        deviceName: true,
        platform: true,
        osVersion: true,
        appVersion: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true
          }
        },
        servers: {
          select: {
            id: true,
            serverName: true,
            status: true,
            startedAt: true,
            endpoints: {
              select: {
                hostname: true,
                status: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        connections: {
          select: {
            id: true,
            gatewayNodeId: true,
            remoteEndpoint: true,
            status: true,
            connectedAt: true,
            lastHeartbeatAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        _count: {
          select: {
            connections: true,
            auditEvents: true
          }
        }
      }
    });

    if (!device) {
      throw new NotFoundError(`Device with ID '${deviceId}' not found`);
    }

    const latestConn = device.connections[0] || null;

    return {
      id: device.id,
      userId: device.userId,
      user: {
        id: device.user.id,
        email: device.user.email,
        fullName: device.user.fullName,
        status: device.user.status
      },
      installationId: device.installationId,
      deviceName: device.deviceName,
      platform: device.platform,
      osVersion: device.osVersion,
      appVersion: device.appVersion,
      status: device.status,
      lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
      servers: device.servers.map((s) => ({
        id: s.id,
        serverName: s.serverName,
        status: s.status,
        startedAt: s.startedAt ? s.startedAt.toISOString() : null,
        endpoints: s.endpoints.map((e) => ({
          hostname: e.hostname,
          status: e.status
        }))
      })),
      activeConnection: latestConn
        ? {
            id: latestConn.id,
            gatewayNodeId: latestConn.gatewayNodeId,
            remoteEndpoint: latestConn.remoteEndpoint,
            status: latestConn.status,
            connectedAt: latestConn.connectedAt ? latestConn.connectedAt.toISOString() : null,
            lastHeartbeatAt: latestConn.lastHeartbeatAt ? latestConn.lastHeartbeatAt.toISOString() : null
          }
        : null,
      totalConnections: device._count.connections,
      totalAuditEvents: device._count.auditEvents
    };
  }

  /**
   * Disconnects an active device session.
   * Evicts WebSocket on Gateway and marks DB records as OFFLINE / DISCONNECTED.
   * Ensures multi-device isolation (does NOT affect other devices of the user).
   */
  static async disconnectDevice(
    deviceId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{
    id: string;
    userId: string;
    deviceName: string;
    status: string;
    previousStatus: string;
    reason: string;
  }> {
    const device = await prisma.device.findUnique({
      where: { id: deviceId }
    });

    if (!device) {
      throw new NotFoundError(`Device with ID '${deviceId}' not found`);
    }

    if (device.status === 'OFFLINE') {
      throw new ConflictError(`Device '${device.deviceName}' is already offline`);
    }

    const previousStatus = device.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative device disconnection';

    // Evict WebSocket connection on gateway node for this specific device
    try {
      defaultGatewayService.evictDeviceSession(deviceId, finalReason);
    } catch {
      // Non-fatal if gateway in-memory lookup is already missing
    }

    return executeAdminOperation({
      operationName: 'device_disconnect',
      targetResourceType: 'device',
      targetResourceId: deviceId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        operation: 'DEVICE_DISCONNECTED',
        targetDeviceId: deviceId,
        targetUserId: device.userId,
        deviceName: device.deviceName,
        previousStatus,
        newStatus: 'OFFLINE',
        reason: finalReason
      },
      execute: async (tx) => {
        const now = new Date();

        // 1. Mark device OFFLINE
        const updated = await tx.device.update({
          where: { id: deviceId },
          data: {
            status: 'OFFLINE',
            lastSeenAt: now
          },
          select: {
            id: true,
            userId: true,
            deviceName: true,
            status: true
          }
        });

        // 2. Mark any active connections for this specific device as DISCONNECTED
        await tx.deviceConnection.updateMany({
          where: {
            deviceId,
            status: { in: ['CONNECTED', 'CONNECTING', 'RECONNECTING'] }
          },
          data: {
            status: 'DISCONNECTED',
            disconnectedAt: now
          }
        });

        // 3. Mark running server instances for this device as STOPPED
        await tx.serverInstance.updateMany({
          where: {
            deviceId,
            status: { in: ['RUNNING', 'STARTING'] }
          },
          data: {
            status: 'STOPPED'
          }
        });

        return {
          id: updated.id,
          userId: updated.userId,
          deviceName: updated.deviceName,
          status: updated.status,
          previousStatus,
          reason: finalReason
        };
      }
    });
  }
}
