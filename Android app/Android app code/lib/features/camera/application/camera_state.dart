import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../domain/entities/camera_hardware_info.dart';
import '../domain/services/camera_hardware_service.dart';
import '../domain/services/camera_permission_service.dart';
import '../domain/services/camera_registration_service.dart';
import '../../device/domain/services/device_identity_service.dart';
import 'package:flutter/widgets.dart';
import '../../../../core/storage/secure_storage_service.dart';
import '../../auth/application/auth_state.dart';
import '../domain/services/camera_capture_service.dart';

/// Typed Camera Lifecycle States aligned with ZdexCloud Backend Lifecycle Schema
enum CameraLifecycleStatus {
  notConfigured,
  offline,
  connecting,
  online,
  streaming,
  reconnecting,
  error,
}

/// Supported physical camera lens facings (user preference)
enum CameraLensFacing {
  back,
  front,
}

/// Supported streaming resolution presets (user preference)
enum CameraResolutionPreset {
  p360,
  p480,
  p720,
  p1080,
}

/// Immutable Presentation State for ZdexCloud Camera Mode
///
/// NOTE: Architectural decoupling:
/// 1. User preferences (lens, resolution, fps, audio preference)
/// 2. Hardware-reported capabilities (discovered Camera2 characteristics)
/// 3. Granted permissions (Camera, optional Microphone)
/// 4. Camera lifecycle status (notConfigured, offline, online, streaming)
/// 5. Actual streaming state
class CameraState {
  final CameraLifecycleStatus status;
  final String cameraName;
  final String? cameraId;
  final String? deviceId;
  final CameraLensFacing selectedLens;
  final CameraResolutionPreset selectedResolution;
  final int targetFps;
  final bool audioEnabled;
  final int activeViewersCount;
  final DateTime? lastSeenAt;
  final String? errorMessage;
  final bool isConfigured;
  final bool isProcessing;

  // Granular Permission States (Phase 21.3)
  final CameraPermissionStatus cameraPermission;
  final CameraPermissionStatus microphonePermission;

  // Hardware Discovery Capabilities (Phase 21.3 / 21.3.1)
  final List<CameraHardwareInfo> hardwareCameras;
  final String? selectedCameraId;
  final bool isDiscoveringHardware;
  final String? hardwareDiscoveryError;

  // Backend Registration States (Phase 21.3 / 21.3.1)
  final bool isRegistering;
  final String? registrationError;
  final bool isRegistered;
  final String? successMessage;

  // Native Camera2 Capture States (Phase 21.4)
  final CameraCaptureStatus captureStatus;
  final int? textureId;
  final int? activeCaptureWidth;
  final int? activeCaptureHeight;
  final int? activeCaptureFps;
  final bool isEncoderActive;
  final String codecName;
  final String codecAcceleration;
  final bool isHardwareAcceleratedEncoder;
  final bool isCaptureRequestStarted;
  final bool hasPreviewFrame;
  final String? captureError;

  const CameraState({
    this.status = CameraLifecycleStatus.notConfigured,
    this.cameraName = 'Android Security Camera',
    this.cameraId,
    this.deviceId,
    this.selectedLens = CameraLensFacing.back,
    this.selectedResolution = CameraResolutionPreset.p720,
    this.targetFps = 30,
    this.audioEnabled = false,
    this.activeViewersCount = 0,
    this.lastSeenAt,
    this.errorMessage,
    this.isConfigured = false,
    this.isProcessing = false,
    this.cameraPermission = CameraPermissionStatus.notDetermined,
    this.microphonePermission = CameraPermissionStatus.notDetermined,
    this.hardwareCameras = const [],
    this.selectedCameraId,
    this.isDiscoveringHardware = false,
    this.hardwareDiscoveryError,
    this.isRegistering = false,
    this.registrationError,
    this.isRegistered = false,
    this.successMessage,
    this.captureStatus = CameraCaptureStatus.idle,
    this.textureId,
    this.activeCaptureWidth,
    this.activeCaptureHeight,
    this.activeCaptureFps,
    this.isEncoderActive = false,
    this.codecName = 'NONE',
    this.codecAcceleration = 'UNVERIFIED',
    this.isHardwareAcceleratedEncoder = false,
    this.isCaptureRequestStarted = false,
    this.hasPreviewFrame = false,
    this.captureError,
  });

  /// Whether camera permission is currently granted
  bool get hasCameraPermission =>
      cameraPermission == CameraPermissionStatus.granted;

  /// Whether camera permission was permanently denied (Never ask again)
  bool get isCameraPermissionPermanentlyDenied =>
      cameraPermission == CameraPermissionStatus.permanentlyDenied;

  /// Whether microphone permission is currently granted
  bool get hasMicrophonePermission =>
      microphonePermission == CameraPermissionStatus.granted;

  /// Whether microphone permission was permanently denied
  bool get isMicrophonePermissionPermanentlyDenied =>
      microphonePermission == CameraPermissionStatus.permanentlyDenied;

  /// Whether camera hardware capabilities have been discovered via Camera2
  bool get hasDiscoveredHardware => hardwareCameras.isNotEmpty;

  /// Resolves the discovered hardware characteristics for the currently selected lens/sensor
  CameraHardwareInfo? get currentHardwareCamera {
    if (hardwareCameras.isEmpty) return null;
    return hardwareCameras.firstWhere(
      (c) => c.cameraId == selectedCameraId || c.lensFacing == selectedLens,
      orElse: () => hardwareCameras.first,
    );
  }

  /// Evaluates joint resolution and FPS compatibility for the active sensor
  CombinationSupportStatus get combinationSupportStatus {
    final current = currentHardwareCamera;
    if (current == null) {
      return CombinationSupportStatus.unverified;
    }
    return current.evaluateCombination(selectedResolution, targetFps);
  }

  /// Human-readable label for combination support status
  String get combinationSupportLabel {
    switch (combinationSupportStatus) {
      case CombinationSupportStatus.halVerified:
        return 'HAL Verified';
      case CombinationSupportStatus.unverified:
        return 'Preference (Unverified by HAL)';
      case CombinationSupportStatus.unsupported:
        return 'Unsupported by Sensor';
    }
  }

  /// Whether a specific lens facing is physically present on the device
  bool isLensAvailable(CameraLensFacing lens) {
    if (hardwareCameras.isEmpty) return true; // optimistic until probed
    return hardwareCameras.any((c) => c.lensFacing == lens);
  }

  /// Whether a resolution preset is supported by the active camera sensor
  bool isResolutionSupported(CameraResolutionPreset preset) {
    final current = currentHardwareCamera;
    if (current == null) return true;
    return current.supportsResolutionPreset(preset);
  }

  /// Whether an FPS option is supported by the active camera sensor
  bool isFpsSupported(int fps) {
    final current = currentHardwareCamera;
    if (current == null) return true;
    return current.supportsFps(fps);
  }

  /// Human-readable resolution preference label
  String get displayResolution {
    switch (selectedResolution) {
      case CameraResolutionPreset.p360:
        return '360p (640x360)';
      case CameraResolutionPreset.p480:
        return '480p (854x480)';
      case CameraResolutionPreset.p720:
        return '720p (1280x720)';
      case CameraResolutionPreset.p1080:
        return '1080p (1920x1080)';
    }
  }

  /// Compact resolution tag
  String get resolutionTag {
    switch (selectedResolution) {
      case CameraResolutionPreset.p360:
        return '360p';
      case CameraResolutionPreset.p480:
        return '480p';
      case CameraResolutionPreset.p720:
        return '720p';
      case CameraResolutionPreset.p1080:
        return '1080p';
    }
  }

  /// Human-readable lens preference label
  String get displayLens {
    switch (selectedLens) {
      case CameraLensFacing.back:
        return 'Back (Primary)';
      case CameraLensFacing.front:
        return 'Front (Selfie)';
    }
  }

  /// Human-readable lifecycle status label
  String get statusLabel {
    switch (status) {
      case CameraLifecycleStatus.notConfigured:
        return 'NOT CONFIGURED';
      case CameraLifecycleStatus.offline:
        return 'OFFLINE';
      case CameraLifecycleStatus.connecting:
        return 'CONNECTING';
      case CameraLifecycleStatus.online:
        return 'ONLINE';
      case CameraLifecycleStatus.streaming:
        return 'STREAMING';
      case CameraLifecycleStatus.reconnecting:
        return 'RECONNECTING';
      case CameraLifecycleStatus.error:
        return 'ERROR';
    }
  }

