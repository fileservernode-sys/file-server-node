import 'dart:async';
import 'dart:convert';
import 'dart:io';
import '../../../../core/config/app_config.dart';
import '../../../../core/utils/logger.dart';
import 'remote_transport.dart';

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
  final String? hostname;
  final String? publicUrl;
  final RemoteConnectionState status;
  final DateTime? lastHeartbeatAt;
  final String? errorMessage;

  const RemoteConnectionInfo({
    this.connectionId,
    this.gatewayHostname,
    this.remoteEndpoint,
    this.hostname,
    this.publicUrl,
    this.status = RemoteConnectionState.disconnected,
    this.lastHeartbeatAt,
    this.errorMessage,
  });

  bool get isConnected => status == RemoteConnectionState.connected;
}

/// Service Interface for Outbound Remote Gateway Connection Management
abstract class RemoteConnectionService {
  Stream<RemoteConnectionInfo> get statusStream;

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

/// Production & Integration Client with Bounded Exponential Backoff Reconnect Engine & Remote Data Plane Handler
class HttpRemoteConnectionService implements RemoteConnectionService {
  final HttpClient _httpClient;
  final String _baseUrl;
  final RemoteTransport _transport;
  final StreamController<RemoteConnectionInfo> _statusController =
      StreamController<RemoteConnectionInfo>.broadcast();

  RemoteConnectionInfo _currentInfo;
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 5;
  Timer? _reconnectTimer;
  Timer? _pingTimer;
  StreamSubscription? _transportSubscription;
  Completer<bool>? _authCompleter;

  String? _lastDeviceId;
  String? _lastSessionToken;
  bool _isExplicitlyDisconnecting = false;

  HttpRemoteConnectionService({
    HttpClient? httpClient,
    String? baseUrl,
    RemoteTransport? transport,
  })  : _httpClient = httpClient ??
            (HttpClient()
              ..badCertificateCallback = (cert, host, port) =>
                  AppConfig.current.environment != 'production'),
        _baseUrl = baseUrl ?? AppConfig.current.apiBaseUrl,
        _transport = transport ?? WebSocketRemoteTransport(),
        _currentInfo = const RemoteConnectionInfo(
            status: RemoteConnectionState.disconnected);

  @override
  Stream<RemoteConnectionInfo> get statusStream => _statusController.stream;

  void _updateInfo(RemoteConnectionInfo info) {
    _currentInfo = info;
    if (!_statusController.isClosed) {
      _statusController.add(info);
    }
  }

  bool _isConnecting = false;

