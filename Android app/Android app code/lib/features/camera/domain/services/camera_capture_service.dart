import 'dart:async';
import 'package:flutter/services.dart';

/// Camera2 native capture state machine states
enum CameraCaptureStatus {
  idle,
  opening,
  configuring,
  capturing,
  stopping,
  error;

  bool get isCapturing => this == capturing;
  bool get isOpening => this == opening || this == configuring;
  bool get isIdle => this == idle;
  bool get isError => this == error;

  static CameraCaptureStatus fromString(String? val) {
    switch (val?.toUpperCase()) {
      case 'OPENING':
        return CameraCaptureStatus.opening;
      case 'CONFIGURING':
        return CameraCaptureStatus.configuring;
      case 'CAPTURING':
        return CameraCaptureStatus.capturing;
      case 'STOPPING':
        return CameraCaptureStatus.stopping;
      case 'ERROR':
        return CameraCaptureStatus.error;
      case 'IDLE':
      default:
        return CameraCaptureStatus.idle;
    }
  }
}

/// Structured result metadata returned by native Camera2 capture engine
class CameraCaptureResult {
  final CameraCaptureStatus status;
  final bool isCapturing;
  final bool isCaptureRequestStarted;
  final bool hasPreviewFrame;
  final int? generation;
  final String? cameraId;
  final int? width;
  final int? height;
  final int? fps;
  final int? textureId;
  final int sensorOrientation;
  final String lensFacing;
  final bool isEncoderActive;
  final String codecName;
  final String codecAcceleration;
  final bool isHardwareAccelerated;
  final String? errorMessage;

  const CameraCaptureResult({
    this.status = CameraCaptureStatus.idle,
    this.isCapturing = false,
    this.isCaptureRequestStarted = false,
    this.hasPreviewFrame = false,
    this.generation,
    this.cameraId,
    this.width,
    this.height,
    this.fps,
    this.textureId,
    this.sensorOrientation = 0,
    this.lensFacing = 'BACK',
    this.isEncoderActive = false,
    this.codecName = 'NONE',
    this.codecAcceleration = 'UNVERIFIED',
    this.isHardwareAccelerated = false,
    this.errorMessage,
  });

  factory CameraCaptureResult.fromMap(Map<dynamic, dynamic> map) {
    final statusStr = map['status'] as String?;
    return CameraCaptureResult(
      status: CameraCaptureStatus.fromString(statusStr),
      isCapturing: (map['isCapturing'] as bool?) ?? false,
      isCaptureRequestStarted: (map['isCaptureRequestStarted'] as bool?) ?? false,
      hasPreviewFrame: (map['hasPreviewFrame'] as bool?) ?? false,
      generation: (map['generation'] as num?)?.toInt(),
      cameraId: map['cameraId'] as String?,
      width: (map['width'] as num?)?.toInt(),
      height: (map['height'] as num?)?.toInt(),
      fps: (map['fps'] as num?)?.toInt(),
      textureId: (map['textureId'] as num?)?.toInt(),
      sensorOrientation: (map['sensorOrientation'] as num?)?.toInt() ?? 0,
      lensFacing: (map['lensFacing'] as String?) ?? 'BACK',
      isEncoderActive: (map['isEncoderActive'] as bool?) ?? false,
      codecName: (map['codecName'] as String?) ?? 'NONE',
      codecAcceleration: (map['codecAcceleration'] as String?) ?? 'UNVERIFIED',
      isHardwareAccelerated: (map['isHardwareAccelerated'] as bool?) ?? false,
      errorMessage: map['errorMessage'] as String?,
    );
  }

  Map<String, dynamic> toMap() => {
        'status': status.name,
        'isCapturing': isCapturing,
        'isCaptureRequestStarted': isCaptureRequestStarted,
        'hasPreviewFrame': hasPreviewFrame,
        'generation': generation,
        'cameraId': cameraId,
        'width': width,
        'height': height,
        'fps': fps,
        'textureId': textureId,
        'sensorOrientation': sensorOrientation,
        'lensFacing': lensFacing,
        'isEncoderActive': isEncoderActive,
        'codecName': codecName,
        'codecAcceleration': codecAcceleration,
        'isHardwareAccelerated': isHardwareAccelerated,
        'errorMessage': errorMessage,
      };
}

/// Abstract contract for controlling native Android Camera2 hardware capture
abstract class CameraCaptureService {
  /// Starts native camera capture session and returns capture result with Flutter textureId
  Future<CameraCaptureResult> startCapture({
    required String cameraId,
    required int width,
    required int height,
    required int fps,
    bool enableEncoder = true,
  });

