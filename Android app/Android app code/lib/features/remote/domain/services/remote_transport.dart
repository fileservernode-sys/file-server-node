import 'dart:async';
import 'dart:convert';
import 'dart:io';
import '../../../../core/config/app_config.dart';
import '../../../../core/utils/logger.dart';

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
  StreamSubscription? _socketSubscription;
  int _socketGeneration = 0;
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
    final currentSocketGen = ++_socketGeneration;

    // Validate endpoint format and environment constraints
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme || (uri.scheme != 'ws' && uri.scheme != 'wss')) {
      throw ArgumentError('Invalid WebSocket gateway URL: $url. Scheme must be ws:// or wss://');
    }

    if (AppConfig.current.environment == 'production' && uri.scheme != 'wss') {
      throw StateError('Insecure ws:// protocol is strictly forbidden in production mode. Target URL: $url');
    }

    try {
      AppLogger.info('[WebSocketTransport] Connecting to gateway endpoint: $url (generation: $currentSocketGen)');
      final client = HttpClient();
      if (AppConfig.current.environment != 'production') {
        client.badCertificateCallback = (cert, host, port) => true;
      }

      final socket = await WebSocket.connect(url, customClient: client)
          .timeout(const Duration(seconds: 12));

      if (currentSocketGen != _socketGeneration) {
        AppLogger.info('[WebSocketTransport] Socket connection superseded by newer generation ($currentSocketGen != $_socketGeneration)');
        try {
          await socket.close();
        } catch (_) {}
        return;
      }

      _socket = socket;
      // Active transport-level ping interval: keep NAT routers, mobile carrier APNs,
      // and intermediate reverse proxy WebSocket connections alive without silent TCP timeouts
      _socket!.pingInterval = const Duration(seconds: 10);

      AppLogger.info('[WebSocketTransport] Connected successfully to: $url (gen: $currentSocketGen)');
      _socketSubscription = _socket!.listen(
        (data) {
          if (currentSocketGen != _socketGeneration) return;
          try {
            final json = jsonDecode(data.toString()) as Map<String, dynamic>;
            AppLogger.info('[WebSocketTransport] Inbound message: ${json['type']}');
            _controller.add(json);
          } catch (_) {}
        },
        onError: (err) {
          if (currentSocketGen != _socketGeneration) return;
          AppLogger.warning('[WebSocketTransport] Socket error from $url', err);
          _controller.add({'type': 'ERROR', 'message': err.toString()});
        },
        onDone: () {
          if (currentSocketGen != _socketGeneration) return;
          AppLogger.info('[WebSocketTransport] Socket closed / onDone from $url');
          _controller.add({'type': 'DISCONNECT'});
        },
        cancelOnError: false,
      );
    } catch (e) {
      AppLogger.warning('[WebSocketTransport] Failed connecting to $url', e);
      if (currentSocketGen == _socketGeneration) {
        _controller.add({'type': 'ERROR', 'message': e.toString()});
      }
      rethrow;
    }
  }

  @override
  Future<void> send(Map<String, dynamic> message) async {
    if (!isConnected) {
      AppLogger.warning('[WebSocketTransport] Send failed: socket is not connected');
      throw Exception('WebSocket is not connected');
    }
    AppLogger.info('[WebSocketTransport] Outbound message: ${message['type']}');
    _socket!.add(jsonEncode(message));
  }

  @override
  Future<void> disconnect() async {
    _socketGeneration++;
    if (_socketSubscription != null) {
      try {
        await _socketSubscription!.cancel();
      } catch (_) {}
      _socketSubscription = null;
    }
    if (_socket != null) {
      AppLogger.info('[WebSocketTransport] Disconnecting socket');
      try {
        await _socket!.close();
      } catch (_) {}
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
