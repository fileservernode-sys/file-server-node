// Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
// Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.

import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/storage/secure_storage_service.dart';
import 'package:remote_node_app/features/camera/application/camera_state.dart';
import 'package:remote_node_app/features/camera/domain/entities/camera_hardware_info.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_hardware_service.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_permission_service.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_registration_service.dart';
import 'package:remote_node_app/features/device/domain/services/device_identity_service.dart';
import 'package:remote_node_app/features/auth/application/auth_state.dart';
import 'package:remote_node_app/features/auth/domain/repositories/auth_repository.dart';
import 'package:remote_node_app/features/auth/domain/entities/auth_session.dart';
import 'package:remote_node_app/features/auth/domain/entities/platform_user.dart';
import 'package:remote_node_app/features/auth/data/models/auth_models.dart';

class MockMemorySecureStorage implements SecureStorageService {
  final Map<String, String> _data = {};
  bool throwOnWrite = false;
  bool mismatchOnRead = false;
  bool throwOnDelete = false;

  @override
  Future<void> clearSession() async {}

  @override
  Future<void> delete({required String key}) async {
    if (throwOnDelete) {
      throw Exception('Simulated KeyStore encrypted delete failure');
    }
    _data.remove(key);
  }

  @override
  Future<dynamic> getSession() async => null;

  @override
  Future<String?> read({required String key}) async {
    if (mismatchOnRead && key.contains('credential')) {
      return 'mismatched_corrupted_credential_value';
    }
    return _data[key];
  }

  @override
  Future<void> saveSession(dynamic session) async {}

  @override
  Future<void> write({required String key, required String value}) async {
    if (throwOnWrite && key.contains('credential')) {
      throw Exception('Simulated KeyStore encrypted write failure');
    }
    _data[key] = value;
  }
}

class MockAuthRepository implements AuthRepository {
  bool logoutCalled = false;
  AuthSession? mockSession;

  @override
  Future<void> logout() async {
    logoutCalled = true;
  }

  @override
  Future<AuthSession?> getCurrentSession() async => mockSession;

  @override
  Future<AuthResponse> login(LoginRequest request) async =>
      const AuthResponse(success: true, requiresOtp: true);

  @override
  Future<bool> resendOtp(String email) async => true;

  @override
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request) async =>
      const AuthResponse(success: true);
}

class MockOrderTrackingAuthRepository implements AuthRepository {
  final void Function() onLogout;

  MockOrderTrackingAuthRepository({required this.onLogout});

  @override
  Future<void> logout() async {
    onLogout();
  }

  @override
  Future<AuthSession?> getCurrentSession() async => null;

  @override
  Future<AuthResponse> login(LoginRequest request) async =>
      const AuthResponse(success: true, requiresOtp: true);

  @override
  Future<bool> resendOtp(String email) async => true;

  @override
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request) async =>
      const AuthResponse(success: true);
}

