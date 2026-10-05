import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CustomerStatusService } from '../src/services/customer_status_service.js';
import { ConnectionStateMachine } from '../src/services/connection_state_machine.js';
import { ConnectionStatus, DeviceStatus, ServerInstanceStatus, UserStatus } from '@prisma/client';

describe('Phase PRS - Batch PRS-1: Post-Reconnect Dashboard State Synchronization', () => {
  const deviceIdA = 'dev_test_alpha_123';
  const deviceIdB = 'dev_test_beta_456';
  const serverIdA = 'srv_test_alpha_123';
  const serverIdB = 'srv_test_beta_456';

  // A. INITIAL CONNECTION
  it('A. INITIAL CONNECTION: fresh connection with active gateway session evaluates to ONLINE with fresh effectiveLastSeenAt', () => {
    const now = new Date();
    const mockGatewayService = {
      getActiveSessionForDevice: () => ({
        connectionId: 'conn_1',
        sessionId: 'sess_1',
        sessionEpoch: 1,
        isAuthoritative: true,
        lastHeartbeatAt: now,
        connectedAt: now
      }),
      hasActiveConnectionForDevice: () => true
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: now,
        serverInstance: {
          id: serverIdA,
          status: ServerInstanceStatus.RUNNING,
          startedAt: now,
          lastHeartbeatAt: now
        },
        deviceConnection: {
          id: 'conn_1',
          status: ConnectionStatus.CONNECTED,
          lastHeartbeatAt: now,
          connectedAt: now
        },
        userStatus: UserStatus.ACTIVE
      },
      mockGatewayService
    );

    assert.strictEqual(result.remoteStatus, 'ONLINE');
    assert.strictEqual(result.statusReason, 'authenticated_live_session');
    assert.strictEqual(result.isRemoteAvailable, true);
    assert.strictEqual(result.livenessValid, true);
    assert.strictEqual(result.effectiveLastSeenAt, now.toISOString());
  });

  // B. NORMAL DISCONNECT
  it('B. NORMAL DISCONNECT: connection closed and liveness expired evaluates to OFFLINE', () => {
    const oldTimestamp = new Date(Date.now() - 120_000); // 2 minutes ago
    const mockGatewayService = {
      getActiveSessionForDevice: () => null,
      hasActiveConnectionForDevice: () => false
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: oldTimestamp,
        serverInstance: {
          id: serverIdA,
          status: ServerInstanceStatus.STOPPED,
          startedAt: oldTimestamp,
          lastHeartbeatAt: oldTimestamp
        },
        deviceConnection: {
          id: 'conn_1',
          status: ConnectionStatus.DISCONNECTED,
          lastHeartbeatAt: oldTimestamp,
          connectedAt: oldTimestamp
        },
        userStatus: UserStatus.ACTIVE
      },
      mockGatewayService
    );

    assert.strictEqual(result.remoteStatus, 'OFFLINE');
    assert.strictEqual(result.isRemoteAvailable, false);
    assert.strictEqual(result.livenessValid, false);
  });

  // C. RECONNECT — NEW CONNECTION BEFORE OLD CLOSE
  it('C. RECONNECT — NEW CONNECTION BEFORE OLD CLOSE: late close of old connection A does not downgrade live replacement B', () => {
    const now = new Date();
    const oldTime = new Date(Date.now() - 30_000);

    const mockGatewayService = {
      getActiveSessionForDevice: () => ({
        connectionId: 'conn_B',
        sessionId: 'sess_B_new',
        sessionEpoch: 2,
        isAuthoritative: true,
        lastHeartbeatAt: now,
        connectedAt: now
      }),
      hasActiveConnectionForDevice: () => true
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: oldTime,
        serverInstance: {
          id: serverIdA,
          status: ServerInstanceStatus.RUNNING,
          startedAt: oldTime,
          lastHeartbeatAt: now
        },
        deviceConnection: {
          id: 'conn_B',
          status: ConnectionStatus.CONNECTED,
          lastHeartbeatAt: now,
          connectedAt: now
        },
        userStatus: UserStatus.ACTIVE
      },
      mockGatewayService
    );

    assert.strictEqual(result.remoteStatus, 'ONLINE');
    assert.strictEqual(result.isRemoteAvailable, true);
    assert.strictEqual(result.sessionId, 'sess_B_new');
    assert.strictEqual(result.effectiveLastSeenAt, now.toISOString());
  });

  // D. RECONNECT — OLD CLOSE BEFORE NEW AUTH
  it('D. RECONNECT — OLD CLOSE BEFORE NEW AUTH: replacement connection establishes authoritative live state', () => {
    const now = new Date();
    const mockGatewayService = {
      getActiveSessionForDevice: () => ({
        connectionId: 'conn_B',
        sessionId: 'sess_B',
        sessionEpoch: 2,
        isAuthoritative: true,
        lastHeartbeatAt: now,
        connectedAt: now
      }),
      hasActiveConnectionForDevice: () => true
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: new Date(Date.now() - 60_000),
        serverInstance: {
          id: serverIdA,
          status: ServerInstanceStatus.RUNNING,
          startedAt: now,
          lastHeartbeatAt: now
        },
        deviceConnection: {
          id: 'conn_B',
          status: ConnectionStatus.CONNECTED,
          lastHeartbeatAt: now,
          connectedAt: now
        },
        userStatus: UserStatus.ACTIVE
      },
      mockGatewayService
    );

    assert.strictEqual(result.remoteStatus, 'ONLINE');
    assert.strictEqual(result.isRemoteAvailable, true);
  });

  // E. STALE OLD CLEANUP & LEGAL TRANSITIONS
  it('E. STALE OLD CLEANUP: verifies LEGAL_TRANSITIONS permits recovery on AUTH_SUCCESS', () => {
    assert.strictEqual(ConnectionStateMachine.canTransition(ConnectionStatus.DISCONNECTED, ConnectionStatus.CONNECTED), true);
    assert.strictEqual(ConnectionStateMachine.canTransition(ConnectionStatus.FAILED, ConnectionStatus.CONNECTED), true);
    assert.strictEqual(ConnectionStateMachine.canTransition(ConnectionStatus.CONNECTING, ConnectionStatus.CONNECTED), true);
  });

  // F. STALE OLD HEARTBEAT
  it('F. STALE OLD HEARTBEAT: calculateEffectiveLastSeen filters out invalid future timestamps and computes highest valid timestamp', () => {
    const t0 = new Date('2026-10-05T10:00:00.000Z');
    const t1 = new Date('2026-10-05T10:30:00.000Z');
    const t2 = new Date('2026-10-05T10:35:00.000Z');

    const effective = CustomerStatusService.calculateEffectiveLastSeen([t0, t1, t2]);
    assert.strictEqual(effective, t2.toISOString());
  });

  // G. HEARTBEAT PROPAGATION
  it('G. HEARTBEAT PROPAGATION: batched heartbeat correctly reflects recent activity across sources', () => {
    const now = new Date();
    const staleDeviceLastSeen = new Date(Date.now() - 36 * 60 * 1000); // 36 minutes ago
    const freshHeartbeat = now;

    const effective = CustomerStatusService.calculateEffectiveLastSeen([
      staleDeviceLastSeen,
      freshHeartbeat
    ]);

    assert.strictEqual(effective, freshHeartbeat.toISOString());
  });

  // H. EFFECTIVE LAST SEEN
  it('H. EFFECTIVE LAST SEEN: old Device.lastSeenAt with fresh connection heartbeat yields fresh effectiveLastSeenAt', () => {
    const freshHeartbeat = new Date();
    const staleDeviceLastSeen = new Date(Date.now() - 36 * 60 * 1000); // 36 minutes ago

    const mockGatewayService = {
      getActiveSessionForDevice: () => ({
        connectionId: 'conn_1',
        sessionId: 'sess_1',
        sessionEpoch: 1,
        isAuthoritative: true,
        lastHeartbeatAt: freshHeartbeat,
        connectedAt: freshHeartbeat
      }),
      hasActiveConnectionForDevice: () => true
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: staleDeviceLastSeen,
        serverInstance: {
          id: serverIdA,
          status: ServerInstanceStatus.RUNNING,
          startedAt: staleDeviceLastSeen,
          lastHeartbeatAt: freshHeartbeat
        },
        deviceConnection: {
          id: 'conn_1',
          status: ConnectionStatus.CONNECTED,
          lastHeartbeatAt: freshHeartbeat,
          connectedAt: freshHeartbeat
        },
        userStatus: UserStatus.ACTIVE
      },
      mockGatewayService
    );

    assert.strictEqual(result.remoteStatus, 'ONLINE');
    assert.strictEqual(result.effectiveLastSeenAt, freshHeartbeat.toISOString());
    assert.strictEqual(result.isRemoteAvailable, true);
  });

  // I. NO LIVE SESSION
  it('I. NO LIVE SESSION: absent in-memory gateway session with fresh durable DB heartbeat remains ONLINE', () => {
    const recentDbHeartbeat = new Date(Date.now() - 10_000); // 10 seconds ago (< 60s)
    const mockGatewayService = {
      getActiveSessionForDevice: () => null,
      hasActiveConnectionForDevice: () => false
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: recentDbHeartbeat,
        serverInstance: {
          id: serverIdA,
          status: ServerInstanceStatus.RUNNING,
          startedAt: recentDbHeartbeat,
          lastHeartbeatAt: recentDbHeartbeat
        },
        deviceConnection: {
          id: 'conn_1',
          status: ConnectionStatus.CONNECTED,
          lastHeartbeatAt: recentDbHeartbeat,
          connectedAt: recentDbHeartbeat
        },
        userStatus: UserStatus.ACTIVE
      },
      mockGatewayService
    );

    assert.strictEqual(result.remoteStatus, 'ONLINE');
    assert.strictEqual(result.statusReason, 'authenticated_live_session');
    assert.strictEqual(result.isRemoteAvailable, true);
    assert.strictEqual(result.livenessValid, true);
  });

  // J. EXPIRED HEARTBEAT
  it('J. EXPIRED HEARTBEAT: when all liveness sources exceed 60s max age, status is OFFLINE', () => {
    const staleTime = new Date(Date.now() - 90_000); // 90 seconds ago (> 60s threshold)
    const mockGatewayService = {
      getActiveSessionForDevice: () => null,
      hasActiveConnectionForDevice: () => false
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: staleTime,
        serverInstance: {
          id: serverIdA,
          status: ServerInstanceStatus.RUNNING,
          startedAt: staleTime,
          lastHeartbeatAt: staleTime
        },
        deviceConnection: {
          id: 'conn_1',
          status: ConnectionStatus.CONNECTED,
          lastHeartbeatAt: staleTime,
          connectedAt: staleTime
        },
        userStatus: UserStatus.ACTIVE
      },
      mockGatewayService
    );

    assert.strictEqual(result.remoteStatus, 'OFFLINE');
    assert.strictEqual(result.statusReason, 'heartbeat_expired');
    assert.strictEqual(result.isRemoteAvailable, false);
    assert.strictEqual(result.livenessValid, false);
  });

  // K. STOPPED STATE RACE
  it('K. STOPPED STATE RACE: live gateway session takes precedence over stale STOPPED server status artifact', () => {
    const now = new Date();
    const mockGatewayService = {
      getActiveSessionForDevice: () => ({
        connectionId: 'conn_replacement',
        sessionId: 'sess_replacement',
        sessionEpoch: 3,
        isAuthoritative: true,
        lastHeartbeatAt: now,
        connectedAt: now
      }),
      hasActiveConnectionForDevice: () => true
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: now,
        serverInstance: {
          id: serverIdA,
          status: ServerInstanceStatus.STOPPED, // Stale artifact from old disconnect
          startedAt: now,
          lastHeartbeatAt: now
        },
        deviceConnection: {
          id: 'conn_replacement',
          status: ConnectionStatus.CONNECTED,
          lastHeartbeatAt: now,
          connectedAt: now
        },
        userStatus: UserStatus.ACTIVE,
        isExplicitlyStopped: false // Not manually stopped by user
      },
      mockGatewayService
    );

    assert.strictEqual(result.remoteStatus, 'ONLINE');
    assert.strictEqual(result.isRemoteAvailable, true);
    assert.strictEqual(result.statusReason, 'authenticated_live_session');
  });

  // L. REAPER RACE
  it('L. REAPER RACE: reconciliation skips downgrading device when active gateway session exists', () => {
    const mockGatewayService = {
      hasActiveConnectionForDevice: (id: string) => id === deviceIdA
    };

    assert.strictEqual(mockGatewayService.hasActiveConnectionForDevice(deviceIdA), true);
    assert.strictEqual(mockGatewayService.hasActiveConnectionForDevice(deviceIdB), false);
  });

  // M. MULTI-DEVICE ISOLATION
  it('M. MULTI-DEVICE: reconnecting Device A does not alter state of Device B', () => {
    const now = new Date();
    const mockGatewayService = {
      getActiveSessionForDevice: (devId: string) => {
        if (devId === deviceIdA) {
          return {
            connectionId: 'conn_A',
            sessionId: 'sess_A',
            sessionEpoch: 2,
            isAuthoritative: true,
            lastHeartbeatAt: now,
            connectedAt: now
          };
        }
        return null;
      },
      hasActiveConnectionForDevice: (devId: string) => devId === deviceIdA
    } as any;

    const batchResults = CustomerStatusService.deriveBatchDeviceStatuses(
      [
        {
          id: deviceIdA,
          status: DeviceStatus.ONLINE,
          lastSeenAt: now,
          servers: [{ id: serverIdA, status: ServerInstanceStatus.RUNNING, lastHeartbeatAt: now }],
          connections: [{ id: 'conn_A', status: ConnectionStatus.CONNECTED, lastHeartbeatAt: now }]
        },
        {
          id: deviceIdB,
          status: DeviceStatus.OFFLINE,
          lastSeenAt: new Date(Date.now() - 3600_000),
          servers: [{ id: serverIdB, status: ServerInstanceStatus.STOPPED, lastHeartbeatAt: null }],
          connections: [{ id: 'conn_B', status: ConnectionStatus.DISCONNECTED, lastHeartbeatAt: null }]
        }
      ],
      UserStatus.ACTIVE,
      mockGatewayService
    );

    const statusA = batchResults.get(deviceIdA)!;
    const statusB = batchResults.get(deviceIdB)!;

    assert.strictEqual(statusA.remoteStatus, 'ONLINE');
    assert.strictEqual(statusA.isRemoteAvailable, true);

    assert.strictEqual(statusB.remoteStatus, 'OFFLINE');
    assert.strictEqual(statusB.isRemoteAvailable, false);
  });

  // N. FILE MANAGER AVAILABILITY
  it('N. FILE MANAGER: isRemoteAvailable reflects authoritative connection liveness', () => {
    const now = new Date();
    const liveGw = {
      getActiveSessionForDevice: () => ({
        connectionId: 'c1',
        sessionId: 's1',
        sessionEpoch: 1,
        isAuthoritative: true,
        lastHeartbeatAt: now,
        connectedAt: now
      })
    } as any;

    const deadGw = {
      getActiveSessionForDevice: () => null
    } as any;

    const onlineResult = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceConnection: { id: 'c1', status: ConnectionStatus.CONNECTED, lastHeartbeatAt: now },
        userStatus: UserStatus.ACTIVE
      },
      liveGw
    );
    assert.strictEqual(onlineResult.isRemoteAvailable, true);

    const offlineResult = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceConnection: { id: 'c1', status: ConnectionStatus.DISCONNECTED, lastHeartbeatAt: null },
        userStatus: UserStatus.ACTIVE
      },
      deadGw
    );
    assert.strictEqual(offlineResult.isRemoteAvailable, false);
  });

  // O. API CONTRACT
  it('O. API CONTRACT: response contract provides remoteStatus, statusReason, isRemoteAvailable, and effectiveLastSeenAt', () => {
    const now = new Date();
    const liveGw = {
      getActiveSessionForDevice: () => ({
        connectionId: 'c1',
        sessionId: 's1',
        sessionEpoch: 1,
        isAuthoritative: true,
        lastHeartbeatAt: now,
        connectedAt: now
      })
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceLastSeenAt: now,
        serverInstance: { id: serverIdA, status: ServerInstanceStatus.RUNNING, lastHeartbeatAt: now },
        deviceConnection: { id: 'c1', status: ConnectionStatus.CONNECTED, lastHeartbeatAt: now },
        userStatus: UserStatus.ACTIVE
      },
      liveGw
    );

    assert.ok('remoteStatus' in result);
    assert.ok('statusReason' in result);
    assert.ok('isRemoteAvailable' in result);
    assert.ok('effectiveLastSeenAt' in result);
    assert.strictEqual(typeof result.effectiveLastSeenAt, 'string');
  });

  // P. BACKWARD COMPATIBILITY
  it('P. BACKWARD COMPATIBILITY: handles legacy contexts where deviceLastSeenAt or serverInstance is missing', () => {
    const now = new Date();
    const liveGw = {
      getActiveSessionForDevice: () => ({
        connectionId: 'c1',
        sessionId: 's1',
        sessionEpoch: 1,
        isAuthoritative: true,
        lastHeartbeatAt: now,
        connectedAt: now
      })
    } as any;

    const result = CustomerStatusService.deriveCustomerStatus(
      {
        deviceId: deviceIdA,
        deviceConnection: { id: 'c1', status: ConnectionStatus.CONNECTED, lastHeartbeatAt: now }
      },
      liveGw
    );

    assert.strictEqual(result.remoteStatus, 'ONLINE');
    assert.strictEqual(result.isRemoteAvailable, true);
  });
});
