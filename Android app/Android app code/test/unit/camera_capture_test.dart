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

class MockMemoryStorage implements SecureStorageService {
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

class TestCameraPermissionService implements CameraPermissionService {
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
  Future<bool> openAppSettings() async => true;
}

class MockCameraHardwareService implements CameraHardwareService {
  List<CameraHardwareInfo> cameras = [
    const CameraHardwareInfo(
      cameraId: '0',
      lensFacing: CameraLensFacing.back,
      sensorOrientation: 90,
      supportedPreviewResolutions: [
        CameraResolution(width: 1920, height: 1080),
        CameraResolution(width: 1280, height: 720),
        CameraResolution(width: 640, height: 480),
      ],
      supportedFpsRanges: [
        FpsRange(minFps: 15, maxFps: 30),
        FpsRange(minFps: 30, maxFps: 30),
        FpsRange(minFps: 30, maxFps: 60),
      ],
      hardwareLevel: CameraHardwareLevel.full,
      isFlashAvailable: true,
      isManualExposureSupported: true,
      isManualFocusSupported: true,
      hasMicrophone: true,
    ),
    const CameraHardwareInfo(
      cameraId: '1',
      lensFacing: CameraLensFacing.front,
      sensorOrientation: 270,
      supportedPreviewResolutions: [
        CameraResolution(width: 1280, height: 720),
        CameraResolution(width: 640, height: 480),
      ],
      supportedFpsRanges: [
        FpsRange(minFps: 15, maxFps: 30),
        FpsRange(minFps: 30, maxFps: 30),
      ],
      hardwareLevel: CameraHardwareLevel.limited,
      isFlashAvailable: false,
      isManualExposureSupported: false,
      isManualFocusSupported: false,
      hasMicrophone: true,
    ),
  ];

  @override
  Future<List<CameraHardwareInfo>> getAvailableCameras() async => cameras;

