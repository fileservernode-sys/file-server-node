import { Prisma, AdminAuditAction, GatewayStatus, ConnectionStatus } from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ConflictError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';
import { createPaginatedResponse, PaginatedResult } from '../utils/pagination.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { defaultGatewayService } from '../../../../gateway/gateway_service.js';
import { GatewayNodeListQuery, GatewayConnectionListQuery } from './schemas.js';

export interface GatewayNodeSummaryItem {
  id: string;
  hostname: string;
  region: string | null;
  status: string;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeConnectionCount: number;
  totalConnectionCount: number;
  healthSummary: {
    status: string;
    isHealthy: boolean;
  };
}

export interface GatewayNodeDetailResult {
  id: string;
  hostname: string;
  region: string | null;
  status: string;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeConnections: Array<{
    id: string;
    deviceId: string;
    deviceName: string;
    remoteEndpoint: string | null;
    status: string;
    connectedAt: string | null;
    lastHeartbeatAt: string | null;
  }>;
  activeConnectionCount: number;
  totalConnectionCount: number;
  health: {
    status: string;
    isHealthy: boolean;
    lastHeartbeatAgeSeconds: number | null;
  };
}

export interface GatewayConnectionSummaryItem {
  id: string;
  deviceId: string;
  deviceName: string;
  gatewayNodeId: string | null;
  gatewayHostname: string | null;
  remoteEndpoint: string | null;
  status: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
}

export interface GatewayTelemetryResult {
  totalGatewayNodes: number;
  activeGatewayNodes: number;
  inactiveGatewayNodes: number;
  maintenanceGatewayNodes: number;
  totalActiveConnections: number;
  totalHistoricalConnections: number;
  connectedDevices: number;
  runtimeTelemetry: {
    activeConnections: number;
    connectedDevices: number;
    reconnectCount: number;
    rateLimitEvents: number;
    timedOutRequests: number;
    failedAuthCount: number;
    activeTransfers: number;
    uptimeSeconds: number;
    gatewayStatus: string;
    port: number;
  };
}

export interface GatewayDiagnosticsResult {
  gatewayProcessStatus: string;
  controlPlaneConnected: boolean;
  uptimeSeconds: number;
  activeConnectionCount: number;
  activeTransferCount: number;
  inMemoryConnectedDevices: number;
  connectionStateDistribution: Record<string, number>;
  nodeHealthBreakdown: Array<{
    id: string;
    hostname: string;
    status: string;
    isHealthy: boolean;
    lastHeartbeatAt: string | null;
  }>;
  diagnosticsTimestamp: string;
}

