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
  // Canonical web URLs and dual-scheme deep links
  static const String schemeServer = 'remotenode://server/';
  static const String schemeFileManager = 'remotenode://filemanager';
  static const String schemeSecurity = 'remotenode://security';
  static const String schemeDevice = 'remotenode://device/';

  static const String zSchemeServer = 'zdexcloud://server/';
  static const String zSchemeFileManager = 'zdexcloud://filemanager';
  static const String zSchemeSecurity = 'zdexcloud://security';
  static const String zSchemeDevice = 'zdexcloud://device/';

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

      // File Manager
      if (deepLink.startsWith(schemeFileManager) ||
          deepLink.startsWith(zSchemeFileManager) ||
          deepLink.contains('/file-manager') ||
          deepLink.contains('file-manager.html')) {
        return NotificationTarget(
          type: NotificationTargetType.fileManager,
          rawDeepLink: deepLink,
        );
      }

      // Server Detail
      if (deepLink.startsWith(schemeServer) || deepLink.startsWith(zSchemeServer)) {
        final prefix = deepLink.startsWith(schemeServer) ? schemeServer : zSchemeServer;
        final parsedServerId = deepLink.substring(prefix.length).trim();
        return NotificationTarget(
          type: NotificationTargetType.serverDetail,
          serverId: parsedServerId.isNotEmpty ? parsedServerId : serverId,
          rawDeepLink: deepLink,
        );
      }
      if (deepLink.contains('#server-')) {
        final parsedServerId = deepLink.split('#server-')[1].trim();
        return NotificationTarget(
          type: NotificationTargetType.serverDetail,
          serverId: parsedServerId.isNotEmpty ? parsedServerId : serverId,
          rawDeepLink: deepLink,
        );
      }

      // Security Settings
      if (deepLink.startsWith(schemeSecurity) ||
          deepLink.startsWith(zSchemeSecurity) ||
          deepLink.contains('#security')) {
        return NotificationTarget(
          type: NotificationTargetType.securitySettings,
          rawDeepLink: deepLink,
        );
      }

      // Device Detail
      if (deepLink.startsWith(schemeDevice) || deepLink.startsWith(zSchemeDevice)) {
        final prefix = deepLink.startsWith(schemeDevice) ? schemeDevice : zSchemeDevice;
        final parsedDeviceName = deepLink.substring(prefix.length).trim();
        return NotificationTarget(
          type: NotificationTargetType.deviceDetail,
          deviceName: parsedDeviceName.isNotEmpty ? parsedDeviceName : deviceName,
          rawDeepLink: deepLink,
        );
      }

      // Dashboard / General canonical URLs
      if (deepLink.contains('/dashboard') ||
          deepLink.contains('/login') ||
          deepLink.contains('zdexcloud.com')) {
        return const NotificationTarget(type: NotificationTargetType.dashboard);
      }

      AppLogger.warning('[NotificationRouter] Deep-link not in allowlist: $deepLink. Falling back to dashboard.');
      return const NotificationTarget(type: NotificationTargetType.dashboard);
    } catch (e) {
      AppLogger.error('[NotificationRouter] Error parsing payload: $payload', e);
      return const NotificationTarget(type: NotificationTargetType.dashboard);
    }
  }
}
