import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../domain/services/camera_hardware_service.dart';
import '../domain/services/camera_permission_service.dart';
import '../domain/services/camera_registration_service.dart';
import '../domain/services/camera_capture_service.dart';
import '../../device/domain/services/device_identity_service.dart';
import '../../../../core/storage/secure_storage_service.dart';
import 'camera_state.dart';

/// Provider for CameraPermissionService contract
final cameraPermissionServiceProvider = Provider<CameraPermissionService>((ref) {
  return PlatformCameraPermissionService();
});

/// Provider for CameraHardwareService contract
final cameraHardwareServiceProvider = Provider<CameraHardwareService>((ref) {
  return PlatformCameraHardwareService();
});

/// Provider for CameraRegistrationService contract
final cameraRegistrationServiceProvider =
    Provider<CameraRegistrationService>((ref) {
  return HttpCameraRegistrationService();
});

/// Provider for CameraCaptureService contract (Phase 21.4)
final cameraCaptureServiceProvider = Provider<CameraCaptureService>((ref) {
  final service = PlatformCameraCaptureService();
  ref.onDispose(() => service.dispose());
  return service;
});

/// Provider for DeviceIdentityService contract
final cameraDeviceIdentityServiceProvider =
    Provider<DeviceIdentityService>((ref) {
  return MethodChannelDeviceIdentityService();
});

/// Provider for SecureStorageService contract
final cameraSecureStorageServiceProvider =
    Provider<SecureStorageService>((ref) {
  return FileSecureStorageService();
});