export class AdminGatewayService {
  /**
   * Lists gateway nodes with safe filtering, search, and pagination.
   */
  static async listNodes(query: GatewayNodeListQuery): Promise<PaginatedResult<GatewayNodeSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.GatewayNodeWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.region) {
      where.region = query.region;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { hostname: { contains: term } },
        { region: { contains: term } },
        { id: { contains: term } }
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

    const orderBy: Prisma.GatewayNodeOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder
    };

    const [total, nodes] = await Promise.all([
      prisma.gatewayNode.count({ where }),
      prisma.gatewayNode.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          hostname: true,
          region: true,
          status: true,
          lastHeartbeatAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              connections: true
            }
          },
          connections: {
            where: {
              status: { in: ['CONNECTED', 'CONNECTING', 'RECONNECTING'] }
            },
            select: {
              id: true
            }
          }
        }
      })
    ]);

    const items: GatewayNodeSummaryItem[] = nodes.map((n) => ({
      id: n.id,
      hostname: n.hostname,
      region: n.region,
      status: n.status,
      lastHeartbeatAt: n.lastHeartbeatAt ? n.lastHeartbeatAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      activeConnectionCount: n.connections.length,
      totalConnectionCount: n._count.connections,
      healthSummary: {
        status: n.status,
        isHealthy: n.status === GatewayStatus.ACTIVE
      }
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves operational metadata and connection details for a specific gateway node.
   * Safe projection: Never returns gateway secrets, customer file contents, or connection tokens.
   */
  static async getNodeDetail(gatewayNodeId: string): Promise<GatewayNodeDetailResult> {
    const node = await prisma.gatewayNode.findUnique({
      where: { id: gatewayNodeId },
      select: {
        id: true,
        hostname: true,
        region: true,
        status: true,
        lastHeartbeatAt: true,
        createdAt: true,
        updatedAt: true,
        connections: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            deviceId: true,
            remoteEndpoint: true,
            status: true,
            connectedAt: true,
            lastHeartbeatAt: true,
            device: {
              select: {
                deviceName: true
              }
            }
          }
        },
        _count: {
          select: {
            connections: true
          }
        }
      }
    });

    if (!node) {
      throw new NotFoundError(`Gateway node with ID '${gatewayNodeId}' not found`);
    }

    const activeConns = node.connections.filter(c =>
      c.status === 'CONNECTED' || c.status === 'CONNECTING' || c.status === 'RECONNECTING'
    );

    const now = Date.now();
    const heartbeatAge = node.lastHeartbeatAt
      ? Math.floor((now - node.lastHeartbeatAt.getTime()) / 1000)
      : null;

    return {
      id: node.id,
      hostname: node.hostname,
      region: node.region,
      status: node.status,
      lastHeartbeatAt: node.lastHeartbeatAt ? node.lastHeartbeatAt.toISOString() : null,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
      activeConnections: node.connections.map((c) => ({
        id: c.id,
        deviceId: c.deviceId,
        deviceName: c.device?.deviceName || 'Unknown Device',
        remoteEndpoint: c.remoteEndpoint,
        status: c.status,
        connectedAt: c.connectedAt ? c.connectedAt.toISOString() : null,
        lastHeartbeatAt: c.lastHeartbeatAt ? c.lastHeartbeatAt.toISOString() : null
      })),
      activeConnectionCount: activeConns.length,
      totalConnectionCount: node._count.connections,
      health: {
        status: node.status,
        isHealthy: node.status === GatewayStatus.ACTIVE && (heartbeatAge === null || heartbeatAge < 300),
        lastHeartbeatAgeSeconds: heartbeatAge
      }
    };
  }

  /**
   * Lists gateway connection records with allowlisted filters and search.
   * Never exposes raw connectionToken or WebSocket payloads.
   */
  static async listConnections(query: GatewayConnectionListQuery): Promise<PaginatedResult<GatewayConnectionSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.DeviceConnectionWhereInput = {};

    if (query.gatewayNodeId) {
      where.gatewayNodeId = query.gatewayNodeId;
    }

    if (query.deviceId) {
      where.deviceId = query.deviceId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { remoteEndpoint: { contains: term } },
        { device: { deviceName: { contains: term } } },
        { gatewayNode: { hostname: { contains: term } } }
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

    const orderBy: Prisma.DeviceConnectionOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder
    };

    const [total, connections] = await Promise.all([
      prisma.deviceConnection.count({ where }),
      prisma.deviceConnection.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          deviceId: true,
          gatewayNodeId: true,
          remoteEndpoint: true,
          status: true,
          connectedAt: true,
          disconnectedAt: true,
          lastHeartbeatAt: true,
          createdAt: true,
          device: {
            select: {
              deviceName: true
            }
          },
          gatewayNode: {
            select: {
              hostname: true
            }
          }
        }
      })
    ]);

    const items: GatewayConnectionSummaryItem[] = connections.map((c) => ({
      id: c.id,
      deviceId: c.deviceId,
      deviceName: c.device?.deviceName || 'Unknown Device',
      gatewayNodeId: c.gatewayNodeId,
      gatewayHostname: c.gatewayNode?.hostname || null,
      remoteEndpoint: c.remoteEndpoint,
      status: c.status,
      connectedAt: c.connectedAt ? c.connectedAt.toISOString() : null,
      disconnectedAt: c.disconnectedAt ? c.disconnectedAt.toISOString() : null,
      lastHeartbeatAt: c.lastHeartbeatAt ? c.lastHeartbeatAt.toISOString() : null,
      createdAt: c.createdAt.toISOString()
    }));

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves aggregated infrastructure telemetry from persistent database and runtime gateway service.
   */
  static async getTelemetry(): Promise<GatewayTelemetryResult> {
    const [
      totalGatewayNodes,
      activeGatewayNodes,
      inactiveGatewayNodes,
      maintenanceGatewayNodes,
      totalActiveConnections,
      totalHistoricalConnections,
      connectedDevices
    ] = await Promise.all([
      prisma.gatewayNode.count(),
      prisma.gatewayNode.count({ where: { status: GatewayStatus.ACTIVE } }),
      prisma.gatewayNode.count({ where: { status: GatewayStatus.INACTIVE } }),
      prisma.gatewayNode.count({ where: { status: GatewayStatus.MAINTENANCE } }),
      prisma.deviceConnection.count({
        where: { status: { in: ['CONNECTED', 'CONNECTING', 'RECONNECTING'] } }
      }),
      prisma.deviceConnection.count(),
      prisma.device.count({ where: { status: 'ONLINE' } })
    ]);

    const runtimeHealth = defaultGatewayService.getHealthStatus();

    return {
      totalGatewayNodes,
      activeGatewayNodes,
      inactiveGatewayNodes,
      maintenanceGatewayNodes,
      totalActiveConnections,
      totalHistoricalConnections,
      connectedDevices,
      runtimeTelemetry: {
        activeConnections: runtimeHealth.activeConnections,
        connectedDevices: runtimeHealth.connectedDevices,
        reconnectCount: runtimeHealth.reconnectCount,
        rateLimitEvents: runtimeHealth.rateLimitEvents,
        timedOutRequests: runtimeHealth.timedOutRequests,
        failedAuthCount: runtimeHealth.failedAuthCount,
        activeTransfers: runtimeHealth.activeTransfersCount,
        uptimeSeconds: runtimeHealth.uptimeSeconds,
        gatewayStatus: runtimeHealth.status,
        port: runtimeHealth.port
      }
    };
  }

  /**
   * Retrieves safe, sanitized diagnostic information about the gateway subsystem.
   */
  static async getDiagnostics(): Promise<GatewayDiagnosticsResult> {
    const [nodes, connectionStates] = await Promise.all([
      prisma.gatewayNode.findMany({
        select: {
          id: true,
          hostname: true,
          status: true,
          lastHeartbeatAt: true
        }
      }),
      prisma.deviceConnection.groupBy({
        by: ['status'],
        _count: {
          status: true
        }
      })
    ]);

    const stateMap: Record<string, number> = {
      CONNECTED: 0,
      DISCONNECTED: 0,
      CONNECTING: 0,
      RECONNECTING: 0,
      FAILED: 0
    };

    for (const group of connectionStates) {
      stateMap[group.status] = group._count.status;
    }

    const runtimeHealth = defaultGatewayService.getHealthStatus();
    const readiness = defaultGatewayService.getReadinessStatus();

    const nodeBreakdown = nodes.map((n) => ({
      id: n.id,
      hostname: n.hostname,
      status: n.status,
      isHealthy: n.status === GatewayStatus.ACTIVE,
      lastHeartbeatAt: n.lastHeartbeatAt ? n.lastHeartbeatAt.toISOString() : null
    }));

    return {
      gatewayProcessStatus: runtimeHealth.status,
      controlPlaneConnected: readiness.controlPlaneConnected,
      uptimeSeconds: runtimeHealth.uptimeSeconds,
      activeConnectionCount: runtimeHealth.activeConnections,
      activeTransferCount: runtimeHealth.activeTransfersCount,
      inMemoryConnectedDevices: runtimeHealth.connectedDevices,
      connectionStateDistribution: stateMap,
      nodeHealthBreakdown: nodeBreakdown,
      diagnosticsTimestamp: new Date().toISOString()
    };
  }

  /**
   * Drains a gateway node safely, evicts connected device sessions, and sets status to MAINTENANCE.
   */
  static async drainNode(
    gatewayNodeId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{
    id: string;
    hostname: string;
    status: string;
    previousStatus: string;
    drainedConnectionsCount: number;
    reason: string;
  }> {
    const node = await prisma.gatewayNode.findUnique({
      where: { id: gatewayNodeId },
      include: {
        connections: {
          where: {
            status: { in: ['CONNECTED', 'CONNECTING', 'RECONNECTING'] }
          },
          select: {
            id: true,
            deviceId: true
          }
        }
      }
    });

    if (!node) {
      throw new NotFoundError(`Gateway node with ID '${gatewayNodeId}' not found`);
    }

    if (node.status === GatewayStatus.MAINTENANCE) {
      throw new ConflictError(`Gateway node '${node.hostname}' is already in maintenance/drained state`);
    }

    const previousStatus = node.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative gateway node drain';
    const activeConns = node.connections;

    // Evict active device WebSocket sessions connected via this node
    for (const conn of activeConns) {
      try {
        defaultGatewayService.evictDeviceSession(conn.deviceId, finalReason);
      } catch {
        // Non-fatal
      }
    }

    return executeAdminOperation({
      operationName: 'gateway_drain',
      targetResourceType: 'gateway',
      targetResourceId: gatewayNodeId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        operation: 'GATEWAY_NODE_DRAINED',
        targetGatewayNodeId: gatewayNodeId,
        hostname: node.hostname,
        previousStatus,
        newStatus: GatewayStatus.MAINTENANCE,
        drainedConnectionsCount: activeConns.length,
        reason: finalReason
      },
      execute: async (tx) => {
        const now = new Date();

        // 1. Update node status to MAINTENANCE
        const updated = await tx.gatewayNode.update({
          where: { id: gatewayNodeId },
          data: {
            status: GatewayStatus.MAINTENANCE
          },
          select: {
            id: true,
            hostname: true,
            status: true
          }
        });

        // 2. Mark active connections for this node as DISCONNECTED
        await tx.deviceConnection.updateMany({
          where: {
            gatewayNodeId,
            status: { in: ['CONNECTED', 'CONNECTING', 'RECONNECTING'] }
          },
          data: {
            status: ConnectionStatus.DISCONNECTED,
            disconnectedAt: now
          }
        });

        return {
          id: updated.id,
          hostname: updated.hostname,
          status: updated.status,
          previousStatus,
          drainedConnectionsCount: activeConns.length,
          reason: finalReason
        };
      }
    });
  }

  /**
   * Restores a drained/maintenance gateway node back to ACTIVE status.
   */
  static async restoreNode(
    gatewayNodeId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{
    id: string;
    hostname: string;
    status: string;
    previousStatus: string;
    reason: string;
  }> {
    const node = await prisma.gatewayNode.findUnique({
      where: { id: gatewayNodeId }
    });

    if (!node) {
      throw new NotFoundError(`Gateway node with ID '${gatewayNodeId}' not found`);
    }

    if (node.status === GatewayStatus.ACTIVE) {
      throw new ConflictError(`Gateway node '${node.hostname}' is already active`);
    }

    const previousStatus = node.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative gateway node restore';

    return executeAdminOperation({
      operationName: 'gateway_restore',
      targetResourceType: 'gateway',
      targetResourceId: gatewayNodeId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        operation: 'GATEWAY_NODE_RESTORED',
        targetGatewayNodeId: gatewayNodeId,
        hostname: node.hostname,
        previousStatus,
        newStatus: GatewayStatus.ACTIVE,
        reason: finalReason
      },
      execute: async (tx) => {
        const now = new Date();

        const updated = await tx.gatewayNode.update({
          where: { id: gatewayNodeId },
          data: {
            status: GatewayStatus.ACTIVE,
            lastHeartbeatAt: now
          },
          select: {
            id: true,
            hostname: true,
            status: true
          }
        });

        return {
          id: updated.id,
          hostname: updated.hostname,
          status: updated.status,
          previousStatus,
          reason: finalReason
        };
      }
    });
  }
}
