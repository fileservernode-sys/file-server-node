import 'package:flutter/services.dart';
import '../entities/camera_hardware_info.dart';

/// Abstract service contract for Android camera and microphone runtime permissions
abstract class CameraPermissionService {
  /// Queries camera permission status without triggering user prompt
  Future<CameraPermissionStatus> checkCameraPermission();

  /// Requests camera permission via system prompt
  Future<CameraPermissionStatus> requestCameraPermission();

  /// Queries microphone permission status without triggering user prompt
  Future<CameraPermissionStatus> checkMicrophonePermission();

  /// Requests microphone permission via system prompt
  Future<CameraPermissionStatus> requestMicrophonePermission();

  /// Opens Android application details settings
  Future<bool> openAppSettings();
}

/// Native MethodChannel implementation targeting Android CameraEngineHandler
class PlatformCameraPermissionService implements CameraPermissionService {
  static const MethodChannel _channel = MethodChannel('camera_engine');

  final MethodChannel _customChannel;

  PlatformCameraPermissionService({MethodChannel? channel})
      : _customChannel = channel ?? _channel;

  @override
  Future<CameraPermissionStatus> checkCameraPermission() async {
    try {
      final statusStr = await _customChannel.invokeMethod<String>('checkCameraPermission');
      return _parseStatus(statusStr);
    } catch (_) {
      return CameraPermissionStatus.denied;
    }
  }

  @override
  Future<CameraPermissionStatus> requestCameraPermission() async {
    try {
      final statusStr = await _customChannel.invokeMethod<String>('requestCameraPermission');
      return _parseStatus(statusStr);
    } catch (_) {
      return CameraPermissionStatus.denied;
    }
  }

  @override
  Future<CameraPermissionStatus> checkMicrophonePermission() async {
    try {
      final statusStr = await _customChannel.invokeMethod<String>('checkMicrophonePermission');
      return _parseStatus(statusStr);
    } catch (_) {
      return CameraPermissionStatus.denied;
    }
  }

  @override
  Future<CameraPermissionStatus> requestMicrophonePermission() async {
    try {
      final statusStr = await _customChannel.invokeMethod<String>('requestMicrophonePermission');
      return _parseStatus(statusStr);
    } catch (_) {
      return CameraPermissionStatus.denied;
    }
  }

  @override
  Future<bool> openAppSettings() async {
    try {
      final res = await _customChannel.invokeMethod<bool>('openAppSettings');
      return res ?? false;
    } catch (_) {
      return false;
    }
  }

  static CameraPermissionStatus _parseStatus(String? status) {
    switch (status) {
      case 'granted':
        return CameraPermissionStatus.granted;
      case 'permanently_denied':
        return CameraPermissionStatus.permanentlyDenied;
      case 'denied':
      default:
        return CameraPermissionStatus.denied;
    }
  }
}

/// Configurable mock service for unit and widget testing
class MockCameraPermissionService implements CameraPermissionService {
  CameraPermissionStatus cameraStatus;
  CameraPermissionStatus micStatus;
  bool settingsOpened = false;

  MockCameraPermissionService({
    this.cameraStatus = CameraPermissionStatus.denied,
    this.micStatus = CameraPermissionStatus.denied,
  });

  @override
  Future<CameraPermissionStatus> checkCameraPermission() async => cameraStatus;

  @override
  Future<CameraPermissionStatus> requestCameraPermission() async => cameraStatus;

  @override
  Future<CameraPermissionStatus> checkMicrophonePermission() async => micStatus;

  @override
  Future<CameraPermissionStatus> requestMicrophonePermission() async => micStatus;

  @override
  Future<bool> openAppSettings() async {
    settingsOpened = true;
    return true;
  }
}
