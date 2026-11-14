import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/camera/application/camera_state.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_registration_service.dart';

void main() {
  group('CameraRegistrationService Tests (Phase 21.3 / 21.3.1)', () {
    test('MockCameraRegistrationService succeeds with mock camera instance', () async {
      final service = MockCameraRegistrationService(
        shouldSucceed: true,
        mockCameraId: 'cam_unit_test_999',
      );

      final res = await service.registerCamera(
        sessionToken: 'valid_jwt_token',
        cameraName: 'Living Room Camera',
        installationId: 'inst-1111-2222-3333-4444',
        lensFacing: CameraLensFacing.back,
        resolution: CameraResolutionPreset.p720,
        fps: 30,
        audioEnabled: false,
      );

      expect(res['success'], isTrue);
      expect(res['data']['camera']['id'], equals('cam_unit_test_999'));
      expect(res['data']['camera']['status'], equals('OFFLINE'));
      expect(res['data']['camera']['lensFacing'], equals('BACK'));
      expect(res['data']['camera']['fps'], equals(30));
    });

    test('registerCameraDevice registers device with purpose: CAMERA and returns deviceCredential', () async {
      final service = MockCameraRegistrationService(
        shouldSucceed: true,
        mockDeviceId: 'dev_test_555',
        mockDeviceCredential: 'cred_mock_secret_token_123',
      );

      final res = await service.registerCameraDevice(
        sessionToken: 'valid_jwt_token',
        deviceName: 'Android Node',
        installationId: 'inst-node-1234',
      );

      expect(res['success'], isTrue);
      expect(res['data']['device']['id'], equals('dev_test_555'));
      expect(res['data']['device']['status'], equals('ONLINE'));
      expect(res['data']['deviceCredential'], equals('cred_mock_secret_token_123'));
    });

    test('listCameras supports pagination and returns hasMore and totalCount', () async {
      final service = MockCameraRegistrationService(
        shouldSucceed: true,
        initialExistingCameras: [
          {'id': 'cam_1', 'deviceId': 'dev_test_555', 'cameraName': 'Cam 1'},
          {'id': 'cam_2', 'deviceId': 'dev_test_555', 'cameraName': 'Cam 2'},
          {'id': 'cam_3', 'deviceId': 'dev_test_555', 'cameraName': 'Cam 3'},
        ],
      );

      final page1Res = await service.listCameras(
        sessionToken: 'valid_jwt_token',
        deviceId: 'dev_test_555',
        page: 1,
        limit: 2,
      );

      expect(page1Res['success'], isTrue);
      final page1Data = page1Res['data'];
      expect((page1Data['cameras'] as List).length, equals(2));
      expect(page1Data['totalCount'], equals(3));
      expect(page1Data['hasMore'], isTrue);

      final page2Res = await service.listCameras(
        sessionToken: 'valid_jwt_token',
        deviceId: 'dev_test_555',
        page: 2,
        limit: 2,
      );

      expect(page2Res['success'], isTrue);
      final page2Data = page2Res['data'];
      expect((page2Data['cameras'] as List).length, equals(1));
      expect(page2Data['hasMore'], isFalse);
    });

    test('listCameras filters existing cameras by deviceId for idempotent reuse', () async {
      final service = MockCameraRegistrationService(
        shouldSucceed: true,
        initialExistingCameras: [
          {
            'id': 'cam_existing_001',
            'deviceId': 'dev_test_555',
            'cameraName': 'Existing Back Camera',
            'status': 'OFFLINE',
          },
          {
            'id': 'cam_other_002',
            'deviceId': 'dev_other_999',
            'cameraName': 'Other Device Cam',
            'status': 'OFFLINE',
          },
        ],
      );

      final res = await service.listCameras(
        sessionToken: 'valid_jwt_token',
        deviceId: 'dev_test_555',
      );

      expect(res['success'], isTrue);
      final cameras = res['data']['cameras'] as List;
      expect(cameras.length, equals(1));
      expect(cameras.first['id'], equals('cam_existing_001'));
      expect(cameras.first['deviceId'], equals('dev_test_555'));
    });

    test('updateCameraConfig updates existing camera settings', () async {
      final service = MockCameraRegistrationService(shouldSucceed: true);

      final res = await service.updateCameraConfig(
        sessionToken: 'valid_jwt_token',
        cameraId: 'cam_existing_001',
        cameraName: 'Renamed Camera',
        resolution: CameraResolutionPreset.p1080,
        fps: 15,
      );

      expect(res['success'], isTrue);
      expect(res['data']['camera']['id'], equals('cam_existing_001'));
      expect(res['data']['camera']['cameraName'], equals('Renamed Camera'));
    });

    test('MockCameraRegistrationService fails when shouldSucceed is false', () async {
      final service = MockCameraRegistrationService(
        shouldSucceed: false,
        failureCode: 'CAMERA_LIMIT_REACHED',
        failureMessage: 'Account camera tier limit reached.',
      );

      final res = await service.registerCamera(
        sessionToken: 'valid_jwt_token',
        cameraName: 'Porch Camera',
        installationId: 'inst-1111-2222-3333-4444',
        lensFacing: CameraLensFacing.front,
        resolution: CameraResolutionPreset.p480,
        fps: 15,
        audioEnabled: false,
      );

      expect(res['success'], isFalse);
      expect(res['error']['code'], equals('CAMERA_LIMIT_REACHED'));
    });

    test('HttpCameraRegistrationService rejects empty sessionToken with UNAUTHENTICATED', () async {
      final service = HttpCameraRegistrationService(baseUrl: 'http://localhost:3000/api/v1');

      final res = await service.registerCamera(
        sessionToken: '',
        cameraName: 'Test Camera',
        installationId: 'inst-test',
        lensFacing: CameraLensFacing.back,
        resolution: CameraResolutionPreset.p720,
        fps: 30,
        audioEnabled: false,
      );

      expect(res['success'], isFalse);
      expect(res['error']['code'], equals('UNAUTHENTICATED'));

      final listRes = await service.listCameras(
        sessionToken: '',
        deviceId: 'dev-test',
      );
      expect(listRes['success'], isFalse);
      expect(listRes['error']['code'], equals('UNAUTHENTICATED'));
    });

    test('MockCameraRegistrationService simulates specific page failures for fail-closed verification', () async {
      final service = MockCameraRegistrationService(
        shouldSucceed: true,
        failOnPage: 2,
      );

      final p1 = await service.listCameras(sessionToken: 'jwt', page: 1);
      expect(p1['success'], isTrue);

      final p2 = await service.listCameras(sessionToken: 'jwt', page: 2);
      expect(p2['success'], isFalse);
      expect(p2['error']['code'], equals('PAGE_ERROR'));
    });
  });
}