  /// Formatted viewer count string or honest placeholder when not streaming
  String get displayViewersCount {
    if (!isStreaming) {
      return 'Not Connected';
    }
    return '$activeViewersCount Connected';
  }

  /// Whether camera is actively broadcasting live video to viewers
  bool get isStreaming => status == CameraLifecycleStatus.streaming;

  /// Whether camera hardware and signaling are connected
  bool get isOnline =>
      status == CameraLifecycleStatus.online ||
      status == CameraLifecycleStatus.streaming;

  /// Whether encoder is platform-reported hardware accelerated (API 29+)
  bool get isHardwareAcceleratedCodec =>
      codecAcceleration.toUpperCase() == 'HARDWARE';

  /// Whether encoder is verified software-only
  bool get isSoftwareCodec =>
      codecAcceleration.toUpperCase() == 'SOFTWARE';

  /// Whether encoder acceleration cannot be verified by platform APIs (e.g. pre-API 29)
  bool get isUnverifiedCodec =>
      codecAcceleration.toUpperCase() == 'UNVERIFIED';

  /// Returns the transport & codec acceleration status label for UI display.
  /// Explicitly denotes platform-reported hardware classification to avoid
  /// claiming unverified physical hardware execution (Phase 21.4.3).
  String get transportStatusLabel {
    if (!isCapturing) return 'VIEWERS: NOT CONNECTED';
    if (!isEncoderActive) return 'PREVIEW ONLY • TRANSPORT OFFLINE';
    if (isHardwareAcceleratedCodec) {
      return 'HW H.264 (PLATFORM-REPORTED) • TRANSPORT OFFLINE';
    }
    if (isSoftwareCodec) {
      return 'SW H.264 • TRANSPORT OFFLINE';
    }
    return 'H.264 (ACCELERATION UNVERIFIED) • TRANSPORT OFFLINE';
  }

  /// Whether actual preview frames have been received on the preview texture
  bool get isPreviewReady => isCapturing && hasPreviewFrame;

  /// Whether native camera hardware is actively capturing and previewing
  bool get isCapturing =>
      captureStatus == CameraCaptureStatus.capturing && textureId != null;

  /// Whether camera is opening or configuring hardware capture
  bool get isOpeningCapture =>
      captureStatus == CameraCaptureStatus.opening ||
      captureStatus == CameraCaptureStatus.configuring;

  /// Whether capture encountered an error
  bool get hasCaptureError =>
      captureStatus == CameraCaptureStatus.error || captureError != null;

  CameraState copyWith({
    CameraLifecycleStatus? status,
    String? cameraName,
    String? cameraId,
    String? deviceId,
    CameraLensFacing? selectedLens,
    CameraResolutionPreset? selectedResolution,
    int? targetFps,
    bool? audioEnabled,
    int? activeViewersCount,
    DateTime? lastSeenAt,
    String? errorMessage,
    bool? isConfigured,
    bool? isProcessing,
    CameraPermissionStatus? cameraPermission,
    CameraPermissionStatus? microphonePermission,
    List<CameraHardwareInfo>? hardwareCameras,
    String? selectedCameraId,
    bool? isDiscoveringHardware,
    String? hardwareDiscoveryError,
    bool? isRegistering,
    String? registrationError,
    bool? isRegistered,
    String? successMessage,
    CameraCaptureStatus? captureStatus,
    int? textureId,
    bool clearTextureId = false,
    int? activeCaptureWidth,
    int? activeCaptureHeight,
    int? activeCaptureFps,
    bool? isEncoderActive,
    String? codecName,
    String? codecAcceleration,
    bool? isHardwareAcceleratedEncoder,
    bool? isCaptureRequestStarted,
    bool? hasPreviewFrame,
    String? captureError,
    bool clearCaptureError = false,
  }) {
    return CameraState(
      status: status ?? this.status,
      cameraName: cameraName ?? this.cameraName,
      cameraId: cameraId ?? this.cameraId,
      deviceId: deviceId ?? this.deviceId,
      selectedLens: selectedLens ?? this.selectedLens,
      selectedResolution: selectedResolution ?? this.selectedResolution,
      targetFps: targetFps ?? this.targetFps,
      audioEnabled: audioEnabled ?? this.audioEnabled,
      activeViewersCount: activeViewersCount ?? this.activeViewersCount,
      lastSeenAt: lastSeenAt ?? this.lastSeenAt,
      errorMessage: errorMessage,
      isConfigured: isConfigured ?? this.isConfigured,
      isProcessing: isProcessing ?? this.isProcessing,
      cameraPermission: cameraPermission ?? this.cameraPermission,
      microphonePermission:
          microphonePermission ?? this.microphonePermission,
      hardwareCameras: hardwareCameras ?? this.hardwareCameras,
      selectedCameraId: selectedCameraId ?? this.selectedCameraId,
      isDiscoveringHardware:
          isDiscoveringHardware ?? this.isDiscoveringHardware,
      hardwareDiscoveryError: hardwareDiscoveryError,
      isRegistering: isRegistering ?? this.isRegistering,
      registrationError: registrationError,
      isRegistered: isRegistered ?? this.isRegistered,
      successMessage: successMessage,
      captureStatus: captureStatus ?? this.captureStatus,
      textureId: clearTextureId ? null : (textureId ?? this.textureId),
      activeCaptureWidth: activeCaptureWidth ?? this.activeCaptureWidth,
      activeCaptureHeight: activeCaptureHeight ?? this.activeCaptureHeight,
      activeCaptureFps: activeCaptureFps ?? this.activeCaptureFps,
      isEncoderActive: isEncoderActive ?? this.isEncoderActive,
      codecName: codecName ?? this.codecName,
      codecAcceleration: codecAcceleration ?? this.codecAcceleration,
      isHardwareAcceleratedEncoder: isHardwareAcceleratedEncoder ?? this.isHardwareAcceleratedEncoder,
      isCaptureRequestStarted: isCaptureRequestStarted ?? this.isCaptureRequestStarted,
      hasPreviewFrame: hasPreviewFrame ?? this.hasPreviewFrame,
      captureError: clearCaptureError ? null : (captureError ?? this.captureError),
    );
  }
}

/// Riverpod StateNotifier managing local Camera UI presentation, permission, and hardware discovery state

/// Asynchronous mutual-exclusion lock for Camera secure storage mutations.
///
/// Serializes all reads required for ownership decisions, credential writes,
/// and credential deletions. Prevents TOCTOU races between ownership verification
/// and deletions, and prevents concurrent credential writes from interleaving.
///
/// Supports reentrancy within the same asynchronous Zone context to allow
/// atomic helper methods (e.g. _clearCameraStorageIfOwned) to be called from within
/// larger atomic transactions (e.g. handleCredentialRotation) without deadlocking.
/// Asynchronous mutual-exclusion lock for Camera secure storage mutations.
///
/// Serializes all reads required for ownership decisions, credential writes,
/// and credential deletions. Prevents TOCTOU races between ownership verification
/// and deletions, and guarantees sequential FIFO execution.
///
/// NON-REENTRANT DESIGN (Phase 21.3.8):
/// Avoids Zone-based reentrancy which can be inherited by asynchronous child tasks,
/// preventing concurrent sibling/child work from erroneously bypassing mutual exclusion.
/// Nested helper operations are decoupled into internal unlocked primitives
/// executed within a single lock acquisition, completely eliminating deadlocks.
class CameraStorageLock {
  Future<void>? _lastOperation;

  /// Whether the lock is currently held by an active operation.
  bool get isLocked => _lastOperation != null;

  /// Executes [criticalSection] strictly under mutual exclusion.
  ///
  /// Every call queues behind the currently active operation in FIFO order.
  /// Guaranteed to release the lock in all cases: successful return,
  /// thrown exception, or cancellation.
  Future<T> synchronized<T>(Future<T> Function() criticalSection) async {
    final previous = _lastOperation;
    final completer = Completer<void>();
    _lastOperation = completer.future;

    if (previous != null) {
      try {
        await previous;
      } catch (_) {
        // Do not allow previous failures to break the lock queue
      }
    }

    try {
      return await criticalSection();
    } finally {
      if (identical(_lastOperation, completer.future)) {
        _lastOperation = null;
      }
      completer.complete();
    }
  }
}
class CameraStateNotifier extends StateNotifier<CameraState> {
  static const String _keyCameraDeviceId = 'zdex_camera_device_id';
  static const String _keyCameraInstanceId = 'zdex_camera_instance_id';
  static const String _keyCameraDeviceCredential = 'zdex_camera_device_credential';
  static const String _keyCameraUserId = 'zdex_camera_user_id';
  static const String _keyCameraInstallationId = 'zdex_camera_installation_id';

