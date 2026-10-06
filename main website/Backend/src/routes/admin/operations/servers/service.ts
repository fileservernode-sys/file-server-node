import { Prisma, AdminAuditAction } from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ConflictError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';
import { createPaginatedResponse, PaginatedResult } from '../utils/pagination.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { defaultGatewayService } from '../../../../gateway/gateway_service.js';
import { EndpointService } from '../../../../services/endpoint.js';
import { ServerListQuery } from './schemas.js';

export interface ServerSummaryItem {
  id: string;
  deviceId: string;
  deviceName: string;
  userId: string;
  userEmail: string;
  serverName: string | null;
  adminUsername: string | null;
  status: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  endpoints: Array<{
    hostname: string;
    status: string;
  }>;
}

export interface ServerSummaryMetrics {
  totalServers: number;
  runningServers: number;
  stoppedServers: number;
  startingServers: number;
  errorServers: number;
}

export interface ServerDetailResult {
  id: string;
  deviceId: string;
  device: {
    id: string;
    deviceName: string;
    platform: string;
    status: string;
    lastSeenAt: string | null;
  };
  userId: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    status: string;
  };
  serverName: string | null;
  adminUsername: string | null;
  status: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  endpoints: Array<{
    id: string;
    hostname: string;
    status: string;
    createdAt: string;
  }>;
  activeConnection: {
    id: string;
    gatewayNodeId: string | null;
    remoteEndpoint: string | null;
    status: string;
    connectedAt: string | null;
    lastHeartbeatAt: string | null;
  } | null;
  totalAuditEvents: number;
}

export class AdminServerService {
  /**
   * Retrieves summary metric counts across all server instances.
   */
  static async getServerSummaryMetrics(): Promise<ServerSummaryMetrics> {
    const [totalServers, runningServers, stoppedServers, startingServers, errorServers] = await Promise.all([
      prisma.serverInstance.count(),
      prisma.serverInstance.count({ where: { status: 'RUNNING' } }),
      prisma.serverInstance.count({ where: { status: 'STOPPED' } }),
      prisma.serverInstance.count({ where: { status: 'STARTING' } }),
      prisma.serverInstance.count({ where: { status: 'ERROR' } })
    ]);

    return {
      totalServers,
      runningServers,
      stoppedServers,
      startingServers,
      errorServers
    };
  }