  @override
  Future<RemoteConnectionInfo> connect({
    required String deviceId,
    required String sessionToken,
  }) async {
    if (_isConnecting) {
      AppLogger.info('[RemoteConnection] Connection attempt already in progress, returning current state');
      return _currentInfo;
    }
    _isConnecting = true;
    _reconnectTimer?.cancel();

    try {
      _lastDeviceId = deviceId;
      _lastSessionToken = sessionToken;

      _updateInfo(const RemoteConnectionInfo(status: RemoteConnectionState.connecting));
      AppLogger.info('[RemoteConnection] Initiating connection registration for device: $deviceId');

      int registerAttempts = 0;
      HttpClientResponse? res;
      Map<String, dynamic>? json;

      // Up to 8 attempts with 4s gaps = ~32s window, enough for Render free-tier cold start
      const int maxRegisterAttempts = 8;
      while (registerAttempts < maxRegisterAttempts) {
        registerAttempts++;
        final url = Uri.parse('$_baseUrl/connections/register');
        final req = await _httpClient.postUrl(url);
        req.headers.set('content-type', 'application/json');
        req.headers.set('authorization', 'Bearer $sessionToken');
        req.write(jsonEncode({'deviceId': deviceId}));

        res = await req.close().timeout(const Duration(seconds: 30));
        final bodyStr = await res.transform(utf8.decoder).join();
        try {
          json = jsonDecode(bodyStr) as Map<String, dynamic>;
        } catch (_) {
          json = null;
        }

        AppLogger.info('[RemoteConnection] Registration API result (attempt $registerAttempts/$maxRegisterAttempts): status=${res.statusCode}, success=${json?["success"]}');

        if (res.statusCode == 200 && json != null && json['success'] == true) {
          break;
        }

        if (res.statusCode >= 500 && registerAttempts < maxRegisterAttempts) {
          AppLogger.warning('[RemoteConnection] Database/server warming up (${res.statusCode}), retrying in 4s... ($registerAttempts/$maxRegisterAttempts)');
          await Future.delayed(const Duration(seconds: 4));
        } else {
          break;
        }
      }

      if (res != null && res.statusCode == 200 && json != null && json['success'] == true) {
        final conn = json['data']['connection'];
        final connId = conn['id'] as String?;
        final remoteEp = conn['remoteEndpoint'] as String?;
        final host = conn['hostname'] as String?;
        final pubUrl = conn['publicUrl'] as String? ?? remoteEp;
        final token = conn['connectionToken'] as String? ?? 'mock-token';

        _authCompleter = Completer<bool>();

        // Cancel any old subscription BEFORE connecting the new socket so that
        // the old socket's onDone event never fires into a live listener.
        _transportSubscription?.cancel();
        _transportSubscription = null;

        // Establish Outbound Gateway Transport Connection (ws:// in dev, wss:// in prod)
        bool wsConnected = false;
        try {
          AppLogger.info('[RemoteConnection] Connecting transport to: ${AppConfig.current.gatewayWsUrl}');
          await _transport.connect(AppConfig.current.gatewayWsUrl);
          _setupTransportMessageListener();
          AppLogger.info('[RemoteConnection] Transport connected. Sending AUTH handshake...');
          await _transport.send({
            'type': 'AUTH',
            'connectionToken': token,
            'deviceId': deviceId,
          });

          // Await Gateway AUTH_SUCCESS response with bounded timeout
          final authSuccess = await _authCompleter!.future.timeout(
            const Duration(seconds: 8),
            onTimeout: () {
              AppLogger.warning('[RemoteConnection] Gateway AUTH_SUCCESS timed out after 8s');
              return false;
            },
          );
          wsConnected = authSuccess;
        } catch (e) {
          AppLogger.warning('[RemoteConnection] First transport attempt failed, retrying...', e);
          try {
            await Future.delayed(const Duration(milliseconds: 800));
            _authCompleter = Completer<bool>();
            await _transport.connect(AppConfig.current.gatewayWsUrl);
            _setupTransportMessageListener();
            await _transport.send({
              'type': 'AUTH',
              'connectionToken': token,
              'deviceId': deviceId,
            });
            final authSuccess = await _authCompleter!.future.timeout(
              const Duration(seconds: 8),
              onTimeout: () {
                AppLogger.warning('[RemoteConnection] Retry AUTH_SUCCESS timed out after 8s');
                return false;
              },
            );
            wsConnected = authSuccess;
          } catch (retryErr) {
            AppLogger.error('[RemoteConnection] Retry transport attempt failed', retryErr);
          }
        }

        _reconnectAttempts = 0;
        final newInfo = RemoteConnectionInfo(
          connectionId: connId,
          remoteEndpoint: remoteEp,
          hostname: host,
          publicUrl: pubUrl,
          status: wsConnected ? RemoteConnectionState.connected : RemoteConnectionState.failed,
          lastHeartbeatAt: DateTime.now(),
          errorMessage: wsConnected ? null : 'Failed to authenticate with Remote Gateway',
        );
        AppLogger.info('[RemoteConnection] Updated connection info state to: ${newInfo.status} (connected: ${newInfo.isConnected})');
        _updateInfo(newInfo);

        if (wsConnected) {
          _startPingTimer();
        }
        return _currentInfo;
      }

      final errorMsg = json?['error']?['message'] ??
          'Failed to establish connection token with control plane (${res?.statusCode ?? 500})';
      AppLogger.warning('[RemoteConnection] Registration error: $errorMsg');
      _updateInfo(RemoteConnectionInfo(
        status: RemoteConnectionState.failed,
        errorMessage: errorMsg,
      ));
      return _currentInfo;
    } catch (e) {
      AppLogger.error('[RemoteConnection] Connect network exception', e);
      _updateInfo(RemoteConnectionInfo(
        status: RemoteConnectionState.failed,
        errorMessage: 'Network error connecting to control plane: ${e.toString()}',
      ));
      return _currentInfo;
    } finally {
      _isConnecting = false;
    }
  }

