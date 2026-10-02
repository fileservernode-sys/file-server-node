import 'dart:async';
import 'package:flutter/services.dart';
import '../../../../core/config/app_config.dart';
import '../../../../core/utils/logger.dart';

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

  void dispose();
}

/// Native Platform Implementation delegating persistent WebSocket tunnel ownership to Android Foreground Service & RemoteNodeTunnelManager
class NativeRemoteConnectionService implements RemoteConnectionService {
  static const MethodChannel _methodChannel =
      MethodChannel('net.remotenode.fileserver/server_engine');
  static const EventChannel _eventChannel =
      EventChannel('net.remotenode.fileserver/tunnel_events');

  final StreamController<RemoteConnectionInfo> _statusController =
      StreamController<RemoteConnectionInfo>.broadcast();
  StreamSubscription? _eventSubscription;
  Timer? _reconciliationTimer;
  int _reconciliationPollCount = 0;
  static const int _maxReconciliationPolls = 60; // Max 60 seconds of transitional polling

  RemoteConnectionInfo _currentInfo = const RemoteConnectionInfo(
    status: RemoteConnectionState.disconnected,
  );

  NativeRemoteConnectionService() {
    _initEventListener();
  }

  @override
  Stream<RemoteConnectionInfo> get statusStream => _statusController.stream;

  void _initEventListener() {
    try {
      _eventSubscription = _eventChannel.receiveBroadcastStream().listen(
        (dynamic event) {
          if (event is Map) {
            final map = Map<String, dynamic>.from(event);
            final info = _parseNativeInfo(map);
            _applyStateUpdate(info, source: 'EventChannel');
          }
        },
        onError: (err) {
          AppLogger.warning('[NativeRemoteConnection] EventChannel error: $err');
          _startReconciliation();
        },
      );
    } catch (e) {
      AppLogger.warning('[NativeRemoteConnection] Failed to bind EventChannel: $e');
      _startReconciliation();
    }
  }

  void _applyStateUpdate(RemoteConnectionInfo info, {required String source}) {
    final changed = _shouldUpdateInfo(info);
    if (changed) {
      _currentInfo = info;
      AppLogger.info('[NativeRemoteConnection] State update via $source: ${info.status} (endpoint: ${info.remoteEndpoint})');
      if (!_statusController.isClosed) {
        _statusController.add(info);
      }
    }

    if (_isTerminalState(info.status)) {
      _stopReconciliation();
    } else {
      _startReconciliation();
    }
  }

  bool _isTerminalState(RemoteConnectionState state) {
    return state == RemoteConnectionState.connected ||
        state == RemoteConnectionState.failed ||
        state == RemoteConnectionState.disconnected;
  }

  bool _shouldUpdateInfo(RemoteConnectionInfo newInfo) {
    if (_currentInfo.status != newInfo.status) return true;
    if (_currentInfo.connectionId != newInfo.connectionId) return true;
    if (_currentInfo.remoteEndpoint != newInfo.remoteEndpoint) return true;
    if (_currentInfo.hostname != newInfo.hostname) return true;
    if (_currentInfo.publicUrl != newInfo.publicUrl) return true;
    if (_currentInfo.errorMessage != newInfo.errorMessage) return true;
    return false;
  }

  void _startReconciliation() {
    if (_reconciliationTimer != null && _reconciliationTimer!.isActive) {
      return;
    }
    _reconciliationPollCount = 0;
    _reconciliationTimer = Timer.periodic(const Duration(seconds: 1), (timer) async {
      _reconciliationPollCount++;
      if (_statusController.isClosed || _reconciliationPollCount > _maxReconciliationPolls) {
        _stopReconciliation();
        return;
      }

      try {
        final res = await _methodChannel.invokeMethod<Map<dynamic, dynamic>>('getTunnelStatus');
        if (res != null) {
          final info = _parseNativeInfo(Map<String, dynamic>.from(res));
          _applyStateUpdate(info, source: 'ReconciliationPoll');
        }
      } catch (e) {
        // Communication error or method channel busy; keep timer active until terminal state or max polls
      }
    });
  }

  void _stopReconciliation() {
    _reconciliationTimer?.cancel();
    _reconciliationTimer = null;
    _reconciliationPollCount = 0;
  }

  RemoteConnectionInfo _parseNativeInfo(Map<String, dynamic> map) {
    final nativeState = (map['state'] as String? ?? 'STOPPED').toUpperCase();
    final connId = map['connectionId'] as String?;
    final remoteEp = map['remoteEndpoint'] as String?;
    final host = map['hostname'] as String?;
    final pubUrl = map['publicUrl'] as String? ?? remoteEp;
    final errMsg = map['errorMessage'] as String?;
    final lastHbMs = map['lastHeartbeatAt'] as int?;

    RemoteConnectionState status;
    switch (nativeState) {
      case 'CONNECTED':
        status = RemoteConnectionState.connected;
        break;
      case 'CONNECTING':
      case 'AUTHENTICATING':
      case 'STARTING':
        status = RemoteConnectionState.connecting;
        break;
      case 'RECONNECTING':
      case 'NETWORK_UNAVAILABLE':
        status = RemoteConnectionState.reconnecting;
        break;
      case 'AUTH_FAILED':
      case 'ERROR':
        status = RemoteConnectionState.failed;
        break;
      case 'STOPPED':
      default:
        status = RemoteConnectionState.disconnected;
        break;
    }

    return RemoteConnectionInfo(
      connectionId: connId,
      remoteEndpoint: remoteEp,
      hostname: host,
      publicUrl: pubUrl,
      status: status,
      lastHeartbeatAt: lastHbMs != null ? DateTime.fromMillisecondsSinceEpoch(lastHbMs) : null,
      errorMessage: errMsg,
    );
  }