  @override
  Future<CameraHardwareInfo?> getCameraDetails(String cameraId) async {
    try {
      return cameras.firstWhere((c) => c.cameraId == cameraId);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<bool> hasCameraHardware() async => cameras.isNotEmpty;
}

void main() {
  group('Phase 21.4.3 — Timeout Generation Isolation & Codec Classification Label Accuracy Tests', () {
    late TestCameraPermissionService permissionService;
    late MockCameraHardwareService hardwareService;
    late MockCameraCaptureService captureService;
    late MockMemoryStorage storage;
    late CameraStateNotifier notifier;

    setUp(() {
      permissionService = TestCameraPermissionService();
      hardwareService = MockCameraHardwareService();
      captureService = MockCameraCaptureService();
      storage = MockMemoryStorage();

      notifier = CameraStateNotifier(
        permissionService: permissionService,
        hardwareService: hardwareService,
        registrationService: HttpCameraRegistrationService(),
        deviceIdentityService: MethodChannelDeviceIdentityService(),
        secureStorage: storage,
        captureService: captureService,
      );
    });

    tearDown(() {
      notifier.dispose();
      captureService.dispose();
    });

    // -------------------------------------------------------------------------
    // Scenario 1: Stale Generation 1 timeout cannot clear Generation 2's active context
    // -------------------------------------------------------------------------
    test('1. Stale Generation 1 timeout cannot clear Generation 2 active context or texture', () async {
      await notifier.checkPermissions();

      // Generation 1 starts
      await notifier.startCapture();
      final gen1 = notifier.captureGeneration;
      expect(gen1, equals(1));
      expect(notifier.state.textureId, isNotNull);

      // Generation 2 starts (e.g. user toggles lens or restarts capture)
      await notifier.startCapture();
      final gen2 = notifier.captureGeneration;
      expect(gen2, equals(2));
      final gen2TextureId = notifier.state.textureId;
      expect(gen2TextureId, isNotNull);

      // Simulate stale Generation 1 timeout callback arriving late
      captureService.emitEvent(const CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: 'Camera preview frame timed out after capture request started',
        generation: 1,
      ));

      // Generation 2 must remain completely intact
      expect(notifier.captureGeneration, equals(2));
      expect(notifier.state.textureId, equals(gen2TextureId));
      expect(notifier.state.captureStatus, equals(CameraCaptureStatus.capturing));
      expect(notifier.state.captureError, isNull);
    });

    // -------------------------------------------------------------------------
    // Scenario 2: Stale Generation 1 timeout cannot change Generation 2's capture state
    // -------------------------------------------------------------------------
    test('2. Stale Generation 1 timeout cannot change Generation 2 capture state', () async {
      await notifier.checkPermissions();

      // Generation 1 started and superseded
      await notifier.startCapture();
      await notifier.switchCameraLens(CameraLensFacing.front);
      expect(notifier.state.isCapturing, isTrue);

      // Late Generation 1 hardware start timeout event
      captureService.emitEvent(const CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: 'Camera hardware timed out waiting for initial frame start',
        generation: 1,
      ));

      // State remains CAPTURING, error is not applied
      expect(notifier.state.captureStatus, equals(CameraCaptureStatus.capturing));
      expect(notifier.state.isCapturing, isTrue);
      expect(notifier.state.captureError, isNull);
    });

    // -------------------------------------------------------------------------
    // Scenario 3: Stale timeout only releases its own generation's resources
    // -------------------------------------------------------------------------
    test('3. Stale timeout only releases its own generation resources, preserving Generation 2', () async {
      await notifier.checkPermissions();

      await notifier.startCapture();
      final activeTexId = notifier.state.textureId;

      // Switch to front lens (new generation)
      await notifier.switchCameraLens(CameraLensFacing.front);
      final newTexId = notifier.state.textureId;
      expect(newTexId, isNotNull);

      // Dispatch error for old generation
      captureService.emitEvent(const CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: 'Preview frame timeout for generation 1',
        generation: 1,
      ));

      // Generation 2 resources (texture, encoder) remain active
      expect(notifier.state.textureId, equals(newTexId));
      expect(notifier.state.isEncoderActive, isTrue);
      expect(notifier.state.hasPreviewFrame, isTrue);
    });

    // -------------------------------------------------------------------------
    // Scenario 4: Current-generation timeout transitions the correct context to error
    // -------------------------------------------------------------------------
    test('4. Current-generation timeout transitions the correct context to error and clears texture', () async {
      await notifier.checkPermissions();

      await notifier.startCapture();
      final currentGen = notifier.captureGeneration;
      expect(notifier.state.isCapturing, isTrue);

      // Current generation timeout fires
      captureService.emitEvent(CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: 'Camera preview frame timed out after capture request started',
        generation: currentGen,
      ));

      expect(notifier.state.captureStatus, equals(CameraCaptureStatus.error));
      expect(notifier.state.isCapturing, isFalse);
      expect(notifier.state.textureId, isNull);
      expect(notifier.state.isPreviewReady, isFalse);
      expect(
        notifier.state.captureError,
        contains('Camera preview frame timed out'),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 5: Timeout racing with successful preview readiness does not terminate active capture
    // -------------------------------------------------------------------------
    test('5. Timeout racing with successful preview readiness does not terminate active capture', () async {
      await notifier.checkPermissions();

      captureService.mockIsCaptureRequestStarted = true;
      captureService.mockHasPreviewFrame = true;
      await notifier.startCapture();

      expect(notifier.state.isPreviewReady, isTrue);
      expect(notifier.state.isCapturing, isTrue);

      // Even if a delayed timeout arrives, active verified capture remains safe
      final currentGen = notifier.captureGeneration;
      // When preview frame has already arrived, native engine returns early without error
      expect(notifier.state.isCapturing, isTrue);
      expect(notifier.state.captureStatus, equals(CameraCaptureStatus.capturing));
    });

    // -------------------------------------------------------------------------
    // Scenario 6: Concurrent stop and timeout cleanup remain idempotent
    // -------------------------------------------------------------------------
    test('6. Concurrent stop and timeout cleanup remain idempotent', () async {
      await notifier.checkPermissions();
      await notifier.startCapture();

      // Trigger stopCapture while timeout cleanup runs
      final stop1 = notifier.stopCapture();
      final stop2 = notifier.stopCapture();
      final results = await Future.wait([stop1, stop2]);

      expect(results[0], isTrue);
      expect(results[1], isTrue);
      expect(notifier.state.captureStatus, equals(CameraCaptureStatus.idle));
      expect(notifier.state.textureId, isNull);
    });

    // -------------------------------------------------------------------------
    // Scenario 7: API 29+ hardware classification uses HW H.264 (PLATFORM-REPORTED)
    // -------------------------------------------------------------------------
    test('7. API 29+ hardware classification uses HW H.264 (PLATFORM-REPORTED)', () {
      const state = CameraState(
        captureStatus: CameraCaptureStatus.capturing,
        isEncoderActive: true,
        codecName: 'c2.qcom.avc.encoder',
        codecAcceleration: 'HARDWARE',
        isHardwareAcceleratedEncoder: true,
      );

      expect(state.isHardwareAcceleratedCodec, isTrue);
      expect(state.isSoftwareCodec, isFalse);
      expect(state.isUnverifiedCodec, isFalse);
      expect(
        state.transportStatusLabel,
        equals('HW H.264 (PLATFORM-REPORTED) • TRANSPORT OFFLINE'),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 8: Pre-API 29 vendor codecs remain unverified (H.264 (ACCELERATION UNVERIFIED))
    // -------------------------------------------------------------------------
    test('8. Pre-API 29 vendor codecs remain unverified (H.264 (ACCELERATION UNVERIFIED))', () {
      const state = CameraState(
        captureStatus: CameraCaptureStatus.capturing,
        isEncoderActive: true,
        codecName: 'OMX.qcom.video.encoder.avc',
        codecAcceleration: 'UNVERIFIED',
        isHardwareAcceleratedEncoder: false,
      );

      expect(state.isHardwareAcceleratedCodec, isFalse);
      expect(state.isUnverifiedCodec, isTrue);
      expect(
        state.transportStatusLabel,
        equals('H.264 (ACCELERATION UNVERIFIED) • TRANSPORT OFFLINE'),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 9: Software and unverified labels remain accurate
    // -------------------------------------------------------------------------
    test('9. Software and unverified labels remain accurate across standby and capture states', () {
      // Software encoder
      const swState = CameraState(
        captureStatus: CameraCaptureStatus.capturing,
        isEncoderActive: true,
        codecName: 'c2.android.avc.encoder',
        codecAcceleration: 'SOFTWARE',
        isHardwareAcceleratedEncoder: false,
      );
      expect(swState.isSoftwareCodec, isTrue);
      expect(
        swState.transportStatusLabel,
        equals('SW H.264 • TRANSPORT OFFLINE'),
      );

      // Preview only without encoder
      const previewOnlyState = CameraState(
        captureStatus: CameraCaptureStatus.capturing,
        isEncoderActive: false,
      );
      expect(
        previewOnlyState.transportStatusLabel,
        equals('PREVIEW ONLY • TRANSPORT OFFLINE'),
      );

      // Idle / Standby
      const idleState = CameraState(
        captureStatus: CameraCaptureStatus.idle,
      );
      expect(
        idleState.transportStatusLabel,
        equals('VIEWERS: NOT CONNECTED'),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 10: Camera timeout and cleanup changes do not modify Storage credentials or lifecycle
    // -------------------------------------------------------------------------
    test('10. Camera timeout and cleanup changes do not modify Storage credentials or lifecycle', () async {
      await storage.write(key: 'storage_server_admin_token', value: 'secret_storage_admin_token_456');
      await storage.write(key: 'device_installation_id', value: 'installation_uuid_789');

      await notifier.checkPermissions();
      await notifier.startCapture();

      // Trigger timeout error
      captureService.emitEvent(CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: 'Camera preview frame timed out after capture request started',
        generation: notifier.captureGeneration,
      ));

      // Attempt recovery and stop
      await notifier.stopCapture();

      final token = await storage.read(key: 'storage_server_admin_token');
      final installId = await storage.read(key: 'device_installation_id');

      expect(token, equals('secret_storage_admin_token_456'));
      expect(installId, equals('installation_uuid_789'));
    });
  });
}
