import 'package:flutter/services.dart';
import '../../application/camera_state.dart';
import '../entities/camera_hardware_info.dart';

/// Abstract service contract for non-destructive camera hardware capability discovery
abstract class CameraHardwareService {
  /// Probes device camera characteristics without opening cameras or starting capture
  Future<List<CameraHardwareInfo>> discoverCameras();
}

/// Native MethodChannel implementation targeting Android Camera2 CameraManager
class PlatformCameraHardwareService implements CameraHardwareService {
  static const MethodChannel _channel = MethodChannel('camera_engine');

  final MethodChannel _customChannel;

  PlatformCameraHardwareService({MethodChannel? channel})
      : _customChannel = channel ?? _channel;

  @override
  Future<List<CameraHardwareInfo>> discoverCameras() async {
    try {
      final rawList = await _customChannel
          .invokeMethod<List<dynamic>>('discoverCameras');

      if (rawList == null || rawList.isEmpty) {
        return [];
      }

      final cameras = <CameraHardwareInfo>[];
      for (final item in rawList) {
        if (item is Map) {
          cameras.add(CameraHardwareInfo.fromMap(item));
        }
      }
      return cameras;
    } catch (_) {
      // Gracefully fall back to empty list on non-Android or platform channel failure
      return [];
    }
  }
}

/// In-memory mock hardware service for unit tests with standard dual-camera device profile
class MockCameraHardwareService implements CameraHardwareService {
  List<CameraHardwareInfo> cameras;
  bool shouldThrow;

  MockCameraHardwareService({
    List<CameraHardwareInfo>? initialCameras,
    this.shouldThrow = false,
  }) : cameras = initialCameras ?? _defaultMockCameras();

  @override
  Future<List<CameraHardwareInfo>> discoverCameras() async {
    if (shouldThrow) {
      throw PlatformException(
        code: 'CAMERA_DISCOVERY_ERROR',
        message: 'Camera service temporarily unavailable',
      );
    }
    return cameras;
  }

  static List<CameraHardwareInfo> _defaultMockCameras() {
    return [
      const CameraHardwareInfo(
        cameraId: '0',
        lensFacing: CameraLensFacing.back,
        sensorOrientation: 90,
        resolutions: [
          CameraHardwareResolution(width: 1920, height: 1080),
          CameraHardwareResolution(width: 1280, height: 720),
          CameraHardwareResolution(width: 640, height: 480),
          CameraHardwareResolution(width: 640, height: 360),
        ],
        fpsRanges: [
          CameraFpsRange(min: 15, max: 15),
          CameraFpsRange(min: 15, max: 30),
          CameraFpsRange(min: 30, max: 30),
        ],
        hasFlash: true,
        hardwareLevel: 'FULL',
      ),
      const CameraHardwareInfo(
        cameraId: '1',
        lensFacing: CameraLensFacing.front,
        sensorOrientation: 270,
        resolutions: [
          CameraHardwareResolution(width: 1280, height: 720),
          CameraHardwareResolution(width: 640, height: 480),
          CameraHardwareResolution(width: 640, height: 360),
        ],
        fpsRanges: [
          CameraFpsRange(min: 15, max: 15),
          CameraFpsRange(min: 15, max: 30),
        ],
        hasFlash: false,
        hardwareLevel: 'LIMITED',
      ),
    ];
  }
}
