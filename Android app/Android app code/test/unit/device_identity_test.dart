import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:remote_node_app/core/storage/secure_storage_service.dart';
import 'package:remote_node_app/features/auth/domain/entities/auth_session.dart';
import 'package:remote_node_app/features/auth/domain/entities/platform_user.dart';
import 'package:remote_node_app/features/device/data/datasources/device_remote_datasource.dart';
import 'package:remote_node_app/features/device/domain/services/device_identity_service.dart';
import 'package:remote_node_app/features/server/domain/services/server_service.dart';
import 'package:remote_node_app/features/setup/application/setup_state.dart';

void main() {
  group('Batch 2: DeviceIdentityService & Installation Identity Tests', () {
    late SecureStorageService storage;
    late DeviceIdentityService identityService;

    setUp(() {
      storage = InMemorySecureStorageService();
      identityService = MethodChannelDeviceIdentityService(storage: storage);
    });

    test('Test 1 — First access: identity is generated and persisted', () async {
      // Initially no identity stored
      final storedBefore = await storage.read(key: 'device_installation_id');
      expect(storedBefore, isNull);

      final id = await identityService.getInstallationId();
      expect(id, isNotEmpty);
      expect(id, startsWith('inst-'));

      final storedAfter = await storage.read(key: 'device_installation_id');
      expect(storedAfter, equals(id));
    });

    test('Test 2 — Second access: same identity returned', () async {
      final id1 = await identityService.getInstallationId();
      final id2 = await identityService.getInstallationId();

      expect(id1, isNotEmpty);
      expect(id2, equals(id1));
    });

    test('Test 3 — Setup executed twice: same installationId, no new identity',
        () async {
      final serviceA = MethodChannelDeviceIdentityService(storage: storage);
      final id1 = await serviceA.getInstallationId();

      final serviceB = MethodChannelDeviceIdentityService(storage: storage);
      final id2 = await serviceB.getInstallationId();

      expect(id2, equals(id1));
    });

    test('Test 4 — Logout/login simulation: same installationId', () async {
      final idBefore = await identityService.getInstallationId();

      // Simulate clearSession (logout)
      await storage.clearSession();

      // Re-initialize service or retrieve identity post-login
      final idAfter = await identityService.getInstallationId();
      expect(idAfter, equals(idBefore));
    });

    test('Test 5 — Server restart simulation: same installationId', () async {
      final idBefore = await identityService.getInstallationId();

      const serverService = MockServerService(initiallyRunning: false);
      await serverService.startServer();
      await serverService.stopServer();
      await serverService.restartServer();

      final idAfter = await identityService.getInstallationId();
      expect(idAfter, equals(idBefore));
    });

    test(
        'Test 6 — Two independent installations: installationId A != installationId B',
        () async {
      final storageA = InMemorySecureStorageService();
      final identityServiceA =
          MethodChannelDeviceIdentityService(storage: storageA);
      final idA = await identityServiceA.getInstallationId();

      final storageB = InMemorySecureStorageService();
      final identityServiceB =
          MethodChannelDeviceIdentityService(storage: storageB);
      final idB = await identityServiceB.getInstallationId();

      expect(idA, isNotEmpty);
      expect(idB, isNotEmpty);
      expect(idA, isNot(equals(idB)));
    });

    test('Test 7 — Device name changes: installationId DOES NOT CHANGE',
        () async {
      final sharedStorage = InMemorySecureStorageService();
      final sharedIdentityService =
          MethodChannelDeviceIdentityService(storage: sharedStorage);

      final container = ProviderContainer(
        overrides: [
          deviceIdentityServiceProvider
              .overrideWithValue(sharedIdentityService),
          deviceRemoteDataSourceProvider
              .overrideWithValue(const MockDeviceRemoteDataSource()),
          serverServiceProvider
              .overrideWithValue(const MockServerService()),
        ],
      );

      final notifier = container.read(setupStateProvider.notifier);

      // 1. Initial configuration: "Android Phone Host"
      notifier.setConfiguration(
        serverName: 'Server 1',
        deviceName: 'Android Phone Host',
      );
      final id1 = await sharedIdentityService.getInstallationId();

      // 2. Change device name to "My Pixel"
      notifier.setConfiguration(
        serverName: 'Server 1',
        deviceName: 'My Pixel',
      );
      final id2 = await sharedIdentityService.getInstallationId();

      expect(id1, isNotEmpty);
      expect(id2, equals(id1));
    });

    test('Test 8 — Email/Account changes: installationId DOES NOT CHANGE',
        () async {
      final sharedStorage = InMemorySecureStorageService();
      final sharedIdentityService =
          MethodChannelDeviceIdentityService(storage: sharedStorage);

      final id1 = await sharedIdentityService.getInstallationId();

      // Account 1 login
      final session1 = AuthSession(
        accessToken: 'token-user-1',
        refreshToken: 'refresh-1',
        user: PlatformUser(
          id: 'u1',
          email: 'user1@example.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now(),
        ),
        expiresAt: DateTime.now().add(const Duration(days: 1)),
      );
      await sharedStorage.saveSession(session1);
      final idAccount1 = await sharedIdentityService.getInstallationId();
      expect(idAccount1, equals(id1));

      // Account 2 login
      final session2 = AuthSession(
        accessToken: 'token-user-2',
        refreshToken: 'refresh-2',
        user: PlatformUser(
          id: 'u2',
          email: 'user2@example.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now(),
        ),
        expiresAt: DateTime.now().add(const Duration(days: 1)),
      );
      await sharedStorage.saveSession(session2);
      final idAccount2 = await sharedIdentityService.getInstallationId();
      expect(idAccount2, equals(id1));
    });
  });
}