  /**
   * Lists customer server instances with safe allowlisted filters, search, and pagination.
   */
  static async listServers(query: ServerListQuery): Promise<PaginatedResult<ServerSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ServerInstanceWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.deviceId) {
      where.deviceId = query.deviceId;
    }

    if (query.userId) {
      where.device = {
        userId: query.userId
      };
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { serverName: { contains: term } },
        { adminUsername: { contains: term } },
        { device: { deviceName: { contains: term } } },
        { device: { user: { email: { contains: term } } } }
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

    const orderBy: Prisma.ServerInstanceOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder
    };

    const [total, servers] = await Promise.all([
      prisma.serverInstance.count({ where }),
      prisma.serverInstance.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          deviceId: true,
          serverName: true,
          adminUsername: true,
          status: true,
          startedAt: true,
          lastHeartbeatAt: true,
          createdAt: true,
          updatedAt: true,
          device: {
            select: {
              deviceName: true,
              userId: true,
              user: {
                select: {
                  email: true
                }
              }
            }
          },
          endpoints: {
            select: {
              hostname: true,
              status: true
            }
          }
        }
      })
    ]);

    const items: ServerSummaryItem[] = servers.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      deviceName: s.device?.deviceName || 'Unknown Device',
      userId: s.device?.userId || 'unknown',
      userEmail: s.device?.user?.email || 'unknown',
      serverName: s.serverName,
      adminUsername: s.adminUsername,
      status: s.status,
      startedAt: s.startedAt ? s.startedAt.toISOString() : null,
      lastHeartbeatAt: s.lastHeartbeatAt ? s.lastHeartbeatAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      endpoints: s.endpoints.map((e) => ({
        hostname: e.hostname,
        status: e.status
      }))
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves operational metadata and resource overview for a specific server instance.
   * Safe projection: Never returns adminPasswordHash, customer files, or raw connection tokens.
   */
  static async getServerDetail(serverId: string): Promise<ServerDetailResult> {
    const server = await prisma.serverInstance.findUnique({
      where: { id: serverId },
      select: {
        id: true,
        deviceId: true,
        serverName: true,
        adminUsername: true,
        status: true,
        startedAt: true,
        lastHeartbeatAt: true,
        createdAt: true,
        updatedAt: true,
        device: {
          select: {
            id: true,
            deviceName: true,
            platform: true,
            status: true,
            lastSeenAt: true,
            userId: true,
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                status: true
              }
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
                auditEvents: true
              }
            }
          }
        },
        endpoints: {
          select: {
            id: true,
            hostname: true,
            status: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!server) {
      throw new NotFoundError(`Server instance with ID '${serverId}' not found`);
    }

    const latestConn = server.device?.connections[0] || null;

    return {
      id: server.id,
      deviceId: server.deviceId,
      device: {
        id: server.device.id,
        deviceName: server.device.deviceName,
        platform: server.device.platform,
        status: server.device.status,
        lastSeenAt: server.device.lastSeenAt ? server.device.lastSeenAt.toISOString() : null
      },
      userId: server.device.userId,
      user: {
        id: server.device.user.id,
        email: server.device.user.email,
        fullName: server.device.user.fullName,
        status: server.device.user.status
      },
      serverName: server.serverName,
      adminUsername: server.adminUsername,
      status: server.status,
      startedAt: server.startedAt ? server.startedAt.toISOString() : null,
      lastHeartbeatAt: server.lastHeartbeatAt ? server.lastHeartbeatAt.toISOString() : null,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
      endpoints: server.endpoints.map((e) => ({
        id: e.id,
        hostname: e.hostname,
        status: e.status,
        createdAt: e.createdAt.toISOString()
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
      totalAuditEvents: server.device?._count?.auditEvents || 0
    };
  }

  /**
   * Starts a stopped or errored server instance.
   * Enforces transition state checks, provisions endpoints, and records audit trail.
   */
  static async startServer(
    serverId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{
    id: string;
    deviceId: string;
    serverName: string | null;
    status: string;
    previousStatus: string;
    reason: string;
  }> {
    const server = await prisma.serverInstance.findUnique({
      where: { id: serverId },
      include: {
        device: {
          select: {
            id: true,
            userId: true,
            deviceName: true,
            status: true
          }
        }
      }
    });

    if (!server) {
      throw new NotFoundError(`Server instance with ID '${serverId}' not found`);
    }

    if (server.status === 'RUNNING') {
      throw new ConflictError(`Server instance '${server.serverName || server.id}' is already running`);
    }

    if (server.status === 'STARTING') {
      throw new ConflictError(`Server instance '${server.serverName || server.id}' is currently starting`);
    }

    const previousStatus = server.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative server start';

    // Provision or reactivate DNS endpoint for this server
    try {
      await EndpointService.reserveEndpoint(serverId);
    } catch (err: any) {
      // Endpoint reservation error is logged but won't crash if already present
      console.warn(`[ADMIN_SERVER_OPS] Endpoint reservation notice for server ${serverId}: ${err.message}`);
    }

    return executeAdminOperation({
      operationName: 'server_start',
      targetResourceType: 'server',
      targetResourceId: serverId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        operation: 'SERVER_STARTED',
        targetServerId: serverId,
        targetDeviceId: server.deviceId,
        targetUserId: server.device.userId,
        serverName: server.serverName,
        previousStatus,
        newStatus: server.device.status === 'ONLINE' ? 'RUNNING' : 'STARTING',
        reason: finalReason
      },
      execute: async (tx) => {
        const now = new Date();
        const newStatus = server.device.status === 'ONLINE' ? 'RUNNING' : 'STARTING';

        const updated = await tx.serverInstance.update({
          where: { id: serverId },
          data: {
            status: newStatus,
            startedAt: now,
            lastHeartbeatAt: now
          },
          select: {
            id: true,
            deviceId: true,
            serverName: true,
            status: true
          }
        });

        return {
          id: updated.id,
          deviceId: updated.deviceId,
          serverName: updated.serverName,
          status: updated.status,
          previousStatus,
          reason: finalReason
        };
      }
    });
  }

  /**
   * Stops an active or starting server instance.
   * Evicts gateway sessions, deactivates endpoints, and records audit trail.
   */
  static async stopServer(
    serverId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{
    id: string;
    deviceId: string;
    serverName: string | null;
    status: string;
    previousStatus: string;
    reason: string;
  }> {
    const server = await prisma.serverInstance.findUnique({
      where: { id: serverId },
      include: {
        device: {
          select: {
            id: true,
            userId: true,
            deviceName: true,
            status: true
          }
        }
      }
    });

    if (!server) {
      throw new NotFoundError(`Server instance with ID '${serverId}' not found`);
    }

    if (server.status === 'STOPPED') {
      throw new ConflictError(`Server instance '${server.serverName || server.id}' is already stopped`);
    }

    const previousStatus = server.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative server stop';

    // Evict active device gateway session if connected
    try {
      defaultGatewayService.evictDeviceSession(server.deviceId, finalReason);
    } catch {
      // Non-fatal if gateway session was already evicted
    }

    return executeAdminOperation({
      operationName: 'server_stop',
      targetResourceType: 'server',
      targetResourceId: serverId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        operation: 'SERVER_STOPPED',
        targetServerId: serverId,
        targetDeviceId: server.deviceId,
        targetUserId: server.device.userId,
        serverName: server.serverName,
        previousStatus,
        newStatus: 'STOPPED',
        reason: finalReason
      },
      execute: async (tx) => {
        const now = new Date();

        // 1. Mark ServerInstance as STOPPED
        const updated = await tx.serverInstance.update({
          where: { id: serverId },
          data: {
            status: 'STOPPED'
          },
          select: {
            id: true,
            deviceId: true,
            serverName: true,
            status: true
          }
        });

        // 2. Mark ServerEndpoints as INACTIVE
        await tx.serverEndpoint.updateMany({
          where: { serverInstanceId: serverId },
          data: { status: 'INACTIVE' }
        });

        // 3. Mark active DeviceConnections as DISCONNECTED
        await tx.deviceConnection.updateMany({
          where: {
            deviceId: server.deviceId,
            status: { in: ['CONNECTED', 'CONNECTING', 'RECONNECTING'] }
          },
          data: {
            status: 'DISCONNECTED',
            disconnectedAt: now
          }
        });

        // 4. Update Device to OFFLINE
        await tx.device.update({
          where: { id: server.deviceId },
          data: {
            status: 'OFFLINE',
            lastSeenAt: now
          }
        });

        return {
          id: updated.id,
          deviceId: updated.deviceId,
          serverName: updated.serverName,
          status: updated.status,
          previousStatus,
          reason: finalReason
        };
      }
    });
  }

  /**
   * Restarts an active server instance.
   * Evicts previous gateway session, reactivates endpoint, transitions status to STARTING.
   */
  static async restartServer(
    serverId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{
    id: string;
    deviceId: string;
    serverName: string | null;
    status: string;
    previousStatus: string;
    reason: string;
  }> {
    const server = await prisma.serverInstance.findUnique({
      where: { id: serverId },
      include: {
        device: {
          select: {
            id: true,
            userId: true,
            deviceName: true,
            status: true
          }
        }
      }
    });

    if (!server) {
      throw new NotFoundError(`Server instance with ID '${serverId}' not found`);
    }

    if (server.status === 'STOPPED') {
      throw new ConflictError(`Cannot restart a stopped server instance; use start instead`);
    }

    const previousStatus = server.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative server restart';

    // 1. Evict existing gateway WebSocket session
    try {
      defaultGatewayService.evictDeviceSession(server.deviceId, finalReason);
    } catch {
      // Non-fatal
    }

    // 2. Ensure endpoint is reserved/verified
    try {
      await EndpointService.reserveEndpoint(serverId);
    } catch (err: any) {
      console.warn(`[ADMIN_SERVER_OPS] Endpoint reservation during restart: ${err.message}`);
    }

    // 3. Atomically transition state and record audit
    return executeAdminOperation({
      operationName: 'server_restart',
      targetResourceType: 'server',
      targetResourceId: serverId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        operation: 'SERVER_RESTARTED',
        targetServerId: serverId,
        targetDeviceId: server.deviceId,
        targetUserId: server.device.userId,
        serverName: server.serverName,
        previousStatus,
        newStatus: 'STARTING',
        reason: finalReason
      },
      execute: async (tx) => {
        const now = new Date();

        const updated = await tx.serverInstance.update({
          where: { id: serverId },
          data: {
            status: 'STARTING',
            startedAt: now,
            lastHeartbeatAt: now
          },
          select: {
            id: true,
            deviceId: true,
            serverName: true,
            status: true
          }
        });

        return {
          id: updated.id,
          deviceId: updated.deviceId,
          serverName: updated.serverName,
          status: updated.status,
          previousStatus,
          reason: finalReason
        };
      }
    });
  }
}
