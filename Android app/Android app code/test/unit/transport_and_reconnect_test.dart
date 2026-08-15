import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/remote/domain/services/remote_connection_service.dart';
import 'package:remote_node_app/features/remote/domain/services/remote_transport.dart';

void main() {
  group('Batch 6H Outbound Remote Transport & Reconnect Tests', () {
    test('Structured Transport Messages serialize correctly', () {
      const hello = HelloMessage(version: '1.0');
      expect(hello.toJson(), {'type': 'HELLO', 'version': '1.0'});

      const auth =
          AuthMessage(connectionToken: 'token-abc', deviceId: 'device-xyz');
      expect(auth.toJson(), {
        'type': 'AUTH',
        'connectionToken': 'token-abc',
        'deviceId': 'device-xyz',
      });

      const ping = PingMessage();
      expect(ping.toJson(), {'type': 'PING'});

      const pong = PongMessage();
      expect(pong.toJson(), {'type': 'PONG'});
    });

    test('MockRemoteTransport simulates HELLO greeting and AUTH_SUCCESS',
        () async {
      final transport = MockRemoteTransport();
      expect(transport.isConnected, isFalse);

      final receivedTypes = <String>[];
      transport.messageStream.listen((msg) {
        receivedTypes.add(msg['type'] as String);
      });

      await transport.connect('ws://localhost:4001');
      expect(transport.isConnected, isTrue);

      await Future.delayed(const Duration(milliseconds: 20));
      expect(receivedTypes, contains('HELLO'));

      await transport.send({
        'type': 'AUTH',
        'connectionToken': 'valid-token',
        'deviceId': 'device-123',
      });

      await Future.delayed(const Duration(milliseconds: 20));
      expect(receivedTypes, contains('AUTH_SUCCESS'));

      await transport.send({'type': 'PING'});
      await Future.delayed(const Duration(milliseconds: 20));
      expect(receivedTypes, contains('PONG'));

      await transport.disconnect();
      expect(transport.isConnected, isFalse);
    });

    test('HttpRemoteConnectionService initializes in disconnected state',
        () async {
      final service = HttpRemoteConnectionService();
      final status = await service.getStatus();
      expect(status, RemoteConnectionState.disconnected);
    });

    test(
        'HttpRemoteConnectionService performs exponential backoff on reconnect',
        () async {
      final service = HttpRemoteConnectionService();

      // Trigger reconnect
      final info = await service.reconnect();
      expect(info.status, RemoteConnectionState.connected);
      expect(info.isConnected, isTrue);
    });
  });
}