  /// Stops native camera capture and releases all camera, surface, and encoder resources
  Future<bool> stopCapture();

  /// Switches active camera sensor and updates capture session
  Future<CameraCaptureResult> switchCamera({
    required String cameraId,
    required int width,
    required int height,
    required int fps,
  });

  /// Probes current native capture state
  Future<CameraCaptureResult> getCaptureState();

  /// Stream of native capture lifecycle and error events
  Stream<CameraCaptureResult> get captureEvents;

  /// Releases resources
  void dispose();
}

/// Production implementation communicating with native CameraEngineHandler via MethodChannel
class PlatformCameraCaptureService implements CameraCaptureService {
  static const MethodChannel _defaultChannel = MethodChannel('camera_engine');

  final MethodChannel _channel;
  final StreamController<CameraCaptureResult> _eventController =
      StreamController<CameraCaptureResult>.broadcast();

  PlatformCameraCaptureService({MethodChannel? channel})
      : _channel = channel ?? _defaultChannel {
    _channel.setMethodCallHandler(_handleNativeCall);
  }

  Future<dynamic> _handleNativeCall(MethodCall call) async {
    if (call.method == 'onCaptureStateChanged') {
      final args = call.arguments;
      if (args is Map) {
        final result = CameraCaptureResult.fromMap(args);
        _eventController.add(result);
      }
    } else if (call.method == 'onCaptureError') {
      final args = call.arguments;
      if (args is Map) {
        final message = args['message'] as String? ?? 'Native camera error';
        _eventController.add(CameraCaptureResult(
          status: CameraCaptureStatus.error,
          errorMessage: message,
        ));
      }
    }
  }

  @override
  Stream<CameraCaptureResult> get captureEvents => _eventController.stream;

  @override
  Future<CameraCaptureResult> startCapture({
    required String cameraId,
    required int width,
    required int height,
    required int fps,
    bool enableEncoder = true,
  }) async {
    try {
      final rawResult = await _channel.invokeMethod<Map<dynamic, dynamic>>(
        'startCapture',
        {
          'cameraId': cameraId,
          'width': width,
          'height': height,
          'fps': fps,
          'enableEncoder': enableEncoder,
        },
      );
      if (rawResult != null) {
        return CameraCaptureResult.fromMap(rawResult);
      }
      return const CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: 'Empty response from native camera engine',
      );
    } on PlatformException catch (e) {
      return CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: e.message ?? 'Failed to start camera capture',
      );
    } catch (e) {
      return CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: e.toString(),
      );
    }
  }

  @override
  Future<bool> stopCapture() async {
    try {
      final stopped = await _channel.invokeMethod<bool>('stopCapture');
      return stopped ?? true;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<CameraCaptureResult> switchCamera({
    required String cameraId,
    required int width,
    required int height,
    required int fps,
  }) async {
    try {
      final rawResult = await _channel.invokeMethod<Map<dynamic, dynamic>>(
        'switchCamera',
        {
          'cameraId': cameraId,
          'width': width,
          'height': height,
          'fps': fps,
        },
      );
      if (rawResult != null) {
        return CameraCaptureResult.fromMap(rawResult);
      }
      return const CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: 'Empty response on switch camera',
      );
    } on PlatformException catch (e) {
      return CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: e.message ?? 'Failed to switch camera',
      );
    } catch (e) {
      return CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: e.toString(),
      );
    }
  }

  @override
  Future<CameraCaptureResult> getCaptureState() async {
    try {
      final rawResult = await _channel.invokeMethod<Map<dynamic, dynamic>>(
        'getCaptureState',
      );
      if (rawResult != null) {
        return CameraCaptureResult.fromMap(rawResult);
      }
      return const CameraCaptureResult(status: CameraCaptureStatus.idle);
    } catch (_) {
      return const CameraCaptureResult(status: CameraCaptureStatus.idle);
    }
  }

  @override
  void dispose() {
    _eventController.close();
  }
}

/// Configurable in-memory mock capture service for unit and widget testing
class MockCameraCaptureService implements CameraCaptureService {
  CameraCaptureStatus currentStatus = CameraCaptureStatus.idle;
  int? currentTextureId;
  String? activeCameraId;
  int activeWidth = 1280;
  int activeHeight = 720;
  int activeFps = 30;
  bool activeEncoder = true;
  String mockCodecName = 'c2.qcom.avc.encoder';
  String mockCodecAcceleration = 'HARDWARE';
  bool mockIsHardwareAccelerated = true;
  bool mockIsCaptureRequestStarted = true;
  bool mockHasPreviewFrame = true;
  int mockGeneration = 1;
  String? simulatedError;

