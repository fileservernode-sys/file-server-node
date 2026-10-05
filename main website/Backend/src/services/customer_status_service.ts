import { ConnectionStatus, ServerInstanceStatus, UserStatus } from '@prisma/client';
import { defaultGatewayService, GatewayService } from '../gateway/gateway_service.js';
import { ConnectionObservability } from '../observability/connection_observability.js';

export type CustomerStatus = 'ONLINE' | 'CONNECTING' | 'RECONNECTING' | 'OFFLINE' | 'ERROR';

export type CustomerStatusReason =
  | 'authenticated_live_session'
  | 'connecting'
  | 'automatic_recovery'
  | 'network_unavailable'
  | 'gateway_failover'
  | 'authentication_failed'
  | 'device_unlinked'
  | 'stale_connection'
  | 'heartbeat_expired'
  | 'explicitly_stopped'
  | 'no_active_connection'
  | 'server_stopped'
  | 'server_starting'
  | 'account_suspended';

export interface DerivedCustomerStatusResult {
  remoteStatus: CustomerStatus;
  statusReason: CustomerStatusReason;
  isRemoteAvailable: boolean;
  livenessValid: boolean;
  effectiveLastSeenAt?: string | null;
  lastHeartbeatAt?: string | null;
  sessionId?: string | null;
  connectionId?: string | null;
  gatewayNodeId?: string | null;
}

export interface CustomerStatusEvaluationContext {
  deviceId: string;
  deviceLastSeenAt?: Date | string | null;
  serverInstance?: {
    id: string;
    status: ServerInstanceStatus | string;
    lastHeartbeatAt?: Date | null;
    startedAt?: Date | null;
  } | null;
  deviceConnection?: {
    id: string;
    status: ConnectionStatus | string;
    lastHeartbeatAt?: Date | null;
    gatewayNodeId?: string | null;
    connectedAt?: Date | null;
  } | null;
  userStatus?: UserStatus | string;
  isExplicitlyStopped?: boolean;
}

/**
 * Authoritative Customer Status Accuracy Engine (Phase 11A Batch 11A.16 & Phase PRS Batch PRS-1)
 *
 * Enforces the strict invariant:
 * "An authenticated newer connection owns the current live state of the logical device/server.
 *  Cleanup, timeout, disconnect, or reconciliation work belonging to an older connection MUST NOT downgrade the newer connection."
 *
 * Source Evaluation Hierarchy:
 * 1. Account Level Suspensions & Explicit User Stop
 * 2. Valid Current Live Gateway Session (In-memory authoritative WebSocket session)
 * 3. Durable DB DeviceConnection Heartbeat (< 60s)
 * 4. ServerInstance Heartbeat (< 60s)
 * 5. Device lastSeenAt timestamp
 * 6. Explicit fallback states
 */
export class CustomerStatusService {
  /**
   * Maximum acceptable age for heartbeat liveness before marking remote status expired (60 seconds)
   */
  public static readonly HEARTBEAT_LIVENESS_MAX_AGE_MS = 60 * 1000;

  /**
   * Calculates normalized effective last-seen timestamp across all valid candidates.
   * Ensures no future timestamps (beyond 5s clock skew) and formats as ISO 8601 string.
   */
  public static calculateEffectiveLastSeen(
    candidates: Array<Date | string | null | undefined>
  ): string | null {
    const now = Date.now();
    let maxTime = 0;
    for (const c of candidates) {
      if (!c) continue;
      const t = typeof c === 'string' ? new Date(c).getTime() : c.getTime();
      if (!isNaN(t) && t > maxTime && t <= now + 5000) {
        maxTime = t;
      }
    }
    return maxTime > 0 ? new Date(maxTime).toISOString() : null;
  }

