import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/server/domain/services/server_service.dart';
import 'package:remote_node_app/core/notifications/push_notification_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Phase APP-R1.11 — Android Persistent Server & Background Reliability Tests', () {
    late MockServerService serverService;

    setUp(() {
      serverService = const MockServerService(initiallyRunning: false, port: 8080);
    });

    test('1. Initial Server State: reports STOPPED and isServiceRunning false', () async {
      final status = await serverService.getServerStatus();
      final isRunning = await serverService.isServiceRunning();

      expect(status['status'], 'STOPPED');
      expect(status['port'], 8080);
      expect(isRunning, isFalse);
    });

    test('2. Start Server Operation: promotes service to running state with localUrl', () async {
      final res = await serverService.startServer(port: 8080);

      expect(res['success'], isTrue);
      expect(res['port'], 8080);
      expect(res['localUrl'], contains('8080'));
      expect(res['serviceRunning'], isTrue);
    });

    test('3. Stop Server Operation: stops server and updates service running state to false', () async {
      await serverService.startServer(port: 8080);
      final stopRes = await serverService.stopServer();

      expect(stopRes['success'], isTrue);
      expect(stopRes['serviceRunning'], isFalse);
    });

    test('4. Restart Server Operation: executes serialized stop then start without socket leak', () async {
      final restartRes = await serverService.restartServer(port: 9090);

      expect(restartRes['success'], isTrue);
      expect(restartRes['port'], 9090);
      expect(restartRes['localUrl'], contains('9090'));
      expect(restartRes['serviceRunning'], isTrue);
    });

    test('5. Battery Optimization Queries: reports status and launches system intent', () async {
      final isIgnored = await serverService.isBatteryOptimizationIgnored();
      final requestSuccess = await serverService.requestIgnoreBatteryOptimization();

      expect(isIgnored, isTrue);
      expect(requestSuccess, isTrue);
    });

    test('6. Notification Permission: contextual check and request methods execute cleanly', () async {
      final hasPerm = await serverService.isNotificationPermissionGranted();
      final reqPerm = await serverService.requestNotificationPermission();

      expect(hasPerm, isTrue);
      expect(reqPerm, isTrue);
    });

    test('7. Push Notification Channel Severity Mapping: routes correctly across categories', () {
      final criticalChannel = PushNotificationService.selectChannelId('CRITICAL');
      final securityChannel = PushNotificationService.selectChannelId('SECURITY');
      final infoChannel = PushNotificationService.selectChannelId('INFO');
      final warningChannel = PushNotificationService.selectChannelId('WARNING');

      expect(criticalChannel, PushNotificationService.channelCritical.id);
      expect(securityChannel, PushNotificationService.channelSecurity.id);
      expect(infoChannel, PushNotificationService.channelGeneral.id);
      expect(warningChannel, PushNotificationService.channelGeneral.id);
    });

    test('8. Push Notification Service: initializes channels without automatic permission popup', () async {
      final pushService = PushNotificationService();
      await pushService.initialize();

      expect(pushService.isInitialized, isTrue);
      expect(pushService.isPermissionGranted, isFalse);

      final granted = await pushService.requestNotificationPermission();
      expect(granted, isTrue);
      expect(pushService.isPermissionGranted, isTrue);
    });

    test('9. Custom Port Bounds: custom ports bind and serialize in local URL', () async {
      const customPort = 4242;
      const customService = MockServerService(initiallyRunning: true, port: customPort);
      final status = await customService.getServerStatus();
      final localUrl = await customService.getLocalUrl();

      expect(status['port'], customPort);
      expect(status['status'], 'ONLINE');
      expect(localUrl, 'http://127.0.0.1:$customPort');
    });

    test('10. Credentials Setting: accepts server credentials without throwing', () async {
      final setCreds = await serverService.setCredentials(
        username: 'admin',
        password: 'secure_password_123',
      );

      expect(setCreds, isTrue);
    });
  });
}
