import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/camera/application/camera_state.dart';
import 'package:remote_node_app/features/camera/domain/entities/camera_hardware_info.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_hardware_service.dart';

void main() {
  group('CameraHardwareService & Entity Tests (Phase 21.3 / 21.3.1)', () {
    test('CameraHardwareInfo.fromMap parses logical camera and physical camera IDs', () {
      final map = {
        'cameraId': '0',
        'lensFacing': 'BACK',
        'sensorOrientation': 90,
        'isLogical': true,
        'physicalCameraIds': ['2', '3'],
        'hasFlash': true,
        'hardwareLevel': 'FULL',
        'resolutions': [
          {'width': 1920, 'height': 1080, 'maxFps': 30, 'isVerified': true},
          {'width': 1280, 'height': 720, 'maxFps': 60, 'isVerified': true},
          {'width': 640, 'height': 480, 'maxFps': null, 'isVerified': false},
        ],
        'fpsRanges': [
          {'min': 15, 'max': 15},
          {'min': 15, 'max': 30},
          {'min': 30, 'max': 30},
        ],
      };

      final info = CameraHardwareInfo.fromMap(map);

      expect(info.cameraId, equals('0'));
      expect(info.lensFacing, equals(CameraLensFacing.back));
      expect(info.isLogical, isTrue);
      expect(info.physicalCameraIds, equals(['2', '3']));
      expect(info.hasFlash, isTrue);
      expect(info.hardwareLevel, equals('FULL'));
      expect(info.resolutions.length, equals(3));
      expect(info.resolutions.first.maxFps, equals(30));
      expect(info.resolutions.first.isVerified, isTrue);
      expect(info.displayTitle, contains('Logical'));
      expect(info.displayTitle, contains('Sensors: 2, 3'));
    });

    test('evaluateCombination returns halVerified when HAL verified minimum frame duration allows target FPS', () {
      const info = CameraHardwareInfo(
        cameraId: '0',
        lensFacing: CameraLensFacing.back,
        sensorOrientation: 90,
        resolutions: [
          CameraHardwareResolution(
            width: 1920,
            height: 1080,
            maxFps: 30,
            isVerified: true,
          ),
        ],
        fpsRanges: [
          CameraFpsRange(min: 15, max: 30),
        ],
      );

      final status = info.evaluateCombination(CameraResolutionPreset.p1080, 30);
      expect(status, equals(CombinationSupportStatus.halVerified));
      expect(status.isHalVerified, isTrue);
    });

    test('evaluateCombination returns unsupported when target FPS exceeds HAL maxFps', () {
      const info = CameraHardwareInfo(
        cameraId: '0',
        lensFacing: CameraLensFacing.back,
        sensorOrientation: 90,
        resolutions: [
          CameraHardwareResolution(
            width: 1920,
            height: 1080,
            maxFps: 15, // Sensor cannot exceed 15 FPS at 1080p
            isVerified: true,
          ),
        ],
        fpsRanges: [
          CameraFpsRange(min: 15, max: 15),
          CameraFpsRange(min: 15, max: 30),
        ],
      );

      final status = info.evaluateCombination(CameraResolutionPreset.p1080, 30);
      expect(status, equals(CombinationSupportStatus.unsupported));
    });

    test('evaluateCombination returns unverified when HAL does not specify min frame duration', () {
      const info = CameraHardwareInfo(
        cameraId: '0',
        lensFacing: CameraLensFacing.back,
        sensorOrientation: 90,
        resolutions: [
          CameraHardwareResolution(
            width: 1280,
            height: 720,
            maxFps: null,
            isVerified: false,
          ),
        ],
        fpsRanges: [
          CameraFpsRange(min: 15, max: 30),
        ],
      );

      final status = info.evaluateCombination(CameraResolutionPreset.p720, 30);
      expect(status, equals(CombinationSupportStatus.unverified));
    });

    test('supportsResolutionPreset validates 1080p, 720p, 480p, 360p correctly', () {
      const info720pOnly = CameraHardwareInfo(
        cameraId: '1',
        lensFacing: CameraLensFacing.front,
        sensorOrientation: 270,
        resolutions: [
          CameraHardwareResolution(width: 1280, height: 720),
          CameraHardwareResolution(width: 640, height: 480),
        ],
      );

      expect(info720pOnly.supportsResolutionPreset(CameraResolutionPreset.p720), isTrue);
      expect(info720pOnly.supportsResolutionPreset(CameraResolutionPreset.p480), isTrue);
      expect(info720pOnly.supportsResolutionPreset(CameraResolutionPreset.p1080), isFalse);
    });

    test('supportsFps accurately evaluates supported auto-exposure ranges', () {
      const info = CameraHardwareInfo(
        cameraId: '0',
        lensFacing: CameraLensFacing.back,
        sensorOrientation: 90,
        fpsRanges: [
          CameraFpsRange(min: 15, max: 15),
          CameraFpsRange(min: 15, max: 30),
        ],
      );

      expect(info.supportsFps(15), isTrue);
      expect(info.supportsFps(30), isTrue);
      expect(info.supportsFps(60), isFalse);
    });

    test('MockCameraHardwareService discovers dual-camera hardware profile without capture', () async {
      final service = MockCameraHardwareService();
      final cameras = await service.discoverCameras();

      expect(cameras.length, equals(2));
      expect(cameras.first.lensFacing, equals(CameraLensFacing.back));
      expect(cameras.last.lensFacing, equals(CameraLensFacing.front));
    });

    test('MockCameraHardwareService throws PlatformException on hardware failure', () async {
      final service = MockCameraHardwareService(shouldThrow: true);
      expect(() => service.discoverCameras(), throwsA(isA<Exception>()));
    });
  });
}