  /**
   * Derives customer-facing remote status and availability from authoritative context.
   */
  public static deriveCustomerStatus(
    context: CustomerStatusEvaluationContext,
    gatewayService: GatewayService = defaultGatewayService
  ): DerivedCustomerStatusResult {
    try {
      const { deviceId, deviceLastSeenAt, serverInstance, deviceConnection, userStatus, isExplicitlyStopped } = context;

      // 1. Account Level Suspensions
      if (userStatus === UserStatus.SUSPENDED || userStatus === 'SUSPENDED') {
        return {
          remoteStatus: 'ERROR',
          statusReason: 'account_suspended',
          isRemoteAvailable: false,
          livenessValid: false,
          effectiveLastSeenAt: this.calculateEffectiveLastSeen([deviceLastSeenAt])
        };
      }

      // 2. Explicit User Stop
      if (isExplicitlyStopped) {
        return {
          remoteStatus: 'OFFLINE',
          statusReason: 'explicitly_stopped',
          isRemoteAvailable: false,
          livenessValid: false,
          effectiveLastSeenAt: this.calculateEffectiveLastSeen([
            deviceLastSeenAt,
            serverInstance?.lastHeartbeatAt,
            deviceConnection?.lastHeartbeatAt
          ])
        };
      }

      // 3. Evaluate In-Memory Gateway Live Session (Source 1: Primary Live Transport)
      const liveSession = gatewayService.getActiveSessionForDevice(deviceId);

      if (liveSession && liveSession.isAuthoritative) {
        const liveHeartbeat = liveSession.lastHeartbeatAt;
        const liveHeartbeatTime = liveHeartbeat ? new Date(liveHeartbeat).getTime() : 0;
        const isLiveHeartbeatFresh = (Date.now() - liveHeartbeatTime) < CustomerStatusService.HEARTBEAT_LIVENESS_MAX_AGE_MS;

        const effectiveLastSeenAt = this.calculateEffectiveLastSeen([
          liveHeartbeat,
          deviceConnection?.lastHeartbeatAt,
          serverInstance?.lastHeartbeatAt,
          deviceLastSeenAt
        ]);

        if (isLiveHeartbeatFresh) {
          // Authoritative live session is connected and active: server is genuinely ONLINE
          return {
            remoteStatus: 'ONLINE',
            statusReason: 'authenticated_live_session',
            isRemoteAvailable: true,
            livenessValid: true,
            effectiveLastSeenAt,
            connectionId: liveSession.connectionId || deviceConnection?.id,
            sessionId: liveSession.sessionId,
            gatewayNodeId: deviceConnection?.gatewayNodeId ?? null,
            lastHeartbeatAt: liveHeartbeat ? new Date(liveHeartbeat).toISOString() : null
          };
        } else {
          // Live session exists but heartbeat has lapsed
          return {
            remoteStatus: 'OFFLINE',
            statusReason: 'heartbeat_expired',
            isRemoteAvailable: false,
            livenessValid: false,
            effectiveLastSeenAt,
            connectionId: liveSession.connectionId || deviceConnection?.id,
            sessionId: liveSession.sessionId,
            lastHeartbeatAt: liveHeartbeat ? new Date(liveHeartbeat).toISOString() : null
          };
        }
      }

      // 4. Evaluate Durable Connection State (Source 2: Database State when no in-memory session on this node)
      if (deviceConnection) {
        const connStatus = deviceConnection.status as ConnectionStatus;
        const dbHeartbeat = deviceConnection.lastHeartbeatAt ? new Date(deviceConnection.lastHeartbeatAt).getTime() : 0;
        const isDbHeartbeatRecent = (Date.now() - dbHeartbeat) < CustomerStatusService.HEARTBEAT_LIVENESS_MAX_AGE_MS;

        const effectiveLastSeenAt = this.calculateEffectiveLastSeen([
          deviceConnection.lastHeartbeatAt,
          serverInstance?.lastHeartbeatAt,
          deviceLastSeenAt
        ]);

        if (connStatus === ConnectionStatus.CONNECTED) {
          if (isDbHeartbeatRecent) {
            return {
              remoteStatus: 'ONLINE',
              statusReason: 'authenticated_live_session',
              isRemoteAvailable: true,
              livenessValid: true,
              effectiveLastSeenAt,
              connectionId: deviceConnection.id,
              gatewayNodeId: deviceConnection.gatewayNodeId ?? null,
              lastHeartbeatAt: deviceConnection.lastHeartbeatAt ? new Date(deviceConnection.lastHeartbeatAt).toISOString() : null
            };
          } else {
            return {
              remoteStatus: 'OFFLINE',
              statusReason: 'heartbeat_expired',
              isRemoteAvailable: false,
              livenessValid: false,
              effectiveLastSeenAt,
              connectionId: deviceConnection.id,
              lastHeartbeatAt: deviceConnection.lastHeartbeatAt ? new Date(deviceConnection.lastHeartbeatAt).toISOString() : null
            };
          }
        }

        if (connStatus === ConnectionStatus.CONNECTING) {
          return {
            remoteStatus: 'CONNECTING',
            statusReason: 'connecting',
            isRemoteAvailable: false,
            livenessValid: false,
            effectiveLastSeenAt,
            connectionId: deviceConnection.id
          };
        }

        if (connStatus === ConnectionStatus.RECONNECTING || connStatus === ConnectionStatus.STALE) {
          return {
            remoteStatus: 'RECONNECTING',
            statusReason: connStatus === ConnectionStatus.STALE ? 'stale_connection' : 'automatic_recovery',
            isRemoteAvailable: false,
            livenessValid: false,
            effectiveLastSeenAt,
            connectionId: deviceConnection.id
          };
        }

        if (connStatus === ConnectionStatus.FAILED) {
          return {
            remoteStatus: 'ERROR',
            statusReason: 'authentication_failed',
            isRemoteAvailable: false,
            livenessValid: false,
            effectiveLastSeenAt,
            connectionId: deviceConnection.id
          };
        }
      }

      // 5. Check Local Server Lifecycle State if no active connection
      const fallbackEffectiveLastSeenAt = this.calculateEffectiveLastSeen([
        serverInstance?.lastHeartbeatAt,
        deviceConnection?.lastHeartbeatAt,
        deviceLastSeenAt
      ]);

      if (serverInstance && serverInstance.status === ServerInstanceStatus.STOPPED) {
        return {
          remoteStatus: 'OFFLINE',
          statusReason: 'server_stopped',
          isRemoteAvailable: false,
          livenessValid: false,
          effectiveLastSeenAt: fallbackEffectiveLastSeenAt
        };
      }

      // 6. Default Fallback
      return {
        remoteStatus: 'OFFLINE',
        statusReason: 'no_active_connection',
        isRemoteAvailable: false,
        livenessValid: false,
        effectiveLastSeenAt: fallbackEffectiveLastSeenAt
      };
    } catch {
      // Fail-safe default
      return {
        remoteStatus: 'OFFLINE',
        statusReason: 'no_active_connection',
        isRemoteAvailable: false,
        livenessValid: false,
        effectiveLastSeenAt: null
      };
    }
  }

  /**
   * Batch derivation for multiple devices without N+1 queries.
   */
  public static deriveBatchDeviceStatuses(
    devices: Array<{
      id: string;
      status: string;
      lastSeenAt?: Date | string | null;
      servers?: Array<{
        id: string;
        status: string;
        lastHeartbeatAt?: Date | null;
        startedAt?: Date | null;
      }>;
      connections?: Array<{
        id: string;
        status: string;
        lastHeartbeatAt?: Date | null;
        gatewayNodeId?: string | null;
        connectedAt?: Date | null;
      }>;
    }>,
    userStatus?: UserStatus | string,
    gatewayService: GatewayService = defaultGatewayService
  ): Map<string, DerivedCustomerStatusResult> {
    const results = new Map<string, DerivedCustomerStatusResult>();

    for (const device of devices) {
      const activeServer = device.servers?.[0] ?? null;
      const activeConn = device.connections?.[0] ?? null;

      const derived = this.deriveCustomerStatus(
        {
          deviceId: device.id,
          deviceLastSeenAt: device.lastSeenAt,
          serverInstance: activeServer,
          deviceConnection: activeConn,
          userStatus
        },
        gatewayService
      );

      results.set(device.id, derived);
    }

    return results;
  }
}
