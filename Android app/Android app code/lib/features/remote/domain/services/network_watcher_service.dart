import 'dart:async';
import 'package:flutter/services.dart';
import '../../../../core/utils/logger.dart';

/// Supported Network Transports
enum NetworkTransportType {
  wifi,
  cellular,
  ethernet,
  vpn,
  other,
  none,
}

/// Structured Network Connectivity Status Model
class NetworkStatus {
  final bool hasInternet;
  final bool isValidated;
  final NetworkTransportType transport;
  final String networkId;
  final String eventType;
  final DateTime timestamp;

  const NetworkStatus({
    this.hasInternet = false,
    this.isValidated = false,
    this.transport = NetworkTransportType.none,
    this.networkId = 'none',
    this.eventType = 'INITIAL_STATE',
    required this.timestamp,
  });

  bool get isOnline => hasInternet && isValidated;

  NetworkStatus copyWith({
    bool? hasInternet,
    bool? isValidated,
    NetworkTransportType? transport,
    String? networkId,
    String? eventType,
    DateTime? timestamp,
  }) {
    return NetworkStatus(
      hasInternet: hasInternet ?? this.hasInternet,
      isValidated: isValidated ?? this.isValidated,
      transport: transport ?? this.transport,
      networkId: networkId ?? this.networkId,
      eventType: eventType ?? this.eventType,
      timestamp: timestamp ?? this.timestamp,
    );
  }

  @override
  String toString() =>
      'NetworkStatus(online: $isOnline, transport: $transport, netId: $networkId, event: $eventType)';
}

/// Interface for Network Transition & Connectivity Monitoring
abstract class NetworkWatcherService {
  Stream<NetworkStatus> get networkStream;
  Future<NetworkStatus> getCurrentStatus();
  void dispose();
}

/// Platform Implementation using Android NetworkCallback via EventChannel & MethodChannel
class PlatformNetworkWatcherService implements NetworkWatcherService {
  static const EventChannel _eventChannel =
      EventChannel('net.remotenode.fileserver/network_events');
  static const MethodChannel _methodChannel =
      MethodChannel('net.remotenode.fileserver/server_engine');

  final StreamController<NetworkStatus> _controller =
      StreamController<NetworkStatus>.broadcast();
  StreamSubscription? _eventSubscription;

  NetworkStatus _lastStatus = NetworkStatus(
    hasInternet: true,
    isValidated: true,
    transport: NetworkTransportType.wifi,
    networkId: 'initial',
    timestamp: DateTime.now(),
  );

  Timer? _debounceTimer;
  NetworkStatus? _pendingStatus;

  PlatformNetworkWatcherService() {
    _initListener();
  }

  @override
  Stream<NetworkStatus> get networkStream => _controller.stream;

  void _initListener() {
    try {
      _eventSubscription = _eventChannel.receiveBroadcastStream().listen(
        (dynamic event) {
          if (event is Map) {
            final map = Map<String, dynamic>.from(event);
            final status = _parseNetworkStatus(map);
            _debounceAndEmit(status);
          }
        },
        onError: (err) {
          AppLogger.warning('[NetworkWatcher] EventChannel error: $err');
        },
      );
    } catch (e) {
      AppLogger.warning('[NetworkWatcher] Failed to bind EventChannel: $e');
    }
  }

  void _debounceAndEmit(NetworkStatus status) {
    // Check if there is a material change (transport switch, validation switch, or netId switch)
    final isMaterialChange = _lastStatus.transport != status.transport ||
        _lastStatus.isValidated != status.isValidated ||
        _lastStatus.hasInternet != status.hasInternet ||
        _lastStatus.networkId != status.networkId;

    if (!isMaterialChange && status.eventType == 'CAPABILITIES_CHANGED') {
      // Ignore minor capability fluctuations
      return;
    }

    _pendingStatus = status;
    _debounceTimer?.cancel();

    // 400ms debounce to coalesce rapid bursting callbacks from Android ConnectivityManager
    _debounceTimer = Timer(const Duration(milliseconds: 400), () {
      if (_pendingStatus != null) {
        _lastStatus = _pendingStatus!;
        AppLogger.info('[NetworkWatcher] Network state transition: ${_lastStatus.toString()}');
        if (!_controller.isClosed) {
          _controller.add(_lastStatus);
        }
        _pendingStatus = null;
      }
    });
  }

  NetworkStatus _parseNetworkStatus(Map<String, dynamic> map) {
    final type = map['type'] as String? ?? 'UNKNOWN';
    final hasInternet = map['hasInternet'] as bool? ?? false;
    final isValidated = map['isValidated'] as bool? ?? false;
    final transportStr = (map['transport'] as String? ?? 'NONE').toUpperCase();
    final netId = map['networkId'] as String? ?? 'none';

    NetworkTransportType transport;
    switch (transportStr) {
      case 'WIFI':
        transport = NetworkTransportType.wifi;
        break;
      case 'CELLULAR':
        transport = NetworkTransportType.cellular;
        break;
      case 'ETHERNET':
        transport = NetworkTransportType.ethernet;
        break;
      case 'VPN':
        transport = NetworkTransportType.vpn;
        break;
      case 'NONE':
        transport = NetworkTransportType.none;
        break;
      default:
        transport = NetworkTransportType.other;
    }

    return NetworkStatus(
      hasInternet: hasInternet,
      isValidated: isValidated,
      transport: transport,
      networkId: netId,
      eventType: type,
      timestamp: DateTime.now(),
    );
  }

  @override
  Future<NetworkStatus> getCurrentStatus() async {
    try {
      final res = await _methodChannel.invokeMethod<Map<dynamic, dynamic>>('getNetworkStatus');
      if (res != null) {
        _lastStatus = _parseNetworkStatus(Map<String, dynamic>.from(res));
      }
    } catch (_) {
      // Fallback to last known status on error/mock
    }
    return _lastStatus;
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _eventSubscription?.cancel();
    _controller.close();
  }
}

/// Mock Implementation for Testing & Non-Android Platforms
class MockNetworkWatcherService implements NetworkWatcherService {
  final StreamController<NetworkStatus> _controller =
      StreamController<NetworkStatus>.broadcast();

  NetworkStatus _status = NetworkStatus(
    hasInternet: true,
    isValidated: true,
    transport: NetworkTransportType.wifi,
    networkId: 'mock-wifi',
    eventType: 'INITIAL_STATE',
    timestamp: DateTime.now(),
  );

  @override
  Stream<NetworkStatus> get networkStream => _controller.stream;

  @override
  Future<NetworkStatus> getCurrentStatus() async => _status;

  void emitStatus(NetworkStatus status) {
    _status = status;
    if (!_controller.isClosed) {
      _controller.add(status);
    }
  }

  @override
  void dispose() {
    _controller.close();
  }
}
