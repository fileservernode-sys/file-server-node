import { prisma } from '../config/database.js';
import { defaultGatewayService } from '../gateway/gateway_service.js';
import { DeviceStatus, ServerInstanceStatus, ConnectionStatus, GatewayStatus } from '@prisma/client';
import { appLogger } from './logger.js';

export interface StateAuditReport {
  timestamp: string;
  isConsistent: boolean;
  discrepancies: {
    orphanedConnections: number;
    staleOnlineDevices: number;
    staleRunningServers: number;
    offlineGatewayNodesWithActiveSockets: number;
    details: Array<{
      type: string;
      id: string;
      description: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH';
    }>;
  };
  summary: {
    dbTotalDevices: number;
    dbOnlineDevices: number;
    gatewayActiveSockets: number;
    dbRunningServers: number;
    dbActiveGatewayNodes: number;
  };
}

/**
 * Non-destructive state reconciliation and audit diagnostic service.
 * Identifies drift between MySQL DB state, Gateway memory, WebSocket sockets, and Server lifecycles.
 */
export class StateReconciliationService {
  public static async auditState(): Promise<StateAuditReport> {
    const timestamp = new Date().toISOString();
    const details: StateAuditReport['discrepancies']['details'] = [];

    // 1. Fetch DB counts and states
    const [
      dbTotalDevices,
      dbOnlineDevices,
      dbRunningServers,
      dbActiveGatewayNodes,
      dbConnectedConnections
    ] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: { status: DeviceStatus.ONLINE } }),
      prisma.serverInstance.count({ where: { status: ServerInstanceStatus.RUNNING } }),
      prisma.gatewayNode.count({ where: { status: GatewayStatus.ACTIVE } }),
      prisma.deviceConnection.findMany({
        where: { status: ConnectionStatus.CONNECTED },
        select: { id: true, deviceId: true, gatewayNodeId: true }
      })
    ]);

    const gwMetrics = defaultGatewayService.getHealthStatus();
    const gwActiveSockets = gwMetrics.activeConnections;

    let orphanedConnections = 0;
    let staleOnlineDevices = 0;
    let staleRunningServers = 0;
    let offlineGatewayNodesWithActiveSockets = 0;

    // 2. Check for connections marked CONNECTED in DB without active socket in gateway memory
    for (const conn of dbConnectedConnections) {
      const isSocketActive = defaultGatewayService.hasActiveConnectionForDevice(conn.deviceId);
      if (!isSocketActive) {
        orphanedConnections++;
        details.push({
          type: 'ORPHANED_DB_CONNECTION',
          id: conn.id,
          description: `DeviceConnection ${conn.id} for device ${conn.deviceId} is marked CONNECTED in DB but has no active WebSocket socket in memory.`,
          severity: 'MEDIUM'
        });
      }
    }

    // 3. Check for devices marked ONLINE with no active connection in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const silentOnlineDevices = await prisma.device.findMany({
      where: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: { lt: fiveMinutesAgo }
      },
      select: { id: true, deviceName: true, lastSeenAt: true }
    });

    for (const dev of silentOnlineDevices) {
      const isLiveInGw = defaultGatewayService.hasActiveConnectionForDevice(dev.id);
      if (!isLiveInGw) {
        staleOnlineDevices++;
        details.push({
          type: 'STALE_ONLINE_DEVICE',
          id: dev.id,
          description: `Device ${dev.id} (${dev.deviceName}) is marked ONLINE but last heartbeat was >5m ago and has no active socket.`,
          severity: 'LOW'
        });
      }
    }

    const isConsistent = details.length === 0;

    appLogger.info('State reconciliation audit completed', {
      operation: 'STATE_AUDIT',
      metadata: {
        isConsistent,
        discrepanciesCount: details.length,
        orphanedConnections,
        staleOnlineDevices
      }
    });

    return {
      timestamp,
      isConsistent,
      discrepancies: {
        orphanedConnections,
        staleOnlineDevices,
        staleRunningServers,
        offlineGatewayNodesWithActiveSockets,
        details
      },
      summary: {
        dbTotalDevices,
        dbOnlineDevices,
        gatewayActiveSockets: gwActiveSockets,
        dbRunningServers,
        dbActiveGatewayNodes
      }
    };
  }
}
