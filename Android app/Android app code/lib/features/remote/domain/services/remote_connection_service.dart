import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
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

  final Random _random = Random();
  RemoteConnectionInfo _currentInfo;
  int _reconnectAttempts = 0;
  Timer? _reconnectTimer;
  Timer? _pingTimer;
  StreamSubscription? _transportSubscription;
  Completer<bool>? _authCompleter;

  int _connectionGeneration = 0;
  int _missedPings = 0;
  DateTime? _lastPongReceivedAt;

  String? _lastDeviceId;
  String? _lastSessionToken;
  bool _isExplicitlyDisconnecting = false;
  bool _isReconnecting = false;

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
    _isExplicitlyDisconnecting = false;
    _reconnectTimer?.cancel();
    final currentGen = ++_connectionGeneration;

    try {
      _lastDeviceId = deviceId;
      _lastSessionToken = sessionToken;

      _updateInfo(const RemoteConnectionInfo(status: RemoteConnectionState.connecting));
      AppLogger.info('[RemoteConnection] Initiating connection registration for device: $deviceId (generation: $currentGen)');

      int registerAttempts = 0;
      HttpClientResponse? res;
      Map<String, dynamic>? json;

      // Up to 8 attempts with 4s gaps = ~32s window, enough for Render free-tier cold start
      const int maxRegisterAttempts = 8;
      while (registerAttempts < maxRegisterAttempts && currentGen == _connectionGeneration) {
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

      if (currentGen != _connectionGeneration) {
        AppLogger.info('[RemoteConnection] Connection attempt superseded by newer generation ($currentGen != $_connectionGeneration)');
        return _currentInfo;
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
          _setupTransportMessageListener(currentGen);
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
            if (currentGen == _connectionGeneration) {
              _authCompleter = Completer<bool>();
              await _transport.connect(AppConfig.current.gatewayWsUrl);
              _setupTransportMessageListener(currentGen);
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
            }
          } catch (retryErr) {
            AppLogger.error('[RemoteConnection] Retry transport attempt failed', retryErr);
          }
        }

        if (currentGen != _connectionGeneration) {
          AppLogger.info('[RemoteConnection] Connection generation superseded during auth handshake');
          return _currentInfo;
        }

        _reconnectAttempts = 0;
        _missedPings = 0;
        _lastPongReceivedAt = DateTime.now();

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

      if (res?.statusCode == 401) {
        const sessionMsg = 'Platform session expired (24h). Please sign in again.';
        AppLogger.warning('[RemoteConnection] 24h Platform session expired (401)');
        _updateInfo(const RemoteConnectionInfo(
          status: RemoteConnectionState.failed,
          errorMessage: sessionMsg,
        ));
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

  void _setupTransportMessageListener(int generation) {
    _transportSubscription?.cancel();
    _transportSubscription = _transport.messageStream.listen((msg) async {
      if (generation != _connectionGeneration) {
        return;
      }
      final type = msg['type'];
      AppLogger.info('[RemoteConnection] Inbound transport event: $type (gen: $generation)');
      if (type == 'FILE_REQUEST') {
        await _handleRemoteFileRequest(msg);
      } else if (type == 'FILE_STREAM_CANCEL') {
        _handleStreamCancel(msg);
      } else if (type == 'AUTH_SUCCESS' || type == 'CONNECTED') {
        AppLogger.info('[RemoteConnection] Gateway AUTH_SUCCESS verified!');
        if (_authCompleter != null && !_authCompleter!.isCompleted) {
          _authCompleter!.complete(true);
        }
        _missedPings = 0;
        _lastPongReceivedAt = DateTime.now();
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
        _missedPings = 0;
        _lastPongReceivedAt = DateTime.now();
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
        if (_isExplicitlyDisconnecting) {
          _updateInfo(const RemoteConnectionInfo(status: RemoteConnectionState.disconnected));
        } else {
          _updateInfo(const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting));
          if (_lastDeviceId != null && _lastSessionToken != null) {
            reconnect();
          }
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
        final isSuccess = localRes['success'] == true ||
            (localRes['success'] == null && localRes['error'] == null);
        await _transport.send({
          'type': 'FILE_RESPONSE',
          'requestId': requestId,
          'success': isSuccess,
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
            req.contentLength = bytes.length;
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
    _isReconnecting = false;
    _isConnecting = false;
    ++_connectionGeneration;
    _pingTimer?.cancel();
    _pingTimer = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _transportSubscription?.cancel();
    _transportSubscription = null;
    _reconnectAttempts = 0;
    _currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.disconnected);
    _updateInfo(_currentInfo);

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
    if (_isReconnecting || _isConnecting) {
      AppLogger.info('[RemoteConnection] Reconnect/Connect already active, deduplicating call');
      return _currentInfo;
    }

    _reconnectTimer?.cancel();
    final currentGen = ++_connectionGeneration;
    _reconnectAttempts++;
    _updateInfo(const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting));

    // Bounded Exponential Backoff: 1s, 2s, 4s, 8s, 16s, 30s, capped at max 60s
    final baseDelaySec = (1 << (_reconnectAttempts - 1).clamp(0, 6)).clamp(1, 60);
    // Bounded random jitter: up to 20% (min 50ms, max 2000ms)
    final jitterMs = _random.nextInt((baseDelaySec * 200).clamp(50, 2000));
    final delay = Duration(seconds: baseDelaySec, milliseconds: jitterMs);

    AppLogger.info('[RemoteConnection] Scheduling reconnect attempt $_reconnectAttempts after ${delay.inMilliseconds}ms (generation: $currentGen)');
    _isReconnecting = true;
    try {
      await Future.delayed(delay);
      if (currentGen != _connectionGeneration || _isExplicitlyDisconnecting) {
        AppLogger.info('[RemoteConnection] Reconnect superseded by generation $_connectionGeneration or explicit disconnect');
        return _currentInfo;
      }

      final devId = _lastDeviceId;
      final token = _lastSessionToken;
      if (devId != null && token != null && token.isNotEmpty && !_isExplicitlyDisconnecting) {
        return await connect(deviceId: devId, sessionToken: token);
      }
    } finally {
      _isReconnecting = false;
    }

    _currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.disconnected);
    _updateInfo(_currentInfo);
    return _currentInfo;
  }

  void _startPingTimer() {
    _pingTimer?.cancel();
    _missedPings = 0;
    _lastPongReceivedAt = DateTime.now();

    _pingTimer = Timer.periodic(const Duration(seconds: 15), (_) async {
      if (_currentInfo.isConnected) {
        // Silent liveness check: if missed >= 2 pings or last pong older than 35s
        if (_missedPings >= 2 ||
            (_lastPongReceivedAt != null &&
                DateTime.now().difference(_lastPongReceivedAt!).inSeconds > 35)) {
          AppLogger.warning('[RemoteConnection] Silent heartbeat loss detected (>35s without PONG). Triggering reconnect.');
          _updateInfo(const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting));
          try {
            await _transport.disconnect();
          } catch (_) {}
          reconnect();
          return;
        }

        try {
          await _transport.send(const PingMessage().toJson());
          _missedPings++;
        } catch (e) {
          _updateInfo(const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting));
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
  final StreamController<RemoteConnectionInfo> _statusController =
      StreamController<RemoteConnectionInfo>.broadcast();
  RemoteConnectionInfo _currentInfo;

  int reconnectAttempts = 0;
  int connectionGeneration = 0;
  bool isPingTimerActive = false;
  bool simulateSessionExpired = false;
  bool simulateHeartbeatTimeout = false;
  Duration simulatedBackoffDelay = Duration.zero;

  MockRemoteConnectionService({
    RemoteConnectionState initialState = RemoteConnectionState.disconnected,
  }) : _currentInfo = RemoteConnectionInfo(status: initialState);

  @override
  Stream<RemoteConnectionInfo> get statusStream => _statusController.stream;

  void emitStatus(RemoteConnectionInfo info) {
    _currentInfo = info;
    if (!_statusController.isClosed) {
      _statusController.add(info);
    }
  }

  @override
  Future<RemoteConnectionInfo> connect({
    required String deviceId,
    required String sessionToken,
  }) async {
    connectionGeneration++;
    if (simulateSessionExpired) {
      const expiredInfo = RemoteConnectionInfo(
        status: RemoteConnectionState.failed,
        errorMessage: 'Platform session expired (24h). Please sign in again.',
      );
      emitStatus(expiredInfo);
      return expiredInfo;
    }

    emitStatus(const RemoteConnectionInfo(status: RemoteConnectionState.connecting));
    if (simulatedBackoffDelay > Duration.zero) {
      await Future.delayed(simulatedBackoffDelay);
    } else {
      await Future.delayed(const Duration(milliseconds: 20));
    }

    reconnectAttempts = 0;
    isPingTimerActive = true;
    final info = RemoteConnectionInfo(
      connectionId: 'mock-conn-999',
      gatewayHostname: 'gateway.zdexcloud.com',
      remoteEndpoint: 'https://srv_mock999.gateway.zdexcloud.com',
      hostname: 'srv_mock999.gateway.zdexcloud.com',
      publicUrl: 'https://srv_mock999.gateway.zdexcloud.com',
      status: RemoteConnectionState.connected,
      lastHeartbeatAt: DateTime.now(),
    );
    emitStatus(info);
    return info;
  }

  @override
  Future<RemoteConnectionInfo> disconnect({
    required String connectionId,
    required String sessionToken,
  }) async {
    connectionGeneration++;
    isPingTimerActive = false;
    reconnectAttempts = 0;
    await Future.delayed(const Duration(milliseconds: 10));
    const info = RemoteConnectionInfo(status: RemoteConnectionState.disconnected);
    emitStatus(info);
    return info;
  }

  @override
  Future<RemoteConnectionInfo> reconnect() async {
    reconnectAttempts++;
    connectionGeneration++;
    emitStatus(const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting));

    if (simulateSessionExpired) {
      const expiredInfo = RemoteConnectionInfo(
        status: RemoteConnectionState.failed,
        errorMessage: 'Platform session expired (24h). Please sign in again.',
      );
      emitStatus(expiredInfo);
      return expiredInfo;
    }

    if (simulatedBackoffDelay > Duration.zero) {
      await Future.delayed(simulatedBackoffDelay);
    } else {
      await Future.delayed(const Duration(milliseconds: 20));
    }

    isPingTimerActive = true;
    final info = RemoteConnectionInfo(
      connectionId: 'mock-conn-999',
      gatewayHostname: 'gateway.zdexcloud.com',
      remoteEndpoint: 'https://srv_mock999.gateway.zdexcloud.com',
      hostname: 'srv_mock999.gateway.zdexcloud.com',
      publicUrl: 'https://srv_mock999.gateway.zdexcloud.com',
      status: RemoteConnectionState.connected,
      lastHeartbeatAt: DateTime.now(),
    );
    emitStatus(info);
    return info;
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
