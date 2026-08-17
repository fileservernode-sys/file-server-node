import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/server/domain/services/server_service.dart';
import 'package:remote_node_app/features/device/domain/repositories/device_repository.dart';
import 'package:remote_node_app/features/device/data/datasources/device_remote_datasource.dart';
import 'package:remote_node_app/core/storage/secure_storage_service.dart';

void main() {
  group('Batch 6F Local Server Engine Service Tests', () {
    late ServerService mockServerService;

    setUp(() {
      mockServerService =
          const MockServerService(initiallyRunning: false, port: 8080);
    });

    test('MockServerService returns stopped status initially', () async {
      final status = await mockServerService.getServerStatus();
      expect(status['status'], equals('STOPPED'));
      expect(status['port'], equals(8080));
    });

    test('MockServerService starts local server engine cleanly', () async {
      final res = await mockServerService.startServer(port: 8080);
      expect(res['success'], isTrue);
      expect(res['localUrl'], equals('http://127.0.0.1:8080'));
    });

    test('MockServerService stops local server engine cleanly', () async {
      final res = await mockServerService.stopServer();
      expect(res['success'], isTrue);
    });

    test('MockServerService restarts local server engine cleanly', () async {
      final res = await mockServerService.restartServer(port: 8080);
      expect(res['success'], isTrue);
      expect(res['port'], equals(8080));
    });
  });

  group('Batch 6F Device Repository & Installation Identity Tests', () {
    late DeviceRepository deviceRepository;

    setUp(() {
      deviceRepository = DeviceRepositoryImpl(
        remoteDataSource: const MockDeviceRemoteDataSource(),
        secureStorageService: InMemorySecureStorageService(),
      );
    });

    test('Generates and persists stable privacy-minimal installationId',
        () async {
      final id1 = await deviceRepository.getOrCreateInstallationId();
      expect(id1, startsWith('inst-'));

      final id2 = await deviceRepository.getOrCreateInstallationId();
      expect(id2, equals(id1));
    });

    test('Registers device node under platform session', () async {
      final res = await deviceRepository.registerDevice(
        deviceName: 'Pixel 7 Host Phone',
        sessionToken: 'mock-session-token',
      );

      expect(res['success'], isTrue);
      final device = res['data']['device'];
      expect(device['deviceName'], equals('Pixel 7 Host Phone'));
      expect(device['status'], equals('ONLINE'));
    });

    test('Sends heartbeat for registered device', () async {
      final res = await deviceRepository.sendHeartbeat(
        deviceId: 'mock-device-id-101',
        sessionToken: 'mock-session-token',
      );

      expect(res, isTrue);
    });
  });
}