  void _setupTransportMessageListener() {
    _transportSubscription?.cancel();
    _transportSubscription = _transport.messageStream.listen((msg) async {
      final type = msg['type'];
      AppLogger.info('[RemoteConnection] Inbound transport event: $type');
      if (type == 'FILE_REQUEST') {
        await _handleRemoteFileRequest(msg);
      } else if (type == 'FILE_STREAM_CANCEL') {
        _handleStreamCancel(msg);
      } else if (type == 'AUTH_SUCCESS' || type == 'CONNECTED') {
        AppLogger.info('[RemoteConnection] Gateway AUTH_SUCCESS verified!');
        if (_authCompleter != null && !_authCompleter!.isCompleted) {
          _authCompleter!.complete(true);
        }
        _updateInfo(RemoteConnectionInfo(
          connectionId: msg['connectionId'] as String? ?? _currentInfo.connectionId,
          remoteEndpoint: msg['remoteEndpoint'] as String? ?? _currentInfo.remoteEndpoint,
          hostname: _currentInfo.hostname,
          publicUrl: _currentInfo.publicUrl,
          status: RemoteConnectionState.connected,
          lastHeartbeatAt: DateTime.now(),
        ));
      } else if (type == 'AUTH_FAILURE') {
        AppLogger.warning('[RemoteConnection] Gateway AUTH_FAILURE: ${msg['reason']}');
        if (_authCompleter != null && !_authCompleter!.isCompleted) {
          _authCompleter!.complete(false);
        }
        _updateInfo(RemoteConnectionInfo(
          connectionId: _currentInfo.connectionId,
          remoteEndpoint: _currentInfo.remoteEndpoint,
          hostname: _currentInfo.hostname,
          publicUrl: _currentInfo.publicUrl,
          status: RemoteConnectionState.failed,
          errorMessage: msg['reason'] as String? ?? 'Authentication rejected by gateway',
        ));
      } else if (type == 'PONG') {
        AppLogger.info('[RemoteConnection] PONG received from gateway');
        _updateInfo(RemoteConnectionInfo(
          connectionId: _currentInfo.connectionId,
          remoteEndpoint: _currentInfo.remoteEndpoint,
          hostname: _currentInfo.hostname,
          publicUrl: _currentInfo.publicUrl,
          status: _currentInfo.status,
          lastHeartbeatAt: DateTime.now(),
        ));
      } else if (type == 'DISCONNECT' || type == 'ERROR') {
        AppLogger.warning('[RemoteConnection] Transport disconnected / error event: $type');
        if (!_isExplicitlyDisconnecting && _lastDeviceId != null && _lastSessionToken != null && _currentInfo.isConnected) {
          reconnect();
        }
      }
    });
  }

  void _handleStreamCancel(Map<String, dynamic> msg) {
    final transferId = msg['transferId'] as String?;
    if (transferId != null) {
      // Abort active local stream associated with transferId if in progress
    }
  }

  Future<void> _handleRemoteFileRequest(Map<String, dynamic> msg) async {
    final requestId = msg['requestId'] as String?;
    final operation = msg['operation'] as String?;

    if (requestId == null || operation == null) return;

    try {
      if (operation == 'HEALTH') {
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': true,
          'data': {'status': 'ok', 'server': 'remote-node-file-server'}
        });
        return;
      }

