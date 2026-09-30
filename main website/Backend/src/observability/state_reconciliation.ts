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

export interface ReconciliationCycleResult {
  timestamp: string;
  gatewayNodeId: string;
  durationMs: number;
  staleConnectionsDetected: number;
  staleConnectionsReconciled: number;
  orphanConnectionsReclaimed: number;
  staleNodesDetected: number;
  replacementSessionsReconciled: number;
  statusTransitionsSkipped: number;
  errors: string[];
}

export interface StartupReconciliationResult {
  gatewayNodeId: string;
  nodeHostname: string;
  prunedLocalOrphanConnections: number;
  staleRemoteNodesMarkedInactive: number;
  prunedRemoteOrphanConnections: number;
  devicesEvaluated: number;
  devicesPreservedOnline: number;
  durationMs: number;
}

/**
 * Control Plane & Gateway State Reconciliation Engine (Phase 11A Batch 11A.5)
 * 
 * Unifies persistent MySQL state, Gateway Node liveness, and in-memory runtime evidence.
 * Features:
 * - Safe Startup Pruning of local & stale-node orphan connections.
 * - Monitored Gateway Node Heartbeats & Cross-Node liveness tracking.
 * - Bounded Periodic Reconciliation Loops with Conditional Status Transitions.
 * - Device & Server Instance protection (Never marks OFFLINE/STOPPED if replacement connection exists).
 * - Multi-Device Isolation & Zero Customer Data Access.
 */
export class StateReconciliationService {
  private static reconciliationRuns = 0;
  private static reconciliationFailures = 0;
  private static totalStaleConnectionsDetected = 0;
  private static totalStaleConnectionsReconciled = 0;
  private static totalOrphanConnectionsReclaimed = 0;
  private static totalStaleNodesDetected = 0;
  private static totalReplacementSessionsReconciled = 0;
  private static totalStatusTransitionsSkipped = 0;
  private static lastCycleResult: ReconciliationCycleResult | null = null;

  /**
   * Diagnostic Audit Report: Read-only check for discrepancies across DB and Gateway memory.
   */
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