  @override
  Future<RemoteConnectionInfo> connect({
    required String deviceId,
    required String sessionToken,
  }) async {
    // Defensive guard: if already actively connecting or connected, return current status without dispatching duplicate MethodChannel start
    if (_currentInfo.status == RemoteConnectionState.connecting ||
        _currentInfo.status == RemoteConnectionState.connected) {
      AppLogger.info('[NativeRemoteConnection] Already in ${_currentInfo.status.name} state, skipping redundant startTunnel dispatch');
      return _currentInfo;
    }

    try {
      AppLogger.info('[NativeRemoteConnection] Requesting native tunnel start for device: $deviceId');
      final cred = await FileSecureStorageService().read(key: 'device_credential');
      final res = await _methodChannel.invokeMethod<Map<dynamic, dynamic>>('startTunnel', {
        'deviceId': deviceId,
        'sessionToken': sessionToken,
        'apiBaseUrl': AppConfig.current.apiBaseUrl,
        'gatewayWsUrl': AppConfig.current.gatewayWsUrl,
        if (cred != null) 'deviceCredential': cred,
      });

      if (res != null) {
        final info = _parseNativeInfo(Map<String, dynamic>.from(res));
        _applyStateUpdate(info, source: 'startTunnel');
      } else {
        _currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.connecting);
        if (!_statusController.isClosed) {
          _statusController.add(_currentInfo);
        }
        _startReconciliation();
      }
      return _currentInfo;
    } catch (e) {
      AppLogger.warning('[NativeRemoteConnection] Native startTunnel call failed, using fallback status: $e');
      _currentInfo = RemoteConnectionInfo(
        status: RemoteConnectionState.failed,
        errorMessage: e.toString(),
      );
      if (!_statusController.isClosed) {
        _statusController.add(_currentInfo);
      }
      _stopReconciliation();
      return _currentInfo;
    }
  }

  @override
  Future<RemoteConnectionInfo> disconnect({
    required String connectionId,
    required String sessionToken,
  }) async {
    _stopReconciliation();
    try {
      AppLogger.info('[NativeRemoteConnection] Requesting native tunnel stop');
      final res = await _methodChannel.invokeMethod<Map<dynamic, dynamic>>('stopTunnel');
      if (res != null) {
        final info = _parseNativeInfo(Map<String, dynamic>.from(res));
        _applyStateUpdate(info, source: 'stopTunnel');
      } else {
        _currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.disconnected);
        if (!_statusController.isClosed) {
          _statusController.add(_currentInfo);
        }
      }
      return _currentInfo;
    } catch (e) {
      _currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.disconnected);
      if (!_statusController.isClosed) {
        _statusController.add(_currentInfo);
      }
      return _currentInfo;
    }
  }

  @override
  Future<RemoteConnectionInfo> reconnect() async {
    try {
      AppLogger.info('[NativeRemoteConnection] Requesting native tunnel reconnect');
      await _methodChannel.invokeMethod<bool>('reconnectTunnel');
      _currentInfo = const RemoteConnectionInfo(status: RemoteConnectionState.reconnecting);
      if (!_statusController.isClosed) {
        _statusController.add(_currentInfo);
      }
      _startReconciliation();
      return _currentInfo;
    } catch (e) {
      return _currentInfo;
    }
  }

  @override
  Future<RemoteConnectionState> getStatus() async {
    try {
      final res = await _methodChannel.invokeMethod<Map<dynamic, dynamic>>('getTunnelStatus');
      if (res != null) {
        final info = _parseNativeInfo(Map<String, dynamic>.from(res));
        _applyStateUpdate(info, source: 'getStatus');
      }
    } catch (_) {}
    return _currentInfo.status;
  }

  @override
  Future<RemoteConnectionInfo> getConnectionInfo() async {
    try {
      final res = await _methodChannel.invokeMethod<Map<dynamic, dynamic>>('getTunnelStatus');
      if (res != null) {
        final info = _parseNativeInfo(Map<String, dynamic>.from(res));
        _applyStateUpdate(info, source: 'getConnectionInfo');
      }
    } catch (_) {}
    return _currentInfo;
  }

  @override
  void dispose() {
    _stopReconciliation();
    _eventSubscription?.cancel();
    _statusController.close();
  }
}

/// Backward Compatibility Facade & Mock Service for Unit Testing & Non-Android Platforms
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

  @override
  void dispose() {
    _statusController.close();
  }
}

/// Backward compatibility alias for legacy references
typedef HttpRemoteConnectionService = NativeRemoteConnectionService;

