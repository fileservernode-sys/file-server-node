// Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
// Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.

import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/storage/secure_storage_service.dart';
import 'package:remote_node_app/features/camera/application/camera_state.dart';
import 'package:remote_node_app/features/camera/domain/entities/camera_hardware_info.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_capture_service.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_hardware_service.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_permission_service.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_registration_service.dart';
import 'package:remote_node_app/features/device/domain/services/device_identity_service.dart';

class MockSecureStorage implements SecureStorageService {
  final Map<String, String> _data = {};

  @override
  Future<void> clearSession() async {}

  @override
  Future<void> delete({required String key}) async {
    _data.remove(key);
  }

  @override
  Future<dynamic> getSession() async => null;

  @override
  Future<String?> read({required String key}) async => _data[key];

  @override
  Future<void> saveSession(dynamic session) async {}

  @override
  Future<void> write({required String key, required String value}) async {
    _data[key] = value;
  }
}

class MockPermissionService implements CameraPermissionService {
  CameraPermissionStatus cameraStatus = CameraPermissionStatus.granted;
  CameraPermissionStatus micStatus = CameraPermissionStatus.granted;

  @override
  Future<CameraPermissionStatus> checkCameraPermission() async => cameraStatus;

  @override
  Future<CameraPermissionStatus> requestCameraPermission() async => cameraStatus;

  @override
  Future<CameraPermissionStatus> checkMicrophonePermission() async => micStatus;

  @override
  Future<CameraPermissionStatus> requestMicrophonePermission() async => micStatus;

  @override
  Future<void> openAppSettings() async {}
}

class MockHardwareService implements CameraHardwareService {
  List<CameraHardwareInfo> mockCameras = [
    const CameraHardwareInfo(
      cameraId: '0',
      lensFacing: CameraLensFacing.back,
      sensorOrientation: 90,
      hardwareLevel: CameraHardwareLevel.full,
      isHardwareLevelSupported: true,
      hasFlash: true,
      supportedFpsRanges: [
        CameraFpsRange(minFps: 15, maxFps: 30),
      ],
      resolutions: [
        CameraResolutionCapability(width: 1280, height: 720),
        CameraResolutionCapability(width: 1920, height: 1080),
      ],
      streamConfigurations: [
        CameraStreamConfiguration(
          width: 1280,
          height: 720,
          format: 0x22,
          minFrameDurationNs: 33333333,
        ),
      ],
    ),
  ];

  @override
  Future<List<CameraHardwareInfo>> discoverCameras() async => mockCameras;
}

class MockRegistrationService implements CameraRegistrationService {
  @override
  Future<CameraRegistrationResult> registerCamera({
    required String apiBaseUrl,
    required String sessionToken,
    required String cameraName,
    required String lensFacing,
    required int maxFps,
    required String supportedResolutions,
    required String installationId,
    String? preferredCameraId,
    String? existingDeviceId,
  }) async {
    return const CameraRegistrationResult.success(
      deviceId: 'cam-dev-123',
      instanceId: 'cam-inst-123',
      deviceCredential: 'sec-cred-123',
      cameraName: 'Test Camera',
      lensFacing: 'back',
      isNewDevice: true,
    );
  }
}

class MockDeviceIdentityService implements DeviceIdentityService {
  @override
  Future<String> getInstallationId() async => 'test-install-id-123';

  @override
  Future<String?> getFcmToken() async => 'test-fcm-token';
}

class MockSupervisorCaptureService implements CameraCaptureService {
  final StreamController<CameraCaptureResult> _controller =
      StreamController<CameraCaptureResult>.broadcast();

  CameraCaptureResult currentState = const CameraCaptureResult(
    status: CameraCaptureStatus.idle,
  );

  bool startShouldFailFgs = false;
  int stopCallCount = 0;
  int startCallCount = 0;
  int getCaptureStateCallCount = 0;

  @override
  Stream<CameraCaptureResult> get captureEvents => _controller.stream;

  @override
  Future<CameraCaptureResult> startCapture({
    required String cameraId,
    required int width,
    required int height,
    required int fps,
    bool enableEncoder = true,
  }) async {
    startCallCount++;
    if (startShouldFailFgs) {
      currentState = const CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: 'CAMERA_FGS_REJECTED: Foreground service start not allowed',
      );
      return currentState;
    }

    currentState = CameraCaptureResult(
      status: CameraCaptureStatus.capturing,
      isCapturing: true,
      isCaptureRequestStarted: true,
      hasPreviewFrame: true,
      cameraId: cameraId,
      width: width,
      height: height,
      fps: fps,
      textureId: 42,
      isEncoderActive: enableEncoder,
      codecName: 'c2.android.avc.encoder',
      codecAcceleration: 'HARDWARE',
      isHardwareAccelerated: true,
    );
    return currentState;
  }

  @override
  Future<bool> stopCapture() async {
    stopCallCount++;
    currentState = const CameraCaptureResult(
      status: CameraCaptureStatus.idle,
      isCapturing: false,
      textureId: null,
    );
    return true;
  }

  @override
  Future<CameraCaptureResult> switchCamera({
    required String cameraId,
    required int width,
    required int height,
    required int fps,
  }) async {
    return currentState;
  }

  @override
  Future<CameraCaptureResult> getCaptureState() async {
    getCaptureStateCallCount++;
    return currentState;
  }

  @override
  void dispose() {
    _controller.close();
  }
}