  /**
   * Startup Reconciliation: Executed upon Gateway process boot.
   * - Registers current GatewayNode as ACTIVE with fresh heartbeat.
   * - Safely prunes orphaned connections previously attributed to this node.
   * - Identifies dead remote gateway nodes and prunes their abandoned connections.
   * - Guards against false device/server offline transitions if replacement connections exist.
   */
  public static async reconcileOnStartup(
    gatewayNodeId: string,
    nodeHostname: string,
    region: string = 'default',
    nodeStaleThresholdMs: number = 120000
  ): Promise<StartupReconciliationResult> {
    const startTime = Date.now();
    const now = new Date();

    appLogger.info('Gateway startup state reconciliation initiated', {
      operation: 'STARTUP_RECONCILIATION_STARTED',
      gatewayNodeId,
      metadata: { nodeHostname }
    });

    try {
      // 1. Upsert / Register this GatewayNode in database
      await prisma.gatewayNode.upsert({
        where: { id: gatewayNodeId },
        update: {
          hostname: nodeHostname,
          region,
          status: GatewayStatus.ACTIVE,
          lastHeartbeatAt: now
        },
        create: {
          id: gatewayNodeId,
          hostname: nodeHostname,
          region,
          status: GatewayStatus.ACTIVE,
          lastHeartbeatAt: now
        }
      });

      // 2. Prune local orphan connections from previous process run
      const localOrphanConns = await prisma.deviceConnection.findMany({
        where: {
          gatewayNodeId,
          status: { in: [ConnectionStatus.CONNECTED, ConnectionStatus.CONNECTING, ConnectionStatus.RECONNECTING] }
        },
        select: { id: true, deviceId: true }
      });

      let prunedLocalCount = 0;
      const affectedDeviceIds = new Set<string>();

      if (localOrphanConns.length > 0) {
        await prisma.deviceConnection.updateMany({
          where: {
            id: { in: localOrphanConns.map((c) => c.id) }
          },
          data: {
            status: ConnectionStatus.DISCONNECTED,
            disconnectedAt: now
          }
        });

        for (const c of localOrphanConns) {
          affectedDeviceIds.add(c.deviceId);
        }
        prunedLocalCount = localOrphanConns.length;
      }

      // 3. Reconcile dead remote gateway nodes
      const staleNodeThresholdDate = new Date(Date.now() - nodeStaleThresholdMs);
      const staleRemoteNodes = await prisma.gatewayNode.findMany({
        where: {
          id: { not: gatewayNodeId },
          status: GatewayStatus.ACTIVE,
          lastHeartbeatAt: { lt: staleNodeThresholdDate }
        },
        select: { id: true, hostname: true }
      });

      let staleRemoteNodeCount = 0;
      let prunedRemoteConnCount = 0;

      if (staleRemoteNodes.length > 0) {
        staleRemoteNodeCount = staleRemoteNodes.length;
        const staleNodeIds = staleRemoteNodes.map((n) => n.id);

        // Mark stale remote nodes as INACTIVE
        await prisma.gatewayNode.updateMany({
          where: { id: { in: staleNodeIds } },
          data: { status: GatewayStatus.INACTIVE }
        });

        // Find and prune connections owned by these dead nodes
        const remoteOrphanConns = await prisma.deviceConnection.findMany({
          where: {
            gatewayNodeId: { in: staleNodeIds },
            status: { in: [ConnectionStatus.CONNECTED, ConnectionStatus.CONNECTING, ConnectionStatus.RECONNECTING] }
          },
          select: { id: true, deviceId: true }
        });

        if (remoteOrphanConns.length > 0) {
          await prisma.deviceConnection.updateMany({
            where: { id: { in: remoteOrphanConns.map((c) => c.id) } },
            data: {
              status: ConnectionStatus.DISCONNECTED,
              disconnectedAt: now
            }
          });

          for (const c of remoteOrphanConns) {
            affectedDeviceIds.add(c.deviceId);
          }
          prunedRemoteConnCount = remoteOrphanConns.length;
        }
      }

      // 4. Evaluate affected devices & server instances conditionally
      let preservedCount = 0;
      for (const devId of Array.from(affectedDeviceIds)) {
        const hasLiveActiveConn = await prisma.deviceConnection.findFirst({
          where: {
            deviceId: devId,
            status: ConnectionStatus.CONNECTED
          }
        });

        if (!hasLiveActiveConn) {
          // Safe to mark device OFFLINE and server STOPPED
          await prisma.device.update({
            where: { id: devId },
            data: { status: DeviceStatus.OFFLINE }
          }).catch(() => {});

          await prisma.serverInstance.updateMany({
            where: { deviceId: devId },
            data: { status: ServerInstanceStatus.STOPPED }
          }).catch(() => {});

          await prisma.serverEndpoint.updateMany({
            where: { serverInstance: { deviceId: devId } },
            data: { status: 'INACTIVE' }
          }).catch(() => {});
        } else {
          preservedCount++;
        }
      }

      const durationMs = Date.now() - startTime;
      const result: StartupReconciliationResult = {
        gatewayNodeId,
        nodeHostname,
        prunedLocalOrphanConnections: prunedLocalCount,
        staleRemoteNodesMarkedInactive: staleRemoteNodeCount,
        prunedRemoteOrphanConnections: prunedRemoteConnCount,
        devicesEvaluated: affectedDeviceIds.size,
        devicesPreservedOnline: preservedCount,
        durationMs
      };

      appLogger.info('Gateway startup state reconciliation completed', {
        operation: 'STARTUP_RECONCILIATION_COMPLETED',
        metadata: result
      });

      return result;
    } catch (err: any) {
      appLogger.error('Gateway startup state reconciliation failed', {
        operation: 'STARTUP_RECONCILIATION_FAILED',
        error: err.message
      });
      return {
        gatewayNodeId,
        nodeHostname,
        prunedLocalOrphanConnections: 0,
        staleRemoteNodesMarkedInactive: 0,
        prunedRemoteOrphanConnections: 0,
        devicesEvaluated: 0,
        devicesPreservedOnline: 0,
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Periodic Reconciliation Cycle: Reconciles MySQL state with live runtime evidence.
   * - Emits node heartbeat.
   * - Prunes unobserved local connections (marked CONNECTED in DB without active WebSocket).
   * - Detects dead remote nodes and reclaims their abandoned connections.
   * - Prunes lingering unobserved connections exceeding stale thresholds.
   * - Uses conditional updates so replacement sessions are never downgraded.
   */
  public static async runReconciliationCycle(
    gatewayNodeId: string,
    activeRuntimeConnectionIds: Set<string>,
    nodeHostname: string = 'gateway.zdexcloud.com',
    nodeStaleThresholdMs: number = 120000,
    connectionStaleThresholdMs: number = 90000
  ): Promise<ReconciliationCycleResult> {
    this.reconciliationRuns++;
    const startTime = Date.now();
    const now = new Date();
    const errors: string[] = [];

    let staleDetected = 0;
    let staleReconciled = 0;
    let orphanReclaimed = 0;
    let staleNodesFound = 0;
    let replacementPreserved = 0;
    let statusTransitionsSkipped = 0;

    try {
      // 1. Emit Gateway Node Heartbeat
      await prisma.gatewayNode.upsert({
        where: { id: gatewayNodeId },
        update: {
          lastHeartbeatAt: now,
          status: GatewayStatus.ACTIVE
        },
        create: {
          id: gatewayNodeId,
          hostname: nodeHostname,
          status: GatewayStatus.ACTIVE,
          lastHeartbeatAt: now
        }
      });

      // 2. Identify local connection discrepancies (DB says CONNECTED on THIS node, but no live WebSocket)
      const localDbConnections = await prisma.deviceConnection.findMany({
        where: {
          gatewayNodeId,
          status: ConnectionStatus.CONNECTED
        },
        take: 100, // Bounded query batch
        select: { id: true, deviceId: true, lastHeartbeatAt: true }
      });

      const localOrphanIds: string[] = [];
      const affectedDeviceIds = new Set<string>();

      for (const conn of localDbConnections) {
        if (!activeRuntimeConnectionIds.has(conn.id)) {
          staleDetected++;
          orphanReclaimed++;
          localOrphanIds.push(conn.id);
          affectedDeviceIds.add(conn.deviceId);
        }
      }

      if (localOrphanIds.length > 0) {
        await prisma.deviceConnection.updateMany({
          where: { id: { in: localOrphanIds } },
          data: {
            status: ConnectionStatus.DISCONNECTED,
            disconnectedAt: now
          }
        });
        staleReconciled += localOrphanIds.length;
      }

      // 3. Identify and prune stale remote nodes & their orphaned connections
      const staleNodeThresholdDate = new Date(Date.now() - nodeStaleThresholdMs);
      const staleRemoteNodes = await prisma.gatewayNode.findMany({
        where: {
          id: { not: gatewayNodeId },
          status: GatewayStatus.ACTIVE,
          lastHeartbeatAt: { lt: staleNodeThresholdDate }
        },
        take: 20,
        select: { id: true }
      });

      if (staleRemoteNodes.length > 0) {
        staleNodesFound = staleRemoteNodes.length;
        const staleNodeIds = staleRemoteNodes.map((n) => n.id);

        await prisma.gatewayNode.updateMany({
          where: { id: { in: staleNodeIds } },
          data: { status: GatewayStatus.INACTIVE }
        });

        const remoteOrphans = await prisma.deviceConnection.findMany({
          where: {
            gatewayNodeId: { in: staleNodeIds },
            status: ConnectionStatus.CONNECTED
          },
          take: 100,
          select: { id: true, deviceId: true }
        });

        if (remoteOrphans.length > 0) {
          staleDetected += remoteOrphans.length;
          orphanReclaimed += remoteOrphans.length;
          await prisma.deviceConnection.updateMany({
            where: { id: { in: remoteOrphans.map((c) => c.id) } },
            data: {
              status: ConnectionStatus.DISCONNECTED,
              disconnectedAt: now
            }
          });
          staleReconciled += remoteOrphans.length;
          for (const c of remoteOrphans) {
            affectedDeviceIds.add(c.deviceId);
          }
        }
      }

      // 4. Identify lingering silent connections without node heartbeat
      const staleConnThresholdDate = new Date(Date.now() - connectionStaleThresholdMs);
      const lingeringSilentConns = await prisma.deviceConnection.findMany({
        where: {
          status: ConnectionStatus.CONNECTED,
          lastHeartbeatAt: { lt: staleConnThresholdDate }
        },
        take: 50,
        select: { id: true, deviceId: true }
      });

      const silentToPrune: string[] = [];
      for (const conn of lingeringSilentConns) {
        if (!activeRuntimeConnectionIds.has(conn.id)) {
          silentToPrune.push(conn.id);
          affectedDeviceIds.add(conn.deviceId);
        }
      }

      if (silentToPrune.length > 0) {
        staleDetected += silentToPrune.length;
        await prisma.deviceConnection.updateMany({
          where: { id: { in: silentToPrune } },
          data: {
            status: ConnectionStatus.DISCONNECTED,
            disconnectedAt: now
          }
        });
        staleReconciled += silentToPrune.length;
      }

      // 4b. Identify and prune abandoned CONNECTING records older than 2 minutes
      const staleConnectingThresholdDate = new Date(Date.now() - 120000);
      const abandonedConnectingConns = await prisma.deviceConnection.findMany({
        where: {
          status: ConnectionStatus.CONNECTING,
          createdAt: { lt: staleConnectingThresholdDate }
        },
        take: 50,
        select: { id: true, deviceId: true }
      });

      if (abandonedConnectingConns.length > 0) {
        const abandonedIds = abandonedConnectingConns.map((c) => c.id);
        staleDetected += abandonedIds.length;
        await prisma.deviceConnection.updateMany({
          where: { id: { in: abandonedIds } },
          data: {
            status: ConnectionStatus.DISCONNECTED,
            disconnectedAt: now
          }
        });
        staleReconciled += abandonedIds.length;
        for (const c of abandonedConnectingConns) {
          affectedDeviceIds.add(c.deviceId);
        }
      }

      // 5. Evaluate affected devices & server instances conditionally
      for (const devId of Array.from(affectedDeviceIds)) {
        const liveReplacementConn = await prisma.deviceConnection.findFirst({
          where: {
            deviceId: devId,
            status: ConnectionStatus.CONNECTED
          }
        });

        if (liveReplacementConn) {
          // Replacement session exists — do NOT downgrade device/server!
          replacementPreserved++;
          statusTransitionsSkipped++;
        } else {
          // Safe to mark device OFFLINE and server STOPPED
          await prisma.device.update({
            where: { id: devId },
            data: { status: DeviceStatus.OFFLINE }
          }).catch(() => {});

          await prisma.serverInstance.updateMany({
            where: { deviceId: devId },
            data: { status: ServerInstanceStatus.STOPPED }
          }).catch(() => {});

          await prisma.serverEndpoint.updateMany({
            where: { serverInstance: { deviceId: devId } },
            data: { status: 'INACTIVE' }
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      this.reconciliationFailures++;
      errors.push(err.message || String(err));
      appLogger.error('Reconciliation cycle error', {
        operation: 'RECONCILIATION_ERROR',
        error: err.message
      });
    }

    const durationMs = Date.now() - startTime;
    this.totalStaleConnectionsDetected += staleDetected;
    this.totalStaleConnectionsReconciled += staleReconciled;
    this.totalOrphanConnectionsReclaimed += orphanReclaimed;
    this.totalStaleNodesDetected += staleNodesFound;
    this.totalReplacementSessionsReconciled += replacementPreserved;
    this.totalStatusTransitionsSkipped += statusTransitionsSkipped;

    const cycleResult: ReconciliationCycleResult = {
      timestamp: now.toISOString(),
      gatewayNodeId,
      durationMs,
      staleConnectionsDetected: staleDetected,
      staleConnectionsReconciled: staleReconciled,
      orphanConnectionsReclaimed: orphanReclaimed,
      staleNodesDetected: staleNodesFound,
      replacementSessionsReconciled: replacementPreserved,
      statusTransitionsSkipped: statusTransitionsSkipped,
      errors
    };

    this.lastCycleResult = cycleResult;

    if (staleReconciled > 0 || staleNodesFound > 0 || errors.length > 0) {
      appLogger.info('Reconciliation cycle completed with changes', {
        operation: 'RECONCILIATION_CYCLE_COMPLETED',
        metadata: cycleResult
      });
    }

    return cycleResult;
  }

  /**
   * Batched Connection Heartbeat Persistence:
   * Flushes active connection heartbeat timestamps to database in bounded batches,
   * preventing per-packet DB write storms while ensuring liveness records stay accurate.
   */
  public static async flushBatchedConnectionHeartbeats(
    heartbeatUpdates: Array<{ connectionId: string; lastHeartbeatAt: Date }>
  ): Promise<number> {
    if (heartbeatUpdates.length === 0) return 0;

    let updatedCount = 0;
    try {
      const connIds = heartbeatUpdates.map((u) => u.connectionId);
      const now = new Date();

      const result = await prisma.deviceConnection.updateMany({
        where: {
          id: { in: connIds },
          status: ConnectionStatus.CONNECTED
        },
        data: {
          lastHeartbeatAt: now
        }
      });

      updatedCount = result.count;
    } catch {
      // Non-fatal, will retry on next sweep
    }
    return updatedCount;
  }

  /**
   * Retrieves live metrics & telemetry from the state reconciliation subsystem.
   */
  public static getReconciliationMetrics(): {
    reconciliationRuns: number;
    reconciliationFailures: number;
    totalStaleConnectionsDetected: number;
    totalStaleConnectionsReconciled: number;
    totalOrphanConnectionsReclaimed: number;
    totalStaleNodesDetected: number;
    totalReplacementSessionsReconciled: number;
    totalStatusTransitionsSkipped: number;
    lastCycle: ReconciliationCycleResult | null;
  } {
    return {
      reconciliationRuns: this.reconciliationRuns,
      reconciliationFailures: this.reconciliationFailures,
      totalStaleConnectionsDetected: this.totalStaleConnectionsDetected,
      totalStaleConnectionsReconciled: this.totalStaleConnectionsReconciled,
      totalOrphanConnectionsReclaimed: this.totalOrphanConnectionsReclaimed,
      totalStaleNodesDetected: this.totalStaleNodesDetected,
      totalReplacementSessionsReconciled: this.totalReplacementSessionsReconciled,
      totalStatusTransitionsSkipped: this.totalStatusTransitionsSkipped,
      lastCycle: this.lastCycleResult
    };
  }
}
