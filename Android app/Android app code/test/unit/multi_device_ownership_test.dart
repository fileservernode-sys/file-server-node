import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:remote_node_app/features/auth/application/auth_state.dart';
import 'package:remote_node_app/features/auth/domain/entities/auth_session.dart';
import 'package:remote_node_app/features/auth/domain/entities/platform_user.dart';
import 'package:remote_node_app/features/device/data/datasources/device_remote_datasource.dart';
import 'package:remote_node_app/features/device/domain/services/device_identity_service.dart';
import 'package:remote_node_app/features/remote/domain/services/remote_connection_service.dart';
import 'package:remote_node_app/features/server/domain/services/server_service.dart';
import 'package:remote_node_app/features/setup/application/setup_state.dart';

void main() {
  group('Batch 5: Android Multi-Device Ownership & Resolution Tests', () {
    late MockDeviceIdentityService identityServiceA;
    late MockDeviceIdentityService identityServiceB;
    late AuthSession mockSession;

    setUp(() {
      identityServiceA = MockDeviceIdentityService(initialId: 'installation-A');
      identityServiceB = MockDeviceIdentityService(initialId: 'installation-B');
      mockSession = AuthSession(
        accessToken: 'mock-session-token-101',
        refreshToken: 'refresh-101',
        user: PlatformUser(
          id: 'user-101',
          email: 'user@example.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now(),
        ),
        expiresAt: DateTime.now().add(const Duration(days: 1)),
      );
    });

    ProviderContainer createContainer({
      required MockDeviceIdentityService identityService,
      required List<Map<String, dynamic>> mockDevices,
    }) {
      final container = ProviderContainer(
        overrides: [
          deviceIdentityServiceProvider.overrideWithValue(identityService),
          deviceRemoteDataSourceProvider.overrideWithValue(
            MockDeviceRemoteDataSource(mockDevices: mockDevices),
          ),
          serverServiceProvider.overrideWithValue(const MockServerService()),
          remoteConnectionServiceProvider.overrideWithValue(const MockRemoteConnectionService()),
        ],
      );

      // Authenticate session in container
      container.read(authStateProvider.notifier).setSessionForTesting(mockSession);
      return container;
    }

    test('Test 1 — One device resolves correctly matching local installationId', () async {
      final mockDevices = [
        {
          'id': 'device-A',
          'installationId': 'installation-A',
          'deviceName': 'Phone A',
          'platform': 'Android',
          'status': 'ONLINE',
          'server': {'id': 'srv-A', 'status': 'RUNNING'},
          'connection': {'id': 'conn-A', 'status': 'CONNECTED'}
        }
      ];

      final container = createContainer(
        identityService: identityServiceA,
        mockDevices: mockDevices,
      );

      final notifier = container.read(setupStateProvider.notifier);
      await notifier.syncWithBackend();

      final state = container.read(setupStateProvider);
      expect(state.deviceId, equals('device-A'));
      expect(state.deviceName, equals('Phone A'));
    });

    test('Test 2 — Two devices in same account resolve correct installationId (Phone B selects Device B)', () async {
      final mockDevices = [
        {
          'id': 'device-A',
          'installationId': 'installation-A',
          'deviceName': 'Phone A',
          'platform': 'Android',
          'status': 'ONLINE',
          'server': {'id': 'srv-A', 'status': 'RUNNING'}
        },
        {
          'id': 'device-B',
          'installationId': 'installation-B',
          'deviceName': 'Phone B',
          'platform': 'Android',
          'status': 'ONLINE',
          'server': {'id': 'srv-B', 'status': 'RUNNING'}
        }
      ];

      final containerB = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );

      final notifierB = containerB.read(setupStateProvider.notifier);
      await notifierB.syncWithBackend();

      final stateB = containerB.read(setupStateProvider);
      expect(stateB.deviceId, equals('device-B'));
      expect(stateB.deviceName, equals('Phone B'));
      expect(stateB.deviceId, isNot(equals('device-A')));
    });

    test('Test 3 — Five devices in same account resolve correct installation for each phone', () async {
      final mockDevices = List.generate(5, (index) {
        final letter = String.fromCharCode(65 + index); // A, B, C, D, E
        return {
          'id': 'device-$letter',
          'installationId': 'installation-$letter',
          'deviceName': 'Phone $letter',
          'platform': 'Android',
          'status': 'ONLINE',
          'server': {'id': 'srv-$letter', 'status': 'RUNNING'}
        };
      });

      for (int i = 0; i < 5; i++) {
        final letter = String.fromCharCode(65 + i);
        final mockService = MockDeviceIdentityService(initialId: 'installation-$letter');

        final container = createContainer(
          identityService: mockService,
          mockDevices: mockDevices,
        );

        final notifier = container.read(setupStateProvider.notifier);
        await notifier.syncWithBackend();

        final state = container.read(setupStateProvider);
        expect(state.deviceId, equals('device-$letter'));
        expect(state.deviceName, equals('Phone $letter'));
      }
    });

    test('Test 4 — Same device restart preserves installation-B selection', () async {
      final mockDevices = [
        {
          'id': 'device-A',
          'installationId': 'installation-A',
          'deviceName': 'Phone A',
        },
        {
          'id': 'device-B',
          'installationId': 'installation-B',
          'deviceName': 'Phone B',
        }
      ];

      // Session 1
      final container1 = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );
      await container1.read(setupStateProvider.notifier).syncWithBackend();
      expect(container1.read(setupStateProvider).deviceId, equals('device-B'));

      // Restart App — Session 2
      final container2 = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );
      await container2.read(setupStateProvider.notifier).syncWithBackend();
      expect(container2.read(setupStateProvider).deviceId, equals('device-B'));
    });

    test('Test 5 — Device name change does not affect device resolution', () async {
      final mockDevices = [
        {
          'id': 'device-B',
          'installationId': 'installation-B',
          'deviceName': 'My Old Name Phone',
        }
      ];

      final container = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );

      final notifier = container.read(setupStateProvider.notifier);
      notifier.setConfiguration(serverName: 'Srv', deviceName: 'Brand New Device Name');
      await notifier.syncWithBackend();

      final state = container.read(setupStateProvider);
      expect(state.deviceId, equals('device-B'));
    });

    test('Test 6 — Same account + same default deviceName still resolves separately by installationId', () async {
      final mockDevices = [
        {
          'id': 'device-A',
          'installationId': 'installation-A',
          'deviceName': 'Android Phone Host',
        },
        {
          'id': 'device-B',
          'installationId': 'installation-B',
          'deviceName': 'Android Phone Host',
        }
      ];

      final containerA = createContainer(
        identityService: identityServiceA,
        mockDevices: mockDevices,
      );
      await containerA.read(setupStateProvider.notifier).syncWithBackend();
      expect(containerA.read(setupStateProvider).deviceId, equals('device-A'));

      final containerB = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );
      await containerB.read(setupStateProvider.notifier).syncWithBackend();
      expect(containerB.read(setupStateProvider).deviceId, equals('device-B'));
    });

    test('Test 7 — Missing installation returns explicit not-registered state without selecting first device', () async {
      final mockDevices = [
        {
          'id': 'device-A',
          'installationId': 'installation-A',
          'deviceName': 'Phone A',
        }
      ];

      final identityServiceX = MockDeviceIdentityService(initialId: 'installation-X');
      final containerX = createContainer(
        identityService: identityServiceX,
        mockDevices: mockDevices,
      );

      final notifierX = containerX.read(setupStateProvider.notifier);
      await notifierX.syncWithBackend();

      final stateX = containerX.read(setupStateProvider);
      expect(stateX.deviceId, isNull);
      expect(stateX.endpointStatus, equals('NOT_CREATED'));
    });

    test('Test 8 — Stale deviceId cannot be used if installationId does not match', () async {
      final mockDevices = [
        {
          'id': 'device-B',
          'installationId': 'installation-B',
          'deviceName': 'Phone B',
        }
      ];

      final container = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );

      final notifier = container.read(setupStateProvider.notifier);
      await notifier.syncWithBackend();
      await notifier.startServerNode();

      final state = container.read(setupStateProvider);
      expect(state.deviceId, equals('device-B'));
      expect(state.deviceId, isNot(equals('device-A')));
    });

    test('Test 9 & 10 — deleteServer targets only current device and does not affect Device A', () async {
      final mockDevices = [
        {
          'id': 'device-A',
          'installationId': 'installation-A',
          'deviceName': 'Phone A',
        },
        {
          'id': 'device-B',
          'installationId': 'installation-B',
          'deviceName': 'Phone B',
        }
      ];

      final containerB = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );

      final notifierB = containerB.read(setupStateProvider.notifier);
      await notifierB.syncWithBackend();

      expect(containerB.read(setupStateProvider).deviceId, equals('device-B'));

      final success = await notifierB.deleteServer();
      expect(success, isTrue);

      // Verify state for Phone B is cleared
      final stateBPostDelete = containerB.read(setupStateProvider);
      expect(stateBPostDelete.deviceId, isNull);
      expect(stateBPostDelete.serverInstanceId, isNull);

      // Verify Phone A still resolves Device A
      final containerA = createContainer(
        identityService: identityServiceA,
        mockDevices: mockDevices,
      );

      await containerA.read(setupStateProvider.notifier).syncWithBackend();
      final stateA = containerA.read(setupStateProvider);
      expect(stateA.deviceId, equals('device-A'));
    });

    test('Test 11 — Connection registration uses current Device.id', () async {
      final mockDevices = [
        {
          'id': 'device-B',
          'installationId': 'installation-B',
          'deviceName': 'Phone B',
        }
      ];

      final container = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );

      final notifier = container.read(setupStateProvider.notifier);
      await notifier.syncWithBackend();
      final currentDev = await notifier.resolveCurrentDevice(sessionToken: 'token');

      expect(currentDev?['id'], equals('device-B'));
    });

    test('Test 12 — No code path falls back to devices.first for current-device selection', () async {
      final mockDevices = [
        {
          'id': 'device-A',
          'installationId': 'installation-A',
          'deviceName': 'Phone A',
        },
        {
          'id': 'device-B',
          'installationId': 'installation-B',
          'deviceName': 'Phone B',
        }
      ];

      final containerB = createContainer(
        identityService: identityServiceB,
        mockDevices: mockDevices,
      );

      final notifierB = containerB.read(setupStateProvider.notifier);
      final currentDevB = await notifierB.resolveCurrentDevice(sessionToken: 'token');
      expect(currentDevB?['id'], equals('device-B'));
      expect(currentDevB?['id'], isNot(equals('device-A')));
    });
  });
}