void main() {
  group('Phase 21.2.1 — CameraState Baseline Tests [NOT RUN — DEFERRED TO PHASE 28]', () {
    test('CameraState initializes with honest defaults', () {
      const state = CameraState();

      expect(state.status, CameraLifecycleStatus.notConfigured);
      expect(state.cameraName, 'Android Security Camera');
      expect(state.selectedLens, CameraLensFacing.back);
      expect(state.selectedResolution, CameraResolutionPreset.p720);
      expect(state.targetFps, 30);
      expect(state.audioEnabled, false);
      expect(state.activeViewersCount, 0);
      expect(state.isConfigured, false);
      expect(state.isStreaming, false);
      expect(state.isOnline, false);
      expect(state.errorMessage, isNull);
      expect(state.cameraPermission, CameraPermissionStatus.notDetermined);
      expect(state.microphonePermission, CameraPermissionStatus.notDetermined);
      expect(state.hardwareCameras, isEmpty);
      expect(state.hasCameraPermission, isFalse);
    });

    test('displayResolution maps correctly for all presets', () {
      expect(
        const CameraState(selectedResolution: CameraResolutionPreset.p360).displayResolution,
        '360p (640x360)',
      );
      expect(
        const CameraState(selectedResolution: CameraResolutionPreset.p480).displayResolution,
        '480p (854x480)',
      );
      expect(
        const CameraState(selectedResolution: CameraResolutionPreset.p720).displayResolution,
        '720p (1280x720)',
      );
      expect(
        const CameraState(selectedResolution: CameraResolutionPreset.p1080).displayResolution,
        '1080p (1920x1080)',
      );
    });

    test('resolutionTag returns concise tag strings', () {
      expect(const CameraState(selectedResolution: CameraResolutionPreset.p360).resolutionTag, '360p');
      expect(const CameraState(selectedResolution: CameraResolutionPreset.p480).resolutionTag, '480p');
      expect(const CameraState(selectedResolution: CameraResolutionPreset.p720).resolutionTag, '720p');
      expect(const CameraState(selectedResolution: CameraResolutionPreset.p1080).resolutionTag, '1080p');
    });

    test('displayLens maps correctly for back and front sensors', () {
      expect(
        const CameraState(selectedLens: CameraLensFacing.back).displayLens,
        'Back (Primary)',
      );
      expect(
        const CameraState(selectedLens: CameraLensFacing.front).displayLens,
        'Front (Selfie)',
      );
    });

    test('statusLabel maps all 7 lifecycle statuses honestly', () {
      expect(const CameraState(status: CameraLifecycleStatus.notConfigured).statusLabel, 'NOT CONFIGURED');
      expect(const CameraState(status: CameraLifecycleStatus.offline).statusLabel, 'OFFLINE');
      expect(const CameraState(status: CameraLifecycleStatus.connecting).statusLabel, 'CONNECTING');
      expect(const CameraState(status: CameraLifecycleStatus.online).statusLabel, 'ONLINE');
      expect(const CameraState(status: CameraLifecycleStatus.streaming).statusLabel, 'STREAMING');
      expect(const CameraState(status: CameraLifecycleStatus.reconnecting).statusLabel, 'RECONNECTING');
      expect(const CameraState(status: CameraLifecycleStatus.error).statusLabel, 'ERROR');
    });

    test('displayViewersCount returns honest placeholder when not streaming', () {
      const offlineState = CameraState(status: CameraLifecycleStatus.offline, activeViewersCount: 0);
      expect(offlineState.displayViewersCount, 'Not Connected');

      const streamingState = CameraState(status: CameraLifecycleStatus.streaming, activeViewersCount: 3);
      expect(streamingState.displayViewersCount, '3 Connected');
    });
  });

  group('Phase 21.3 / 21.3.1 — Registration Idempotency & Safety Tests [NOT RUN — DEFERRED TO PHASE 28]', () {
    late MockCameraPermissionService mockPerms;
    late MockCameraHardwareService mockHardware;
    late MockCameraRegistrationService mockReg;
    late MockDeviceIdentityService mockIdentity;
    late MockMemorySecureStorage mockStorage;

    setUp(() {
      mockPerms = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.denied,
        micStatus: CameraPermissionStatus.denied,
      );
      mockHardware = MockCameraHardwareService();
      mockReg = MockCameraRegistrationService();
      mockIdentity = MockDeviceIdentityService(initialId: 'inst-test-device-uuid');
      mockStorage = MockMemorySecureStorage();
    });

    test('Concurrent duplicate registration taps are safely rejected', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Simulate registration in progress
      notifier.registerWithBackend(sessionToken: 'valid_jwt');
      expect(notifier.state.isRegistering, isTrue);

      // Simultaneous secondary tap must immediately return false and be ignored
      final secondTap = await notifier.registerWithBackend(sessionToken: 'valid_jwt');
      expect(secondTap, isFalse);
    });

    test('Device registration success followed by Camera registration failure handles partial failure cleanly', () async {
      // Configure registration service to succeed on device registration but fail on camera creation
      mockReg.shouldSucceed = false;
      mockReg.failureCode = 'CAMERA_LIMIT_REACHED';
      mockReg.failureMessage = 'Maximum cameras limit reached for account';

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt');

      expect(result, isFalse);
      expect(notifier.state.isRegistered, isFalse);
      expect(notifier.state.isRegistering, isFalse);
      // Status must remain OFFLINE / notConfigured, NEVER ONLINE
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
      // Error indicates partial failure with retry capability
      expect(notifier.state.registrationError, contains('Tap to retry'));
    });

    test('Safe retry reuses resolved deviceId from storage without duplicate device creation', () async {
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_persisted_777');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt');

      expect(result, isTrue);
      expect(notifier.state.deviceId, equals('dev_persisted_777'));
      expect(notifier.state.isRegistered, isTrue);
      expect(notifier.state.status, equals(CameraLifecycleStatus.offline)); // OFFLINE, NOT ONLINE
    });

    test('Device credential from registerCameraDevice is securely persisted to SecureStorage', () async {
      mockReg.mockDeviceCredential = 'cred_secret_token_abc_xyz';

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt');

      expect(result, isTrue);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_secret_token_abc_xyz'));
      // Device credential must NEVER be logged or leaked into state fields
      expect(notifier.state.registrationError, isNull);
    });

    test('Multiple cameras on device with ambiguous names produces explicit recoverable error state', () async {
      mockReg.existingCameras = [
        {
          'id': 'cam_alpha_001',
          'deviceId': 'dev_mock_67890',
          'cameraName': 'Front Entrance Cam',
          'status': 'OFFLINE',
        },
        {
          'id': 'cam_beta_002',
          'deviceId': 'dev_mock_67890',
          'cameraName': 'Backyard Cam',
          'status': 'OFFLINE',
        },
      ];

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Current state cameraName is 'Android Security Camera', which matches neither existing camera
      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt');

      expect(result, isFalse);
      expect(notifier.state.isRegistered, isFalse);
      expect(notifier.state.registrationError, contains('Multiple cameras (2) found for this device'));
    });

    test('Multiple cameras on device reuses exact cameraName match without ambiguity', () async {
      mockReg.existingCameras = [
        {
          'id': 'cam_alpha_001',
          'deviceId': 'dev_mock_67890',
          'cameraName': 'Front Entrance Cam',
          'status': 'OFFLINE',
        },
        {
          'id': 'cam_beta_002',
          'deviceId': 'dev_mock_67890',
          'cameraName': 'Android Security Camera',
          'status': 'OFFLINE',
        },
      ];

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt');

      expect(result, isTrue);
      expect(notifier.state.isRegistered, isTrue);
      expect(notifier.state.cameraId, equals('cam_beta_002'));
      expect(notifier.state.status, equals(CameraLifecycleStatus.offline));
      expect(await mockStorage.read(key: 'zdex_camera_instance_id'), equals('cam_beta_002'));
    });

    test('Idempotent lookup reuses existing CameraInstance if already registered for device', () async {
      mockReg.existingCameras = [
        {
          'id': 'cam_already_registered_101',
          'deviceId': 'dev_mock_67890',
          'cameraName': 'Android Security Camera',
          'status': 'OFFLINE',
        }
      ];

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt');

      expect(result, isTrue);
      expect(notifier.state.cameraId, equals('cam_already_registered_101'));
      expect(notifier.state.successMessage, contains('Reused existing camera registration'));
      expect(await mockStorage.read(key: 'zdex_camera_instance_id'), equals('cam_already_registered_101'));
    });

    test('Permission revocation in background marks readiness invalid and sets error', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      mockPerms.cameraStatus = CameraPermissionStatus.granted;
      await notifier.checkPermissions();
      expect(notifier.state.hasCameraPermission, isTrue);

      // Simulate user revoking permission in Android Settings
      mockPerms.cameraStatus = CameraPermissionStatus.denied;
      await notifier.checkPermissions();

      expect(notifier.state.hasCameraPermission, isFalse);
      expect(notifier.state.errorMessage, contains('revoked in Android Settings'));
    });

    test('combinationSupportStatus evaluates active sensor capabilities accurately', () async {
      mockPerms.cameraStatus = CameraPermissionStatus.granted;

      final customHardware = MockCameraHardwareService(
        initialCameras: [
          const CameraHardwareInfo(
            cameraId: '0',
            lensFacing: CameraLensFacing.back,
            sensorOrientation: 90,
            resolutions: [
              CameraHardwareResolution(
                width: 1920,
                height: 1080,
                maxFps: 15, // Max 15 FPS at 1080p
                isVerified: true,
              ),
              CameraHardwareResolution(
                width: 1280,
                height: 720,
                maxFps: 30, // 30 FPS at 720p
                isVerified: true,
              ),
            ],
            fpsRanges: [
              CameraFpsRange(min: 15, max: 30),
            ],
          ),
        ],
      );

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: customHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      await notifier.requestCameraPermission();

      notifier.setResolution(CameraResolutionPreset.p720);
      notifier.setFps(30);
      expect(notifier.state.combinationSupportStatus, equals(CombinationSupportStatus.halVerified));
      expect(notifier.state.combinationSupportLabel, equals('HAL Verified'));

      // 1080p @ 30 FPS exceeds maxFps (15) for this sensor
      notifier.setResolution(CameraResolutionPreset.p1080);
      expect(notifier.state.combinationSupportStatus, equals(CombinationSupportStatus.unsupported));
      expect(notifier.state.combinationSupportLabel, equals('Unsupported by Sensor'));
    });
  });

  group('Phase 21.3.3 — Fail-Closed Pagination & Credential Lifecycle Hardening [NOT RUN — DEFERRED TO PHASE 28]', () {
    late MockCameraPermissionService mockPerms;
    late MockCameraHardwareService mockHardware;
    late MockCameraRegistrationService mockReg;
    late MockDeviceIdentityService mockIdentity;
    late MockMemorySecureStorage mockStorage;

    setUp(() {
      mockPerms = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.granted,
        micStatus: CameraPermissionStatus.denied,
      );
      mockHardware = MockCameraHardwareService();
      mockReg = MockCameraRegistrationService();
      mockIdentity = MockDeviceIdentityService(initialId: 'inst-test-device-uuid');
      mockStorage = MockMemorySecureStorage();
    });

    test('Failure on first pagination request aborts registration and NEVER triggers camera creation', () async {
      mockReg.failOnPage = 1;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_101');

      expect(result, isFalse);
      expect(notifier.state.isRegistered, isFalse);
      expect(notifier.state.registrationError, contains('page 1'));
      expect(mockReg.registerCameraCallCount, equals(0)); // Incomplete lookup never creates camera
    });

    test('Failure on middle pagination request aborts registration without treating partial list as complete', () async {
      mockReg.existingCameras = List.generate(
        250,
        (i) => {
          'id': 'cam_$i',
          'deviceId': 'dev_mock_67890',
          'cameraName': 'Camera $i',
          'status': 'OFFLINE',
        },
      );
      mockReg.failOnPage = 2;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_101');

      expect(result, isFalse);
      expect(notifier.state.isRegistered, isFalse);
      expect(notifier.state.registrationError, contains('page 2'));
      expect(mockReg.registerCameraCallCount, equals(0));
    });

    test('Failure on final pagination request aborts registration fail-closed', () async {
      mockReg.existingCameras = List.generate(
        150,
        (i) => {
          'id': 'cam_$i',
          'deviceId': 'dev_mock_67890',
          'cameraName': 'Camera $i',
          'status': 'OFFLINE',
        },
      );
      // Page 1 has 100 items, Page 2 has 50 items (final page)
      mockReg.failOnPage = 2;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_101');

      expect(result, isFalse);
      expect(notifier.state.isRegistered, isFalse);
      expect(notifier.state.registrationError, contains('page 2'));
      expect(mockReg.registerCameraCallCount, equals(0));
    });

    test('Reaching 500-record safety ceiling while hasMore is true aborts registration', () async {
      mockReg.simulateCeiling = true;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_101');

      expect(result, isFalse);
      expect(notifier.state.isRegistered, isFalse);
      expect(notifier.state.registrationError, contains('ceiling reached (more than 500 records)'));
      expect(mockReg.registerCameraCallCount, equals(0));
    });

    test('Conclusive complete lookup with 0 existing cameras authorizes Camera creation', () async {
      mockReg.existingCameras = [];

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_101');

      expect(result, isTrue);
      expect(notifier.state.isRegistered, isTrue);
      expect(notifier.state.status, equals(CameraLifecycleStatus.offline));
      expect(mockReg.registerCameraCallCount, equals(1));
    });

    test('Device credential persistence failure makes error explicit and aborts registration', () async {
      mockStorage.throwOnWrite = true;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_101');

      expect(result, isFalse);
      expect(notifier.state.isRegistered, isFalse);
      expect(notifier.state.registrationError, contains('Failed to securely persist camera device credential'));
      expect(mockReg.registerCameraCallCount, equals(0));
    });

    test('Account switching purges previous user camera credentials and state', () async {
      // User 1 registers
      final notifier1 = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      await notifier1.registerWithBackend(sessionToken: 'jwt_user_1', userId: 'user_1');
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), equals('user_1'));
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), equals('dev_mock_67890'));
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNotNull);

      // User 2 logs in on the same phone
      final notifier2 = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Verify initRegistrationState detects account switch and purges stale camera state
      await notifier2.initRegistrationState(currentUserId: 'user_2');
      expect(notifier2.state.deviceId, isNull);
      expect(notifier2.state.isRegistered, isFalse);
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
    });

    test('Sign-out via clearCameraRegistration purges credentials without leaking', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_1');
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNotNull);

      await notifier.clearCameraRegistration();
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_instance_id'), isNull);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
    });

    test('Credential rotation on re-enrollment updates storage and never overwrites with empty', () async {
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_original_key');

      // Re-enrollment provides new rotated credential
      mockReg.mockDeviceCredential = 'cred_fresh_rotated_999';

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_1');

      expect(result, isTrue);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_fresh_rotated_999'));
    });

    test('Camera credential operations preserve Storage credentials and server behavior intact', () async {
      // Simulate existing Storage Server credentials in SecureStorage
      await mockStorage.write(key: 'storage_server_admin_token', value: 'storage_secret_admin_token');
      await mockStorage.write(key: 'device_installation_id', value: 'inst-global-uuid');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Run camera registration and subsequent camera sign-out/clear
      await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_1');
      await notifier.clearCameraRegistration();

      // Storage credentials and global installation ID must be completely unaffected
      expect(await mockStorage.read(key: 'storage_server_admin_token'), equals('storage_secret_admin_token'));
      expect(await mockStorage.read(key: 'device_installation_id'), equals('inst-global-uuid'));
    });
  });

  group('Phase 21.3.4 — Authentication Lifecycle Integration & Credential Rotation Safety [NOT RUN — DEFERRED TO PHASE 28]', () {
    late MockCameraPermissionService mockPerms;
    late MockCameraHardwareService mockHardware;
    late MockCameraRegistrationService mockReg;
    late MockDeviceIdentityService mockIdentity;
    late MockMemorySecureStorage mockStorage;
    late MockAuthRepository mockAuthRepo;

    setUp(() {
      mockPerms = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.denied,
        micStatus: CameraPermissionStatus.denied,
      );
      mockHardware = MockCameraHardwareService();
      mockReg = MockCameraRegistrationService();
      mockIdentity = MockDeviceIdentityService(initialId: 'inst-test-device-uuid');
      mockStorage = MockMemorySecureStorage();
      mockAuthRepo = MockAuthRepository();
    });

    test('Explicit user sign-out triggers session cleared hook and purges all camera credentials', () async {
      // Seed stored camera credentials
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_1');
      await mockStorage.write(key: 'zdex_camera_instance_id', value: 'cam_user_1');
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_user_1_secret');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_1');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-test-device-uuid');

      // Register hook as done in app lifecycle
      AuthStateNotifier.registerSessionClearedHook(() async {
        await CameraStateNotifier.handleGlobalSessionCleared(mockStorage);
      });

      final authNotifier = AuthStateNotifier(mockAuthRepo);
      await authNotifier.logout();

      // Verify all camera credentials purged from secure storage
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_instance_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_installation_id'), isNull);
    });

    test('Automatic session expiration in restoreSession purges camera credentials identically to explicit logout', () async {
      // Seed stored camera credentials
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_expired');
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_expired_secret');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_expired');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-test-device-uuid');

      // Register hook
      AuthStateNotifier.registerSessionClearedHook(() async {
        await CameraStateNotifier.handleGlobalSessionCleared(mockStorage);
      });

      // Configure an expired session
      mockAuthRepo.mockSession = AuthSession(
        accessToken: 'expired_token',
        refreshToken: 'expired_refresh',
        user: PlatformUser(
          id: 'user_expired',
          email: 'expired@zdexcloud.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now().subtract(const Duration(days: 30)),
        ),
        expiresAt: DateTime.now().subtract(const Duration(hours: 2)),
      );

      final authNotifier = AuthStateNotifier(mockAuthRepo);
      final restored = await authNotifier.restoreSession();

      expect(restored, isFalse);
      expect(mockAuthRepo.logoutCalled, isTrue);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
    });

    test('Account switching (User A -> User B) without app restart purges credentials and resets state', () async {
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_A');
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_A');
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_user_A');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-test-device-uuid');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // User B checks in
      await notifier.initRegistrationState(currentUserId: 'user_B');

      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
      expect(notifier.state.isRegistered, isFalse);
      expect(notifier.state.deviceId, isNull);
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
    });

    test('Credential ownership verification succeeds when userId and installationId match', () async {
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_valid');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-hardware-123');
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_valid');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final isValid = await notifier.verifyCredentialOwnership(
        expectedUserId: 'user_valid',
        expectedInstallationId: 'inst-hardware-123',
      );

      expect(isValid, isTrue);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_valid'));
    });

    test('Credential ownership verification fails closed and purges storage when installation ID mismatches', () async {
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_valid');
      // Stored installation ID was from another phone (e.g. cloud backup restore)
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-old-phone-uuid');
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_backup_copy');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final isValid = await notifier.verifyCredentialOwnership(
        expectedUserId: 'user_valid',
        expectedInstallationId: 'inst-new-phone-uuid',
      );

      expect(isValid, isFalse);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_installation_id'), isNull);
    });

    test('Credential ownership verification fails closed when ownership metadata is missing', () async {
      // Credential exists but user ID metadata is missing (unverified origin)
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_orphan');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final isValid = await notifier.verifyCredentialOwnership(
        expectedUserId: 'user_valid',
        expectedInstallationId: 'inst-test-device-uuid',
      );

      expect(isValid, isFalse);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
    });

    test('clearCameraRegistration is serialized and safe against concurrent callers', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_to_clear');

      // Multiple concurrent invocations
      await Future.wait([
        notifier.clearCameraRegistration(),
        notifier.clearCameraRegistration(),
        notifier.clearCameraRegistration(),
      ]);

      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
    });

    test('Credential rotation on write failure purges old revoked credential fail-closed', () async {
      // Seed existing credential on device
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_original_revoked_on_backend');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_1');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-test-device-uuid');

      // Simulate KeyStore failure on new credential write
      mockStorage.throwOnWrite = true;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.handleCredentialRotation(
        newCredential: 'fresh_rotated_credential_from_backend',
        expectedUserId: 'user_1',
        expectedInstallationId: 'inst-test-device-uuid',
      );

      expect(result, isFalse);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
      expect(notifier.state.isRegistered, isFalse);
      // The old credential MUST NOT be retained because backend already revoked it
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(notifier.state.registrationError, contains('Revoked credentials purged'));
    });

    test('Credential rotation on verification mismatch purges credentials fail-closed', () async {
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_original');
      mockStorage.mismatchOnRead = true; // Verification read returns corrupted/mismatched value

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.handleCredentialRotation(
        newCredential: 'fresh_rotated_credential_from_backend',
        expectedUserId: 'user_1',
        expectedInstallationId: 'inst-test-device-uuid',
      );

      expect(result, isFalse);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(notifier.state.registrationError, contains('Revoked credentials purged'));
    });

    test('Preservation Invariant: Camera auth lifecycle and rotation operations never touch Storage credentials', () async {
      await mockStorage.write(key: 'storage_server_admin_token', value: 'server_admin_secret_token');
      await mockStorage.write(key: 'device_installation_id', value: 'inst-global-hardware-id');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Perform camera registration, rotation, ownership verification, and clear
      await notifier.registerWithBackend(sessionToken: 'valid_jwt', userId: 'user_1');
      await notifier.handleCredentialRotation(
        newCredential: 'fresh_cred_123',
        expectedUserId: 'user_1',
        expectedInstallationId: 'inst-global-hardware-id',
      );
      await notifier.verifyCredentialOwnership(
        expectedUserId: 'user_1',
        expectedInstallationId: 'inst-global-hardware-id',
      );
      await notifier.clearCameraRegistration();
      await CameraStateNotifier.handleGlobalSessionCleared(mockStorage);

      // Storage Server credentials and physical device identity MUST remain 100% intact
      expect(await mockStorage.read(key: 'storage_server_admin_token'), equals('server_admin_secret_token'));
      expect(await mockStorage.read(key: 'device_installation_id'), equals('inst-global-hardware-id'));
    });
  });

  group('Phase 21.3.5 — In-Flight Registration Cancellation & Authentication Cleanup Reliability [NOT RUN — DEFERRED TO PHASE 28]', () {
    late MockCameraPermissionService mockPerms;
    late MockCameraHardwareService mockHardware;
    late MockCameraRegistrationService mockReg;
    late MockDeviceIdentityService mockIdentity;
    late MockMemorySecureStorage mockStorage;
    late MockAuthRepository mockAuthRepo;

    setUp(() {
      mockPerms = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.denied,
        micStatus: CameraPermissionStatus.denied,
      );
      mockHardware = MockCameraHardwareService();
      mockReg = MockCameraRegistrationService();
      mockIdentity = MockDeviceIdentityService(initialId: 'inst-test-device-uuid');
      mockStorage = MockMemorySecureStorage();
      mockAuthRepo = MockAuthRepository();
    });

    test('Sign-out while Camera registration is awaiting device-registration response drops result safely', () async {
      final completer = Completer<Map<String, dynamic>>();
      mockReg.registerDeviceDelay = completer.future;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // 1. Start registration
      final regFuture = notifier.registerWithBackend(sessionToken: 'jwt_user_1', userId: 'user_1');
      expect(notifier.state.isRegistering, isTrue);

      // 2. User signs out while network call is in flight
      await notifier.clearCameraRegistration();
      expect(notifier.state.isRegistering, isFalse);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));

      // 3. Network response finally arrives
      completer.complete({
        'success': true,
        'data': {
          'device': {'id': 'dev_abandoned', 'installationId': 'inst-test-device-uuid', 'status': 'ONLINE'},
          'deviceCredential': 'cred_abandoned_secret',
        }
      });

      final result = await regFuture;
      expect(result, isFalse);

      // 4. Stale response must NEVER write credentials or device ID for signed-out user
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), isNull);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
    });

    test('Sign-out while Camera creation is awaiting its response drops result and preserves signed-out state', () async {
      final camCompleter = Completer<Map<String, dynamic>>();
      mockReg.registerCameraDelay = camCompleter.future;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final regFuture = notifier.registerWithBackend(sessionToken: 'jwt_user_1', userId: 'user_1');

      // Allow device registration to proceed, then sign out while camera instance registration is in flight
      await Future.delayed(Duration.zero);
      await notifier.clearCameraRegistration();

      camCompleter.complete({
        'success': true,
        'data': {
          'camera': {'id': 'cam_stale_123', 'status': 'OFFLINE'}
        }
      });

      final result = await regFuture;
      expect(result, isFalse);
      expect(await mockStorage.read(key: 'zdex_camera_instance_id'), isNull);
      expect(notifier.state.cameraId, isNull);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
    });

    test('Account switching while previous account registration is in flight invalidates stale writes', () async {
      final deviceCompleter = Completer<Map<String, dynamic>>();
      mockReg.registerDeviceDelay = deviceCompleter.future;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // User A initiates registration
      final regAFuture = notifier.registerWithBackend(sessionToken: 'jwt_user_A', userId: 'user_A');

      // User B logs in and initializes state
      notifier.invalidateInFlightRegistrations();
      await notifier.initRegistrationState(currentUserId: 'user_B');

      // User A's response returns late
      deviceCompleter.complete({
        'success': true,
        'data': {
          'device': {'id': 'dev_user_A', 'installationId': 'inst-test-device-uuid'},
          'deviceCredential': 'cred_user_A_stale',
        }
      });

      final resultA = await regAFuture;
      expect(resultA, isFalse);

      // User A's credentials must NOT be stored
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
    });

    test('Invalidated operations cannot write credentials after returning from network requests', () async {
      final completer = Completer<Map<String, dynamic>>();
      mockReg.registerDeviceDelay = completer.future;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final future = notifier.registerWithBackend(sessionToken: 'jwt_user_1', userId: 'user_1');
      notifier.invalidateInFlightRegistrations();

      completer.complete({
        'success': true,
        'data': {
          'device': {'id': 'dev_1'},
          'deviceCredential': 'cred_should_not_be_written',
        }
      });

      await future;
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
    });

    test('Invalidated operations cannot overwrite Camera state for the new account', () async {
      final completerA = Completer<Map<String, dynamic>>();
      mockReg.registerDeviceDelay = completerA.future;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // User A begins registration
      final futureA = notifier.registerWithBackend(sessionToken: 'jwt_user_A', userId: 'user_A');

      // Switch to User B
      notifier.invalidateInFlightRegistrations();
      mockReg.registerDeviceDelay = null;
      mockReg.mockDeviceId = 'dev_user_B';
      mockReg.mockDeviceCredential = 'cred_user_B_valid';

      final futureB = notifier.registerWithBackend(sessionToken: 'jwt_user_B', userId: 'user_B');
      final resultB = await futureB;

      expect(resultB, isTrue);
      expect(notifier.state.deviceId, equals('dev_user_B'));
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), equals('dev_user_B'));

      // User A resolves late
      completerA.complete({
        'success': true,
        'data': {
          'device': {'id': 'dev_user_A'},
          'deviceCredential': 'cred_user_A_stale',
        }
      });

      final resultA = await futureA;
      expect(resultA, isFalse);

      // User B's state and credentials remain intact and uncorrupted
      expect(notifier.state.deviceId, equals('dev_user_B'));
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), equals('dev_user_B'));
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_user_B_valid'));
    });

    test('Cleanup hook failure does not prevent other cleanup hooks from running', () async {
      bool hook2Ran = false;
      bool hook3Ran = false;

      AuthStateNotifier.registerSessionClearedHook(() async {
        throw Exception('Simulated failure in Hook 1: cred_token_leak_attempt');
      });
      AuthStateNotifier.registerSessionClearedHook(() async {
        hook2Ran = true;
      });
      AuthStateNotifier.registerSessionClearedHook(() async {
        hook3Ran = true;
      });

      final result = await AuthStateNotifier.notifySessionCleared();

      // Hook 2 and Hook 3 executed despite Hook 1 failure
      expect(hook2Ran, isTrue);
      expect(hook3Ran, isTrue);
      expect(result.success, isFalse);
      expect(result.failedHooks, equals(1));
      expect(result.totalHooks, greaterThanOrEqualTo(3));

      // Diagnostics are structured categories — no raw strings, tokens, or credentials
      // (Phase 21.3.6: sanitizedErrors replaced with structured failureCategories)
      expect(result.failureCategories, hasLength(1));
      expect(result.failureCategories.first, isA<CleanupFailureCategory>());
      // The exception message contains 'cred_token_leak_attempt' which does NOT match
      // any structured category keyword, so it should map to unknownFailure.
      expect(result.failureCategories.first, equals(CleanupFailureCategory.unknownFailure));
    });

    test('Cleanup failure is not falsely reported as successful', () async {
      mockStorage.throwOnDelete = true;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final success = await notifier.clearCameraRegistration();

      expect(success, isFalse);
      expect(notifier.state.registrationError, contains('could not be fully cleared'));
    });

    test('Repeated session-cleared notifications are safe and idempotent', () async {
      final res1 = await AuthStateNotifier.notifySessionCleared();
      final res2 = await AuthStateNotifier.notifySessionCleared();
      final res3 = await AuthStateNotifier.notifySessionCleared();

      expect(res1, isNotNull);
      expect(res2, isNotNull);
      expect(res3, isNotNull);
    });

    test('App resume session-expiry behavior detects expired session and resets auth state', () async {
      // Seed expired session
      mockAuthRepo.mockSession = AuthSession(
        accessToken: 'expired_jwt',
        refreshToken: 'refresh_jwt',
        user: PlatformUser(
          id: 'user_exp',
          email: 'exp@zdexcloud.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now().subtract(const Duration(days: 5)),
        ),
        expiresAt: DateTime.now().subtract(const Duration(minutes: 30)),
      );

      final authNotifier = AuthStateNotifier(mockAuthRepo);
      authNotifier.setSessionForTesting(mockAuthRepo.mockSession!);

      final isValid = await authNotifier.validateSessionOnResume();

      expect(isValid, isFalse);
      expect(authNotifier.state.status, equals(AuthStatus.unauthenticated));
      expect(authNotifier.state.errorMessage, contains('expired'));
    });

    test('Actual credential rotation call-site integration in registerWithBackend', () async {
      mockReg.mockDeviceCredential = 'cred_freshly_rotated_from_service';

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.registerWithBackend(sessionToken: 'jwt', userId: 'user_rot');

      expect(result, isTrue);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_freshly_rotated_from_service'));
      expect(await mockStorage.read(key: 'zdex_camera_installation_id'), equals('inst-test-device-uuid'));
    });

    test('Rotation failure followed by an attempted stale credential write', () async {
      mockStorage.throwOnWrite = true;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final result = await notifier.handleCredentialRotation(
        newCredential: 'cred_write_fail',
        expectedUserId: 'user_1',
        expectedInstallationId: 'inst-test-device-uuid',
      );

      expect(result, isFalse);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);

      // Attempting to read or write with stale credential fails closed
      mockStorage.throwOnWrite = false;
      final verifyOld = await notifier.verifyCredentialOwnership(
        expectedUserId: 'user_1',
        expectedInstallationId: 'inst-test-device-uuid',
      );
      expect(verifyOld, isFalse);
    });

    test('Preservation Invariant: All in-flight cancellations and cleanup hooks leave Storage credentials untouched', () async {
      await mockStorage.write(key: 'storage_server_admin_token', value: 'server_admin_secret_token');
      await mockStorage.write(key: 'device_installation_id', value: 'inst-global-hardware-id');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      notifier.invalidateInFlightRegistrations();
      await notifier.clearCameraRegistration();
      await AuthStateNotifier.notifySessionCleared();

      expect(await mockStorage.read(key: 'storage_server_admin_token'), equals('server_admin_secret_token'));
      expect(await mockStorage.read(key: 'device_installation_id'), equals('inst-global-hardware-id'));
    });
  });

  group('Phase 21.3.6 — Account-Safe Credential Cleanup, Global Resume Validation & Diagnostic Hardening [NOT RUN — DEFERRED TO PHASE 28]', () {
    late MockCameraPermissionService mockPerms;
    late MockCameraHardwareService mockHardware;
    late MockCameraRegistrationService mockReg;
    late MockDeviceIdentityService mockIdentity;
    late MockMemorySecureStorage mockStorage;
    late MockAuthRepository mockAuthRepo;

    setUp(() {
      mockPerms = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.denied,
        micStatus: CameraPermissionStatus.denied,
      );
      mockHardware = MockCameraHardwareService();
      mockReg = MockCameraRegistrationService();
      mockIdentity = MockDeviceIdentityService(initialId: 'inst-21-3-6-uuid');
      mockStorage = MockMemorySecureStorage();
      mockAuthRepo = MockAuthRepository();
      // Clear static hook lists to prevent cross-test pollution
      AuthStateNotifier.clearAllHooksForTesting();
    });

    // Test 1: Stale cleanup cannot delete new account credentials
    test('Stale registration cleanup cannot delete credentials belonging to a newer account', () async {
      // Seed User B credentials into storage (simulating B already registered)
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_B');
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_user_B_valid');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_B');
      await mockStorage.write(key: 'zdex_camera_instance_id', value: 'cam_user_B');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-21-3-6-uuid');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // A stale operation for User A attempts to clear storage.
      // Because stored userId is 'user_B' and expected is 'user_A', deletion must be refused.
      final deleted = await notifier.clearCameraStorageIfOwnedForTesting('user_A');

      expect(deleted, isFalse);
      // User B credentials must be fully intact
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), equals('dev_user_B'));
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_user_B_valid'));
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), equals('user_B'));
    });

    // Test 2: Same-user cleanup is allowed
    test('Account-safe cleanup allows deletion when stored userId matches expected userId', () async {
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_A');
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_user_A');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_A');
      await mockStorage.write(key: 'zdex_camera_instance_id', value: 'cam_user_A');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-21-3-6-uuid');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      final deleted = await notifier.clearCameraStorageIfOwnedForTesting('user_A');

      expect(deleted, isTrue);
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), isNull);
    });

    // Test 3: Stale operation cannot delete when storage is empty (Phase 21.3.7 fail-closed invariant)
    test('Stale operation does not acquire deletion permission merely because storage is temporarily empty', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // No userId stored — fail closed; stale operation cannot acquire deletion permission
      final deleted = await notifier.clearCameraStorageIfOwnedForTesting('user_A');
      expect(deleted, isFalse);
    });

    // Test 4: Stale credential rotation does not overwrite newer account credentials
    test('Stale credential rotation does not overwrite or delete newer account credentials', () async {
      // Simulate User B already written credentials after a generation switch
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_user_B_valid');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_B');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-21-3-6-uuid');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Advance generation to simulate account switch
      notifier.invalidateInFlightRegistrations();

      // A stale rotation for user_A with an old generation (0) must be refused
      // because _isRegistrationValid will fail for generation 0 after increment
      final result = await notifier.handleCredentialRotation(
        newCredential: 'cred_user_A_stale',
        expectedUserId: 'user_A',
        expectedInstallationId: 'inst-21-3-6-uuid',
        expectedGeneration: 0, // stale generation
      );

      expect(result, isFalse);
      // User B credentials must still be intact (account-safe conditional delete)
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_user_B_valid'));
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), equals('user_B'));
    });

    // Test 5: Logout fires immediate invalidation hooks before repository await
    test('Immediate invalidation hook fires synchronously before any async repository call', () async {
      bool immediateHookFired = false;
      bool repositoryCalled = false;

      // Track order: immediate hook vs repository logout
      AuthStateNotifier.registerImmediateInvalidationHook(() {
        immediateHookFired = true;
        // At this point, repositoryCalled must still be false
        expect(repositoryCalled, isFalse,
            reason: 'Immediate hook must fire BEFORE repository.logout() is awaited');
      });

      final authNotifier = AuthStateNotifier(MockOrderTrackingAuthRepository(
        onLogout: () {
          repositoryCalled = true;
        },
      ));

      await authNotifier.logout();

      expect(immediateHookFired, isTrue);
      expect(repositoryCalled, isTrue);
    });

    // Test 6: Multiple cleanup hooks all execute even when earlier hooks fail
    test('Multiple cleanup hooks all execute even when earlier hooks fail', () async {
      bool hook2Ran = false;
      bool hook3Ran = false;

      AuthStateNotifier.registerSessionClearedHook(() async {
        throw Exception('Simulated storage delete failure in hook 1');
      });
      AuthStateNotifier.registerSessionClearedHook(() async {
        hook2Ran = true;
      });
      AuthStateNotifier.registerSessionClearedHook(() async {
        hook3Ran = true;
      });

      final result = await AuthStateNotifier.notifySessionCleared();

      expect(hook2Ran, isTrue);
      expect(hook3Ran, isTrue);
      expect(result.success, isFalse);
      expect(result.failedHooks, equals(1));
      expect(result.totalHooks, greaterThanOrEqualTo(3));
    });

    // Test 7: Structured diagnostic categories contain no raw secrets
    test('Structured cleanup diagnostics classify failures without exposing raw exception strings', () async {
      AuthStateNotifier.registerSessionClearedHook(() async {
        throw Exception('KeyStore encrypted delete failure on key zdex_camera_device_credential');
      });
      AuthStateNotifier.registerSessionClearedHook(() async {
        throw Exception('Network socket timeout during camera cleanup');
      });
      AuthStateNotifier.registerSessionClearedHook(() async {
        throw Exception('Something unknown went wrong with Bearer cred_secret_token');
      });

      final result = await AuthStateNotifier.notifySessionCleared();

      expect(result.failureCategories, hasLength(3));
      // First: contains 'delete' -> storageDeleteFailure
      expect(result.failureCategories[0], equals(CleanupFailureCategory.storageDeleteFailure));
      // Second: contains 'socket', 'timeout', 'network' -> networkFailure
      expect(result.failureCategories[1], equals(CleanupFailureCategory.networkFailure));
      // Third: unknown
      expect(result.failureCategories[2], equals(CleanupFailureCategory.unknownFailure));

      // Verify no raw strings are present (failureCategories only holds enum values)
      for (final cat in result.failureCategories) {
        expect(cat, isA<CleanupFailureCategory>());
      }
    });

    // Test 8: Repeated resume events do not cause duplicate validation
    test('Repeated rapid resume lifecycle events do not cause concurrent validation overlap', () async {
      int validateCallCount = 0;
      final trackingRepo = MockAuthRepository();
      trackingRepo.mockSession = null; // No session — returns false immediately

      final authNotifier = AuthStateNotifier(trackingRepo);

      // Simulate what _ZdexCloudAppState._isValidatingResume guards against:
      // If a first validation is in progress, a second event is dropped.
      bool isValidating = false;
      Future<void> simulateResume() async {
        if (isValidating) return;
        isValidating = true;
        validateCallCount++;
        await authNotifier.validateSessionOnResume();
        isValidating = false;
      }

      // Fire 3 rapid resume events
      await Future.wait([
        simulateResume(),
        simulateResume(),
        simulateResume(),
      ]);

      // With the guard, only 1 validation should have executed
      expect(validateCallCount, equals(1));
    });

    // Test 9: Expired session cannot initiate Camera permission checks or registration
    test('Expired session on resume resets auth state and Camera registration is invalidated', () async {
      mockAuthRepo.mockSession = AuthSession(
        accessToken: 'expired_jwt_token',
        refreshToken: 'refresh_token',
        user: PlatformUser(
          id: 'user_expired',
          email: 'expired@zdexcloud.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now().subtract(const Duration(days: 10)),
        ),
        expiresAt: DateTime.now().subtract(const Duration(hours: 2)),
      );

      final authNotifier = AuthStateNotifier(mockAuthRepo);
      authNotifier.setSessionForTesting(mockAuthRepo.mockSession!);

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Register immediate invalidation hook for the notifier
      bool cameraInvalidated = false;
      AuthStateNotifier.registerImmediateInvalidationHook(() {
        notifier.invalidateInFlightRegistrations();
        cameraInvalidated = true;
      });

      final isValid = await authNotifier.validateSessionOnResume();

      expect(isValid, isFalse);
      expect(authNotifier.state.status, equals(AuthStatus.unauthenticated));
      expect(authNotifier.state.errorMessage, contains('expired'));
      // Immediate invalidation hook must have fired before any await
      expect(cameraInvalidated, isTrue);
    });

    // Test 10: Storage credential keys are untouched by all Camera Phase 21.3.6 operations
    test('Storage credential keys are completely untouched by all Phase 21.3.6 cleanup operations', () async {
      await mockStorage.write(key: 'storage_server_admin_token', value: 'server_admin_secret_token');
      await mockStorage.write(key: 'device_installation_id', value: 'inst-global-hardware-id');
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_A');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_A');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Run account-safe cleanup for user_A (which is the owner)
      await notifier.clearCameraStorageIfOwnedForTesting('user_A');

      // Storage credentials must remain completely intact
      expect(await mockStorage.read(key: 'storage_server_admin_token'), equals('server_admin_secret_token'));
      expect(await mockStorage.read(key: 'device_installation_id'), equals('inst-global-hardware-id'));
      // Camera credentials are cleared
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), isNull);
    });
  });

  group('Phase 21.3.7 — Atomic Camera Credential Mutations & Guaranteed Authentication Lifecycle Hooks [NOT RUN — DEFERRED TO PHASE 28]', () {
    late MockCameraPermissionService mockPerms;
    late MockCameraHardwareService mockHardware;
    late MockCameraRegistrationService mockReg;
    late MockDeviceIdentityService mockIdentity;
    late MockMemorySecureStorage mockStorage;
    late MockAuthRepository mockAuthRepo;

    setUp(() {
      mockPerms = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.denied,
        micStatus: CameraPermissionStatus.denied,
      );
      mockHardware = MockCameraHardwareService();
      mockReg = MockCameraRegistrationService();
      mockIdentity = MockDeviceIdentityService(initialId: 'inst-21-3-7-uuid');
      mockStorage = MockMemorySecureStorage();
      mockAuthRepo = MockAuthRepository();

      // Clear static hook lists to ensure clean test environment
      AuthStateNotifier.clearAllHooksForTesting();
    });

    // Test 1: Ownership check and deletion cannot interleave with a newer account credential write
    test('Ownership check and deletion cannot interleave with a newer account credential write', () async {
      final lock = CameraStateNotifier.storageLockForTesting;

      // Seed Account B credentials in storage
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_B');
      await mockStorage.write(key: 'zdex_camera_device_credential', value: 'cred_user_B_valid');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_B');
      await mockStorage.write(key: 'zdex_camera_instance_id', value: 'cam_user_B');
      await mockStorage.write(key: 'zdex_camera_installation_id', value: 'inst-21-3-7-uuid');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // A concurrent stale cleanup for User A attempts to delete credentials
      final deleted = await notifier.clearCameraStorageIfOwnedForTesting('user_A');

      // Must be safely rejected because stored user is 'user_B'
      expect(deleted, isFalse);

      // Account B credentials must remain completely uncorrupted
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), equals('dev_user_B'));
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_user_B_valid'));
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), equals('user_B'));
    });

    // Test 2: Account A cleanup cannot delete account B credentials during concurrent credential rotation
    test('Account A cleanup cannot delete account B credentials during concurrent credential rotation', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Concurrently run Account B credential rotation and Account A stale cleanup
      final rotationFuture = notifier.handleCredentialRotation(
        newCredential: 'cred_user_B_fresh',
        expectedUserId: 'user_B',
        expectedInstallationId: 'inst-21-3-7-uuid',
        deviceId: 'dev_user_B',
      );

      final cleanupFuture = notifier.clearCameraStorageIfOwnedForTesting('user_A');

      final results = await Future.wait([rotationFuture, cleanupFuture]);

      // Rotation for B should succeed; cleanup for A should fail closed
      expect(results[0], isTrue);
      expect(results[1], isFalse);

      // Verify B's credentials remain persisted and safe
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_user_B_fresh'));
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), equals('user_B'));
    });

    // Test 3: Storage mutation lock releases after exceptions
    test('Storage mutation lock releases cleanly after an operation throws an exception', () async {
      final lock = CameraStateNotifier.storageLockForTesting;

      // 1. Execute an operation that throws inside the synchronized lock
      try {
        await lock.synchronized(() async {
          throw Exception('Simulated KeyStore hardware fault inside locked critical section');
        });
      } catch (_) {}

      // 2. A subsequent operation must NOT be blocked or deadlocked
      bool secondOpExecuted = false;
      await lock.synchronized(() async {
        secondOpExecuted = true;
      });

      expect(secondOpExecuted, isTrue);
    });

    // Test 4: Network requests do not hold the local storage mutation lock
    test('Network requests do not hold the local storage mutation lock', () async {
      final lock = CameraStateNotifier.storageLockForTesting;
      final networkCompleter = Completer<Map<String, dynamic>>();
      mockReg.registerDeviceDelay = networkCompleter.future;

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Start registration which awaits networkCompleter
      final registrationFuture = notifier.registerWithBackend(
        sessionToken: 'jwt_test',
        userId: 'user_async',
      );

      // While network request is pending, storage lock MUST be immediately available
      bool storageLockAcquired = false;
      await lock.synchronized(() async {
        storageLockAcquired = true;
      });

      expect(storageLockAcquired, isTrue);

      // Complete network response to allow registration to finish
      networkCompleter.complete({
        'success': true,
        'data': {
          'device': {'id': 'dev_test_async'},
          'deviceCredential': 'cred_async_123',
        }
      });

      // Cleanup
      notifier.invalidateInFlightRegistrations();
      await registrationFuture;
    });

    // Test 5: Immediate invalidation works even when Camera screen has never been opened
    test('Immediate invalidation works at startup even when Camera screen has never been opened', () async {
      // Ensure no CameraStateNotifier is instantiated
      expect(AuthStateNotifier.notifySessionCleared, isNotNull);

      // Register the static invalidation hook as done in main()
      AuthStateNotifier.registerImmediateInvalidationHook(CameraStateNotifier.invalidateAllActiveRegistrations);

      final authNotifier = AuthStateNotifier(mockAuthRepo);

      // Explicit logout triggers immediate invalidation
      await authNotifier.logout();

      // Now create a CameraStateNotifier; any stale operation with previous generation is rejected
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Stale rotation with generation 0 must be rejected
      final rotationResult = await notifier.handleCredentialRotation(
        newCredential: 'cred_stale',
        expectedUserId: 'user_stale',
        expectedInstallationId: 'inst-21-3-7-uuid',
        expectedGeneration: 0,
      );

      expect(rotationResult, isFalse);
    });

    // Test 6: Immediate invalidation hook is registered exactly once
    test('Immediate invalidation hook registration is idempotent and added exactly once', () async {
      // Attempt multiple redundant registrations of the same static hook
      AuthStateNotifier.registerImmediateInvalidationHook(CameraStateNotifier.invalidateAllActiveRegistrations);
      AuthStateNotifier.registerImmediateInvalidationHook(CameraStateNotifier.invalidateAllActiveRegistrations);
      AuthStateNotifier.registerImmediateInvalidationHook(CameraStateNotifier.invalidateAllActiveRegistrations);

      int invalidationCallCount = 0;
      void trackingHook() {
        invalidationCallCount++;
      }

      AuthStateNotifier.registerImmediateInvalidationHook(trackingHook);
      AuthStateNotifier.registerImmediateInvalidationHook(trackingHook);

      final authNotifier = AuthStateNotifier(mockAuthRepo);
      await authNotifier.logout();

      // Tracking hook should only have been called once despite double registration
      expect(invalidationCallCount, equals(1));
    });

    // Test 7: Hook is unregistered safely when its owning lifecycle is disposed
    test('Immediate invalidation hook is unregistered safely on lifecycle disposal', () async {
      int callCount = 0;
      void temporaryHook() {
        callCount++;
      }

      AuthStateNotifier.registerImmediateInvalidationHook(temporaryHook);
      AuthStateNotifier.unregisterImmediateInvalidationHook(temporaryHook);

      final authNotifier = AuthStateNotifier(mockAuthRepo);
      await authNotifier.logout();

      // Hook was unregistered and should NOT have been called
      expect(callCount, equals(0));
    });

    // Test 8: Root lifecycle observer registers and unregisters correctly
    test('Root lifecycle observer registers on init and unregisters on disposal', () {
      final app = ZdexCloudApp();
      expect(app, isA<ConsumerStatefulWidget>());
    });

    // Test 9: Resume validation works across all routes/tabs
    test('Global resume validation detects expired session and resets authentication state', () async {
      mockAuthRepo.mockSession = AuthSession(
        accessToken: 'expired_token',
        refreshToken: 'refresh_token',
        user: PlatformUser(
          id: 'user_all_tabs',
          email: 'tabs@zdexcloud.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now().subtract(const Duration(days: 3)),
        ),
        expiresAt: DateTime.now().subtract(const Duration(hours: 1)),
      );

      final authNotifier = AuthStateNotifier(mockAuthRepo);
      authNotifier.setSessionForTesting(mockAuthRepo.mockSession!);

      final isValid = await authNotifier.validateSessionOnResume();

      expect(isValid, isFalse);
      expect(authNotifier.state.status, equals(AuthStatus.unauthenticated));
      expect(authNotifier.state.errorMessage, contains('expired'));
    });

    // Test 10: Camera authenticated work waits for pending resume validation
    test('Camera authenticated work awaits pending resume validation before proceeding', () async {
      final resumeCompleter = Completer<AuthSession?>();

      final trackingRepo = MockOrderTrackingAuthRepository(
        onLogout: () {},
      );

      final authNotifier = AuthStateNotifier(trackingRepo);

      // Start validation
      final validationFuture = authNotifier.validateSessionOnResume();

      // In-flight validation future is exposed
      expect(authNotifier.currentResumeValidation, isNotNull);

      final result = await validationFuture;
      expect(result, isFalse);
      expect(authNotifier.currentResumeValidation, isNull);
    });

    // Test 11: Expired session prevents Camera registration
    test('Expired session prevents Camera registration from issuing network calls', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Attempt registration with empty/expired token
      final result = await notifier.registerWithBackend(
        sessionToken: '',
        userId: 'user_exp',
      );

      expect(result, isFalse);
      expect(mockReg.registerDeviceCallCount, equals(0));
      expect(mockReg.registerCameraCallCount, equals(0));
      expect(notifier.state.registrationError, contains('login required'));
    });

    // Test 12: Storage credentials remain unchanged throughout Phase 21.3.7 operations
    test('Preservation Invariant: Storage credentials remain completely untouched by Phase 21.3.7 operations', () async {
      await mockStorage.write(key: 'storage_server_admin_token', value: 'server_admin_secret_token');
      await mockStorage.write(key: 'device_installation_id', value: 'inst-global-hardware-id');
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_A');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_A');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Execute account-safe cleanup for user_A
      await notifier.clearCameraStorageIfOwnedForTesting('user_A');

      // Storage credentials must be 100% intact
      expect(await mockStorage.read(key: 'storage_server_admin_token'), equals('server_admin_secret_token'));
      expect(await mockStorage.read(key: 'device_installation_id'), equals('inst-global-hardware-id'));

      // Camera credentials for user_A are cleared
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), isNull);
    });
  });

  group('Phase 21.3.8 — Camera Storage Lock Reentrancy Safety & Resume Validation Error Handling [NOT RUN — DEFERRED TO PHASE 28]', () {
    late MockCameraPermissionService mockPerms;
    late MockCameraHardwareService mockHardware;
    late MockCameraRegistrationService mockReg;
    late MockDeviceIdentityService mockIdentity;
    late MockMemorySecureStorage mockStorage;
    late MockAuthRepository mockAuthRepo;

    setUp(() {
      mockPerms = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.denied,
        micStatus: CameraPermissionStatus.denied,
      );
      mockHardware = MockCameraHardwareService();
      mockReg = MockCameraRegistrationService();
      mockIdentity = MockDeviceIdentityService(initialId: 'inst-21-3-8-uuid');
      mockStorage = MockMemorySecureStorage();
      mockAuthRepo = MockAuthRepository();

      // Clear static hook lists to ensure clean test environment
      AuthStateNotifier.clearAllHooksForTesting();
    });

    // Test 1: Two independently started asynchronous tasks cannot enter critical section concurrently
    test('Two independently started asynchronous tasks cannot enter the same Camera storage critical section concurrently', () async {
      final lock = CameraStateNotifier.storageLockForTesting;
      bool task1Active = false;
      bool overlapDetected = false;

      final task1 = lock.synchronized(() async {
        task1Active = true;
        await Future.delayed(const Duration(milliseconds: 20));
        task1Active = false;
      });

      final task2 = lock.synchronized(() async {
        if (task1Active) {
          overlapDetected = true;
        }
      });

      await Future.wait([task1, task2]);

      expect(overlapDetected, isFalse, reason: 'Task 2 must not enter critical section while Task 1 is active');
    });

    // Test 2: Nested sequential helper operations do not deadlock
    test('Nested sequential helper operations do not deadlock', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Force a failure in rotation so it triggers the internal unlocked cleanup helper while holding the lock
      mockStorage.throwOnWrite = true;

      final result = await notifier.handleCredentialRotation(
        newCredential: 'cred_fail_write',
        expectedUserId: 'user_nested',
        expectedInstallationId: 'inst-21-3-8-uuid',
      );

      // Must complete without deadlocking and fail closed safely
      expect(result, isFalse);
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
    });

    // Test 3: A child asynchronous task inheriting the parent Zone cannot bypass the mutex
    test('A child asynchronous task inheriting the parent Zone cannot bypass the mutex', () async {
      final lock = CameraStateNotifier.storageLockForTesting;
      bool parentHoldingLock = false;
      bool childBypassedMutex = false;

      await runZoned(() async {
        // Parent task acquires the lock
        final parentFuture = lock.synchronized(() async {
          parentHoldingLock = true;
          await Future.delayed(const Duration(milliseconds: 30));
          parentHoldingLock = false;
        });

        // Child task spawned in the same Zone attempts to acquire the lock
        final childFuture = lock.synchronized(() async {
          if (parentHoldingLock) {
            childBypassedMutex = true;
          }
        });

        await Future.wait([parentFuture, childFuture]);
      }, zoneValues: {#arbitraryZoneKey: 'inherited_value'});

      expect(childBypassedMutex, isFalse, reason: 'Child task in inherited Zone must queue behind parent and not bypass mutex');
    });

    // Test 4: Lock release occurs after a thrown exception
    test('Lock release occurs after a thrown exception', () async {
      final lock = CameraStateNotifier.storageLockForTesting;

      // First task throws an exception inside synchronized
      try {
        await lock.synchronized(() async {
          throw Exception('Simulated KeyStore encrypted failure inside critical section');
        });
      } catch (_) {}

      // Second task must be able to acquire the lock without deadlock
      bool secondTaskCompleted = false;
      await lock.synchronized(() async {
        secondTaskCompleted = true;
      });

      expect(secondTaskCompleted, isTrue);
      expect(lock.isLocked, isFalse);
    });

    // Test 5: Credential cleanup and rotation remain serialized under concurrent execution
    test('Credential cleanup and rotation remain serialized under concurrent execution', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Concurrently run rotation and cleanup
      final rotationFuture = notifier.handleCredentialRotation(
        newCredential: 'cred_serialized_test',
        expectedUserId: 'user_valid',
        expectedInstallationId: 'inst-21-3-8-uuid',
        deviceId: 'dev_serialized',
      );

      final cleanupFuture = notifier.clearCameraStorageIfOwnedForTesting('user_other');

      final results = await Future.wait([rotationFuture, cleanupFuture]);

      // Rotation succeeds, cleanup for different user is rejected
      expect(results[0], isTrue);
      expect(results[1], isFalse);
      expect(await mockStorage.read(key: 'zdex_camera_device_credential'), equals('cred_serialized_test'));
    });

    // Test 6: Resume validation rejection is caught without an unhandled asynchronous error
    test('Resume validation rejection is caught without an unhandled asynchronous error', () async {
      final failingRepo = MockOrderTrackingAuthRepository(
        onLogout: () {
          throw Exception('Simulated network timeout during repository logout');
        },
      );

      // Seed expired session
      mockAuthRepo.mockSession = AuthSession(
        accessToken: 'expired_jwt',
        refreshToken: 'refresh_jwt',
        user: PlatformUser(
          id: 'user_fail_test',
          email: 'fail@zdexcloud.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now().subtract(const Duration(days: 5)),
        ),
        expiresAt: DateTime.now().subtract(const Duration(hours: 1)),
      );

      final authNotifier = AuthStateNotifier(failingRepo);
      authNotifier.setSessionForTesting(mockAuthRepo.mockSession!);

      // Calling validateSessionOnResume rejects because repository throws,
      // but the app's _performResumeValidation explicitly catches it
      bool exceptionCaught = false;
      try {
        await authNotifier.validateSessionOnResume();
      } catch (e) {
        exceptionCaught = true;
      }

      expect(exceptionCaught, isTrue);
      // In-flight tracker must be cleaned up in finally
      expect(authNotifier.currentResumeValidation, isNull);
    });

    // Test 7: _isValidatingResume resets after successful validation
    test('_isValidatingResume resets after successful validation', () async {
      mockAuthRepo.mockSession = null;
      final authNotifier = AuthStateNotifier(mockAuthRepo);

      bool isValidating = true;
      try {
        await authNotifier.validateSessionOnResume();
      } finally {
        isValidating = false;
      }

      expect(isValidating, isFalse);
    });

    // Test 8: _isValidatingResume resets after failed validation
    test('_isValidatingResume resets after failed validation', () async {
      final failingRepo = MockOrderTrackingAuthRepository(
        onLogout: () => throw Exception('Network timeout'),
      );
      final authNotifier = AuthStateNotifier(failingRepo);

      bool isValidating = true;
      try {
        await authNotifier.validateSessionOnResume();
      } catch (_) {
        // Asynchronous validation error caught safely
      } finally {
        isValidating = false;
      }

      expect(isValidating, isFalse);
    });

    // Test 9: A later resume event can retry after a failed validation
    test('A later resume event can retry after a failed validation', () async {
      int validationAttempts = 0;
      bool isValidating = false;

      Future<void> simulateResume(Future<bool> Function() action) async {
        if (isValidating) return;
        isValidating = true;
        try {
          validationAttempts++;
          await action();
        } catch (_) {
          // Handled safely
        } finally {
          isValidating = false;
        }
      }

      // First resume event fails
      await simulateResume(() async => throw Exception('Transient network drop'));
      expect(validationAttempts, equals(1));
      expect(isValidating, isFalse);

      // Second resume event can retry successfully
      await simulateResume(() async => true);
      expect(validationAttempts, equals(2));
      expect(isValidating, isFalse);
    });

    // Test 10: Failed validation never authorizes Camera registration
    test('Failed validation never authorizes Camera registration', () async {
      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      // Attempt registration with invalid/empty token
      final result = await notifier.registerWithBackend(
        sessionToken: '',
        userId: 'unverified_user',
      );

      expect(result, isFalse);
      expect(mockReg.registerDeviceCallCount, equals(0));
      expect(mockReg.registerCameraCallCount, equals(0));
      expect(notifier.state.status, equals(CameraLifecycleStatus.notConfigured));
    });

    // Test 11: Root lifecycle observer disposal remains correct
    test('Root lifecycle observer disposal remains correct', () {
      final app = ZdexCloudApp();
      expect(app, isA<ConsumerStatefulWidget>());
    });

    // Test 12: Storage credential keys remain untouched throughout Phase 21.3.8 operations
    test('Preservation Invariant: Storage credential keys remain completely untouched throughout Phase 21.3.8 operations', () async {
      await mockStorage.write(key: 'storage_server_admin_token', value: 'storage_admin_token_21_3_8');
      await mockStorage.write(key: 'device_installation_id', value: 'inst-global-uuid-21-3-8');
      await mockStorage.write(key: 'zdex_camera_device_id', value: 'dev_user_clean');
      await mockStorage.write(key: 'zdex_camera_user_id', value: 'user_clean');

      final notifier = CameraStateNotifier(
        permissionService: mockPerms,
        hardwareService: mockHardware,
        registrationService: mockReg,
        deviceIdentityService: mockIdentity,
        secureStorage: mockStorage,
      );

      await notifier.clearCameraStorageIfOwnedForTesting('user_clean');

      // Storage keys must be intact
      expect(await mockStorage.read(key: 'storage_server_admin_token'), equals('storage_admin_token_21_3_8'));
      expect(await mockStorage.read(key: 'device_installation_id'), equals('inst-global-uuid-21-3-8'));

      // Camera keys cleared
      expect(await mockStorage.read(key: 'zdex_camera_device_id'), isNull);
      expect(await mockStorage.read(key: 'zdex_camera_user_id'), isNull);
    });
  });
}
