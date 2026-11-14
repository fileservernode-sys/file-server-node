import '../../application/camera_state.dart';

/// Permission status enumeration representing Android runtime permission states
enum CameraPermissionStatus {
  notDetermined,
  granted,
  denied,
  permanentlyDenied,
}

/// Evaluation status for a selected resolution and frame rate combination
enum CombinationSupportStatus {
  /// HAL explicitly verified that this resolution can sustain the target frame rate
  halVerified,

  /// Resolution and FPS are individually reported, but joint timing is unverified by HAL metadata
  unverified,

  /// Active sensor cannot sustain this resolution/FPS combination based on HAL minimum frame duration
  unsupported;

  /// Backward-compatible alias for halVerified
  static const CombinationSupportStatus supported = halVerified;

  bool get isHalVerified => this == halVerified;
  bool get isUnverified => this == unverified;
  bool get isUnsupported => this == unsupported;
}

/// Structured resolution capability reported by camera hardware
class CameraHardwareResolution {
  final int width;
  final int height;
  final String format;
  final int? maxFps;
  final bool isVerified;

  const CameraHardwareResolution({
    required this.width,
    required this.height,
    this.format = 'SurfaceTexture',
    this.maxFps,
    this.isVerified = false,
  });

  String get label => '${width}x$height';

  double get aspectRatio => height > 0 ? width / height : 0;

  bool matchesPreset(CameraResolutionPreset preset) {
    switch (preset) {
      case CameraResolutionPreset.p360:
        return (width == 640 && height == 360) ||
            (width == 640 && height == 480) ||
            (height == 360);
      case CameraResolutionPreset.p480:
        return (width == 854 && height == 480) ||
            (width == 720 && height == 480) ||
            (width == 640 && height == 480) ||
            (height == 480);
      case CameraResolutionPreset.p720:
        return (width == 1280 && height == 720) || (height == 720);
      case CameraResolutionPreset.p1080:
        return (width == 1920 && height == 1080) || (height == 1080);
    }
  }

  Map<String, dynamic> toMap() => {
        'width': width,
        'height': height,
        'format': format,
        'maxFps': maxFps,
        'isVerified': isVerified,
      };

  factory CameraHardwareResolution.fromMap(Map<dynamic, dynamic> map) {
    return CameraHardwareResolution(
      width: (map['width'] as num?)?.toInt() ?? 0,
      height: (map['height'] as num?)?.toInt() ?? 0,
      format: (map['format'] as String?) ?? 'SurfaceTexture',
      maxFps: (map['maxFps'] as num?)?.toInt(),
      isVerified: (map['isVerified'] as bool?) ?? false,
    );
  }
}

/// Structured target frame rate range supported by auto-exposure
class CameraFpsRange {
  final int min;
  final int max;

  const CameraFpsRange({
    required this.min,
    required this.max,
  });

  String get label => min == max ? '$max FPS' : '$min-$max FPS';

  bool covers(int fps) => fps >= min && fps <= max;

  Map<String, dynamic> toMap() => {
        'min': min,
        'max': max,
      };