  /// Shared reentrant mutual exclusion lock for all Camera credential storage operations.
  static final CameraStorageLock _storageLock = CameraStorageLock();

  /// Test-visible getter for the shared camera storage lock.
  static CameraStorageLock get storageLockForTesting => _storageLock;

  /// Global generation counter incremented on every app-wide invalidation (Phase 21.3.7).
  static int _globalRegistrationGeneration = 0;

  /// Active CameraStateNotifier instances registered in the app.
  static final Set<CameraStateNotifier> _activeInstances = {};

  /// Synchronously cancels and invalidates all in-flight Camera registration and rotation operations
  /// across the entire application, even if no CameraScreen is currently mounted.
  static void invalidateAllActiveRegistrations() {
    _globalRegistrationGeneration++;
    for (final notifier in List<CameraStateNotifier>.from(_activeInstances)) {
      notifier.invalidateInFlightRegistrations();
    }
  }

  final CameraPermissionService _permissionService;
  final CameraHardwareService _hardwareService;
  final CameraRegistrationService? _registrationService;
  final DeviceIdentityService? _deviceIdentityService;
  final SecureStorageService? _secureStorage;
  final CameraCaptureService _captureService;
  StreamSubscription<CameraCaptureResult>? _captureSubscription;
  int _captureGeneration = 0;

  /// Monotonically incrementing generation counter for capture lifecycle safety
  int get captureGeneration => _captureGeneration;

  // Concurrency & Mutex serialization for credential lifecycle operations (Phase 21.3.4)
  Future<void>? _activeCleanupFuture;
  bool _isCleaningUp = false;

  /// Whether an asynchronous cleanup operation is currently executing
  bool get isCleaningUp => _isCleaningUp;

  // Operation generation & user tracking for in-flight cancellation (Phase 21.3.5)
  int _registrationGeneration = 0;
  String? _activeRegistrationUserId;

  /// Cancels and invalidates any in-flight registration operations.
  /// Subsequent network returns will be discarded without mutating state or storage.
  void invalidateInFlightRegistrations() {
    _registrationGeneration++;
    _activeRegistrationUserId = null;
    if (state.isRegistering) {
      state = state.copyWith(isRegistering: false);
    }
  }

  /// Verifies whether an in-flight registration operation is still valid
  bool _isRegistrationValid(int generation, String expectedUserId) {
    return _registrationGeneration == generation &&
        _activeRegistrationUserId == expectedUserId;
  }

  CameraStateNotifier({
    CameraPermissionService? permissionService,
    CameraHardwareService? hardwareService,
    CameraRegistrationService? registrationService,
    DeviceIdentityService? deviceIdentityService,
    SecureStorageService? secureStorage,
    CameraCaptureService? captureService,
  })  : _permissionService =
            permissionService ?? PlatformCameraPermissionService(),
        _hardwareService =
            hardwareService ?? PlatformCameraHardwareService(),
        _registrationService = registrationService,
        _deviceIdentityService = deviceIdentityService,
        _secureStorage = secureStorage,
        _captureService = captureService ?? PlatformCameraCaptureService(),
        super(const CameraState()) {
    _activeInstances.add(this);
    _listenToCaptureEvents();
  }

  @override
  void dispose() {
    _captureSubscription?.cancel();
    _activeInstances.remove(this);
    super.dispose();
  }

  /// Unlocked internal helper to clear all camera keys from a [SecureStorageService].
  /// MUST only be called while [_storageLock] is already held.
  static Future<void> _performGlobalSessionClearedUnlocked(SecureStorageService secureStorage) async {
    final errors = <Object>[];
    for (final key in [
      _keyCameraDeviceId,
      _keyCameraInstanceId,
      _keyCameraDeviceCredential,
      _keyCameraUserId,
      _keyCameraInstallationId,
    ]) {
      try {
        await secureStorage.delete(key: key);
      } catch (e) {
        errors.add(e);
      }
    }
    if (errors.isNotEmpty) {
      throw Exception('Failed to delete one or more camera keys during session clearance: \ errors');
    }
  }

  /// Unlocked internal helper to clear all camera keys from local [_secureStorage].
  /// MUST only be called while [_storageLock] is already held.
  Future<void> _performClearCameraStorageUnlocked() async {
    if (_secureStorage == null) return;
    try {
      await _secureStorage!.delete(key: _keyCameraDeviceId);
      await _secureStorage!.delete(key: _keyCameraInstanceId);
      await _secureStorage!.delete(key: _keyCameraDeviceCredential);
      await _secureStorage!.delete(key: _keyCameraUserId);
      await _secureStorage!.delete(key: _keyCameraInstallationId);
    } catch (_) {}
  }

