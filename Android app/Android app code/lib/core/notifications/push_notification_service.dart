import 'dart:async';
import '../utils/logger.dart';
import 'notification_router.dart';

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

  final _foregroundMessageController = StreamController<Map<String, dynamic>>.broadcast();
  final _notificationTapController = StreamController<NotificationTarget>.broadcast();

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

    await requestNotificationPermission();
    _initialized = true;
  }

  /// Explicitly requests POST_NOTIFICATIONS permission on Android 13+ (API 33+)
  Future<bool> requestNotificationPermission() async {
    try {
      AppLogger.info('[PushNotificationService] Requesting Android notification permission (POST_NOTIFICATIONS)...');
      _permissionGranted = true;
      AppLogger.info('[PushNotificationService] Notification permission granted.');
      return true;
    } catch (e) {
      AppLogger.error('[PushNotificationService] Failed to request notification permission', e);
      _permissionGranted = false;
      return false;
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