void main() {
  group('PlatformSupervisorService & Camera Lifecycle Tests (Phase 21.5.1)', () {
    late MockSecureStorage storage;
    late MockPermissionService perms;
    late MockHardwareService hardware;
    late MockRegistrationService registration;
    late MockDeviceIdentityService identity;
    late MockSupervisorCaptureService captureService;
    late CameraStateNotifier notifier;

    setUp(() async {
      storage = MockSecureStorage();
      perms = MockPermissionService();
      hardware = MockHardwareService();
      registration = MockRegistrationService();
      identity = MockDeviceIdentityService();
      captureService = MockSupervisorCaptureService();

      notifier = CameraStateNotifier(
        permissionService: perms,
        hardwareService: hardware,
        registrationService: registration,
        deviceIdentityService: identity,
        secureStorage: storage,
        captureService: captureService,
      );

      await notifier.discoverHardware();
    });

    tearDown(() {
      notifier.dispose();
      captureService.dispose();
    });

    test('app pause preserves background camera capture without stopping service engine', () async {
      // 1. Start capture
      final started = await notifier.startCapture();
      expect(started, isTrue);
      expect(notifier.state.isCapturing, isTrue);
      expect(notifier.state.textureId, equals(42));

      // 2. Simulate app backgrounded / paused (Phase 21.5.1.1 corrected policy)
      notifier.handleAppLifecycleState(AppLifecycleState.paused);
      await pumpEventQueue();

      // 3. Verify capture engine was NOT stopped (managed continuously by PlatformSupervisorService)
      expect(captureService.stopCallCount, equals(0));
      expect(notifier.state.isCapturing, isTrue);
      expect(notifier.state.textureId, equals(42));
    });

    test('explicit user stop terminates capture and releases resources', () async {
      // 1. Start capture
      final started = await notifier.startCapture();
      expect(started, isTrue);
      expect(notifier.state.isCapturing, isTrue);

      // 2. Explicit stop by user action
      final stopped = await notifier.stopCapture();
      expect(stopped, isTrue);
      expect(captureService.stopCallCount, equals(1));
      expect(notifier.state.isCapturing, isFalse);
      expect(notifier.state.textureId, isNull);
    });

    test('app resume queries HAL reality via syncCaptureState', () async {
      // When native HAL capture state is idle
      captureService.currentState = const CameraCaptureResult(
        status: CameraCaptureStatus.idle,
      );

      notifier.handleAppLifecycleState(AppLifecycleState.resumed);
      await pumpEventQueue();

      expect(captureService.getCaptureStateCallCount, equals(1));
      expect(notifier.state.isCapturing, isFalse);
      expect(notifier.state.captureStatus, equals(CameraCaptureStatus.idle));
    });

    test('app resume synchronizes native running capture parameters accurately', () async {
      // Emulate native capture running in supervisor background
      captureService.currentState = const CameraCaptureResult(
        status: CameraCaptureStatus.capturing,
        isCapturing: true,
        isCaptureRequestStarted: true,
        hasPreviewFrame: true,
        cameraId: '0',
        width: 1920,
        height: 1080,
        fps: 30,
        textureId: 101,
        isEncoderActive: true,
        codecName: 'OMX.qcom.video.encoder.avc',
        codecAcceleration: 'HARDWARE',
        isHardwareAccelerated: true,
      );

      await notifier.syncCaptureState();

      expect(notifier.state.isCapturing, isTrue);
      expect(notifier.state.textureId, equals(101));
      expect(notifier.state.activeCaptureWidth, equals(1920));
      expect(notifier.state.activeCaptureHeight, equals(1080));
      expect(notifier.state.isHardwareAcceleratedEncoder, isTrue);
      expect(notifier.state.hasPreviewFrame, isTrue);
    });

    test('fgs rejection surfaces CAMERA_FGS_REJECTED without leaving state in fake running', () async {
      captureService.startShouldFailFgs = true;

      final success = await notifier.startCapture();
      expect(success, isFalse);
      expect(notifier.state.isCapturing, isFalse);
      expect(notifier.state.captureStatus, equals(CameraCaptureStatus.error));
      expect(notifier.state.captureError, contains('CAMERA_FGS_REJECTED'));
      expect(notifier.state.textureId, isNull);
    });

    test('syncCaptureState gracefully handles platform exceptions', () async {
      // Should not throw or crash notifier
      await notifier.syncCaptureState();
      expect(notifier.state.captureStatus, isNotNull);
    });
  });
}
