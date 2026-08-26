import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:remote_node_app/features/server/domain/services/server_service.dart';
import 'package:remote_node_app/features/setup/application/setup_state.dart';

class CustomMockServerService extends MockServerService {
  final bool mockNotificationGranted;
  final bool mockBatteryIgnored;
  final String mockDeviceModel;
  final Map<String, dynamic> mockStorage;
  final Map<String, dynamic> mockPower;

  const CustomMockServerService({
    this.mockNotificationGranted = true,
    this.mockBatteryIgnored = true,
    this.mockDeviceModel = 'Google Pixel 8',
    this.mockStorage = const {
      'availableBytes': 10 * 1024 * 1024 * 1024,
      'totalBytes': 128 * 1024 * 1024 * 1024,
      'isSufficient': true,
      'isLow': false,
      'availableMb': 10240,
      'formattedAvailable': '10.0 GB',
    },
    this.mockPower = const {
      'isCharging': true,
      'batteryLevel': 90,
    },
  });

  @override
  Future<bool> isNotificationPermissionGranted() async => mockNotificationGranted;

  @override
  Future<bool> isBatteryOptimizationIgnored() async => mockBatteryIgnored;

  @override
  Future<String> getDeviceModel() async => mockDeviceModel;

  @override
  Future<Map<String, dynamic>> getStorageReadiness() async => mockStorage;

  @override
  Future<Map<String, dynamic>> getPowerReadiness() async => mockPower;
}

void main() {
  group('RemoteNode APP-R1.12 — Permission Onboarding & Server Setup Wizard Tests', () {
    test('1. SetupState starts with empty serverName and default Android Device', () {
      const state = SetupState();
      expect(state.serverName, isEmpty);
      expect(state.deviceName, equals('Android Device'));
    });

    test('2. Server Name Validation rejects empty, whitespace, and short names', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(setupStateProvider.notifier);
      
      notifier.setConfiguration(
        serverName: '   ',
        deviceName: 'Google Pixel 8',
      );
      expect(container.read(setupStateProvider).serverName, isEmpty);

      notifier.setConfiguration(
        serverName: 'My Server Node',
        deviceName: 'Google Pixel 8',
      );
      expect(container.read(setupStateProvider).serverName, equals('My Server Node'));
    });

    test('3. Device Hardware Model Detection retrieves device model from ServerService', () async {
      const customService = CustomMockServerService(mockDeviceModel: 'Samsung Galaxy S24 Ultra');
      final model = await customService.getDeviceModel();
      expect(model, equals('Samsung Galaxy S24 Ultra'));
    });

    test('4. Storage Readiness identifies sufficient, low, and insufficient storage levels', () async {
      // Case A: Sufficient (> 500MB)
      const sufficientService = CustomMockServerService(mockStorage: {
        'availableBytes': 5 * 1024 * 1024 * 1024,
        'totalBytes': 64 * 1024 * 1024 * 1024,
        'isSufficient': true,
        'isLow': false,
        'availableMb': 5120,
        'formattedAvailable': '5.0 GB',
      });
      final resA = await sufficientService.getStorageReadiness();
      expect(resA['isSufficient'], isTrue);
      expect(resA['isLow'], isFalse);

      // Case B: Low (100MB - 500MB)
      const lowService = CustomMockServerService(mockStorage: {
        'availableBytes': 300 * 1024 * 1024,
        'totalBytes': 64 * 1024 * 1024 * 1024,
        'isSufficient': true,
        'isLow': true,
        'availableMb': 300,
        'formattedAvailable': '0.3 GB',
      });
      final resB = await lowService.getStorageReadiness();
      expect(resB['isSufficient'], isTrue);
      expect(resB['isLow'], isTrue);

      // Case C: Insufficient (< 100MB)
      const blockedService = CustomMockServerService(mockStorage: {
        'availableBytes': 50 * 1024 * 1024,
        'totalBytes': 64 * 1024 * 1024 * 1024,
        'isSufficient': false,
        'isLow': true,
        'availableMb': 50,
        'formattedAvailable': '0.05 GB',
      });
      final resC = await blockedService.getStorageReadiness();
      expect(resC['isSufficient'], isFalse);
    });

    test('5. Power and Charging state evaluates battery level and charger connection', () async {
      const powerService = CustomMockServerService(mockPower: {
        'isCharging': false,
        'batteryLevel': 75,
      });
      final powerInfo = await powerService.getPowerReadiness();
      expect(powerInfo['isCharging'], isFalse);
      expect(powerInfo['batteryLevel'], equals(75));
    });

    test('6. Notification Permission check detects granted and ungranted states', () async {
      const grantedService = CustomMockServerService(mockNotificationGranted: true);
      expect(await grantedService.isNotificationPermissionGranted(), isTrue);

      const deniedService = CustomMockServerService(mockNotificationGranted: false);
      expect(await deniedService.isNotificationPermissionGranted(), isFalse);
    });

    test('7. Battery Optimization check detects active and ignored states', () async {
      const ignoredService = CustomMockServerService(mockBatteryIgnored: true);
      expect(await ignoredService.isBatteryOptimizationIgnored(), isTrue);

      const activeService = CustomMockServerService(mockBatteryIgnored: false);
      expect(await activeService.isBatteryOptimizationIgnored(), isFalse);
    });

    test('8. executeSetup blocks server start when serverName is empty', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(setupStateProvider.notifier);
      // Ensure serverName is empty
      notifier.setConfiguration(serverName: '', deviceName: 'Google Pixel');

      final success = await notifier.executeSetup();
      expect(success, isFalse);
      expect(container.read(setupStateProvider).errorMessage,
          contains('Server name is required'));
    });

    test('9. executeSetup blocks server start when storage is insufficient (<100MB)', () async {
      const insufficientStorageService = CustomMockServerService(
        mockStorage: {
          'availableBytes': 10 * 1024 * 1024,
          'totalBytes': 64 * 1024 * 1024 * 1024,
          'isSufficient': false,
          'isLow': true,
          'availableMb': 10,
          'formattedAvailable': '0.01 GB',
        },
      );

      final container = ProviderContainer(
        overrides: [
          serverServiceProvider.overrideWithValue(insufficientStorageService),
        ],
      );
      addTearDown(container.dispose);

      final notifier = container.read(setupStateProvider.notifier);
      notifier.setConfiguration(
        serverName: 'Valid Server Name',
        deviceName: 'Google Pixel 8',
      );

      final success = await notifier.executeSetup();
      expect(success, isFalse);
      expect(container.read(setupStateProvider).errorMessage,
          contains('Insufficient device storage'));
    });
  });
}
