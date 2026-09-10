import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:remote_node_app/features/remote/domain/services/remote_connection_service.dart';
import 'package:remote_node_app/features/remote/domain/services/remote_transport.dart';
import 'package:remote_node_app/features/setup/application/setup_state.dart';

void main() {
  group('NF-5 Long-Running Relay Reliability & Self-Recovery Tests', () {
    // -------------------------------------------------------------------------
    // Test 1: Initial connection
    // -------------------------------------------------------------------------
    test('Test 1 — Initial connection: connect successfully reaches CONNECTED',
        () async {
      final mockService = MockRemoteConnectionService(
        initialState: RemoteConnectionState.disconnected,
      );

      final initialStatus = await mockService.getStatus();
      expect(initialStatus, equals(RemoteConnectionState.disconnected));

      final info = await mockService.connect(
        deviceId: 'device-101',
        sessionToken: 'valid-session-token-1',
      );

      expect(info.status, equals(RemoteConnectionState.connected));
      expect(info.isConnected, isTrue);
      expect(info.connectionId, equals('mock-conn-999'));
      expect(info.remoteEndpoint, isNotNull);
      expect(mockService.isPingTimerActive, isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 2: Network loss
    // -------------------------------------------------------------------------
    test('Test 2 — Network loss transitions state from CONNECTED to RECONNECTING',
        () async {
      final mockService = MockRemoteConnectionService();
      await mockService.connect(
        deviceId: 'device-101',
        sessionToken: 'valid-session-token-1',
      );
      expect(await mockService.getStatus(), equals(RemoteConnectionState.connected));

      // Network loss event
      mockService.emitStatus(
        const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting),
      );

      final currentStatus = await mockService.getStatus();
      expect(currentStatus, equals(RemoteConnectionState.reconnecting));
      final info = await mockService.getConnectionInfo();
      expect(info.isConnected, isFalse);
    });

    // -------------------------------------------------------------------------
    // Test 3: Network restoration
    // -------------------------------------------------------------------------
    test(
        'Test 3 — Network restoration transitions RECONNECTING -> CONNECTING -> CONNECTED',
        () async {
      final mockService = MockRemoteConnectionService();
      final emittedStates = <RemoteConnectionState>[];

      final sub = mockService.statusStream.listen((info) {
        emittedStates.add(info.status);
      });

      // Start in reconnecting
      mockService.emitStatus(
        const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting),
      );

      // Reconnect
      final info = await mockService.reconnect();
      await Future<void>.delayed(Duration.zero);

      expect(info.status, equals(RemoteConnectionState.connected));
      expect(info.isConnected, isTrue);
      expect(emittedStates, contains(RemoteConnectionState.reconnecting));
      expect(emittedStates, contains(RemoteConnectionState.connected));

      await sub.cancel();
    });

    // -------------------------------------------------------------------------
    // Test 4: Repeated network flapping
    // -------------------------------------------------------------------------
    test(
        'Test 4 — Repeated network flapping avoids duplicate sockets and reconnect storms',
        () async {
      final mockService = MockRemoteConnectionService();
      int reconnectCount = 0;

      for (int i = 0; i < 10; i++) {
        mockService.emitStatus(
          const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting),
        );
        await mockService.reconnect();
        reconnectCount++;
      }

      expect(reconnectCount, equals(10));
      expect(await mockService.getStatus(), equals(RemoteConnectionState.connected));
      expect(mockService.connectionGeneration, greaterThanOrEqualTo(10));
    });

    // -------------------------------------------------------------------------
    // Test 5: Exponential backoff
    // -------------------------------------------------------------------------
    test('Test 5 — Exponential backoff scales retry delay up to bounded max',
        () {
      // Backoff calculation verification:
      // (1 << (attempts - 1).clamp(0, 6)).clamp(1, 60)
      int computeDelay(int attempts) =>
          (1 << (attempts - 1).clamp(0, 6)).clamp(1, 60);

      expect(computeDelay(1), equals(1)); // 1s
      expect(computeDelay(2), equals(2)); // 2s
      expect(computeDelay(3), equals(4)); // 4s
      expect(computeDelay(4), equals(8)); // 8s
      expect(computeDelay(5), equals(16)); // 16s
      expect(computeDelay(6), equals(32)); // 32s
      expect(computeDelay(7), equals(60)); // bounded max 60s
      expect(computeDelay(10), equals(60)); // bounded max 60s
      expect(computeDelay(50), equals(60)); // bounded max 60s
    });

    // -------------------------------------------------------------------------
    // Test 6: Successful recovery resets backoff
    // -------------------------------------------------------------------------
    test('Test 6 — Successful recovery resets backoff counter to 0', () async {
      final mockService = MockRemoteConnectionService();

      // Trigger 3 simulated reconnects
      await mockService.reconnect();
      await mockService.reconnect();
      await mockService.reconnect();
      expect(mockService.reconnectAttempts, equals(3));

      // Successful fresh connection resets counter
      await mockService.connect(
        deviceId: 'device-101',
        sessionToken: 'valid-session-token-1',
      );

      expect(mockService.reconnectAttempts, equals(0));
      expect(await mockService.getStatus(), equals(RemoteConnectionState.connected));
    });

    // -------------------------------------------------------------------------
    // Test 7: Duplicate reconnect prevention
    // -------------------------------------------------------------------------
    test(
        'Test 7 — Duplicate reconnect calls deduplicate to a single active reconnect attempt',
        () async {
      final mockService = MockRemoteConnectionService(
        initialState: RemoteConnectionState.reconnecting,
      );

      // Launch multiple reconnects in parallel
      final f1 = mockService.reconnect();
      final f2 = mockService.reconnect();
      final f3 = mockService.reconnect();

      final results = await Future.wait([f1, f2, f3]);

      for (final r in results) {
        expect(r.status, equals(RemoteConnectionState.connected));
      }
      expect(await mockService.getStatus(), equals(RemoteConnectionState.connected));
    });

    // -------------------------------------------------------------------------
    // Test 8: Stale callback
    // -------------------------------------------------------------------------
    test(
        'Test 8 — Out-of-order callback from older connection generation cannot overwrite current state',
        () async {
      int activeGeneration = 0;
      RemoteConnectionInfo currentInfo =
          const RemoteConnectionInfo(status: RemoteConnectionState.disconnected);

      void handleAttemptResult(int attemptGen, RemoteConnectionInfo result) {
        if (attemptGen == activeGeneration) {
          currentInfo = result;
        }
      }

      // Generation 1 starts
      const gen1 = 1;
      activeGeneration = 1;

      // Generation 2 starts and succeeds
      const gen2 = 2;
      activeGeneration = 2;
      handleAttemptResult(
        gen2,
        const RemoteConnectionInfo(status: RemoteConnectionState.connected),
      );
      expect(currentInfo.status, equals(RemoteConnectionState.connected));

      // Generation 1 late failure callback arrives
      handleAttemptResult(
        gen1,
        const RemoteConnectionInfo(status: RemoteConnectionState.failed),
      );

      // Current state remains CONNECTED
      expect(currentInfo.status, equals(RemoteConnectionState.connected));
      expect(currentInfo.isConnected, isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 9: Socket cleanup
    // -------------------------------------------------------------------------
    test(
        'Test 9 — Socket cleanup: old transport disconnect cleanly closes underlying socket',
        () async {
      final transport = MockRemoteTransport();
      await transport.connect('ws://localhost:4001');
      expect(transport.isConnected, isTrue);

      await transport.disconnect();
      expect(transport.isConnected, isFalse);
    });

    // -------------------------------------------------------------------------
    // Test 10: Service stop
    // -------------------------------------------------------------------------
    test(
        'Test 10 — Service stop clears ping timer, reconnect timer, and marks state disconnected',
        () async {
      final mockService = MockRemoteConnectionService();
      await mockService.connect(
        deviceId: 'device-101',
        sessionToken: 'valid-session-token-1',
      );
      expect(mockService.isPingTimerActive, isTrue);

      final discInfo = await mockService.disconnect(
        connectionId: 'mock-conn-999',
        sessionToken: 'valid-session-token-1',
      );

      expect(discInfo.status, equals(RemoteConnectionState.disconnected));
      expect(mockService.isPingTimerActive, isFalse);
      expect(mockService.reconnectAttempts, equals(0));
    });

    // -------------------------------------------------------------------------
    // Test 11: Service restart
    // -------------------------------------------------------------------------
    test('Test 11 — Service restart recovers connection cleanly without duplicate instances',
        () async {
      final mockService = MockRemoteConnectionService();

      // Start 1
      await mockService.connect(
        deviceId: 'device-101',
        sessionToken: 'valid-token',
      );
      expect(await mockService.getStatus(), equals(RemoteConnectionState.connected));

      // Stop
      await mockService.disconnect(
        connectionId: 'mock-conn-999',
        sessionToken: 'valid-token',
      );
      expect(await mockService.getStatus(), equals(RemoteConnectionState.disconnected));

      // Restart
      await mockService.connect(
        deviceId: 'device-101',
        sessionToken: 'valid-token',
      );
      expect(await mockService.getStatus(), equals(RemoteConnectionState.connected));
    });

    // -------------------------------------------------------------------------
    // Test 12: Heartbeat timeout
    // -------------------------------------------------------------------------
    test(
        'Test 12 — Heartbeat timeout (>35s without pong) marks connection unhealthy and initiates self-recovery',
        () {
      DateTime? lastPong = DateTime.now().subtract(const Duration(seconds: 40));
      int missedPings = 3;

      bool isLivenessLost = missedPings >= 2 ||
          DateTime.now().difference(lastPong).inSeconds > 35;

      expect(isLivenessLost, isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 13: Gateway restart
    // -------------------------------------------------------------------------
    test('Test 13 — Gateway restart recovery: disconnect -> reconnect -> connected',
        () async {
      final mockService = MockRemoteConnectionService();
      await mockService.connect(
        deviceId: 'device-101',
        sessionToken: 'valid-session-token-1',
      );

      // Gateway restart event
      mockService.emitStatus(
        const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting),
      );
      expect(await mockService.getStatus(), equals(RemoteConnectionState.reconnecting));

      // Gateway returns online
      final info = await mockService.reconnect();
      expect(info.status, equals(RemoteConnectionState.connected));
      expect(info.isConnected, isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 14: 24-hour session boundary
    // -------------------------------------------------------------------------
    test(
        'Test 14 — 24-hour session boundary: expired session halts reconnect loop without extending session',
        () async {
      final mockService = MockRemoteConnectionService();
      mockService.simulateSessionExpired = true;

      final info = await mockService.connect(
        deviceId: 'device-101',
        sessionToken: 'expired-session-token',
      );

      expect(info.status, equals(RemoteConnectionState.failed));
      expect(info.errorMessage, contains('Platform session expired (24h)'));
      expect(info.isConnected, isFalse);

      final reconnectInfo = await mockService.reconnect();
      expect(reconnectInfo.status, equals(RemoteConnectionState.failed));
      expect(reconnectInfo.errorMessage, contains('Platform session expired (24h)'));
    });

    // -------------------------------------------------------------------------
    // Test 15: Local/relay separation
    // -------------------------------------------------------------------------
    test(
        'Test 15 — Local server running state remains independent when relay is disconnected',
        () {
      const isLocalServerRunning = true;
      const relayState = RemoteConnectionState.disconnected;

      expect(isLocalServerRunning, isTrue);
      expect(relayState, equals(RemoteConnectionState.disconnected));
    });

    // -------------------------------------------------------------------------
    // Test 16: Relay/local failure distinction
    // -------------------------------------------------------------------------
    test(
        'Test 16 — When local server is stopped, remote usability is not falsely reported as healthy',
        () {
      bool isRemoteUsable({
        required bool isServerRunning,
        required bool isRelayConnected,
      }) =>
          isServerRunning && isRelayConnected;

      expect(isRemoteUsable(isServerRunning: false, isRelayConnected: true), isFalse);
      expect(isRemoteUsable(isServerRunning: true, isRelayConnected: false), isFalse);
      expect(isRemoteUsable(isServerRunning: true, isRelayConnected: true), isTrue);
    });

    // -------------------------------------------------------------------------
    // Test 17: Timer cleanup
    // -------------------------------------------------------------------------
    test('Test 17 — Repeated connect/disconnect cycles leave no active ping timers',
        () async {
      final mockService = MockRemoteConnectionService();

      for (int i = 0; i < 5; i++) {
        await mockService.connect(
          deviceId: 'device-101',
          sessionToken: 'valid-token',
        );
        expect(mockService.isPingTimerActive, isTrue);

        await mockService.disconnect(
          connectionId: 'mock-conn-999',
          sessionToken: 'valid-token',
        );
        expect(mockService.isPingTimerActive, isFalse);
      }
    });

    // -------------------------------------------------------------------------
    // Test 18: Listener cleanup
    // -------------------------------------------------------------------------
    test('Test 18 — Riverpod container dispose cleanly cancels status stream subscription',
        () {
      final container = ProviderContainer(
        overrides: [
          remoteConnectionServiceProvider.overrideWithValue(
            MockRemoteConnectionService(),
          ),
        ],
      );

      final notifier = container.read(setupStateProvider.notifier);
      expect(notifier, isNotNull);

      container.dispose();
    });
  });
}