      if (operation == 'STORAGE') {
        final localRes = await _executeLocalApiGet('/api/storage');
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? localRes,
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'RECENT') {
        final localRes = await _executeLocalApiGet('/api/files/recent');
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? localRes,
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'PHOTOS') {
        final localRes = await _executeLocalApiGet('/api/files?type=photos');
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? localRes,
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'VIDEOS') {
        final localRes = await _executeLocalApiGet('/api/files?type=videos');
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? localRes,
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'DOCUMENTS') {
        final localRes = await _executeLocalApiGet('/api/files?type=documents');
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? localRes,
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'LIST') {
        final path = msg['path'] as String? ?? '/';
        final type = msg['type_filter'] as String?;
        final queryParam = type != null
            ? '?path=${Uri.encodeComponent(path)}&type=$type'
            : '?path=${Uri.encodeComponent(path)}';
        final localRes = await _executeLocalApiGet('/api/files$queryParam');
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? localRes,
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'CREATE_FOLDER') {
        final path = msg['path'] as String? ?? '/';
        final name = msg['name'] as String? ?? 'New Folder';
        final localRes = await _executeLocalApiPost(
            '/api/folders', {'path': path, 'name': name});
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? {},
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'RENAME') {
        final oldPath = msg['oldPath'] as String? ?? '/';
        final newName = msg['newName'] as String? ?? 'renamed';
        final localRes = await _executeLocalApiPost(
            '/api/rename', {'oldPath': oldPath, 'newName': newName});
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? {},
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'DELETE') {
        final path = msg['path'] as String? ?? '/';
        final localRes =
            await _executeLocalApiDelete('/api/files', {'path': path});
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': localRes['success'] ?? true,
          'data': localRes['data'] ?? {},
          'error': localRes['error']
        });
        return;
      }

      if (operation == 'UPLOAD') {
        final path = msg['path'] as String? ?? '/';
        final name = msg['name'] as String? ?? 'file.dat';
        final dataBase64 = msg['dataBase64'] as String?;

        if (dataBase64 != null) {
          try {
            final bytes = base64Decode(dataBase64);
            final req = await _httpClient.postUrl(
              Uri.parse('http://127.0.0.1:8080/api/upload?path=${Uri.encodeComponent(path)}&filename=${Uri.encodeComponent(name)}')
            );
            req.headers.set('content-type', 'application/octet-stream');
            req.add(bytes);
            final res = await req.close().timeout(const Duration(seconds: 120));
            final body = await res.transform(utf8.decoder).join();
            final jsonRes = jsonDecode(body) as Map<String, dynamic>;

            await _transport.send({
              'type': 'FILE_RESPONSE',
              'requestId': requestId,
              'success': jsonRes['success'] ?? true,
              'data': jsonRes['data'] ?? {},
              'error': jsonRes['error']
            });
            return;
          } catch (err) {
            await _transport.send({
              'type': 'FILE_RESPONSE',
              'requestId': requestId,
              'success': false,
              'error': {'code': 'UPLOAD_FAILED', 'message': err.toString()}
            });
            return;
          }
        }
      }

      if (operation == 'DOWNLOAD') {
        var path = msg['path'] as String? ?? '/';
        try {
          while (path.startsWith('/') || path.startsWith('\\')) {
            path = path.substring(1);
          }
          final req = await _httpClient.getUrl(
            Uri.parse('http://127.0.0.1:8080/api/download?path=${Uri.encodeComponent(path)}')
          );
          final res = await req.close().timeout(const Duration(seconds: 120));
          if (res.statusCode != 200 && res.statusCode != 206) {
            final errorBody = await res.transform(utf8.decoder).join();
            await _transport.send({
              'type': 'FILE_RESPONSE',
              'requestId': requestId,
              'success': false,
              'error': {'code': 'DOWNLOAD_HTTP_ERROR', 'message': 'Local server returned HTTP ${res.statusCode}: $errorBody'}
            });
            return;
          }
          final bytes = await res.fold<List<int>>(<int>[], (previous, element) => previous..addAll(element));
          final dataBase64 = base64Encode(bytes);
          final filename = path.split('/').lastWhere((element) => element.isNotEmpty, orElse: () => 'download');
          final mimeType = res.headers.value('content-type') ?? 'application/octet-stream';

          await _transport.send({
            'type': 'FILE_RESPONSE',
            'requestId': requestId,
            'success': true,
            'filename': filename,
            'mimeType': mimeType,
            'dataBase64': dataBase64
          });
          return;
        } catch (err) {
          await _transport.send({
            'type': 'FILE_RESPONSE',
            'requestId': requestId,
            'success': false,
            'error': {'code': 'DOWNLOAD_FAILED', 'message': err.toString()}
          });
          return;
        }
      }

      // Default fallback for unknown operation
      await _transport.send({
        'type': 'FILE_RESPONSE',
        'requestId': requestId,
        'success': true,
        'data': {'items': []}
      });
    } catch (e) {
      await _transport.send({
        'type': 'FILE_RESPONSE',
        'requestId': requestId,
        'success': false,
        'error': {'code': 'PROCESSING_ERROR', 'message': e.toString()}
      });
    }
  }

  Future<Map<String, dynamic>> _executeLocalApiGet(String pathQuery) async {
    try {
      final req = await _httpClient
          .getUrl(Uri.parse('http://127.0.0.1:8080$pathQuery'));
      final res = await req.close().timeout(const Duration(seconds: 5));
      final body = await res.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {
        'success': false,
        'error': {
          'code': 'LOCAL_ENGINE_UNAVAILABLE',
          'message': 'Failed to communicate with Android storage engine: ${e.toString()}'
        }
      };
    }
  }

  Future<Map<String, dynamic>> _executeLocalApiPost(
      String path, Map<String, dynamic> payload) async {
    try {
      final req =
          await _httpClient.postUrl(Uri.parse('http://127.0.0.1:8080$path'));
      req.headers.set('content-type', 'application/json');
      req.write(jsonEncode(payload));
      final res = await req.close().timeout(const Duration(seconds: 5));
      final body = await res.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {
        'success': false,
        'error': {
          'code': 'LOCAL_ENGINE_UNAVAILABLE',
          'message': 'Failed to communicate with Android storage engine: ${e.toString()}'
        }
      };
    }
  }

  Future<Map<String, dynamic>> _executeLocalApiDelete(
      String path, Map<String, dynamic> payload) async {
    try {
      final req = await _httpClient.openUrl(
          'DELETE', Uri.parse('http://127.0.0.1:8080$path'));
      req.headers.set('content-type', 'application/json');
      req.write(jsonEncode(payload));
      final res = await req.close().timeout(const Duration(seconds: 5));
      final body = await res.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {
        'success': false,
        'error': {
          'code': 'LOCAL_ENGINE_UNAVAILABLE',
          'message': 'Failed to communicate with Android storage engine: ${e.toString()}'
        }
      };
    }
  }

  @override
  Future<RemoteConnectionInfo> disconnect({
    required String connectionId,
    required String sessionToken,
  }) async {
    _isExplicitlyDisconnecting = true;
    _pingTimer?.cancel();
    _reconnectTimer?.cancel();
    _transportSubscription?.cancel();
    _currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.disconnected);

    try {
      await _transport.send({'type': 'DISCONNECT'});
      await _transport.disconnect();
    } catch (e) {
      // Ignore transport errors during disconnect
    }

    try {
      final url = Uri.parse('$_baseUrl/connections/$connectionId/disconnect');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');
      req.write(jsonEncode({}));
      await req.close().timeout(const Duration(seconds: 3));
    } catch (e) {
      // Ignore backend HTTP errors during disconnect
    }

    _isExplicitlyDisconnecting = false;
    return _currentInfo;
  }

  @override
  Future<RemoteConnectionInfo> reconnect() async {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      _currentInfo = const RemoteConnectionInfo(
        status: RemoteConnectionState.failed,
        errorMessage:
            'Maximum reconnect attempts reached. Transport connection failed.',
      );
      return _currentInfo;
    }

    _reconnectAttempts++;
    _currentInfo =
        const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting);

    // Exponential Backoff: 1s, 2s, 4s, 8s, 16s (max 30s)
    final delaySeconds = (1 << (_reconnectAttempts - 1)).clamp(1, 30);
    await Future.delayed(Duration(seconds: delaySeconds));

    final devId = _lastDeviceId;
    final token = _lastSessionToken;
    if (devId != null && token != null && token.isNotEmpty) {
      return connect(deviceId: devId, sessionToken: token);
    }

    _currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.disconnected);
    return _currentInfo;
  }

  void _startPingTimer() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 15), (_) async {
      if (_currentInfo.isConnected) {
        try {
          await _transport.send(const PingMessage().toJson());
        } catch (e) {
          reconnect();
        }
      }
    });
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
  Stream<RemoteConnectionInfo> get statusStream => const Stream.empty();

  @override
  Future<RemoteConnectionInfo> connect({
    required String deviceId,
    required String sessionToken,
  }) async {
    await Future.delayed(const Duration(milliseconds: 100));
    return RemoteConnectionInfo(
      connectionId: 'mock-conn-999',
      gatewayHostname: 'gateway.viewduration.com',
      remoteEndpoint: 'https://srv_mock999.gateway.viewduration.com',
      hostname: 'srv_mock999.gateway.viewduration.com',
      publicUrl: 'https://srv_mock999.gateway.viewduration.com',
      status: RemoteConnectionState.connected,
      lastHeartbeatAt: DateTime.now(),
    );
  }

  @override
  Future<RemoteConnectionInfo> disconnect({
    required String connectionId,
    required String sessionToken,
  }) async {
    await Future.delayed(const Duration(milliseconds: 50));
    return const RemoteConnectionInfo(
        status: RemoteConnectionState.disconnected);
  }

  @override
  Future<RemoteConnectionInfo> reconnect() async {
    await Future.delayed(const Duration(milliseconds: 50));
    return RemoteConnectionInfo(
      connectionId: 'mock-conn-999',
      gatewayHostname: 'gateway.viewduration.com',
      remoteEndpoint: 'https://srv_mock999.gateway.viewduration.com',
      hostname: 'srv_mock999.gateway.viewduration.com',
      publicUrl: 'https://srv_mock999.gateway.viewduration.com',
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
      gatewayHostname: 'gateway.viewduration.com',
      remoteEndpoint: 'https://srv_mock999.gateway.viewduration.com',
      hostname: 'srv_mock999.gateway.viewduration.com',
      publicUrl: 'https://srv_mock999.gateway.viewduration.com',
      status: _initialState,
      lastHeartbeatAt: DateTime.now(),
    );
  }
}
