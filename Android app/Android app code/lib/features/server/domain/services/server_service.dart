import 'package:flutter/services.dart';

/// Abstract Service Contract for Local HTTP File-Server Engine
abstract class ServerService {
  Future<Map<String, dynamic>> startServer({int port = 8080});
  Future<Map<String, dynamic>> stopServer();
  Future<Map<String, dynamic>> restartServer({int port = 8080});
  Future<Map<String, dynamic>> getServerStatus();
  Future<String> getLocalUrl();
  Future<bool> openUrl(String url);
}

/// MethodChannel Platform Implementation targeting Android Kotlin LocalServerEngine
class MethodChannelServerService implements ServerService {
  static const MethodChannel _channel =
      MethodChannel('net.remotenode.fileserver/server_engine');

  @override
  Future<Map<String, dynamic>> startServer({int port = 8080}) async {
    try {
      final res = await _channel
          .invokeMethod<Map<dynamic, dynamic>>('startServer', {'port': port});
      return res != null ? Map<String, dynamic>.from(res) : {'success': false};
    } catch (e) {
      return const MockServerService().startServer(port: port);
    }
  }

  @override
  Future<Map<String, dynamic>> stopServer() async {
    try {
      final res =
          await _channel.invokeMethod<Map<dynamic, dynamic>>('stopServer');
      return res != null ? Map<String, dynamic>.from(res) : {'success': false};
    } catch (e) {
      return const MockServerService().stopServer();
    }
  }

  @override
  Future<Map<String, dynamic>> restartServer({int port = 8080}) async {
    try {
      final res = await _channel
          .invokeMethod<Map<dynamic, dynamic>>('restartServer', {'port': port});
      return res != null ? Map<String, dynamic>.from(res) : {'success': false};
    } catch (e) {
      return const MockServerService().restartServer(port: port);
    }
  }

  @override
  Future<Map<String, dynamic>> getServerStatus() async {
    try {
      final res =
          await _channel.invokeMethod<Map<dynamic, dynamic>>('getServerStatus');
      return res != null
          ? Map<String, dynamic>.from(res)
          : {
              'status': 'STOPPED',
              'port': 8080,
              'localUrl': 'http://127.0.0.1:8080'
            };
    } catch (e) {
      return const MockServerService().getServerStatus();
    }
  }

  @override
  Future<String> getLocalUrl() async {
    try {
      final res = await _channel.invokeMethod<String>('getLocalUrl');
      return res ?? 'http://127.0.0.1:8080';
    } catch (e) {
      return const MockServerService().getLocalUrl();
    }
  }

  @override
  Future<bool> openUrl(String url) async {
    try {
      final res = await _channel.invokeMethod<bool>('openUrl', {'url': url});
      return res ?? false;
    } catch (e) {
      return const MockServerService().openUrl(url);
    }
  }
}

/// Mock Server Service Implementation for Development & Unit Testing
class MockServerService implements ServerService {
  final bool _initiallyRunning;
  final int _port;

  const MockServerService({bool initiallyRunning = false, int port = 8080})
      : _initiallyRunning = initiallyRunning,
        _port = port;

  @override
  Future<Map<String, dynamic>> startServer({int port = 8080}) async {
    await Future.delayed(const Duration(milliseconds: 200));
    return {
      'success': true,
      'port': port,
      'localUrl': 'http://127.0.0.1:$port',
    };
  }

  @override
  Future<Map<String, dynamic>> stopServer() async {
    await Future.delayed(const Duration(milliseconds: 150));
    return {'success': true};
  }

  @override
  Future<Map<String, dynamic>> restartServer({int port = 8080}) async {
    await stopServer();
    return startServer(port: port);
  }

  @override
  Future<Map<String, dynamic>> getServerStatus() async {
    return {
      'status': _initiallyRunning ? 'ONLINE' : 'STOPPED',
      'port': _port,
      'localUrl': 'http://127.0.0.1:$_port',
    };
  }

  @override
  Future<String> getLocalUrl() async {
    return 'http://127.0.0.1:$_port';
  }

  @override
  Future<bool> openUrl(String url) async {
    await Future.delayed(const Duration(milliseconds: 50));
    return true;
  }
}