  void emitEvent(CameraCaptureResult event) => _mockEvents.add(event);

  bool shouldFailStart = false;
  bool shouldFailStop = false;
  bool shouldFailSwitch = false;

  final StreamController<CameraCaptureResult> _mockEvents =
      StreamController<CameraCaptureResult>.broadcast();

  @override
  Stream<CameraCaptureResult> get captureEvents => _mockEvents.stream;

  @override
  Future<CameraCaptureResult> startCapture({
    required String cameraId,
    required int width,
    required int height,
    required int fps,
    bool enableEncoder = true,
  }) async {
    if (shouldFailStart) {
      currentStatus = CameraCaptureStatus.error;
      simulatedError = 'Simulated hardware capture error';
      final res = CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: simulatedError,
      );
      _mockEvents.add(res);
      return res;
    }

    currentStatus = CameraCaptureStatus.capturing;
    currentTextureId = 42; // standard mock texture ID
    activeCameraId = cameraId;
    activeWidth = width;
    activeHeight = height;
    activeFps = fps;
    activeEncoder = enableEncoder;
    simulatedError = null;

    final res = CameraCaptureResult(
      status: CameraCaptureStatus.capturing,
      isCapturing: true,
      isCaptureRequestStarted: mockIsCaptureRequestStarted,
      hasPreviewFrame: mockHasPreviewFrame,
      generation: mockGeneration,
      cameraId: cameraId,
      width: width,
      height: height,
      fps: fps,
      textureId: currentTextureId,
      isEncoderActive: enableEncoder,
      codecName: enableEncoder ? mockCodecName : 'NONE',
      codecAcceleration: enableEncoder ? mockCodecAcceleration : 'UNVERIFIED',
      isHardwareAccelerated: enableEncoder && mockIsHardwareAccelerated,
      lensFacing: cameraId == '1' ? 'FRONT' : 'BACK',
    );
    _mockEvents.add(res);
    return res;
  }

  @override
  Future<bool> stopCapture() async {
    if (shouldFailStop) return false;
    currentStatus = CameraCaptureStatus.idle;
    currentTextureId = null;
    final res = const CameraCaptureResult(
      status: CameraCaptureStatus.idle,
      isCapturing: false,
    );
    _mockEvents.add(res);
    return true;
  }

  @override
  Future<CameraCaptureResult> switchCamera({
    required String cameraId,
    required int width,
    required int height,
    required int fps,
  }) async {
    if (shouldFailSwitch) {
      currentStatus = CameraCaptureStatus.error;
      simulatedError = 'Simulated switch camera error';
      final res = CameraCaptureResult(
        status: CameraCaptureStatus.error,
        errorMessage: simulatedError,
      );
      _mockEvents.add(res);
      return res;
    }

    activeCameraId = cameraId;
    activeWidth = width;
    activeHeight = height;
    activeFps = fps;

    final res = CameraCaptureResult(
      status: currentStatus,
      isCapturing: currentStatus == CameraCaptureStatus.capturing,
      isCaptureRequestStarted: mockIsCaptureRequestStarted,
      hasPreviewFrame: mockHasPreviewFrame,
      cameraId: cameraId,
      width: width,
      height: height,
      fps: fps,
      textureId: currentTextureId,
      isEncoderActive: activeEncoder,
      codecName: activeEncoder ? mockCodecName : 'NONE',
      codecAcceleration: activeEncoder ? mockCodecAcceleration : 'UNVERIFIED',
      isHardwareAccelerated: activeEncoder && mockIsHardwareAccelerated,
      lensFacing: cameraId == '1' ? 'FRONT' : 'BACK',
    );
    _mockEvents.add(res);
    return res;
  }

  @override
  Future<CameraCaptureResult> getCaptureState() async {
    return CameraCaptureResult(
      status: currentStatus,
      isCapturing: currentStatus == CameraCaptureStatus.capturing,
      isCaptureRequestStarted: mockIsCaptureRequestStarted,
      hasPreviewFrame: mockHasPreviewFrame,
      cameraId: activeCameraId,
      width: activeWidth,
      height: activeHeight,
      fps: activeFps,
      textureId: currentTextureId,
      isEncoderActive: activeEncoder,
      codecName: activeEncoder ? mockCodecName : 'NONE',
      codecAcceleration: activeEncoder ? mockCodecAcceleration : 'UNVERIFIED',
      isHardwareAccelerated: activeEncoder && mockIsHardwareAccelerated,
      errorMessage: simulatedError,
    );
  }

  @override
  void dispose() {
    _mockEvents.close();
  }
}
