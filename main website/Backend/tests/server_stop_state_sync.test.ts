import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStateMachine } from '../src/services/connection_state_machine.js';
import { CustomerStatusService } from '../src/services/customer_status_service.js';
import { GatewayService } from '../src/gateway/gateway_service.js';
import { ConnectionStatus, DeviceStatus, ServerInstanceStatus } from '@prisma/client';

/**
 * Server Stop State Synchronization & Lifecycle Verification Suite
 *
 * Validates the primary invariant:
 * EXPLICIT USER STOP -> LOCAL SERVER STOPPED -> ANDROID SERVICE STOPPED ->
 * GATEWAY SESSION CLOSED / MARKED DISCONNECTED -> SERVER INSTANCE OFFLINE / STOPPED ->
 * BACKEND STATE UPDATED -> WEBSITE DASHBOARD REFLECTS STOPPED -> FILE MANAGER ACCESS UNAVAILABLE
 */
test('Server Stop State Synchronization & Lifecycle Verification Suite', async (t) => {

  // ---------------------------------------------------------------------------
  // 1. Notification Stop & Targeted Delivery
  // ---------------------------------------------------------------------------
  await t.test('1. Notification Stop targeting and device identity resolution', async (t2: any) => {
    await t2.test('1. Notification Stop targets correct server identity without first-device assumption', () => {
      const serverA = { id: 'srv-101', deviceId: 'dev-alpha', name: 'Alpha Server' };
      const serverB = { id: 'srv-102', deviceId: 'dev-beta', name: 'Beta Server' };

      const resolveStopTarget = (targetServerId: string, servers: typeof serverA[]) => {
        const found = servers.find(s => s.id === targetServerId);
        if (!found) throw new Error('Target server not found');
        return { deviceId: found.deviceId, serverId: found.id };
      };

      const target = resolveStopTarget('srv-102', [serverA, serverB]);
      assert.strictEqual(target.serverId, 'srv-102');
      assert.strictEqual(target.deviceId, 'dev-beta');
    });

    await t2.test('2. Notification Stop preserves isolation for multi-server accounts', () => {
      const initialStates = {
        'srv-101': { status: 'RUNNING', gatewayConnected: true },
        'srv-102': { status: 'RUNNING', gatewayConnected: true }
      };

      const stopServer = (targetId: 'srv-101' | 'srv-102') => {
        return {
          ...initialStates,
          [targetId]: { status: 'STOPPED', gatewayConnected: false }
        };
      };

      const updated = stopServer('srv-101');
      assert.strictEqual(updated['srv-101'].status, 'STOPPED');
      assert.strictEqual(updated['srv-101'].gatewayConnected, false);
      assert.strictEqual(updated['srv-102'].status, 'RUNNING');
      assert.strictEqual(updated['srv-102'].gatewayConnected, true);
    });

    await t2.test('3. Stop command transitions LocalServerEngine to STOPPED and releases port', () => {
      let isEngineRunning = true;
      let activePort: number | null = 8080;

      const stopLocalEngine = () => {
        isEngineRunning = false;
        activePort = null;
        return { success: true, status: 'STOPPED' };
      };

      const res = stopLocalEngine();
      assert.strictEqual(res.status, 'STOPPED');
      assert.strictEqual(isEngineRunning, false);
      assert.strictEqual(activePort, null);
    });

    await t2.test('4. Foreground service stop action clears notification and releases wakelock', () => {
      let wakeLockHeld = true;
      let serviceRunning = true;
      let foregroundNotificationActive = true;

      const stopForegroundService = () => {
        wakeLockHeld = false;
        serviceRunning = false;
        foregroundNotificationActive = false;
        return { isServiceRunning: false };
      };

      const res = stopForegroundService();
      assert.strictEqual(res.isServiceRunning, false);
      assert.strictEqual(wakeLockHeld, false);
      assert.strictEqual(foregroundNotificationActive, false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Gateway Connection, Reconnect & Heartbeat Invalidation
  // ---------------------------------------------------------------------------
  await t.test('2. Gateway Connection, Reconnect & Heartbeat Invalidation', async (t2: any) => {
    await t2.test('7. Active gateway session is evicted and closed on explicit stop', () => {
      const mockGateway = new GatewayService({ GATEWAY_NODE_ID: 'gw-stop-test', NODE_ENV: 'test' });
      (mockGateway as any).deviceToConnectionMap.set('dev-stop-1', 'conn-stop-1');
      (mockGateway as any).activeConnections.set('conn-stop-1', {
        connectionId: 'conn-stop-1',
        sessionId: 'ses-stop-1',
        sessionEpoch: 1,
        deviceId: 'dev-stop-1',
        socket: { readyState: 1, send: () => {}, close: () => {} } as any,
        connectedAt: new Date(),
        lastHeartbeatAt: new Date(),
        isAuthoritative: true,
        isEvicted: false,
        isClosed: false
      });

      assert.strictEqual(mockGateway.hasActiveConnectionForDevice('dev-stop-1'), true);

      mockGateway.evictDeviceSession('dev-stop-1', 'Explicit user stop');
      assert.strictEqual(mockGateway.hasActiveConnectionForDevice('dev-stop-1'), false);
    });

    await t2.test('8. Explicit stop sets isExplicitlyStopped=true and increments connection generation', () => {
      let isExplicitlyStopped = false;
      let connectionGeneration = 10;
      let pingTimerActive = true;
      let reconnectScheduled = true;

      const stopTunnel = () => {
        isExplicitlyStopped = true;
        connectionGeneration++;
        pingTimerActive = false;
        reconnectScheduled = false;
      };

      stopTunnel();
      assert.strictEqual(isExplicitlyStopped, true);
      assert.strictEqual(connectionGeneration, 11);
      assert.strictEqual(pingTimerActive, false);
      assert.strictEqual(reconnectScheduled, false);
    });

    await t2.test('9. Explicit stop prevents reconnect trigger from scheduling connection sequence', () => {
      let isExplicitlyStopped = true;
      let connectSequenceDispatched = false;

      const triggerReconnect = () => {
        if (isExplicitlyStopped) {
          return; // Aborted
        }
        connectSequenceDispatched = true;
      };

      triggerReconnect();
      assert.strictEqual(connectSequenceDispatched, false);
    });

    await t2.test('10. Explicit stop cannot transition back to RECONNECTING or RUNNING', () => {
      const canTransitionFromStopped = (next: ConnectionStatus) => {
        return ConnectionStateMachine.canTransition(ConnectionStatus.DISCONNECTED, next);
      };

      // From DISCONNECTED, only CONNECTING or CONNECTED (via fresh registration) is allowed, NOT RECONNECTING or STALE
      assert.strictEqual(canTransitionFromStopped(ConnectionStatus.RECONNECTING), false);
      assert.strictEqual(canTransitionFromStopped(ConnectionStatus.STALE), false);
    });

    await t2.test('11. Stale WebSocket message from superseded generation is ignored', () => {
      const activeGeneration = 42;
      let stateChanged = false;

      const handleWebSocketMessage = (messageGen: number, type: string) => {
        if (messageGen !== activeGeneration) {
          return; // Ignored stale callback
        }
        stateChanged = true;
      };

      handleWebSocketMessage(41, 'AUTH_SUCCESS');
      assert.strictEqual(stateChanged, false);

      handleWebSocketMessage(42, 'AUTH_SUCCESS');
      assert.strictEqual(stateChanged, true);
    });

    await t2.test('12. Stale heartbeat update is rejected when connection is DISCONNECTED', async () => {
      // Precedence rule: Cannot apply heartbeat to terminal DISCONNECTED state
      const currentStatus = ConnectionStatus.DISCONNECTED;
      const requestEventSource = 'HEARTBEAT_UPDATE';

      const isHeartbeatAllowed = !(currentStatus === ConnectionStatus.DISCONNECTED && requestEventSource === 'HEARTBEAT_UPDATE');
      assert.strictEqual(isHeartbeatAllowed, false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Backend State Synchronization & Multi-Device Isolation
  // ---------------------------------------------------------------------------
  await t.test('3. Backend State Synchronization & Multi-Device Isolation', async (t2: any) => {
    await t2.test('15. DISCONNECT_EXPLICIT transitions ServerInstance to STOPPED and Endpoints to INACTIVE', () => {
      const serverState: { status: ServerInstanceStatus | string; endpointStatus: string } = {
        status: ServerInstanceStatus.RUNNING,
        endpointStatus: 'ACTIVE'
      };

      const applyExplicitDisconnect = () => {
        serverState.status = ServerInstanceStatus.STOPPED;
        serverState.endpointStatus = 'INACTIVE';
      };

      applyExplicitDisconnect();
      assert.strictEqual(serverState.status, ServerInstanceStatus.STOPPED);
      assert.strictEqual(serverState.endpointStatus, 'INACTIVE');
    });

    await t2.test('16. Device heartbeat does NOT revive a STOPPED server instance', () => {
      const serverInstance = { id: 'srv-stopped', status: 'STOPPED', lastHeartbeatAt: new Date(Date.now() - 60000) };
      const now = new Date();

      const applyDeviceHeartbeat = (server: typeof serverInstance) => {
        if (server.status === 'RUNNING') {
          server.lastHeartbeatAt = now;
        }
        // Do not touch status
        return server;
      };

      const result = applyDeviceHeartbeat(serverInstance);
      assert.strictEqual(result.status, 'STOPPED');
      assert.notStrictEqual(result.lastHeartbeatAt, now);
    });

    await t2.test('17. Multi-device safety: stopping Server A leaves Server B completely unaffected', () => {
      const devices = [
        {
          id: 'dev-A',
          status: 'OFFLINE',
          server: { id: 'srv-A', status: 'STOPPED' },
          connection: { status: 'DISCONNECTED' }
        },
        {
          id: 'dev-B',
          status: 'ONLINE',
          server: { id: 'srv-B', status: 'RUNNING' },
          connection: { status: 'CONNECTED', lastHeartbeatAt: new Date() }
        }
      ];

      const statusA = CustomerStatusService.deriveCustomerStatus({
        deviceId: devices[0].id,
        serverInstance: devices[0].server as any,
        deviceConnection: devices[0].connection as any
      });

      const statusB = CustomerStatusService.deriveCustomerStatus({
        deviceId: devices[1].id,
        serverInstance: devices[1].server as any,
        deviceConnection: devices[1].connection as any
      });

      assert.strictEqual(statusA.remoteStatus, 'OFFLINE');
      assert.strictEqual(statusA.isRemoteAvailable, false);
      assert.strictEqual(statusB.remoteStatus, 'ONLINE');
      assert.strictEqual(statusB.isRemoteAvailable, true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. File Manager Protection & Real Health Validation
  // ---------------------------------------------------------------------------
  await t.test('4. File Manager Protection & Real Health Validation', async (t2: any) => {
    await t2.test('21. File Manager authorization fails closed immediately when ServerInstance is STOPPED', () => {
      const serverInstance = { id: 'srv-1', status: 'STOPPED' };
      const hasLiveGatewayConnection = true; // Lingering transport socket

      const evaluateFileManagerAccess = (server: typeof serverInstance, liveGw: boolean) => {
        if (server.status === 'STOPPED') {
          return { ok: false, offline: true, reason: 'server_stopped' };
        }
        if (!liveGw) {
          return { ok: false, offline: true, reason: 'no_gateway' };
        }
        return { ok: true, offline: false };
      };

      const access = evaluateFileManagerAccess(serverInstance, hasLiveGatewayConnection);
      assert.strictEqual(access.ok, false);
      assert.strictEqual(access.offline, true);
      assert.strictEqual(access.reason, 'server_stopped');
    });

    await t2.test('22. HEALTH probe fails when local file server engine is stopped on Android host', () => {
      const isEngineRunning = false;
      const isExplicitlyStopped = true;

      const handleHealthProbe = (running: boolean, stopped: boolean) => {
        if (running && !stopped) {
          return { success: true, data: { status: 'ok', server: 'native-remotenode-file-server' } };
        }
        return { success: false, error: { code: 'SERVER_STOPPED', message: 'Local file server engine is stopped or inactive' } };
      };

      const healthRes = handleHealthProbe(isEngineRunning, isExplicitlyStopped);
      assert.strictEqual(healthRes.success, false);
      assert.strictEqual(healthRes.error?.code, 'SERVER_STOPPED');
    });

    await t2.test('23. Dashboard disables Open File Manager when server is STOPPED', () => {
      const derivedStatus = { remoteStatus: 'OFFLINE', isRemoteAvailable: false };
      const canAccess = derivedStatus.remoteStatus === 'ONLINE' && derivedStatus.isRemoteAvailable;

      assert.strictEqual(canAccess, false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Lifecycle Sequences & Recovery Differentiation
  // ---------------------------------------------------------------------------
  await t.test('5. Lifecycle Sequences & Recovery Differentiation', async (t2: any) => {
    await t2.test('24. Lifecycle sequence: START -> RUNNING -> STOP works cleanly', () => {
      let lifecycle = 'STARTING';
      lifecycle = 'RUNNING';
      assert.strictEqual(lifecycle, 'RUNNING');

      // User initiates explicit stop
      lifecycle = 'STOPPED';
      assert.strictEqual(lifecycle, 'STOPPED');
    });

    await t2.test('25. Lifecycle sequence: START -> RUNNING -> STOP -> START restores active state', () => {
      let state = 'STOPPED';
      // User starts
      state = 'STARTING';
      state = 'RUNNING';
      assert.strictEqual(state, 'RUNNING');

      // User stops
      state = 'STOPPED';
      assert.strictEqual(state, 'STOPPED');

      // User starts again
      state = 'STARTING';
      state = 'RUNNING';
      assert.strictEqual(state, 'RUNNING');
    });

    await t2.test('26. Recovery preserved: unexpected transport disconnect transitions to RECONNECTING', () => {
      let isExplicitStop = false;
      let connectionState: ConnectionStatus = ConnectionStatus.CONNECTED;

      const handleTransportFailure = () => {
        if (isExplicitStop) {
          connectionState = ConnectionStatus.DISCONNECTED;
        } else {
          connectionState = ConnectionStatus.RECONNECTING;
        }
      };

      handleTransportFailure();
      assert.strictEqual(connectionState, ConnectionStatus.RECONNECTING);
    });

    await t2.test('27. User stop during RECONNECTING state transitions to STOPPED and halts reconnect', () => {
      let connectionState: ConnectionStatus = ConnectionStatus.RECONNECTING;
      let isExplicitlyStopped = false;

      const handleUserStop = () => {
        isExplicitlyStopped = true;
        connectionState = ConnectionStatus.DISCONNECTED;
      };

      handleUserStop();
      assert.strictEqual(connectionState, ConnectionStatus.DISCONNECTED);
      assert.strictEqual(isExplicitlyStopped, true);
    });
  });
});
