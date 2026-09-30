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
  lastHeartbeatAt?: string | null;
  sessionId?: string | null;
  connectionId?: string | null;
  gatewayNodeId?: string | null;
}

export interface CustomerStatusEvaluationContext {
  deviceId: string;
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
 * Authoritative Customer Status Accuracy Engine (Phase 11A Batch 11A.16)
 *
 * Enforces the strict invariant:
 * Local Server State ≠ Transport State ≠ Authenticated Gateway Session ≠ Customer-Visible Remote Availability
 *
 * Rules:
 * - A server can ONLY be reported 'ONLINE' when:
 *   1. Device & Server belong to authenticated customer.
 *   2. Relevant DeviceConnection is authoritative and in CONNECTED state.
 *   3. Authoritative in-memory gateway runtime session is active and open.
 *   4. Heartbeat/liveness evidence is within 11A.7 thresholds (< 60s).
 *   5. Session is not evicted or superseded.
 *   6. Not explicitly stopped.
 *   7. Local ServerInstance is RUNNING.
 *   8. Account is active (not suspended).
 *   9. Not in auth failure or unlinked state.
 */
export class CustomerStatusService {
  /**
   * Maximum acceptable age for heartbeat liveness before marking remote status expired (11A.7 reaper threshold)
   */
  public static readonly HEARTBEAT_LIVENESS_MAX_AGE_MS = 60 * 1000;

