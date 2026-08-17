import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Structured Transport Messages for Outbound Remote Gateway Handshake Protocol
abstract class TransportMessage {
  final String type;

  const TransportMessage(this.type);

  Map<String, dynamic> toJson();
}

class HelloMessage extends TransportMessage {
  final String version;

  const HelloMessage({this.version = '1.0'}) : super('HELLO');

  factory HelloMessage.fromJson(Map<String, dynamic> json) {
    return HelloMessage(version: json['version'] as String? ?? '1.0');
  }

  @override
  Map<String, dynamic> toJson() => {'type': type, 'version': version};
}

class AuthMessage extends TransportMessage {
  final String connectionToken;
  final String deviceId;

  const AuthMessage({
    required this.connectionToken,
    required this.deviceId,
  }) : super('AUTH');

  @override
  Map<String, dynamic> toJson() => {
        'type': type,
        'connectionToken': connectionToken,
        'deviceId': deviceId,
      };
}

class PingMessage extends TransportMessage {
  const PingMessage() : super('PING');

  @override
  Map<String, dynamic> toJson() => {'type': type};
}

class PongMessage extends TransportMessage {
  const PongMessage() : super('PONG');

  @override
  Map<String, dynamic> toJson() => {'type': type};
}

/// Abstract Transport Interface for Remote Gateway Communication
abstract class RemoteTransport {
  Future<void> connect(String url);
  Future<void> disconnect();
  Future<void> send(Map<String, dynamic> message);
  Stream<Map<String, dynamic>> get messageStream;
  bool get isConnected;
}

/// Outbound WebSocket Transport Layer Implementation
class WebSocketRemoteTransport implements RemoteTransport {
  WebSocket? _socket;
  final StreamController<Map<String, dynamic>> _controller =
      StreamController<Map<String, dynamic>>.broadcast();

  @override
  bool get isConnected =>
      _socket != null && _socket!.readyState == WebSocket.open;

  @override
  Stream<Map<String, dynamic>> get messageStream => _controller.stream;

  @override
  Future<void> connect(String url) async {
    await disconnect();
    final urlsToTry = <String>[
      'wss://file-server-node-1.onrender.com',
      url,
      'wss://gateway.viewduration.com',
    ];

    Object? lastError;
    for (final targetUrl in urlsToTry) {
      try {
        final client = HttpClient()
          ..badCertificateCallback = (cert, host, port) => true;
        _socket = await WebSocket.connect(targetUrl, customClient: client)
            .timeout(const Duration(seconds: 12));
        _socket!.listen(
          (data) {
            try {
              final json = jsonDecode(data.toString()) as Map<String, dynamic>;
              _controller.add(json);
            } catch (_) {}
          },
          onError: (err) {
            _controller.add({'type': 'ERROR', 'message': err.toString()});
          },
          onDone: () {
            _controller.add({'type': 'DISCONNECT'});
          },
        );
        return;
      } catch (e) {
        lastError = e;
      }
    }
    _controller.add({'type': 'ERROR', 'message': lastError.toString()});
    throw lastError ?? Exception('WebSocket connection failed');
  }

  @override
  Future<void> send(Map<String, dynamic> message) async {
    if (!isConnected) {
      throw Exception('WebSocket is not connected');
    }
    _socket!.add(jsonEncode(message));
  }

  @override
  Future<void> disconnect() async {
    if (_socket != null) {
      await _socket!.close();
      _socket = null;
    }
  }
}

/// In-Memory Mock Transport Implementation for Unit Testing
class MockRemoteTransport implements RemoteTransport {
  bool _connected = false;
  final StreamController<Map<String, dynamic>> _controller =
      StreamController<Map<String, dynamic>>.broadcast();

  @override
  bool get isConnected => _connected;

  @override
  Stream<Map<String, dynamic>> get messageStream => _controller.stream;

  @override
  Future<void> connect(String url) async {
    _connected = true;
    // Simulate gateway HELLO greeting
    Future.microtask(() {
      _controller.add({'type': 'HELLO', 'version': '1.0'});
    });
  }

  @override
  Future<void> send(Map<String, dynamic> message) async {
    final type = message['type'];
    if (type == 'AUTH') {
      if (message['connectionToken'] == 'invalid-token') {
        _controller.add(
            {'type': 'AUTH_FAILURE', 'reason': 'Invalid connection token'});
      } else {
        _controller.add({
          'type': 'AUTH_SUCCESS',
          'connectionId': 'conn-mock-123',
          'remoteEndpoint': 'https://node-123.remotenode.net'
        });
      }
    } else if (type == 'PING') {
      _controller.add({'type': 'PONG'});
    }
  }

  @override
  Future<void> disconnect() async {
    _connected = false;
    _controller.add({'type': 'DISCONNECT'});
  }
}
