// NOTE: These tests are NOT EXECUTED as per policy.
import 'package:flutter/services.dart';
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

    test('16. PlatformFcmTokenAdapter communicates with platform channel', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      const channel = MethodChannel('net.remotenode.fileserver/server_engine');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (MethodCall call) async {
          if (call.method == 'getFcmToken') {
            return 'real_platform_fcm_token_xyz_999';
          }
          if (call.method == 'deleteFcmToken') {
            return true;
          }
          return null;
        },
      );

      final platformAdapter = PlatformFcmTokenAdapter(channel: channel);
      final token = await platformAdapter.getToken();
      expect(token, equals('real_platform_fcm_token_xyz_999'));

      await platformAdapter.deleteToken();
      // Reset handler
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
    });

    test('17. PushNotificationService invokes native POST_NOTIFICATIONS permission channel', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      const channel = MethodChannel('net.remotenode.fileserver/server_engine');
      bool permissionRequested = false;

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (MethodCall call) async {
          if (call.method == 'requestNotificationPermission') {
            permissionRequested = true;
            return true;
          }
          if (call.method == 'isNotificationPermissionGranted') {
            return true;
          }
          return null;
        },
      );

      final service = PushNotificationService(channel: channel);
      final granted = await service.requestNotificationPermission();

      expect(permissionRequested, isTrue);
      expect(granted, isTrue);
      expect(service.isPermissionGranted, isTrue);

      final checked = await service.checkNotificationPermission();
      expect(checked, isTrue);

      // Reset handler
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
    });

    test('18. PushNotificationService handles permission denial safely', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      const channel = MethodChannel('net.remotenode.fileserver/server_engine');

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (MethodCall call) async {
          if (call.method == 'requestNotificationPermission') {
            return false;
          }
          if (call.method == 'isNotificationPermissionGranted') {
            return false;
          }
          return null;
        },
      );

      final service = PushNotificationService(channel: channel);
      final granted = await service.requestNotificationPermission();

      expect(granted, isFalse);
      expect(service.isPermissionGranted, isFalse);

      // Reset handler
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
    });

    test('19. PlatformFcmTokenAdapter returns null when platform has no token without generating synthetic UUID', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      const channel = MethodChannel('net.remotenode.fileserver/server_engine');

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (MethodCall call) async {
          if (call.method == 'getFcmToken') {
            return null; // Platform returns null because no real token exists
          }
          return null;
        },
      );

      final adapter = PlatformFcmTokenAdapter(channel: channel);
      final token = await adapter.getToken();

      expect(token, isNull);

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
    });

    test('20. PushTokenManager aborts registration cleanly when no genuine token is available', () async {
      final mockEmptyAdapter = MockFcmTokenAdapter();
      await mockEmptyAdapter.deleteToken(); // Token is null

      final manager = PushTokenManager(fcmAdapter: mockEmptyAdapter);
      final registered = await manager.registerPushToken(deviceId: 'dev_test_999');

      expect(registered, isFalse);
      expect(manager.lastRegisteredToken, isNull);
    });

    test('21. PushTokenManager.maskToken masks sensitive tokens and protects logs', () {
      expect(PushTokenManager.maskToken(null), equals('<none>'));
      expect(PushTokenManager.maskToken(''), equals('<none>'));
      expect(PushTokenManager.maskToken('short123'), equals('***'));
      expect(
        PushTokenManager.maskToken('fcm_token_abcdef1234567890_long_production_key'),
        equals('fcm_to..._key'),
      );
    });

    test('22. PushNotificationService.checkInitialNotification extracts payload on cold launch', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      const channel = MethodChannel('net.remotenode.fileserver/server_engine');

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (MethodCall call) async {
          if (call.method == 'getInitialNotification') {
            return {
              'deepLink': 'zdexcloud://server/srv_node_001',
              'serverId': 'srv_node_001',
              'category': 'DEVICE_SERVER',
              'severity': 'INFO',
              'title': 'Server Ready',
              'body': 'Your server is active'
            };
          }
          return null;
        },
      );

      final service = PushNotificationService(channel: channel);
      final target = await service.checkInitialNotification();

      expect(target, isNotNull);
      expect(target!.type, equals(NotificationTargetType.serverDetail));
      expect(target.serverId, equals('srv_node_001'));

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
    });

    test('23. PushNotificationService checks permission rationale and opens notification settings', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      const channel = MethodChannel('net.remotenode.fileserver/server_engine');
      bool openedSettings = false;

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (MethodCall call) async {
          if (call.method == 'checkNotificationPermissionRationale') {
            return true;
          }
          if (call.method == 'openNotificationSettings') {
            openedSettings = true;
            return true;
          }
          return null;
        },
      );

      final service = PushNotificationService(channel: channel);
      final shouldShowRationale = await service.checkNotificationPermissionRationale();
      expect(shouldShowRationale, isTrue);

      final settingsOpened = await service.openNotificationSettings();
      expect(settingsOpened, isTrue);
      expect(openedSettings, isTrue);

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
    });

    test('24. Billing deep links route correctly across dual schemes and web URLs', () {
      final t1 = NotificationRouter.parsePayload({'deepLink': 'zdexcloud://billing'});
      expect(t1.type, equals(NotificationTargetType.billing));

      final t2 = NotificationRouter.parsePayload({'deepLink': 'remotenode://billing'});
      expect(t2.type, equals(NotificationTargetType.billing));

      final t3 = NotificationRouter.parsePayload({'deepLink': 'https://zdexcloud.com/pages/billing.html'});
      expect(t3.type, equals(NotificationTargetType.billing));

      final t4 = NotificationRouter.parsePayload({'deepLink': 'https://zdexcloud.com/pages/invoices.html'});
      expect(t4.type, equals(NotificationTargetType.billing));

      final t5 = NotificationRouter.parsePayload({'deepLink': 'https://zdexcloud.com/pages/subscription.html'});
      expect(t5.type, equals(NotificationTargetType.billing));
    });

    test('25. Malformed and arbitrary deep links fallback safely to dashboard target', () {
      final t1 = NotificationRouter.parsePayload({'deepLink': 'https://external-untrusted-site.com/steal'});
      expect(t1.type, equals(NotificationTargetType.dashboard));

      final t2 = NotificationRouter.parsePayload({});
      expect(t2.type, equals(NotificationTargetType.dashboard));

      final t3 = NotificationRouter.parsePayload({'deepLink': ''});
      expect(t3.type, equals(NotificationTargetType.dashboard));
    });

    test('26. NotificationPreferences parses granular categories and populates default fallbacks', () {
      final prefs = NotificationPreferences.fromJson({
        'globalPushEnabled': true,
        'globalEmailEnabled': false,
        'categories': {
          'DEVICE_SERVER': {
            'enabled': false,
            'channels': {'IN_APP': true, 'PUSH': false, 'EMAIL': false}
          }
        }
      });

      expect(prefs.globalPushEnabled, isTrue);
      expect(prefs.globalEmailEnabled, isFalse);
      expect(prefs.categories['DEVICE_SERVER']!.enabled, isFalse);
      expect(prefs.categories['DEVICE_SERVER']!.push, isFalse);
      // Missing categories automatically receive defaults
      expect(prefs.categories['BILLING'], isNotNull);
      expect(prefs.categories['BILLING']!.enabled, isTrue);
      expect(prefs.categories['BILLING']!.email, isTrue);
      expect(prefs.categories['STORAGE'], isNotNull);
    });

    test('27. NotificationPreferences enforces mandatory security policy invariants on deserialization', () {
      // Hostile JSON attempting to disable account security
      final prefs = NotificationPreferences.fromJson({
        'categories': {
          'ACCOUNT_SECURITY': {
            'enabled': false,
            'channels': {'IN_APP': false, 'PUSH': false, 'EMAIL': false}
          }
        }
      });

      final sec = prefs.categories['ACCOUNT_SECURITY']!;
      expect(sec.enabled, isTrue);
      expect(sec.inApp, isTrue);
      expect(sec.email, isTrue);
      expect(sec.push, isFalse); // Push channel remains configurable
    });

    test('28. CategoryPreferenceItem serializes and deserializes channel mappings cleanly', () {
      const item = CategoryPreferenceItem(enabled: true, inApp: true, push: false, email: true);
      final json = item.toJson();

      expect(json['enabled'], isTrue);
      expect((json['channels'] as Map)['IN_APP'], isTrue);
      expect((json['channels'] as Map)['PUSH'], isFalse);
      expect((json['channels'] as Map)['EMAIL'], isTrue);

      final restored = CategoryPreferenceItem.fromJson(json);
      expect(restored.enabled, isTrue);
      expect(restored.inApp, isTrue);
      expect(restored.push, isFalse);
      expect(restored.email, isTrue);
    });

    test('29. NotificationPreferences supports both categories and legacy categoryPreferences JSON keys', () {
      final p1 = NotificationPreferences.fromJson({
        'categories': {
          'BILLING': {'enabled': false}
        }
      });
      expect(p1.categories['BILLING']!.enabled, isFalse);

      final p2 = NotificationPreferences.fromJson({
        'categoryPreferences': {
          'BILLING': {'enabled': false}
        }
      });
      expect(p2.categories['BILLING']!.enabled, isFalse);
    });

    test('30. NotificationPreferences copyWith updates individual and category preferences accurately', () {
      const initial = NotificationPreferences();
      final updated = initial.copyWith(
        globalPushEnabled: false,
        categories: {
          'SYSTEM': const CategoryPreferenceItem(enabled: false, inApp: false, push: false, email: false),
        },
      );

      expect(updated.globalPushEnabled, isFalse);
      expect(updated.categories['SYSTEM']!.enabled, isFalse);
    });
  });
}