  factory CameraFpsRange.fromMap(Map<dynamic, dynamic> map) {
    return CameraFpsRange(
      min: (map['min'] as num?)?.toInt() ?? 0,
      max: (map['max'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Structured hardware capabilities discovered via Camera2 CameraCharacteristics
///
/// NOTE: Capability discovery is read-only HAL metadata and never opens a physical camera.
class CameraHardwareInfo {
  final String cameraId;
  final CameraLensFacing lensFacing;
  final int sensorOrientation;
  final bool isLogical;
  final List<String> physicalCameraIds;
  final List<CameraHardwareResolution> resolutions;
  final List<CameraFpsRange> fpsRanges;
  final bool hasFlash;
  final String hardwareLevel;

  const CameraHardwareInfo({
    required this.cameraId,
    required this.lensFacing,
    required this.sensorOrientation,
    this.isLogical = false,
    this.physicalCameraIds = const [],
    this.resolutions = const [],
    this.fpsRanges = const [],
    this.hasFlash = false,
    this.hardwareLevel = 'UNKNOWN',
  });

  /// Evaluates whether a resolution preset is supported by this camera sensor
  bool supportsResolutionPreset(CameraResolutionPreset preset) {
    if (resolutions.isEmpty) {
      return true; // Optimistic until HAL metadata parsed
    }
    return resolutions.any((r) => r.matchesPreset(preset));
  }

  /// Evaluates whether an FPS value falls into any auto-exposure range
  bool supportsFps(int fps) {
    if (fpsRanges.isEmpty) {
      return true;
    }
    return fpsRanges.any((range) => range.covers(fps));
  }

  /// Joint resolution and FPS compatibility verification (Phase 21.3.1)
  CombinationSupportStatus evaluateCombination(
    CameraResolutionPreset preset,
    int targetFps,
  ) {
    if (resolutions.isEmpty) {
      return CombinationSupportStatus.unverified;
    }

    final matchingSizes =
        resolutions.where((r) => r.matchesPreset(preset)).toList();
    if (matchingSizes.isEmpty) {
      return CombinationSupportStatus.unsupported;
    }

    // Auto-exposure FPS range validation
    final fpsSupported = fpsRanges.isEmpty || fpsRanges.any((f) => f.covers(targetFps));
    if (!fpsSupported) {
      return CombinationSupportStatus.unsupported;
    }

    // Camera2 minimum frame duration validation
    final verifiedSizes = matchingSizes.where((s) => s.maxFps != null).toList();
    if (verifiedSizes.isNotEmpty) {
      final canSustain = verifiedSizes.any((s) => targetFps <= s.maxFps!);
      if (!canSustain) {
        return CombinationSupportStatus.unsupported;
      }
      return CombinationSupportStatus.halVerified;
    }

    // If HAL did not supply frame duration, label as unverified preference
    return CombinationSupportStatus.unverified;
  }

  /// Human-readable lens title with explicit logical / physical indicator
  String get displayTitle {
    final lensLabel =
        lensFacing == CameraLensFacing.front ? 'Front Lens' : 'Back Lens';
    if (isLogical) {
      final physLabel = physicalCameraIds.isNotEmpty
          ? ' [Sensors: ${physicalCameraIds.join(", ")}]'
          : '';
      return '$lensLabel (ID $cameraId, Logical$physLabel)';
    }
    return '$lensLabel (ID $cameraId, Physical)';
  }

  /// Formatted max resolution label (e.g. 1920x1080)
  String get maxResolutionLabel {
    if (resolutions.isEmpty) return 'Default';
    final top = resolutions.first;
    return '${top.width}x${top.height}';
  }

  Map<String, dynamic> toMap() => {
        'cameraId': cameraId,
        'lensFacing': lensFacing == CameraLensFacing.front ? 'FRONT' : 'BACK',
        'sensorOrientation': sensorOrientation,
        'isLogical': isLogical,
        'physicalCameraIds': physicalCameraIds,
        'resolutions': resolutions.map((r) => r.toMap()).toList(),
        'fpsRanges': fpsRanges.map((f) => f.toMap()).toList(),
        'hasFlash': hasFlash,
        'hardwareLevel': hardwareLevel,
      };

  factory CameraHardwareInfo.fromMap(Map<dynamic, dynamic> map) {
    final facingStr = (map['lensFacing'] as String?)?.toUpperCase() ?? 'BACK';
    final lensFacing =
        facingStr == 'FRONT' ? CameraLensFacing.front : CameraLensFacing.back;

    final rawPhysicalList = map['physicalCameraIds'] as List<dynamic>? ?? [];
    final physicalCameraIds =
        rawPhysicalList.map((e) => e.toString()).toList();

    final rawResList = map['resolutions'] as List<dynamic>? ?? [];
    final resolutions = rawResList
        .map((r) => CameraHardwareResolution.fromMap(r as Map<dynamic, dynamic>))
        .toList();

    final rawFpsList = map['fpsRanges'] as List<dynamic>? ?? [];
    final fpsRanges = rawFpsList
        .map((f) => CameraFpsRange.fromMap(f as Map<dynamic, dynamic>))
        .toList();

    return CameraHardwareInfo(
      cameraId: (map['cameraId'] as String?) ?? '0',
      lensFacing: lensFacing,
      sensorOrientation: (map['sensorOrientation'] as num?)?.toInt() ?? 0,
      isLogical: (map['isLogical'] as bool?) ?? false,
      physicalCameraIds: physicalCameraIds,
      resolutions: resolutions,
      fpsRanges: fpsRanges,
      hasFlash: (map['hasFlash'] as bool?) ?? false,
      hardwareLevel: (map['hardwareLevel'] as String?) ?? 'UNKNOWN',
    );
  }
}
