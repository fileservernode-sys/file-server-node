import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/remote/domain/services/remote_connection_service.dart';

void main() {
  group('Batch 6G Remote Connection Service & State Machine Tests', () {
    late RemoteConnectionService remoteService;

    setUp(() {
      remoteService = const MockRemoteConnectionService(
        initialState: RemoteConnectionState.disconnected,
      );
    });

    test('Initial RemoteConnectionState is disconnected', () async {
      final status = await remoteService.getStatus();
      expect(status, equals(RemoteConnectionState.disconnected));
    });

    test('Connect transitions state to connected and generates endpoint URL',
        () async {
      final info = await remoteService.connect(
        deviceId: 'device-123',
        sessionToken: 'session-token-456',
      );

      expect(info.status, equals(RemoteConnectionState.connected));
      expect(info.isConnected, isTrue);
      expect(info.remoteEndpoint, contains('remotenode.net'));
    });

    test('Disconnect transitions state to disconnected cleanly', () async {
      final info = await remoteService.disconnect(
        connectionId: 'conn-123',
        sessionToken: 'session-token-456',
      );

      expect(info.status, equals(RemoteConnectionState.disconnected));
      expect(info.isConnected, isFalse);
    });

    test('Reconnect handles re-establishing connection state', () async {
      final info = await remoteService.reconnect();
      expect(info.status, equals(RemoteConnectionState.connected));
    });
  });
}
