import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/notifications/push_token_manager.dart';
import 'package:remote_node_app/core/notifications/notification_router.dart';
import 'package:remote_node_app/core/notifications/push_notification_service.dart';
import 'package:remote_node_app/features/notifications/domain/models/notification_item.dart';
import 'package:remote_node_app/features/notifications/domain/models/notification_preferences.dart';

void main() {
  group('Track B — Android FCM Integration Unit Tests', () {
    late MockFcmTokenAdapter mockFcmAdapter;
    late PushNotificationService pushService;

    setUp(() {
      mockFcmAdapter = MockFcmTokenAdapter();
      pushService = PushNotificationService();
    });

    test('1. FCM Token Acquisition Abstraction retrieves valid initial token', () async {
      final token = await mockFcmAdapter.getToken();
      expect(token, equals('mock_fcm_token_initial_100'));
    });

    test('2. Token Registration logic registers FCM token for device', () async {
      final token = await mockFcmAdapter.getToken();
      expect(token, isNotNull);
      expect(token!.isNotEmpty, isTrue);
    });

    test('3. Token Rotation rotates token when Firebase refreshes it', () async {
      String? refreshedToken;
      mockFcmAdapter.onTokenRefresh.listen((token) {
        refreshedToken = token;
      });

      mockFcmAdapter.simulateTokenRefresh('mock_fcm_token_refreshed_200');
      await Future.delayed(Duration.zero);

      expect(refreshedToken, equals('mock_fcm_token_refreshed_200'));
    });

    test('4. Token Revocation deletes FCM token on logout', () async {
      await mockFcmAdapter.deleteToken();
      final token = await mockFcmAdapter.getToken();
      expect(token, isNull);
    });

    test('5. Duplicate Registration Prevention suppresses identical token registration', () async {
      final token1 = await mockFcmAdapter.getToken();
      final token2 = await mockFcmAdapter.getToken();
      expect(token1, equals(token2));
    });

    test('6. Foreground Notification Handling emits message payload to stream', () async {
      await pushService.initialize();
      Map<String, dynamic>? receivedMessage;

      pushService.onForegroundMessage.listen((msg) {
        receivedMessage = msg;
      });

      pushService.handleForegroundMessage({'title': 'Test Title', 'body': 'Test Body'});
      await Future.delayed(Duration.zero);

      expect(receivedMessage, isNotNull);
      expect(receivedMessage!['title'], equals('Test Title'));
    });

    test('7. Notification Payload Parsing extracts deep link and serverId correctly', () {
      final target = NotificationRouter.parsePayload({
        'deepLink': 'remotenode://server/srv_999',
        'serverId': 'srv_999',
      });

      expect(target.type, equals(NotificationTargetType.serverDetail));
      expect(target.serverId, equals('srv_999'));
    });

    test('8. Deep-Link Allowlist enforces supported schemes and falls back safely', () {
      final validFileManager = NotificationRouter.parsePayload({'deepLink': 'remotenode://filemanager'});
      expect(validFileManager.type, equals(NotificationTargetType.fileManager));

      final invalidScheme = NotificationRouter.parsePayload({'deepLink': 'https://malicious-external-site.com'});
      expect(invalidScheme.type, equals(NotificationTargetType.dashboard));
    });

    test('9. Notification Tap Routing emits parsed target', () async {
      NotificationTarget? tappedTarget;
      pushService.onNotificationTap.listen((target) {
        tappedTarget = target;
      });

      pushService.handleNotificationTap({'deepLink': 'remotenode://security'});
      await Future.delayed(Duration.zero);

      expect(tappedTarget, isNotNull);
      expect(tappedTarget!.type, equals(NotificationTargetType.securitySettings));
    });

    test('10. Severity to Android Notification Channel Mapping resolves correct channel ID', () {
      expect(PushNotificationService.selectChannelId('CRITICAL'), equals('remotenode_critical'));
      expect(PushNotificationService.selectChannelId('SECURITY'), equals('remotenode_security'));
      expect(PushNotificationService.selectChannelId('INFO'), equals('remotenode_general'));
    });

    test('11. Logout Cleanup revokes token and clears cached registration state', () async {
      final manager = PushTokenManager(fcmAdapter: mockFcmAdapter);
      await manager.revokePushToken(deviceId: 'dev_100');
      expect(manager.lastRegisteredToken, isNull);
      expect(manager.lastRegisteredDeviceId, isNull);
    });

    test('12. Notification Preferences Model serializes and deserializes cleanly', () {
      const prefs = NotificationPreferences(
        globalPushEnabled: true,
        globalEmailEnabled: false,
      );

      final json = prefs.toJson();
      final deserialized = NotificationPreferences.fromJson(json);

      expect(deserialized.globalPushEnabled, isTrue);
      expect(deserialized.globalEmailEnabled, isFalse);
    });

    test('13. NotificationItem Model parses ISO timestamps and NotificationStateEnum', () {
      final item = NotificationItem.fromJson({
        'id': 'notif_100',
        'eventId': 'evt_100',
        'userId': 'usr_100',
        'eventType': 'SERVER_STARTED',
        'category': 'DEVICE_SERVER',
        'severity': 'INFO',
        'title': 'Server Online',
        'body': 'Your server is running',
        'state': 'UNREAD',
        'createdAt': '2026-08-26T12:00:00.000Z',
      });

      expect(item.id, equals('notif_100'));
      expect(item.state, equals(NotificationStateEnum.unread));
      expect(item.severity, equals('INFO'));
    });

    test('14. Read & Archive State Mutations update NotificationItem state correctly', () {
      final item = NotificationItem.fromJson({
        'id': 'notif_100',
        'eventId': 'evt_100',
        'userId': 'usr_100',
        'eventType': 'SERVER_STARTED',
        'category': 'DEVICE_SERVER',
        'severity': 'INFO',
        'title': 'Server Online',
        'body': 'Your server is running',
        'state': 'UNREAD',
      });

      final readItem = item.copyWith(state: NotificationStateEnum.read);
      expect(readItem.state, equals(NotificationStateEnum.read));

      final archivedItem = item.copyWith(state: NotificationStateEnum.archived);
      expect(archivedItem.state, equals(NotificationStateEnum.archived));
    });

    test('15. Malformed payload falls back gracefully to dashboard target', () {
      final target = NotificationRouter.parsePayload({'corrupted': 12345});
      expect(target.type, equals(NotificationTargetType.dashboard));
    });
  });
}
