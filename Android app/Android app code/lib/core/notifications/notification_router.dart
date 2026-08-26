import '../utils/logger.dart';

enum NotificationTargetType {
  dashboard,
  serverDetail,
  fileManager,
  securitySettings,
  deviceDetail,
  unknown,
}

class NotificationTarget {
  final NotificationTargetType type;
  final String? serverId;
  final String? deviceName;
  final String? rawDeepLink;

  const NotificationTarget({
    required this.type,
    this.serverId,
    this.deviceName,
    this.rawDeepLink,
  });
}

class NotificationRouter {
  static const String schemeServer = 'remotenode://server/';
  static const String schemeFileManager = 'remotenode://filemanager';
  static const String schemeSecurity = 'remotenode://security';
  static const String schemeDevice = 'remotenode://device/';

  static NotificationTarget parsePayload(Map<String, dynamic> payload) {
    try {
      final deepLink = payload['deepLink'] as String? ?? payload['deepLinkUri'] as String?;
      final serverId = payload['serverId'] as String?;
      final deviceName = payload['deviceName'] as String?;

      if (deepLink == null || deepLink.isEmpty) {
        if (serverId != null && serverId.isNotEmpty) {
          return NotificationTarget(
            type: NotificationTargetType.serverDetail,
            serverId: serverId,
          );
        }
        return const NotificationTarget(type: NotificationTargetType.dashboard);
      }

      if (deepLink.startsWith(schemeFileManager)) {
        return NotificationTarget(
          type: NotificationTargetType.fileManager,
          rawDeepLink: deepLink,
        );
      }

      if (deepLink.startsWith(schemeServer)) {
        final parsedServerId = deepLink.substring(schemeServer.length).trim();
        return NotificationTarget(
          type: NotificationTargetType.serverDetail,
          serverId: parsedServerId.isNotEmpty ? parsedServerId : serverId,
          rawDeepLink: deepLink,
        );
      }

      if (deepLink.startsWith(schemeSecurity)) {
        return NotificationTarget(
          type: NotificationTargetType.securitySettings,
          rawDeepLink: deepLink,
        );
      }

      if (deepLink.startsWith(schemeDevice)) {
        final parsedDeviceName = deepLink.substring(schemeDevice.length).trim();
        return NotificationTarget(
          type: NotificationTargetType.deviceDetail,
          deviceName: parsedDeviceName.isNotEmpty ? parsedDeviceName : deviceName,
          rawDeepLink: deepLink,
        );
      }

      AppLogger.warning('[NotificationRouter] Deep-link not in allowlist: $deepLink. Falling back to dashboard.');
      return const NotificationTarget(type: NotificationTargetType.dashboard);
    } catch (e) {
      AppLogger.error('[NotificationRouter] Error parsing payload: $payload', e);
      return const NotificationTarget(type: NotificationTargetType.dashboard);
    }
  }
}
