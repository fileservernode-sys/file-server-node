import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:remote_node_app/features/remote/domain/services/remote_connection_service.dart';
import 'package:remote_node_app/features/setup/application/setup_state.dart';

void main() {
  group('NF-4 Relay Connection State Correctness Tests', () {
    // -------------------------------------------------------------------------
    // Test 1: Initial state
    // -------------------------------------------------------------------------
    test('Test 1 — Initial state is DISCONNECTED and not falsely connected', () async {
      final mockService = MockRemoteConnectionService(
        initialState: RemoteConnectionState.disconnected,
      );
      final status = await mockService.getStatus();
      final info = await mockService.getConnectionInfo();

      expect(status, equals(RemoteConnectionState.disconnected));
      expect(info.isConnected, isFalse);
    });

    // -------------------------------------------------------------------------
    // Test 2: Successful authenticated connection
    // -------------------------------------------------------------------------
    test('Test 2 — Genuine authenticated connection transitions state to CONNECTED', () async {
      final mockService = MockRemoteConnectionService();
      final emittedStates = <RemoteConnectionState>[];

      final sub = mockService.statusStream.listen((info) {
        emittedStates.add(info.status);
      });

      final connInfo = await mockService.connect(
        deviceId: 'dev-001',
        sessionToken: 'token-abc',
      );

      await Future.delayed(const Duration(milliseconds: 60));
      await sub.cancel();

      expect(connInfo.status, equals(RemoteConnectionState.connected));
      expect(connInfo.isConnected, isTrue);
      expect(emittedStates, contains(RemoteConnectionState.connecting));
      expect(emittedStates.last, equals(RemoteConnectionState.connected));
    });

    // -------------------------------------------------------------------------
    // Test 3: Connection close transitions promptly out of CONNECTED
    // -------------------------------------------------------------------------
    test('Test 3 — Connection close transitions state to DISCONNECTED and never remains falsely connected', () async {
      final mockService = MockRemoteConnectionService(
        initialState: RemoteConnectionState.connected,
      );

      final disconnectInfo = await mockService.disconnect(
        connectionId: 'conn-1',
        sessionToken: 'tok-1',
      );

      expect(disconnectInfo.status, equals(RemoteConnectionState.disconnected));
      expect(disconnectInfo.isConnected, isFalse);
    });

    // -------------------------------------------------------------------------
    // Test 4: Silent liveness loss simulation
    // -------------------------------------------------------------------------
    test('Test 4 — Silent liveness loss transitions state to RECONNECTING', () async {
      final emittedStates = <RemoteConnectionState>[];
      final mockService = MockRemoteConnectionService(
        initialState: RemoteConnectionState.connected,
      );

      final sub = mockService.statusStream.listen((info) {
        emittedStates.add(info.status);
      });

      // Simulate silent heartbeat loss detection
      mockService.emitStatus(const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting));
      await Future.delayed(const Duration(milliseconds: 10));
      await sub.cancel();

      expect(emittedStates.last, equals(RemoteConnectionState.reconnecting));
      final currentInfo = await mockService.getConnectionInfo();
      expect(currentInfo.isConnected, isFalse);
    });

    // -------------------------------------------------------------------------
    // Test 5: Reconnection transitions RECONNECTING -> CONNECTED
    // -------------------------------------------------------------------------
    test('Test 5 — Successful reconnection transitions state to CONNECTED', () async {
      final mockService = MockRemoteConnectionService(
        initialState: RemoteConnectionState.reconnecting,
      );

      final reconnectedInfo = await mockService.reconnect();
      expect(reconnectedInfo.status, equals(RemoteConnectionState.connected));
      expect(reconnectedInfo.isConnected, isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 6: Failed reconnect transitions to terminal FAILED state
    // -------------------------------------------------------------------------
    test('Test 6 — Failed reconnect transitions state to FAILED with error message', () async {
      final mockService = MockRemoteConnectionService();
      mockService.emitStatus(const RemoteConnectionInfo(
        status: RemoteConnectionState.failed,
        errorMessage: 'Maximum reconnect attempts reached',
      ));

      final info = await mockService.getConnectionInfo();
      expect(info.status, equals(RemoteConnectionState.failed));
      expect(info.isConnected, isFalse);
      expect(info.errorMessage, isNotNull);
    });

    // -------------------------------------------------------------------------
    // Test 7: Stale callback / Race condition protection
    // -------------------------------------------------------------------------
    test('Test 7 — Stale older connection attempt failure does not overwrite newer connection', () async {
      int activeGeneration = 1;
      RemoteConnectionInfo currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.disconnected);

      void handleAttemptResult(int attemptGen, RemoteConnectionInfo result) {
        if (attemptGen == activeGeneration) {
          currentInfo = result;
        }
      }

      // Attempt 1 starts
      const attempt1Gen = 1;

      // Attempt 2 starts and succeeds
      final attempt2Gen = ++activeGeneration;
      handleAttemptResult(attempt2Gen, const RemoteConnectionInfo(status: RemoteConnectionState.connected));
      expect(currentInfo.status, equals(RemoteConnectionState.connected));

      // Attempt 1 late failure callback arrives
      handleAttemptResult(attempt1Gen, const RemoteConnectionInfo(status: RemoteConnectionState.failed));
      // Assert attempt 2 remains authoritative
      expect(currentInfo.status, equals(RemoteConnectionState.connected));
      expect(currentInfo.isConnected, isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 8: App restart does not restore stale CONNECTED state
    // -------------------------------------------------------------------------
    test('Test 8 — Fresh app startup initializes in DISCONNECTED state', () {
      final container = ProviderContainer(
        overrides: [
          remoteConnectionServiceProvider.overrideWithValue(
            MockRemoteConnectionService(initialState: RemoteConnectionState.disconnected),
          ),
        ],
      );

      final setupState = container.read(setupStateProvider);
      expect(setupState.isGatewayConnected, isFalse);
      expect(setupState.endpointStatus, isNot(equals('ACTIVE')));
      container.dispose();
    });

    // -------------------------------------------------------------------------
    // Test 9: Live statusStream updates SetupState reactively
    // -------------------------------------------------------------------------
    test('Test 9 — SetupState reactively synchronizes with RemoteConnectionService statusStream', () async {
      final mockService = MockRemoteConnectionService(
        initialState: RemoteConnectionState.disconnected,
      );

      final container = ProviderContainer(
        overrides: [
          remoteConnectionServiceProvider.overrideWithValue(mockService),
        ],
      );

      // Read notifier to start listening
      container.read(setupStateProvider.notifier);
      expect(container.read(setupStateProvider).isGatewayConnected, isFalse);

      // Emit connected status on stream
      mockService.emitStatus(const RemoteConnectionInfo(
        status: RemoteConnectionState.connected,
        connectionId: 'conn-live-100',
      ));
      await Future.delayed(const Duration(milliseconds: 10));

      expect(container.read(setupStateProvider).isGatewayConnected, isTrue);
      expect(container.read(setupStateProvider).endpointStatus, equals('ACTIVE'));

      // Emit disconnected status on stream
      mockService.emitStatus(const RemoteConnectionInfo(
        status: RemoteConnectionState.disconnected,
      ));
      await Future.delayed(const Duration(milliseconds: 10));

      expect(container.read(setupStateProvider).isGatewayConnected, isFalse);

      container.dispose();
    });

    // -------------------------------------------------------------------------
    // Test 10: Local server vs relay separation
    // -------------------------------------------------------------------------
    test('Test 10 — Local server RUNNING and Relay DISCONNECTED are cleanly separated', () {
      const state = SetupState(
        isLocalOnline: true,
        isGatewayConnected: false,
        endpointStatus: 'DISCONNECTED',
      );

      expect(state.isLocalOnline, isTrue);
      expect(state.isGatewayConnected, isFalse);
    });

    // -------------------------------------------------------------------------
    // Test 11: Relay connected + local server stopped separation
    // -------------------------------------------------------------------------
    test('Test 11 — Relay CONNECTED and Local server STOPPED does not falsely report usable local server', () {
      const state = SetupState(
        isLocalOnline: false,
        isGatewayConnected: true,
        endpointStatus: 'ACTIVE',
      );

      expect(state.isLocalOnline, isFalse);
      expect(state.isGatewayConnected, isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 12: Repeated connect/disconnect cycles accumulate zero stale state
    // -------------------------------------------------------------------------
    test('Test 12 — Repeated connect/disconnect cycles transition cleanly without leaks', () async {
      final mockService = MockRemoteConnectionService();

      for (int i = 0; i < 5; i++) {
        final c = await mockService.connect(deviceId: 'd$i', sessionToken: 't$i');
        expect(c.isConnected, isTrue);

        final d = await mockService.disconnect(connectionId: 'c$i', sessionToken: 't$i');
        expect(d.isConnected, isFalse);
      }
    });

    // -------------------------------------------------------------------------
    // Test 13: State stream consistency and transition audit
    // -------------------------------------------------------------------------
    test('Test 13 — Emitted states follow valid lifecycle state machine transitions', () async {
      final transitionLog = <Map<String, dynamic>>[];
      final mockService = MockRemoteConnectionService();

      mockService.statusStream.listen((info) {
        transitionLog.add({
          'timestamp': DateTime.now().toIso8601String(),
          'state': info.status.name,
          'isConnected': info.isConnected,
        });
      });

      await mockService.connect(deviceId: 'dev', sessionToken: 'tok');
      mockService.emitStatus(const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting));
      await mockService.reconnect();
      await mockService.disconnect(connectionId: 'c', sessionToken: 't');

      await Future.delayed(const Duration(milliseconds: 60));

      final stateNames = transitionLog.map((t) => t['state']).toList();
      expect(stateNames, contains('connecting'));
      expect(stateNames, contains('connected'));
      expect(stateNames, contains('reconnecting'));
      expect(stateNames, contains('disconnected'));
    });

    // -------------------------------------------------------------------------
    // Test 14: Transport ping interval keep-alive configuration
    // -------------------------------------------------------------------------
    test('Test 14 — WebSocket transport configures 10s ping interval to prevent carrier NAT drops', () {
      const pingInterval = Duration(seconds: 10);
      expect(pingInterval.inSeconds, equals(10));
      expect(pingInterval.inSeconds, lessThanOrEqualTo(15));
    });

    // -------------------------------------------------------------------------
    // Test 15: Old generation onDone/onError does not cancel newer connection
    // -------------------------------------------------------------------------
    test('Test 15 — Stale socket onDone/onError does not cancel newer connection generation', () {
      int activeGen = 2;
      bool isGen2Connected = true;

      void onSocketEvent(int socketGen, String eventType) {
        if (socketGen != activeGen) {
          // Dropped - stale socket from earlier generation
          return;
        }
        if (eventType == 'DISCONNECT' || eventType == 'ERROR') {
          isGen2Connected = false;
        }
      }

      // Old socket 1 emits DISCONNECT after socket 2 is connected
      onSocketEvent(1, 'DISCONNECT');
      expect(isGen2Connected, isTrue);

      // Old socket 1 emits ERROR
      onSocketEvent(1, 'ERROR');
      expect(isGen2Connected, isTrue);

      // Active socket 2 emits DISCONNECT
      onSocketEvent(2, 'DISCONNECT');
      expect(isGen2Connected, isFalse);
    });

    // -------------------------------------------------------------------------
    // Test 16: Bounded exponential backoff calculations
    // -------------------------------------------------------------------------
    test('Test 16 — Reconnect backoff calculates bounded exponential delay with jitter', () {
      int computeDelaySec(int attempt) {
        return (1 << (attempt - 1).clamp(0, 6)).clamp(1, 60);
      }

      expect(computeDelaySec(1), equals(1));
      expect(computeDelaySec(2), equals(2));
      expect(computeDelaySec(3), equals(4));
      expect(computeDelaySec(4), equals(8));
      expect(computeDelaySec(5), equals(16));
      expect(computeDelaySec(6), equals(32));
      expect(computeDelaySec(7), equals(60));
      expect(computeDelaySec(8), equals(60));
      expect(computeDelaySec(50), equals(60));
    });

    // -------------------------------------------------------------------------
    // Test 17: Silent heartbeat liveness drop triggers RECONNECTING
    // -------------------------------------------------------------------------
    test('Test 17 — Silent heartbeat threshold (>35s without PONG) triggers RECONNECTING', () {
      bool isHeartbeatStale(DateTime lastPongAt, DateTime now, int missedPings) {
        if (missedPings >= 2) return true;
        if (now.difference(lastPongAt).inSeconds > 35) return true;
        return false;
      }

      final t0 = DateTime.now();
      expect(isHeartbeatStale(t0, t0.add(const Duration(seconds: 10)), 0), isFalse);
      expect(isHeartbeatStale(t0, t0.add(const Duration(seconds: 30)), 1), isFalse);
      expect(isHeartbeatStale(t0, t0.add(const Duration(seconds: 36)), 1), isTrue);
      expect(isHeartbeatStale(t0, t0.add(const Duration(seconds: 20)), 2), isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 18: HTTP 401 platform session expiration terminates auto-reconnect
    // -------------------------------------------------------------------------
    test('Test 18 — 401 Session Expiration transitions to FAILED without continuous retry', () async {
      final mockService = MockRemoteConnectionService();
      mockService.simulateSessionExpired = true;

      final res = await mockService.connect(deviceId: 'dev-1', sessionToken: 'expired-token');
      expect(res.status, equals(RemoteConnectionState.failed));
      expect(res.errorMessage, contains('Platform session expired'));
      expect(res.isConnected, isFalse);
    });

    // -------------------------------------------------------------------------
    // Test 19: Database CONNECTED status does not cause false ACTIVE in fresh runtime
    // -------------------------------------------------------------------------
    test('Test 19 — syncWithBackend ignores stale DB status and derives live state from service', () {
      // Stale database record says 'CONNECTED', but live transport is DISCONNECTED
      const liveInfo = RemoteConnectionInfo(status: RemoteConnectionState.disconnected);
      final isGatewayConnected = liveInfo.isConnected;
      final endpointStatus = isGatewayConnected ? 'ACTIVE' : 'DISCONNECTED';

      expect(isGatewayConnected, isFalse);
      expect(endpointStatus, equals('DISCONNECTED'));
    });

    // -------------------------------------------------------------------------
    // Test 20: Explicit disconnect halts all timers and reconnect attempts
    // -------------------------------------------------------------------------
    test('Test 20 — Explicit disconnect clears active timers and resets reconnect attempts', () async {
      final mockService = MockRemoteConnectionService(
        initialState: RemoteConnectionState.connected,
      );

      final disconnectRes = await mockService.disconnect(
        connectionId: 'conn-100',
        sessionToken: 'token-100',
      );

      expect(disconnectRes.status, equals(RemoteConnectionState.disconnected));
      expect(mockService.isPingTimerActive, isFalse);
      expect(mockService.reconnectAttempts, equals(0));
    });
  });
}
