import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/camera/domain/entities/camera_hardware_info.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_permission_service.dart';

void main() {
  group('CameraPermissionService Tests (Phase 21.3 / 21.3.1)', () {
    test('MockCameraPermissionService returns configured camera status', () async {
      final service = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.granted,
        micStatus: CameraPermissionStatus.denied,
      );

      final camStatus = await service.checkCameraPermission();
      expect(camStatus, equals(CameraPermissionStatus.granted));

      final micStatus = await service.checkMicrophonePermission();
      expect(micStatus, equals(CameraPermissionStatus.denied));
    });

    test('Microphone permission remains optional and isolated from camera permission', () async {
      final service = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.granted,
        micStatus: CameraPermissionStatus.permanentlyDenied,
      );

      expect(await service.checkCameraPermission(), equals(CameraPermissionStatus.granted));
      expect(await service.checkMicrophonePermission(), equals(CameraPermissionStatus.permanentlyDenied));
    });

    test('openAppSettings records invocation in mock', () async {
      final service = MockCameraPermissionService();
      expect(service.settingsOpened, isFalse);

      final result = await service.openAppSettings();
      expect(result, isTrue);
      expect(service.settingsOpened, isTrue);
    });

    test('Camera permission request updates granted status', () async {
      final service = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.denied,
      );

      expect(await service.checkCameraPermission(), equals(CameraPermissionStatus.denied));
      service.cameraStatus = CameraPermissionStatus.granted;
      expect(await service.requestCameraPermission(), equals(CameraPermissionStatus.granted));
    });

    test('Interrupted or cancelled permission request returns denied without leaking callbacks', () async {
      final service = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.denied,
      );

      final result = await service.requestCameraPermission();
      expect(result, equals(CameraPermissionStatus.denied));
    });
  });
}