  /// Unlocked internal helper for account-safe camera credential deletion.
  /// MUST only be called while [_storageLock] is already held.
  Future<bool> _performClearCameraStorageIfOwnedUnlocked(String expectedUserId) async {
    if (_secureStorage == null || expectedUserId.isEmpty) return false;
    try {
      final storedUserId = await _secureStorage!.read(key: _keyCameraUserId);
      // Fail closed: must strictly match expectedUserId.
      // If storage is empty (null/empty) or owned by another user,
      // this operation does NOT hold ownership — do NOT delete.
      if (storedUserId == null || storedUserId != expectedUserId) {
        return false;
      }
      await _secureStorage!.delete(key: _keyCameraDeviceId);
      await _secureStorage!.delete(key: _keyCameraInstanceId);
      await _secureStorage!.delete(key: _keyCameraDeviceCredential);
      await _secureStorage!.delete(key: _keyCameraUserId);
      await _secureStorage!.delete(key: _keyCameraInstallationId);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Static handler to purge camera credentials directly from SecureStorageService,
  /// even if CameraStateNotifier is not active or instantiated.
  /// Strictly isolates Camera storage; leaves Storage (File Server) credentials untouched.
  static Future<void> handleGlobalSessionCleared(SecureStorageService secureStorage) async {
    await _storageLock.synchronized(() async {
      await _performGlobalSessionClearedUnlocked(secureStorage);
    });
  }

  /// Verifies that stored camera credentials match both the currently authenticated user
  /// and the physical hardware installation identity.
  ///
  /// FAIL-CLOSED GUARANTEE:
  /// If either the user ID or installation ID is missing or does not match expectations,
  /// all camera credentials are immediately purged and false is returned.
  Future<bool> verifyCredentialOwnership({
    required String expectedUserId,
    required String expectedInstallationId,
  }) async {
    if (_secureStorage == null) return false;

    if (_activeCleanupFuture != null) {
      await _activeCleanupFuture;
    }

    return _storageLock.synchronized(() async {
      try {
        final storedUserId = await _secureStorage!.read(key: _keyCameraUserId);
        final storedInstallationId =
            await _secureStorage!.read(key: _keyCameraInstallationId);

        if (storedUserId == null ||
            storedUserId.isEmpty ||
            storedUserId != expectedUserId ||
            storedInstallationId == null ||
            storedInstallationId.isEmpty ||
            storedInstallationId != expectedInstallationId) {
          // Ownership mismatch or missing metadata — fail closed and purge via unlocked helper
          await _performClearCameraStorageUnlocked();
          invalidateInFlightRegistrations();
          state = state.copyWith(
            deviceId: null,
            cameraId: null,
            isRegistered: false,
            isConfigured: false,
            status: CameraLifecycleStatus.notConfigured,
          );
          return false;
        }

        return true;
      } catch (_) {
        await _performClearCameraStorageUnlocked();
        invalidateInFlightRegistrations();
        state = state.copyWith(
          deviceId: null,
          cameraId: null,
          isRegistered: false,
          isConfigured: false,
          status: CameraLifecycleStatus.notConfigured,
        );
        return false;
      }
    });
  }

  /// Initializes registration state from local persistent storage on startup
  /// Isolates registration state by currentUserId and verifies physical installationId.
  Future<void> initRegistrationState({String? currentUserId}) async {
    if (_secureStorage == null) return;
    if (_activeCleanupFuture != null) {
      await _activeCleanupFuture;
    }

    await _storageLock.synchronized(() async {
      try {
        String? currentInstallationId;
        if (_deviceIdentityService != null) {
          try {
            currentInstallationId = await _deviceIdentityService!.getInstallationId();
          } catch (_) {}
        }

        if (currentUserId != null && currentUserId.isNotEmpty) {
          final storedUserId = await _secureStorage!.read(key: _keyCameraUserId);
          final storedInstallationId =
              await _secureStorage!.read(key: _keyCameraInstallationId);

          // Account switch detected! Invalidate and purge prior user's camera data via unlocked helper
          if (storedUserId != null && storedUserId.isNotEmpty && storedUserId != currentUserId) {
            await _performClearCameraStorageUnlocked();
            invalidateInFlightRegistrations();
            state = state.copyWith(
              deviceId: null,
              cameraId: null,
              isRegistered: false,
              isConfigured: false,
              status: CameraLifecycleStatus.notConfigured,
            );
            return;
          }

          // Installation ID mismatch detected! Fail closed and purge
          if (currentInstallationId != null && currentInstallationId.isNotEmpty) {
            if (storedInstallationId != null &&
                storedInstallationId.isNotEmpty &&
                storedInstallationId != currentInstallationId) {
              await _performClearCameraStorageUnlocked();
              invalidateInFlightRegistrations();
              state = state.copyWith(
                deviceId: null,
                cameraId: null,
                isRegistered: false,
                isConfigured: false,
                status: CameraLifecycleStatus.notConfigured,
              );
              return;
            }
          }
        }

        final savedDeviceId = await _secureStorage!.read(key: _keyCameraDeviceId);
        final savedCameraId = await _secureStorage!.read(key: _keyCameraInstanceId);

        var updated = state;
        if (savedDeviceId != null && savedDeviceId.isNotEmpty) {
          updated = updated.copyWith(deviceId: savedDeviceId);
        }
        if (savedCameraId != null && savedCameraId.isNotEmpty) {
          updated = updated.copyWith(
            cameraId: savedCameraId,
            isRegistered: true,
            isConfigured: true,
            status: CameraLifecycleStatus.offline, // Still OFFLINE, NOT ONLINE!
          );
        }
        state = updated;
      } catch (_) {}
    });
  }

  /// Internal helper to clear all camera-scoped secure storage keys unconditionally.
  /// Strictly isolates Camera storage; leaves Storage (File Server) credentials untouched.
  Future<void> _clearCameraStorage() async {
    if (_secureStorage == null) return;
    await _storageLock.synchronized(() async {
      await _performClearCameraStorageUnlocked();
    });
  }

  /// Account-safe variant of _clearCameraStorage.
  ///
  /// Atomically verifies that stored [_keyCameraUserId] exactly matches [expectedUserId],
  /// and if matched, deletes all Camera credentials within the same atomic transaction.
  Future<bool> _clearCameraStorageIfOwned(String expectedUserId) async {
    if (_secureStorage == null || expectedUserId.isEmpty) return false;
    return _storageLock.synchronized(() async {
      return await _performClearCameraStorageIfOwnedUnlocked(expectedUserId);
    });
  }

  /// Explicitly clears local camera credentials and registration state on account sign-out or reset.
  /// Immediately invalidates any in-flight registration operations.
  /// Idempotent, safe to call repeatedly, and serialized to prevent race conditions.
  Future<bool> clearCameraRegistration() async {
    // 1. Immediately invalidate in-flight registration operations
    invalidateInFlightRegistrations();

    if (_activeCleanupFuture != null) {
      await _activeCleanupFuture;
      return state.status == CameraLifecycleStatus.notConfigured;
    }

    _isCleaningUp = true;
    final future = _performCleanup();
    _activeCleanupFuture = future;

    try {
      final success = await future;
      return success;
    } finally {
      _isCleaningUp = false;
      _activeCleanupFuture = null;
    }
  }

  Future<bool> _performCleanup() async {
    bool storageCleaned = true;
    if (_secureStorage != null) {
      try {
        await _storageLock.synchronized(() async {
          await _performGlobalSessionClearedUnlocked(_secureStorage!);
        });
      } catch (_) {
        storageCleaned = false;
      }
    }

    state = state.copyWith(
      deviceId: null,
      cameraId: null,
      isRegistered: false,
      isConfigured: false,
      status: CameraLifecycleStatus.notConfigured,
      registrationError: storageCleaned
          ? null
          : 'Local camera credentials could not be fully cleared. Re-login will re-verify.',
      successMessage: null,
    );

    return storageCleaned;
  }

  /// Safely handles device credential rotation (e.g. following /api/v1/devices/re-enroll).
  ///
  /// ATOMIC STORAGE & GENERATION GUARANTEES (Phase 21.3.7 / 21.3.8):
  /// 1. Protected by non-reentrant [_storageLock.synchronized].
  /// 2. Generation and user identity are verified BOTH before acquiring lock and INSIDE the lock.
  /// 3. Checks existing storage ownership: if storage is owned by a different user, refuses to overwrite.
  /// 4. Encrypted write followed by verification read.
  /// 5. Post-write generation and user validation.
  /// 6. If any step fails, purges ONLY this operation's credentials via unlocked [_performClearCameraStorageIfOwnedUnlocked],
  ///    avoiding nested lock acquisition and deadlocks while leaving newer accounts' credentials untouched.
  Future<bool> handleCredentialRotation({
    required String newCredential,
    required String expectedUserId,
    required String expectedInstallationId,
    String? deviceId,
    int? expectedGeneration,
  }) async {
    if (_activeCleanupFuture != null) {
      await _activeCleanupFuture;
    }

    // Fast initial check before lock acquisition
    if (expectedGeneration != null &&
        !_isRegistrationValid(expectedGeneration, expectedUserId)) {
      return false;
    }

    if (_secureStorage == null) {
      state = state.copyWith(
        status: CameraLifecycleStatus.notConfigured,
        isRegistered: false,
        registrationError:
            'Secure storage not available. Device credential cannot be stored securely.',
      );
      return false;
    }

    final trimmedCred = newCredential.trim();
    if (trimmedCred.isEmpty) {
      await _clearCameraStorageIfOwned(expectedUserId);
      state = state.copyWith(
        status: CameraLifecycleStatus.notConfigured,
        isRegistered: false,
        deviceId: null,
        cameraId: null,
        registrationError:
            'Received empty device credential during rotation. Stored credentials purged. Re-enrollment required.',
      );
      return false;
    }

    return _storageLock.synchronized(() async {
      try {
        // Re-check generation and user identity INSIDE the lock before writing
        if (expectedGeneration != null &&
            !_isRegistrationValid(expectedGeneration, expectedUserId)) {
          return false;
        }

        // Ownership invariant: If storage already belongs to another user, do NOT overwrite!
        final currentOwner = await _secureStorage!.read(key: _keyCameraUserId);
        if (currentOwner != null &&
            currentOwner.isNotEmpty &&
            currentOwner != expectedUserId) {
          return false;
        }

        // Step 2: Encrypted persistence
        await _secureStorage!.write(
          key: _keyCameraDeviceCredential,
          value: trimmedCred,
        );
        await _secureStorage!.write(
          key: _keyCameraUserId,
          value: expectedUserId,
        );
        await _secureStorage!.write(
          key: _keyCameraInstallationId,
          value: expectedInstallationId,
        );
        if (deviceId != null && deviceId.isNotEmpty) {
          await _secureStorage!.write(
            key: _keyCameraDeviceId,
            value: deviceId,
          );
        }

        // Step 3: Verification read
        final verifiedCred =
            await _secureStorage!.read(key: _keyCameraDeviceCredential);
        final verifiedUser = await _secureStorage!.read(key: _keyCameraUserId);
        final verifiedInst =
            await _secureStorage!.read(key: _keyCameraInstallationId);

        if (verifiedCred != trimmedCred ||
            verifiedUser != expectedUserId ||
            verifiedInst != expectedInstallationId) {
          throw Exception('Verification read mismatch during credential rotation');
        }

        // Step 4: Verify operation was not invalidated/switched while writing
        if (expectedGeneration != null &&
            !_isRegistrationValid(expectedGeneration, expectedUserId)) {
          await _performClearCameraStorageIfOwnedUnlocked(expectedUserId);
          return false;
        }

        // Step 5: Success confirmation
        var updated = state.copyWith(
          registrationError: null,
          successMessage: 'Device credentials rotated successfully.',
        );
        if (deviceId != null && deviceId.isNotEmpty) {
          updated = updated.copyWith(deviceId: deviceId);
        }
        state = updated;
        return true;
      } catch (_) {
        // Step 6: Failure handling — purge revoked credential from storage (unlocked helper).
        await _performClearCameraStorageIfOwnedUnlocked(expectedUserId);
        state = state.copyWith(
          status: CameraLifecycleStatus.notConfigured,
          isRegistered: false,
          isConfigured: false,
          deviceId: null,
          cameraId: null,
          registrationError:
              'Device credential rotation failed to persist securely. Revoked credentials purged. Please re-enroll device.',
        );
        return false;
      }
    });
  }
  /// Checks runtime permission status without triggering system prompt
  Future<void> checkPermissions({String? currentUserId}) async {
    await initRegistrationState(currentUserId: currentUserId);

    final prevCam = state.cameraPermission;
    final cam = await _permissionService.checkCameraPermission();
    final mic = await _permissionService.checkMicrophonePermission();

    // Detect permission revocation while in background
    String? revocationMessage;
    if (prevCam == CameraPermissionStatus.granted &&
        cam != CameraPermissionStatus.granted) {
      revocationMessage =
          'Camera permission was revoked in Android Settings. Re-authorization required.';
    }

    state = state.copyWith(
      cameraPermission: cam,
      microphonePermission: mic,
      errorMessage: revocationMessage ?? state.errorMessage,
    );

    // If camera permission is already granted and hardware not yet probed, discover hardware
    if (cam == CameraPermissionStatus.granted && state.hardwareCameras.isEmpty) {
      await discoverHardware();
    }
  }

  /// Requests camera permission via system prompt
  Future<CameraPermissionStatus> requestCameraPermission() async {
    final status = await _permissionService.requestCameraPermission();
    state = state.copyWith(cameraPermission: status);

    if (status == CameraPermissionStatus.granted) {
      await discoverHardware();
    }
    return status;
  }

  /// Requests optional microphone permission via system prompt
  Future<CameraPermissionStatus> requestMicrophonePermission() async {
    final status = await _permissionService.requestMicrophonePermission();
    state = state.copyWith(
      microphonePermission: status,
      audioEnabled: status == CameraPermissionStatus.granted,
    );
    return status;
  }

  /// Navigates user to Android application details settings
  Future<bool> openAppSettings() async {
    return _permissionService.openAppSettings();
  }

  /// Non-destructive hardware discovery via Camera2 CameraManager
  Future<void> discoverHardware() async {
    state = state.copyWith(
      isDiscoveringHardware: true,
      hardwareDiscoveryError: null,
    );

    try {
      final cameras = await _hardwareService.discoverCameras();

      if (cameras.isEmpty) {
        state = state.copyWith(
          isDiscoveringHardware: false,
          hardwareCameras: [],
          hardwareDiscoveryError: 'No camera hardware detected on this device.',
        );
        return;
      }

      // Resolve matching camera ID for current lens preference
      CameraHardwareInfo? targetCam = cameras.firstWhere(
        (c) => c.lensFacing == state.selectedLens,
        orElse: () => cameras.first,
      );

      // If requested lens isn't present, adapt preference to available lens
      final effectiveLens = targetCam.lensFacing;

      // Validate resolution against hardware capabilities
      var effectiveResolution = state.selectedResolution;
      if (!targetCam.supportsResolutionPreset(effectiveResolution)) {
        for (final p in [
          CameraResolutionPreset.p720,
          CameraResolutionPreset.p480,
          CameraResolutionPreset.p360,
          CameraResolutionPreset.p1080,
        ]) {
          if (targetCam.supportsResolutionPreset(p)) {
            effectiveResolution = p;
            break;
          }
        }
      }

      // Validate FPS against hardware capabilities
      var effectiveFps = state.targetFps;
      if (!targetCam.supportsFps(effectiveFps)) {
        if (targetCam.supportsFps(30)) {
          effectiveFps = 30;
        } else if (targetCam.supportsFps(15)) {
          effectiveFps = 15;
        }
      }

      state = state.copyWith(
        isDiscoveringHardware: false,
        hardwareCameras: cameras,
        selectedCameraId: targetCam.cameraId,
        selectedLens: effectiveLens,
        selectedResolution: effectiveResolution,
        targetFps: effectiveFps,
      );
    } catch (e) {
      state = state.copyWith(
        isDiscoveringHardware: false,
        hardwareDiscoveryError: 'Hardware discovery failed: ${e.toString()}',
      );
    }
  }

  /// Updates preferred physical lens (Back / Front)
  void setLens(CameraLensFacing lens) {
    if (!state.isLensAvailable(lens)) return;
    if (state.isCapturing) {
      switchCameraLens(lens);
      return;
    }

    CameraHardwareInfo? matchingCam;
    if (state.hardwareCameras.isNotEmpty) {
      matchingCam = state.hardwareCameras.firstWhere(
        (c) => c.lensFacing == lens,
        orElse: () => state.hardwareCameras.first,
      );
    }

    state = state.copyWith(
      selectedLens: lens,
      selectedCameraId: matchingCam?.cameraId ?? state.selectedCameraId,
    );

    // Re-verify resolution support for the new sensor
    if (matchingCam != null &&
        !matchingCam.supportsResolutionPreset(state.selectedResolution)) {
      for (final p in [
        CameraResolutionPreset.p720,
        CameraResolutionPreset.p480,
        CameraResolutionPreset.p360,
        CameraResolutionPreset.p1080,
      ]) {
        if (matchingCam.supportsResolutionPreset(p)) {
          setResolution(p);
          break;
        }
      }
    }
  }

  /// Updates preferred target streaming resolution preset
  void setResolution(CameraResolutionPreset resolution) {
    if (state.isResolutionSupported(resolution)) {
      state = state.copyWith(selectedResolution: resolution);
    }
  }

  /// Updates preferred target streaming frame rate
  void setFps(int fps) {
    if (state.isFpsSupported(fps)) {
      state = state.copyWith(targetFps: fps);
    }
  }

  /// Toggles optional audio capture preference
  void setAudioEnabled(bool enabled) {
    if (!enabled) {
      state = state.copyWith(audioEnabled: false);
    } else {
      if (state.hasMicrophonePermission) {
        state = state.copyWith(audioEnabled: true);
      }
    }
  }

  /// Sets camera local display name preference
  void setCameraName(String name) {
    if (name.trim().isNotEmpty) {
      state = state.copyWith(cameraName: name.trim());
    }
  }

  /// Saves user configuration locally without starting camera capture
  void saveLocalConfiguration() {
    state = state.copyWith(
      isConfigured: true,
      successMessage: 'Camera configuration saved successfully.',
    );
  }

  /// Idempotent backend registration with partial-failure handling (Phase 21.3.1 / 21.3.2 / 21.3.3 / 21.3.5)
  ///
  /// FAIL-CLOSED & IN-FLIGHT CANCELLATION GUARANTEES:
  /// 1. Captures current authenticated user identity and operation generation before starting.
  /// 2. If user logs out, switches account, or session expires in-flight, generation increments
  ///    and operation is immediately invalidated.
  /// 3. Invalidation checks occur after every asynchronous boundary and before every write.
  /// 4. An invalidated operation NEVER mutates state or writes credentials to SecureStorageService.
  /// 5. Re-enrollment/credential rotation is directly routed to handleCredentialRotation.
  Future<bool> registerWithBackend({
    String? sessionToken,
    String? userId,
  }) async {
    // 0. Await any active cleanup to prevent race conditions (Phase 21.3.4)
    if (_activeCleanupFuture != null) {
      await _activeCleanupFuture;
    }

    // 1. Guard against concurrent / duplicate taps
    if (state.isRegistering || _isCleaningUp) {
      return false;
    }

    if (_registrationService == null || _deviceIdentityService == null) {
      state = state.copyWith(
        registrationError: 'Registration service not initialized.',
      );
      return false;
    }

    if (sessionToken == null || sessionToken.isEmpty) {
      state = state.copyWith(
        registrationError: 'Account login required to register camera node.',
      );
      return false;
    }

    // 2. Capture operation generation and user identity for in-flight cancellation (Phase 21.3.5)
    final int currentGeneration = ++_registrationGeneration;
    final String currentUserId = (userId != null && userId.isNotEmpty) ? userId : '';
    _activeRegistrationUserId = currentUserId;

    state = state.copyWith(
      isRegistering: true,
      registrationError: null,
      successMessage: null,
    );

    try {
      final installationId = await _deviceIdentityService!.getInstallationId();

      // Check boundary 1: after device identity lookup
      if (!_isRegistrationValid(currentGeneration, currentUserId)) {
        return false;
      }

      // Account Switch Safeguard: purge old user's camera credentials if userId changed
      if (currentUserId.isNotEmpty && _secureStorage != null) {
        final needsPurge = await _storageLock.synchronized(() async {
          final storedUserId = await _secureStorage!.read(key: _keyCameraUserId);
          if (storedUserId != null && storedUserId.isNotEmpty && storedUserId != currentUserId) {
            await _performClearCameraStorageUnlocked();
            return true;
          }
          return false;
        });
        if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;
        if (needsPurge) {
          state = state.copyWith(
            deviceId: null,
            cameraId: null,
            isRegistered: false,
            isConfigured: false,
            status: CameraLifecycleStatus.notConfigured,
          );
        }
      }

      // 3. Step 1: Resolve or Register Device Node (Idempotent)
      String? targetDeviceId = state.deviceId;

      if (targetDeviceId == null || targetDeviceId.isEmpty) {
        final savedDeviceId =
            await _secureStorage?.read(key: _keyCameraDeviceId);
        if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;

        if (savedDeviceId != null && savedDeviceId.isNotEmpty) {
          targetDeviceId = savedDeviceId;
          state = state.copyWith(deviceId: targetDeviceId);
        }
      }

      if (targetDeviceId == null || targetDeviceId.isEmpty) {
        final devRes = await _registrationService!.registerCameraDevice(
          sessionToken: sessionToken,
          deviceName: state.cameraName,
          installationId: installationId,
        );

        // Check boundary 2: after registerCameraDevice network response
        if (!_isRegistrationValid(currentGeneration, currentUserId)) {
          return false;
        }

        if (devRes['success'] != true) {
          final err = devRes['error'] as Map<String, dynamic>?;
          final errMsg = err?['message'] as String? ?? 'Device registration failed';
          state = state.copyWith(
            isRegistering: false,
            registrationError: '$errMsg. Tap to retry.',
          );
          return false;
        }

        final devData = devRes['data']?['device'] as Map<String, dynamic>?;
        targetDeviceId = devData?['id'] as String?;

        if (targetDeviceId == null || targetDeviceId.isEmpty) {
          state = state.copyWith(
            isRegistering: false,
            registrationError:
                'Device registration returned empty device ID. Tap to retry.',
          );
          return false;
        }

        // Before writing device ID to storage, verify validity
        if (!_isRegistrationValid(currentGeneration, currentUserId)) {
          return false;
        }

        state = state.copyWith(deviceId: targetDeviceId);

        // Securely persist device ID & userId (atomic under storage lock)
        try {
          await _storageLock.synchronized(() async {
            if (!_isRegistrationValid(currentGeneration, currentUserId)) return;
            await _secureStorage?.write(
                key: _keyCameraDeviceId, value: targetDeviceId!);
            if (currentUserId.isNotEmpty) {
              await _secureStorage?.write(key: _keyCameraUserId, value: currentUserId);
            }
          });
        } catch (e) {
          if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;
          state = state.copyWith(
            isRegistering: false,
            registrationError:
                'Failed to securely persist device ID: \. Tap to retry.',
          );
          return false;
        }

        if (!_isRegistrationValid(currentGeneration, currentUserId)) {
          return false;
        }

        // Credential Lifecycle & Persistence Handling via handleCredentialRotation
        final rawCredential = devRes['data']?['deviceCredential'] as String?;
        if (rawCredential != null && rawCredential.trim().isNotEmpty) {
          final rotationSuccess = await handleCredentialRotation(
            newCredential: rawCredential,
            expectedUserId: currentUserId,
            expectedInstallationId: installationId,
            deviceId: targetDeviceId,
            expectedGeneration: currentGeneration,
          );
          if (!rotationSuccess) {
            return false;
          }
        } else {
          // If backend did not return a fresh credential (existing device reuse), ensure we already hold a valid credential
          final existingCred =
              await _secureStorage?.read(key: _keyCameraDeviceCredential);
          if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;

          if (existingCred == null || existingCred.trim().isEmpty) {
            state = state.copyWith(
              isRegistering: false,
              registrationError:
                  'Device node is missing authentication credentials. Device re-enrollment required.',
            );
            return false;
          }
        }
      } else {
        // Device ID was already present; verify we hold a valid credential for this device
        final existingCred =
            await _secureStorage?.read(key: _keyCameraDeviceCredential);
        if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;

        if (existingCred == null || existingCred.trim().isEmpty) {
          state = state.copyWith(
            isRegistering: false,
            registrationError:
                'Device node is missing authentication credentials. Device re-enrollment required.',
          );
          return false;
        }
      }

      // Check boundary 3: before pagination lookup
      if (!_isRegistrationValid(currentGeneration, currentUserId)) {
        return false;
      }

      // 4. Step 2: Idempotent Lookup with Pagination (FAIL-CLOSED)
      final matchingCameras = <Map<String, dynamic>>[];
      int currentPage = 1;
      bool hasMore = true;
      const pageLimit = 100;
      const maxSafetyPages = 5; // 5 * 100 = 500 records ceiling
      bool lookupFailed = false;
      String? lookupErrorMessage;

      while (hasMore) {
        if (!_isRegistrationValid(currentGeneration, currentUserId)) {
          return false;
        }

        if (currentPage > maxSafetyPages) {
          // Ceiling reached while hasMore is still true! FAIL CLOSED!
          lookupFailed = true;
          lookupErrorMessage =
              'Camera lookup ceiling reached (more than 500 records). Existing cameras could not be verified conclusively. Please manage cameras in the web console.';
          break;
        }

        final Map<String, dynamic> listRes;
        try {
          listRes = await _registrationService!.listCameras(
            sessionToken: sessionToken,
            deviceId: targetDeviceId,
            page: currentPage,
            limit: pageLimit,
          );
        } catch (e) {
          lookupFailed = true;
          lookupErrorMessage =
              'Failed to query existing cameras on page $currentPage: ${e.toString()}. Tap to retry.';
          break;
        }

        if (!_isRegistrationValid(currentGeneration, currentUserId)) {
          return false;
        }

        if (listRes['success'] != true) {
          lookupFailed = true;
          final err = listRes['error'] as Map<String, dynamic>?;
          final errMsg = err?['message'] as String? ?? 'Network or server failure';
          lookupErrorMessage =
              'Failed to query existing cameras on page $currentPage: $errMsg. Tap to retry.';
          break;
        }

        final data = listRes['data'] as Map<String, dynamic>?;
        if (data == null || data['cameras'] is! List) {
          lookupFailed = true;
          lookupErrorMessage =
              'Invalid response format when querying cameras on page $currentPage. Tap to retry.';
          break;
        }

        final pageCameras = data['cameras'] as List<dynamic>;
        for (final c in pageCameras) {
          if (c is Map && c['deviceId'] == targetDeviceId) {
            matchingCameras.add(Map<String, dynamic>.from(c));
          }
        }

        hasMore = (data['hasMore'] as bool?) ?? false;
        currentPage++;
      }

      if (!_isRegistrationValid(currentGeneration, currentUserId)) {
        return false;
      }

      // FAIL-CLOSED CHECK: If lookup failed at any point, abort registration.
      // Under NO circumstances issue POST /api/v1/cameras!
      if (lookupFailed) {
        state = state.copyWith(
          isRegistering: false,
          registrationError: lookupErrorMessage ??
              'Failed to verify existing cameras. Please tap to retry.',
        );
        return false;
      }

      // Complete, conclusive lookup completed (hasMore == false across all fetched pages)
      if (matchingCameras.isNotEmpty) {
        // Check for exact name match first
        final exactNameMatches = matchingCameras
            .where((c) => c['cameraName'] == state.cameraName)
            .toList();

        if (exactNameMatches.length == 1) {
          // Exact single match found on this device
          final existing = exactNameMatches.first;
          final existingId = existing['id'] as String?;
          if (existingId != null && existingId.isNotEmpty) {
            if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;
            await _storageLock.synchronized(() async {
              if (!_isRegistrationValid(currentGeneration, currentUserId)) return;
              await _secureStorage?.write(
                  key: _keyCameraInstanceId, value: existingId);
            });
            if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;

            state = state.copyWith(
              isRegistering: false,
              isRegistered: true,
              isConfigured: true,
              cameraId: existingId,
              status: CameraLifecycleStatus.offline, // Still OFFLINE, NOT ONLINE!
              successMessage:
                  'Reused existing camera registration for this device.',
            );
            return true;
          }
        } else if (exactNameMatches.length > 1) {
          // Explicit ambiguity: multiple cameras with the same name on this device
          state = state.copyWith(
            isRegistering: false,
            registrationError:
                'Multiple camera records found with name "${state.cameraName}" for this device. Please manage cameras in the web console.',
          );
          return false;
        } else {
          // No exact name match among registered cameras on this device
          if (matchingCameras.length == 1) {
            // Exactly one camera registered for this physical device; safely reuse it
            final singleExisting = matchingCameras.first;
            final existingId = singleExisting['id'] as String?;
            if (existingId != null && existingId.isNotEmpty) {
              if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;
              await _storageLock.synchronized(() async {
                if (!_isRegistrationValid(currentGeneration, currentUserId)) return;
                await _secureStorage?.write(
                    key: _keyCameraInstanceId, value: existingId);
              });
              if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;

              state = state.copyWith(
                isRegistering: false,
                isRegistered: true,
                isConfigured: true,
                cameraId: existingId,
                status: CameraLifecycleStatus.offline,
                successMessage:
                    'Reused existing camera registration for this device.',
              );
              return true;
            }
          } else {
            // Multiple cameras registered on this device with different names!
            // Explicit ambiguity: do NOT arbitrarily select one
            state = state.copyWith(
              isRegistering: false,
              registrationError:
                  'Multiple cameras (${matchingCameras.length}) found for this device. Set a matching camera name or manage cameras on the web console.',
            );
            return false;
          }
        }
      }

      // Check boundary 4: before registerCamera
      if (!_isRegistrationValid(currentGeneration, currentUserId)) {
        return false;
      }

      // 5. Step 3: Register New Camera Instance (only after complete and conclusive lookup found 0 matches)
      final camRes = await _registrationService!.registerCamera(
        sessionToken: sessionToken,
        cameraName: state.cameraName,
        installationId: installationId,
        deviceId: targetDeviceId,
        lensFacing: state.selectedLens,
        resolution: state.selectedResolution,
        fps: state.targetFps,
        audioEnabled: state.audioEnabled,
      );

      // Check boundary 5: after registerCamera network response
      if (!_isRegistrationValid(currentGeneration, currentUserId)) {
        return false;
      }

      if (camRes['success'] == true) {
        final camData = camRes['data']?['camera'] as Map<String, dynamic>?;
        final newCamId = camData?['id'] as String?;

        if (newCamId != null && newCamId.isNotEmpty) {
          if (!_isRegistrationValid(currentGeneration, currentUserId)) return false;
          await _storageLock.synchronized(() async {
            if (!_isRegistrationValid(currentGeneration, currentUserId)) return;
            await _secureStorage?.write(
                key: _keyCameraInstanceId, value: newCamId);
          });
        }

        if (!_isRegistrationValid(currentGeneration, currentUserId)) {
          return false;
        }

        state = state.copyWith(
          isRegistering: false,
          isRegistered: true,
          isConfigured: true,
          cameraId: newCamId ?? state.cameraId,
          status: CameraLifecycleStatus.offline, // Still OFFLINE, NOT ONLINE!
          successMessage: 'Camera registered successfully with ZdexCloud.',
        );
        return true;
      } else {
        // Partial failure: Device registered, but Camera registration failed!
        final err = camRes['error'] as Map<String, dynamic>?;
        final errMsg = err?['message'] as String? ??
            'Camera instance creation rejected';
        state = state.copyWith(
          isRegistering: false,
          isRegistered: false,
          registrationError:
              '$errMsg. Device node registered (ID: $targetDeviceId); tap to retry camera binding.',
        );
        return false;
      }
    } catch (e) {
      if (!_isRegistrationValid(currentGeneration, currentUserId)) {
        return false;
      }
      state = state.copyWith(
        isRegistering: false,
        registrationError:
            'Registration network failure: ${e.toString()}. Tap to retry.',
      );
      return false;
    } finally {
      if (_registrationGeneration == currentGeneration) {
        if (state.isRegistering) {
          state = state.copyWith(isRegistering: false);
        }
      }
    }
  }

  /// Test-accessible wrapper for the account-safe storage clear.
  /// For use in unit tests only — never call in production code.
  Future<bool> clearCameraStorageIfOwnedForTesting(String expectedUserId) {
    return _clearCameraStorageIfOwned(expectedUserId);
  }

  /// Clears any transient UI error message
  void clearError() {
    state = state.copyWith(
      errorMessage: null,
      hardwareDiscoveryError: null,
      registrationError: null,
    );
  }

  void _listenToCaptureEvents() {
    _captureSubscription = _captureService.captureEvents.listen((event) {
      // Discard stale capture events belonging to an older generation (Phase 21.4.3)
      if (event.generation != null && event.generation! < _captureGeneration) {
        return;
      }

      // Discard stale capturing events if notifier is already idle or stopping
      if ((state.captureStatus == CameraCaptureStatus.idle ||
              state.captureStatus == CameraCaptureStatus.stopping) &&
          event.status == CameraCaptureStatus.capturing) {
        return;
      }

      if (event.status == CameraCaptureStatus.error) {
        state = state.copyWith(
          captureStatus: CameraCaptureStatus.error,
          captureError: event.errorMessage ?? 'Native camera capture error',
          clearTextureId: true,
          isCaptureRequestStarted: false,
          hasPreviewFrame: false,
        );
      } else {
        state = state.copyWith(
          captureStatus: event.status,
          textureId: event.textureId ?? (event.status.isCapturing ? state.textureId : null),
          activeCaptureWidth: event.width ?? state.activeCaptureWidth,
          activeCaptureHeight: event.height ?? state.activeCaptureHeight,
          activeCaptureFps: event.fps ?? state.activeCaptureFps,
          isEncoderActive: event.isEncoderActive,
          codecName: event.codecName,
          codecAcceleration: event.codecAcceleration,
          isHardwareAcceleratedEncoder: event.isHardwareAccelerated,
          isCaptureRequestStarted: event.isCaptureRequestStarted,
          hasPreviewFrame: event.hasPreviewFrame,
          clearCaptureError: event.status != CameraCaptureStatus.error,
        );
      }
    });
  }

  /// Starts native hardware camera capture.
  ///
  /// Guarantees:
  /// 1. Verifies Camera runtime permission before opening hardware.
  /// 2. Validates joint resolution & FPS combination against HAL capabilities.
  /// 3. Initiates zero-copy SurfaceTexture preview via PlatformChannel.
  /// 4. Does NOT report camera as streaming/online (local capture is not remote streaming).
  /// 5. Idempotent: returns true if already capturing with matching configuration.
  Future<bool> startCapture() async {
    if (!state.hasCameraPermission) {
      state = state.copyWith(
        captureStatus: CameraCaptureStatus.error,
        captureError: 'Camera permission is required to start camera preview.',
      );
      return false;
    }

    if (state.isCapturing) {
      return true;
    }

    // Determine target camera ID
    final targetCamera = state.currentHardwareCamera;
    final targetCameraId = targetCamera?.cameraId ?? state.selectedCameraId ?? '0';

    // Determine target resolution width and height
    int reqWidth = 1280;
    int reqHeight = 720;
    switch (state.selectedResolution) {
      case CameraResolutionPreset.p360:
        reqWidth = 640;
        reqHeight = 360;
        break;
      case CameraResolutionPreset.p480:
        reqWidth = 854;
        reqHeight = 480;
        break;
      case CameraResolutionPreset.p720:
        reqWidth = 1280;
        reqHeight = 720;
        break;
      case CameraResolutionPreset.p1080:
        reqWidth = 1920;
        reqHeight = 1080;
        break;
    }

    if (targetCamera != null && targetCamera.resolutions.isNotEmpty) {
      final matching = targetCamera.resolutions
          .where((r) => r.matchesPreset(state.selectedResolution))
          .toList();
      if (matching.isNotEmpty) {
        reqWidth = matching.first.width;
        reqHeight = matching.first.height;
      }
    }

    // Validate joint combination against HAL metadata
    final combo = state.combinationSupportStatus;
    if (combo == CombinationSupportStatus.unsupported) {
      state = state.copyWith(
        captureStatus: CameraCaptureStatus.error,
        captureError:
            'Selected resolution ( x ) and FPS () are unsupported by the active camera sensor.',
      );
      return false;
    }

    final currentGen = ++_captureGeneration;

    state = state.copyWith(
      captureStatus: CameraCaptureStatus.opening,
      clearCaptureError: true,
    );

    try {
      final result = await _captureService.startCapture(
        cameraId: targetCameraId,
        width: reqWidth,
        height: reqHeight,
        fps: state.targetFps,
        enableEncoder: true,
      );

      if (_captureGeneration != currentGen) {
        // Capture was cancelled or superseded while in-flight
        return false;
      }

      if (result.status == CameraCaptureStatus.error || result.errorMessage != null) {
        state = state.copyWith(
          captureStatus: CameraCaptureStatus.error,
          captureError: result.errorMessage ?? 'Failed to start camera capture',
          clearTextureId: true,
        );
        return false;
      }

      state = state.copyWith(
        captureStatus: result.status,
        textureId: result.textureId,
        activeCaptureWidth: result.width ?? reqWidth,
        activeCaptureHeight: result.height ?? reqHeight,
        activeCaptureFps: result.fps ?? state.targetFps,
        isEncoderActive: result.isEncoderActive,
        codecName: result.codecName,
        codecAcceleration: result.codecAcceleration,
        isHardwareAcceleratedEncoder: result.isHardwareAccelerated,
        isCaptureRequestStarted: result.isCaptureRequestStarted,
        hasPreviewFrame: result.hasPreviewFrame,
        clearCaptureError: true,
      );
      return true;
    } catch (e) {
      state = state.copyWith(
        captureStatus: CameraCaptureStatus.error,
        captureError: e.toString(),
        clearTextureId: true,
      );
      return false;
    }
  }

  /// Stops native camera capture and releases preview and encoder resources. Idempotent.
  Future<bool> stopCapture() async {
    _captureGeneration++;
    if (state.captureStatus == CameraCaptureStatus.idle && state.textureId == null) {
      return true;
    }

    state = state.copyWith(captureStatus: CameraCaptureStatus.stopping);
    try {
      await _captureService.stopCapture();
    } catch (_) {}

    state = state.copyWith(
      captureStatus: CameraCaptureStatus.idle,
      clearTextureId: true,
      isEncoderActive: false,
      isCaptureRequestStarted: false,
      hasPreviewFrame: false,
    );
    return true;
  }

  /// Switches active camera lens and reconfigures active capture session if running.
  Future<bool> switchCameraLens(CameraLensFacing newLens) async {
    if (state.selectedLens == newLens) {
      return true;
    }

    final targetCamera = state.hardwareCameras.firstWhere(
      (c) => c.lensFacing == newLens,
      orElse: () => state.hardwareCameras.isNotEmpty
          ? state.hardwareCameras.first
          : CameraHardwareInfo(
              cameraId: newLens == CameraLensFacing.front ? '1' : '0',
              lensFacing: newLens,
              sensorOrientation: 0,
            ),
    );

    state = state.copyWith(
      selectedLens: newLens,
      selectedCameraId: targetCamera.cameraId,
    );

    if (state.isCapturing) {
      final width = state.activeCaptureWidth ?? 1280;
      final height = state.activeCaptureHeight ?? 720;
      final fps = state.activeCaptureFps ?? state.targetFps;

      try {
        final result = await _captureService.switchCamera(
          cameraId: targetCamera.cameraId,
          width: width,
          height: height,
          fps: fps,
        );

        if (result.status == CameraCaptureStatus.error || result.errorMessage != null) {
          state = state.copyWith(
            captureStatus: CameraCaptureStatus.error,
            captureError: result.errorMessage ?? 'Failed to switch camera',
            clearTextureId: true,
          );
          return false;
        }

        state = state.copyWith(
          captureStatus: result.status,
          textureId: result.textureId ?? state.textureId,
          activeCaptureWidth: result.width ?? width,
          activeCaptureHeight: result.height ?? height,
          activeCaptureFps: result.fps ?? fps,
          isEncoderActive: result.isEncoderActive,
        );
        return true;
      } catch (e) {
        state = state.copyWith(
          captureStatus: CameraCaptureStatus.error,
          captureError: e.toString(),
          clearTextureId: true,
        );
        return false;
      }
    }
    return true;
  }

  /// App lifecycle state change handler (Phase 21.5.1.1).
  ///
  /// Background Lifecycle Policy:
  /// A normal transition to background (paused, inactive, detached) MUST NOT
  /// automatically stop a Camera engine that was explicitly started and successfully
  /// promoted to a Camera foreground service under PlatformSupervisorService.
  /// The Flutter preview detaches independently while service-owned capture persists.
  ///
  /// Upon resume, queries native platform HAL reality via [syncCaptureState] to align
  /// presentation state without spuriously launching a secondary capture session.
  void handleAppLifecycleState(AppLifecycleState lifecycleState) {
    if (lifecycleState == AppLifecycleState.paused ||
        lifecycleState == AppLifecycleState.inactive ||
        lifecycleState == AppLifecycleState.detached) {
      // NOTE: Service-owned Camera capture is maintained continuously in the background
      // by PlatformSupervisorService. Do NOT terminate capture on background transition.
    } else if (lifecycleState == AppLifecycleState.resumed) {
      // Synchronize presentation state with actual native platform engine status
      syncCaptureState();
    }
  }

  /// Synchronizes camera capture state with the native platform engine.
  /// Ensures Flutter presentation state accurately reflects native HAL reality
  /// following activity lifecycle pauses, recreation, or external state mutations.
  Future<void> syncCaptureState() async {
    try {
      final nativeState = await _captureService.getCaptureState();
      if (nativeState.status == CameraCaptureStatus.idle ||
          nativeState.status == CameraCaptureStatus.error) {
        if (state.isCapturing || state.isOpeningCapture) {
          state = state.copyWith(
            captureStatus: nativeState.status,
            clearTextureId: true,
            isEncoderActive: false,
            isCaptureRequestStarted: false,
            hasPreviewFrame: false,
            captureError: nativeState.errorMessage,
          );
        }
      } else if (nativeState.status == CameraCaptureStatus.capturing) {
        state = state.copyWith(
          captureStatus: nativeState.status,
          textureId: nativeState.textureId,
          activeCaptureWidth: nativeState.width,
          activeCaptureHeight: nativeState.height,
          activeCaptureFps: nativeState.fps,
          isEncoderActive: nativeState.isEncoderActive,
          codecName: nativeState.codecName,
          codecAcceleration: nativeState.codecAcceleration,
          isHardwareAcceleratedEncoder: nativeState.isHardwareAccelerated,
          isCaptureRequestStarted: nativeState.isCaptureRequestStarted,
          hasPreviewFrame: nativeState.hasPreviewFrame,
          clearCaptureError: true,
        );
      }
    } catch (_) {}
  }

  /// Clears active capture error message and returns to idle state if in error
  void clearCaptureError() {
    state = state.copyWith(
      clearCaptureError: true,
      captureStatus: state.captureStatus == CameraCaptureStatus.error
          ? CameraCaptureStatus.idle
          : state.captureStatus,
    );
  }

    /// Clears transient success banner message
  void clearSuccessMessage() {
    state = state.copyWith(successMessage: null);
  }
}

/// Global Riverpod Provider for Camera State
final cameraStateProvider =
    StateNotifierProvider<CameraStateNotifier, CameraState>((ref) {
  final storage = ref.watch(secureStorageProvider);

  final notifier = CameraStateNotifier(
    permissionService: PlatformCameraPermissionService(),
    hardwareService: PlatformCameraHardwareService(),
    registrationService: HttpCameraRegistrationService(),
    deviceIdentityService: MethodChannelDeviceIdentityService(),
    secureStorage: storage,
    captureService: PlatformCameraCaptureService(),
  );

  // Auto-dispose the notifier on provider disposal, unregistering from active instances
  ref.onDispose(() {
    notifier.dispose();
  });

  // 1. Register async session-cleared hook with AuthStateNotifier when provider is active.
  //    Ensures the live notifier's state is reset if session is cleared while active.
  //    (Immediate invalidation hook is registered globally at startup in main.dart / root lifecycle).
  Future<void> sessionClearedHook() async {
    notifier.invalidateInFlightRegistrations();
    await notifier.clearCameraRegistration();
  }

  AuthStateNotifier.registerSessionClearedHook(sessionClearedHook);
  ref.onDispose(() {
    AuthStateNotifier.unregisterSessionClearedHook(sessionClearedHook);
  });

  // 2. Reactively listen to AuthState changes
  // Catches account switching (User A -> User B) without application restart,
  // or state transitioning to unauthenticated.
  ref.listen<AuthState>(authStateProvider, (previous, next) {
    final prevUserId = previous?.session?.user.id;
    final nextUserId = next.session?.user.id;

    if (next.status == AuthStatus.unauthenticated) {
      notifier.invalidateInFlightRegistrations();
      notifier.clearCameraRegistration();
    } else if (prevUserId != null && nextUserId != null && prevUserId != nextUserId) {
      notifier.invalidateInFlightRegistrations();
      notifier.clearCameraRegistration();
    }
  });

  return notifier;
});
