import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../utils/logger.dart';
import 'notification_router.dart';

final pushNotificationServiceProvider = Provider<PushNotificationService>((ref) {
  return PushNotificationService();
});

class AndroidNotificationChannelInfo {
  final String id;
  final String name;
  final String description;
  final int importance;

  const AndroidNotificationChannelInfo({
    required this.id,
    required this.name,
    required this.description,
    this.importance = 3,
  });
}

class PushNotificationService {
  static final PushNotificationService instance = PushNotificationService();

  static const channelGeneral = AndroidNotificationChannelInfo(
    id: 'remotenode_general',
    name: 'General RemoteNode Notifications',
    description: 'Server status, storage alerts, and operational updates',
    importance: 3,
  );

  static const channelCritical = AndroidNotificationChannelInfo(
    id: 'remotenode_critical',
    name: 'Critical System Alerts',
    description: 'High-priority server offline, outage, and storage critical alerts',
    importance: 4,
  );

  static const channelSecurity = AndroidNotificationChannelInfo(
    id: 'remotenode_security',
    name: 'Account & Security Alerts',
    description: 'Login alerts, device linking, and mandatory security notifications',
    importance: 4,
  );

  final MethodChannel _channel;
  final _foregroundMessageController = StreamController<Map<String, dynamic>>.broadcast();
  final _notificationTapController = StreamController<NotificationTarget>.broadcast();

  PushNotificationService({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel('net.remotenode.fileserver/server_engine');

  Stream<Map<String, dynamic>> get onForegroundMessage => _foregroundMessageController.stream;
  Stream<NotificationTarget> get onNotificationTap => _notificationTapController.stream;

  bool _initialized = false;
  bool get isInitialized => _initialized;
  bool _permissionGranted = false;
  bool get isPermissionGranted => _permissionGranted;

  Future<void> initialize() async {
    if (_initialized) return;

    AppLogger.info('[PushNotificationService] Initializing Android Notification Channels: '
        '${channelGeneral.id}, ${channelCritical.id}, ${channelSecurity.id}');

    _channel.setMethodCallHandler(_handlePlatformCall);

    _initialized = true;
  }

  Future<dynamic> _handlePlatformCall(MethodCall call) async {
    switch (call.method) {
      case 'onNotificationTap':
        if (call.arguments is Map) {
          handleNotificationTap(Map<String, dynamic>.from(call.arguments as Map));
        }
        break;
      case 'onForegroundMessage':
        if (call.arguments is Map) {
          handleForegroundMessage(Map<String, dynamic>.from(call.arguments as Map));
        }
        break;
    }
  }

  /// Checks if the app was launched by tapping an Android notification
  Future<NotificationTarget?> checkInitialNotification() async {
    try {
      final payload = await _channel.invokeMethod<Map>('getInitialNotification');
      if (payload != null) {
        final typedPayload = Map<String, dynamic>.from(payload);
        final target = NotificationRouter.parsePayload(typedPayload);
        AppLogger.info('[PushNotificationService] App launched from notification tap: ${target.type}');
        _notificationTapController.add(target);
        return target;
      }
    } catch (e) {
      AppLogger.warning('[PushNotificationService] Failed to check initial notification: $e');
    }
    return null;
  }

  /// Explicitly requests POST_NOTIFICATIONS permission on Android 13+ (API 33+)
  Future<bool> requestNotificationPermission() async {
    try {
      AppLogger.info('[PushNotificationService] Requesting Android notification permission (POST_NOTIFICATIONS)...');
      final granted = await _channel.invokeMethod<bool>('requestNotificationPermission');
      _permissionGranted = granted ?? false;
      AppLogger.info('[PushNotificationService] Notification permission result: $_permissionGranted');
      return _permissionGranted;
    } on MissingPluginException {
      _permissionGranted = true;
      return true;
    } catch (e) {
      AppLogger.error('[PushNotificationService] Failed to request notification permission', e);
      _permissionGranted = false;
      return false;
    }
  }

  /// Checks the current status of notification permission
  Future<bool> checkNotificationPermission() async {
    try {
      final granted = await _channel.invokeMethod<bool>('isNotificationPermissionGranted');
      _permissionGranted = granted ?? false;
      return _permissionGranted;
    } on MissingPluginException {
      return _permissionGranted;
    } catch (e) {
      _permissionGranted = false;
      return false;
    }
  }

  /// Checks if permission rationale should be displayed (or if permanently denied)
  Future<bool> checkNotificationPermissionRationale() async {
    try {
      final rationale = await _channel.invokeMethod<bool>('checkNotificationPermissionRationale');
      return rationale ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Opens Android App Notification Settings screen
  Future<bool> openNotificationSettings() async {
    try {
      final res = await _channel.invokeMethod<bool>('openNotificationSettings');
      return res ?? false;
    } catch (e) {
      AppLogger.error('[PushNotificationService] Failed to open notification settings', e);
      return false;
    }
  }

  /// Retrieves current FCM token from the underlying platform channel
  Future<String?> getFcmToken() async {
    try {
      return await _channel.invokeMethod<String>('getFcmToken');
    } catch (e) {
      AppLogger.warning('[PushNotificationService] Failed to fetch FCM token: $e');
      return null;
    }
  }

  static String selectChannelId(String? severity) {
    switch ((severity ?? '').toUpperCase()) {
      case 'CRITICAL':
        return channelCritical.id;
      case 'SECURITY':
        return channelSecurity.id;
      case 'WARNING':
      case 'SUCCESS':
      case 'INFO':
      default:
        return channelGeneral.id;
    }
  }

  void handleForegroundMessage(Map<String, dynamic> payload) {
    AppLogger.info('[PushNotificationService] Received foreground push message: ${payload['title']}');
    _foregroundMessageController.add(payload);
  }

  void handleNotificationTap(Map<String, dynamic> payload) {
    final target = NotificationRouter.parsePayload(payload);
    AppLogger.info('[PushNotificationService] Notification tapped. Target: ${target.type}, ServerId: ${target.serverId}');
    _notificationTapController.add(target);
  }

  void dispose() {
    _foregroundMessageController.close();
    _notificationTapController.close();
  }
}
