import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Transport types supported by the RemoteNode connectivity abstraction
enum ConnectivityTransportType {
  relay, // Default production outbound WSS gateway relay
  direct, // Local network / direct LAN connection
  futureP2P, // Future peer-to-peer / STUN / WebRTC transport
}

/// Abstract interface for vendor-neutral transport connectivity
abstract class ConnectivityTransport {
  ConnectivityTransportType get transportType;
  bool get isConnected;
  Stream<Map<String, dynamic>> get messageStream;

  Future<void> connect(String endpointUrl);
  Future<void> disconnect();
  Future<void> send(Map<String, dynamic> message);
}

/// Production WebSocket Relay Transport (Outbound-only connection to Gateway)
class WebSocketRelayTransport implements ConnectivityTransport {
  WebSocket? _socket;
  final StreamController<Map<String, dynamic>> _messageController =
      StreamController<Map<String, dynamic>>.broadcast();
  StreamSubscription? _socketSubscription;

  @override
  ConnectivityTransportType get transportType =>
      ConnectivityTransportType.relay;

  @override
  bool get isConnected =>
      _socket != null && _socket!.readyState == WebSocket.open;

  @override
  Stream<Map<String, dynamic>> get messageStream => _messageController.stream;

  @override
  Future<void> connect(String endpointUrl) async {
    await disconnect();

    try {
      _socket = await WebSocket.connect(endpointUrl)
          .timeout(const Duration(seconds: 8));

      _socketSubscription = _socket!.listen(
        (data) {
          try {
            final decoded = jsonDecode(data as String) as Map<String, dynamic>;
            _messageController.add(decoded);
          } catch (_) {
            // Ignore malformed payloads
          }
        },
        onError: (err) {
          _socket = null;
        },
        onDone: () {
          _socket = null;
        },
      );
    } catch (e) {
      _socket = null;
      rethrow;
    }
  }

  @override
  Future<void> disconnect() async {
    await _socketSubscription?.cancel();
    _socketSubscription = null;

    if (_socket != null) {
      try {
        await _socket!.close();
      } catch (_) {}
      _socket = null;
    }
  }

  @override
  Future<void> send(Map<String, dynamic> message) async {
    if (!isConnected) {
      throw StateError('Transport socket is not connected.');
    }
    _socket!.add(jsonEncode(message));
  }
}

/// Mock Connectivity Transport for tests and local simulation
class MockConnectivityTransport implements ConnectivityTransport {
  final ConnectivityTransportType _type;
  bool _connected = false;
  final StreamController<Map<String, dynamic>> _messageController =
      StreamController<Map<String, dynamic>>.broadcast();

  MockConnectivityTransport(
      {ConnectivityTransportType type = ConnectivityTransportType.relay})
      : _type = type;

  @override
  ConnectivityTransportType get transportType => _type;

  @override
  bool get isConnected => _connected;

  @override
  Stream<Map<String, dynamic>> get messageStream => _messageController.stream;

  @override
  Future<void> connect(String endpointUrl) async {
    _connected = true;
    _messageController.add({'type': 'HELLO', 'version': '2.0'});
  }

  @override
  Future<void> disconnect() async {
    _connected = false;
  }

  @override
  Future<void> send(Map<String, dynamic> message) async {
    if (!_connected) throw StateError('Mock transport is not connected.');
    if (message['type'] == 'AUTH') {
      _messageController.add({
        'type': 'AUTH_SUCCESS',
        'connectionId': 'mock-conn-999',
        'remoteEndpoint': 'https://node-mock.remotenode.net'
      });
    }
  }

  void simulateIncomingMessage(Map<String, dynamic> message) {
    _messageController.add(message);
  }
}
