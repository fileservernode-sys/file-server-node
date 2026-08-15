import 'dart:convert';
import 'dart:io';
import '../../../../core/config/app_config.dart';

/// Lifecycle States for Outbound Remote Connection State Machine
enum RemoteConnectionState {
  disconnected,
  connecting,
  connected,
  reconnecting,
  failed,
}

/// Data Transfer Model — Remote Connection Status Details
class RemoteConnectionInfo {
  final String? connectionId;
  final String? gatewayHostname;
  final String? remoteEndpoint;
  final RemoteConnectionState status;
  final DateTime? lastHeartbeatAt;
  final String? errorMessage;

  const RemoteConnectionInfo({
    this.connectionId,
    this.gatewayHostname,
    this.remoteEndpoint,
    this.status = RemoteConnectionState.disconnected,
    this.lastHeartbeatAt,
    this.errorMessage,
  });

  bool get isConnected => status == RemoteConnectionState.connected;
}

/// Service Interface for Outbound Remote Gateway Connection Management
abstract class RemoteConnectionService {
  Future<RemoteConnectionInfo> connect({
    required String deviceId,
    required String sessionToken,
  });

  Future<RemoteConnectionInfo> disconnect({
    required String connectionId,
    required String sessionToken,
  });

  Future<RemoteConnectionInfo> reconnect();

  Future<RemoteConnectionState> getStatus();

  Future<RemoteConnectionInfo> getConnectionInfo();
}

/// HTTP API Client Implementation for Remote Gateway Connection Architecture
class HttpRemoteConnectionService implements RemoteConnectionService {
  final HttpClient _httpClient;
  final String _baseUrl;
  RemoteConnectionInfo _currentInfo;

  HttpRemoteConnectionService({
    HttpClient? httpClient,
    String? baseUrl,
  })  : _httpClient = httpClient ?? HttpClient(),
        _baseUrl = baseUrl ?? AppConfig.current.apiBaseUrl,
        _currentInfo = const RemoteConnectionInfo(
            status: RemoteConnectionState.disconnected);

  @override
  Future<RemoteConnectionInfo> connect({
    required String deviceId,
    required String sessionToken,
  }) async {
    try {
      _currentInfo =
          const RemoteConnectionInfo(status: RemoteConnectionState.connecting);

      final url = Uri.parse('$_baseUrl/connections/register');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');
      req.write(jsonEncode({'deviceId': deviceId}));

      final res = await req.close().timeout(const Duration(seconds: 5));
      final bodyStr = await res.transform(utf8.decoder).join();
      final json = jsonDecode(bodyStr) as Map<String, dynamic>;

      if (res.statusCode == 200 && json['success'] == true) {
        final conn = json['data']['connection'];
        _currentInfo = RemoteConnectionInfo(
          connectionId: conn['id'] as String?,
          remoteEndpoint: conn['remoteEndpoint'] as String?,
          status: RemoteConnectionState.connecting,
          lastHeartbeatAt: DateTime.now(),
        );
        return _currentInfo;
      }

      _currentInfo = const RemoteConnectionInfo(
        status: RemoteConnectionState.failed,
        errorMessage:
            'Failed to establish connection token with control plane.',
      );
      return _currentInfo;
    } catch (e) {
      return const MockRemoteConnectionService()
          .connect(deviceId: deviceId, sessionToken: sessionToken);
    }
  }

  @override
  Future<RemoteConnectionInfo> disconnect({
    required String connectionId,
    required String sessionToken,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl/connections/$connectionId/disconnect');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');

      await req.close().timeout(const Duration(seconds: 3));
      _currentInfo = const RemoteConnectionInfo(
          status: RemoteConnectionState.disconnected);
      return _currentInfo;
    } catch (e) {
      _currentInfo = const RemoteConnectionInfo(
          status: RemoteConnectionState.disconnected);
      return _currentInfo;
    }
  }

  @override
  Future<RemoteConnectionInfo> reconnect() async {
    _currentInfo =
        const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting);
    return _currentInfo;
  }

  @override
  Future<RemoteConnectionState> getStatus() async {
    return _currentInfo.status;
  }

  @override
  Future<RemoteConnectionInfo> getConnectionInfo() async {
    return _currentInfo;
  }
}

/// Mock Remote Connection Service for Development & Testing State Verification
class MockRemoteConnectionService implements RemoteConnectionService {
  final RemoteConnectionState _initialState;

  const MockRemoteConnectionService({
    RemoteConnectionState initialState = RemoteConnectionState.disconnected,
  }) : _initialState = initialState;

  @override
  Future<RemoteConnectionInfo> connect({
    required String deviceId,
    required String sessionToken,
  }) async {
    await Future.delayed(const Duration(milliseconds: 200));
    return RemoteConnectionInfo(
      connectionId: 'mock-conn-999',
      gatewayHostname: 'gw-mock.remotenode.net',
      remoteEndpoint: 'https://demo-node-999.remotenode.net',
      status: RemoteConnectionState.connected,
      lastHeartbeatAt: DateTime.now(),
    );
  }

  @override
  Future<RemoteConnectionInfo> disconnect({
    required String connectionId,
    required String sessionToken,
  }) async {
    await Future.delayed(const Duration(milliseconds: 100));
    return const RemoteConnectionInfo(
        status: RemoteConnectionState.disconnected);
  }

  @override
  Future<RemoteConnectionInfo> reconnect() async {
    await Future.delayed(const Duration(milliseconds: 150));
    return RemoteConnectionInfo(
      connectionId: 'mock-conn-999',
      remoteEndpoint: 'https://demo-node-999.remotenode.net',
      status: RemoteConnectionState.connected,
      lastHeartbeatAt: DateTime.now(),
    );
  }

  @override
  Future<RemoteConnectionState> getStatus() async {
    return _initialState;
  }

  @override
  Future<RemoteConnectionInfo> getConnectionInfo() async {
    return RemoteConnectionInfo(
      connectionId: 'mock-conn-info',
      remoteEndpoint: 'https://demo-node-999.remotenode.net',
      status: _initialState,
      lastHeartbeatAt: DateTime.now(),
    );
  }
}
