import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/remote/domain/services/connectivity_transport.dart';
import 'package:remote_node_app/features/remote/domain/services/remote_connection_service.dart';

void main() {
  group('Phase 2 — Batch 4 Production Connectivity & NAT Resilience Tests', () {
    test(
        'ConnectivityTransport abstraction supports relay, direct and futureP2P types',
        () {
      final relayTransport =
          MockConnectivityTransport(type: ConnectivityTransportType.relay);
      expect(relayTransport.transportType, ConnectivityTransportType.relay);

      final directTransport =
          MockConnectivityTransport(type: ConnectivityTransportType.direct);
      expect(directTransport.transportType, ConnectivityTransportType.direct);

      final p2pTransport =
          MockConnectivityTransport(type: ConnectivityTransportType.futureP2P);
      expect(p2pTransport.transportType, ConnectivityTransportType.futureP2P);
    });

    test('MockConnectivityTransport connects and receives HELLO greeting',
        () async {
      final transport = MockConnectivityTransport();
      expect(transport.isConnected, isFalse);

      final messages = <Map<String, dynamic>>[];
      final sub = transport.messageStream.listen((msg) => messages.add(msg));

      await transport.connect('ws://localhost:4001');
      expect(transport.isConnected, isTrue);

      await Future.delayed(const Duration(milliseconds: 10));
      expect(messages.any((m) => m['type'] == 'HELLO'), isTrue);

      await transport.disconnect();
      expect(transport.isConnected, isFalse);
      await sub.cancel();
    });

    test('RemoteConnectionInfo handles state transitions correctly', () {
      const initial =
          RemoteConnectionInfo(status: RemoteConnectionState.disconnected);
      expect(initial.isConnected, isFalse);

      const connecting =
          RemoteConnectionInfo(status: RemoteConnectionState.connecting);
      expect(connecting.isConnected, isFalse);

      final connected = RemoteConnectionInfo(
        connectionId: 'conn-100',
        remoteEndpoint: 'https://node-100.remotenode.net',
        status: RemoteConnectionState.connected,
        lastHeartbeatAt: DateTime.now(),
      );
      expect(connected.isConnected, isTrue);
      expect(connected.remoteEndpoint, isNotNull);

      const reconnecting =
          RemoteConnectionInfo(status: RemoteConnectionState.reconnecting);
      expect(reconnecting.isConnected, isFalse);
    });

    test('MockRemoteConnectionService simulates connection lifecycle cleanly',
        () async {
      const service = MockRemoteConnectionService();

      final statusBefore = await service.getStatus();
      expect(statusBefore, RemoteConnectionState.disconnected);

      final info =
          await service.connect(deviceId: 'dev-1', sessionToken: 'token-1');
      expect(info.status, RemoteConnectionState.connected);
      expect(info.connectionId, isNotNull);

      final disconnectInfo = await service.disconnect(
          connectionId: info.connectionId!, sessionToken: 'token-1');
      expect(disconnectInfo.status, RemoteConnectionState.disconnected);
    });
  });
}