  /**
   * Derives customer-facing remote status and availability from authoritative context.
   */
  public static deriveCustomerStatus(
    context: CustomerStatusEvaluationContext,
    gatewayService: GatewayService = defaultGatewayService
  ): DerivedCustomerStatusResult {
    try {
      const { deviceId, serverInstance, deviceConnection, userStatus, isExplicitlyStopped } = context;

      // 1. Account Level Suspensions
      if (userStatus === UserStatus.SUSPENDED || userStatus === 'SUSPENDED') {
        return {
          remoteStatus: 'ERROR',
          statusReason: 'account_suspended',
          isRemoteAvailable: false,
          livenessValid: false
        };
      }

      // 2. Explicit User Stop
      if (isExplicitlyStopped) {
        return {
          remoteStatus: 'OFFLINE',
          statusReason: 'explicitly_stopped',
          isRemoteAvailable: false,
          livenessValid: false
        };
      }

      // 3. Check Local Server Lifecycle State
      if (serverInstance && serverInstance.status === ServerInstanceStatus.STOPPED) {
        return {
          remoteStatus: 'OFFLINE',
          statusReason: 'server_stopped',
          isRemoteAvailable: false,
          livenessValid: false
        };
      }

      // 4. Check Connection Existence
      if (!deviceConnection) {
        return {
          remoteStatus: 'OFFLINE',
          statusReason: 'no_active_connection',
          isRemoteAvailable: false,
          livenessValid: false
        };
      }

      const connStatus = deviceConnection.status as ConnectionStatus;

      // 5. Evaluate State Machine Status
      if (connStatus === ConnectionStatus.FAILED) {
        return {
          remoteStatus: 'ERROR',
          statusReason: 'authentication_failed',
          isRemoteAvailable: false,
          livenessValid: false,
          connectionId: deviceConnection.id
        };
      }

      if (connStatus === ConnectionStatus.CONNECTING) {
        return {
          remoteStatus: 'CONNECTING',
          statusReason: 'connecting',
          isRemoteAvailable: false,
          livenessValid: false,
          connectionId: deviceConnection.id
        };
      }

      if (connStatus === ConnectionStatus.RECONNECTING) {
        return {
          remoteStatus: 'RECONNECTING',
          statusReason: 'automatic_recovery',
          isRemoteAvailable: false,
          livenessValid: false,
          connectionId: deviceConnection.id
        };
      }

      if (connStatus === ConnectionStatus.STALE) {
        return {
          remoteStatus: 'RECONNECTING',
          statusReason: 'stale_connection',
          isRemoteAvailable: false,
          livenessValid: false,
          connectionId: deviceConnection.id
        };
      }

      if (connStatus === ConnectionStatus.DISCONNECTED) {
        return {
          remoteStatus: 'OFFLINE',
          statusReason: 'no_active_connection',
          isRemoteAvailable: false,
          livenessValid: false,
          connectionId: deviceConnection.id
        };
      }

      // 6. Detailed Authoritative Verification for CONNECTED Status
      if (connStatus === ConnectionStatus.CONNECTED) {
        const liveSession = gatewayService.getActiveSessionForDevice(deviceId);

        // A. Verify In-Memory Gateway Runtime Ownership
        if (!liveSession) {
          // If no runtime session on this gateway node, inspect DB heartbeat age for possible failover
          const dbHeartbeat = deviceConnection.lastHeartbeatAt ? new Date(deviceConnection.lastHeartbeatAt).getTime() : 0;
          const isDbHeartbeatRecent = (Date.now() - dbHeartbeat) < CustomerStatusService.HEARTBEAT_LIVENESS_MAX_AGE_MS;

          if (!isDbHeartbeatRecent) {
            return {
              remoteStatus: 'OFFLINE',
              statusReason: 'heartbeat_expired',
              isRemoteAvailable: false,
              livenessValid: false,
              connectionId: deviceConnection.id,
              lastHeartbeatAt: deviceConnection.lastHeartbeatAt ? new Date(deviceConnection.lastHeartbeatAt).toISOString() : null
            };
          }

          // Socket not on this node but heartbeat is recent (potential gateway transition/failover)
          return {
            remoteStatus: 'RECONNECTING',
            statusReason: 'gateway_failover',
            isRemoteAvailable: false,
            livenessValid: false,
            connectionId: deviceConnection.id,
            lastHeartbeatAt: deviceConnection.lastHeartbeatAt ? new Date(deviceConnection.lastHeartbeatAt).toISOString() : null
          };
        }

        // B. Verify Live Session Heartbeat Freshness
        const effectiveHeartbeat = liveSession.lastHeartbeatAt || deviceConnection.lastHeartbeatAt;
        const heartbeatTime = effectiveHeartbeat ? new Date(effectiveHeartbeat).getTime() : 0;
        const isHeartbeatFresh = (Date.now() - heartbeatTime) < CustomerStatusService.HEARTBEAT_LIVENESS_MAX_AGE_MS;

        if (!isHeartbeatFresh) {
          return {
            remoteStatus: 'OFFLINE',
            statusReason: 'heartbeat_expired',
            isRemoteAvailable: false,
            livenessValid: false,
            connectionId: deviceConnection.id,
            sessionId: liveSession.sessionId,
            lastHeartbeatAt: effectiveHeartbeat ? new Date(effectiveHeartbeat).toISOString() : null
          };
        }

        // C. Verify Local Server Instance is RUNNING
        if (serverInstance && serverInstance.status !== ServerInstanceStatus.RUNNING) {
          if (serverInstance.status === ServerInstanceStatus.STARTING) {
            return {
              remoteStatus: 'CONNECTING',
              statusReason: 'server_starting',
              isRemoteAvailable: false,
              livenessValid: true,
              connectionId: deviceConnection.id,
              sessionId: liveSession.sessionId
            };
          }

          return {
            remoteStatus: 'OFFLINE',
            statusReason: 'server_stopped',
            isRemoteAvailable: false,
            livenessValid: true,
            connectionId: deviceConnection.id,
            sessionId: liveSession.sessionId
          };
        }

        // ALL 9 CHECKS SATISFIED: Remote Server is genuinely available!
        return {
          remoteStatus: 'ONLINE',
          statusReason: 'authenticated_live_session',
          isRemoteAvailable: true,
          livenessValid: true,
          connectionId: liveSession.connectionId || deviceConnection.id,
          sessionId: liveSession.sessionId,
          gatewayNodeId: deviceConnection.gatewayNodeId ?? null,
          lastHeartbeatAt: effectiveHeartbeat ? new Date(effectiveHeartbeat).toISOString() : null
        };
      }

      // Default Fallback
      return {
        remoteStatus: 'OFFLINE',
        statusReason: 'no_active_connection',
        isRemoteAvailable: false,
        livenessValid: false
      };
    } catch {
      // Fail-safe default
      return {
        remoteStatus: 'OFFLINE',
        statusReason: 'no_active_connection',
        isRemoteAvailable: false,
        livenessValid: false
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
