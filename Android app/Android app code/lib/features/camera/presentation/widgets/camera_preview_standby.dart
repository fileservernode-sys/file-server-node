import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_radius.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../application/camera_state.dart';
import '../../domain/services/camera_capture_service.dart';

/// CameraPreviewStandby — Displays real local Camera2 Texture preview or honest standby/loading states (Phase 21.4).
///
/// Architectural Guarantees:
/// 1. Real local camera preview: When capturing, renders Texture(textureId: state.textureId!) with zero CPU frame copy.
/// 2. Loading state: Displays explicit loading indicator during hardware initialization (OPENING/CONFIGURING).
/// 3. Error state: Displays clear error diagnostics if HAL capture fails.
/// 4. Standby state: Displays clean, honest standby card when capture is stopped or unconfigured.
/// 5. Never reports streaming or online: Clearly indicates that local preview is active while remote network transport is offline.
class CameraPreviewStandby extends StatelessWidget {
  final CameraState state;

  const CameraPreviewStandby({
    super.key,
    required this.state,
  });

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFF0F172A), // Deep Slate Canvas
          borderRadius: AppRadius.borderMd,
          border: Border.all(
            color: state.isCapturing
                ? AppColors.primary.withOpacity(0.5)
                : const Color(0xFF334155),
            width: 1.0,
          ),
          boxShadow: [
            BoxShadow(
              color: state.isCapturing
                  ? AppColors.primary.withOpacity(0.15)
                  : const Color(0x1A0F172A),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: AppRadius.borderMd,
          child: Stack(
            children: [
              // 1. Subtle background grid pattern simulation
              Positioned.fill(
                child: Opacity(
                  opacity: 0.05,
                  child: CustomPaint(
                    painter: _StandbyGridPainter(),
                  ),
                ),
              ),

              // 2. Real Native Zero-Copy Flutter Texture (When Capturing)
              if (state.isCapturing && state.textureId != null)
                Positioned.fill(
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: FittedBox(
                          fit: BoxFit.cover,
                          child: SizedBox(
                            width: (state.activeCaptureWidth ?? 1280).toDouble(),
                            height: (state.activeCaptureHeight ?? 720).toDouble(),
                            child: Texture(textureId: state.textureId!),
                          ),
                        ),
                      ),
                      if (!state.hasPreviewFrame)
                        Positioned.fill(
                          child: Container(
                            color: const Color(0xCC0F172A),
                            child: const Center(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  SizedBox(
                                    width: 24,
                                    height: 24,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.0,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                  SizedBox(height: AppSpacing.xs),
                                  Text(
                                    'Awaiting First Frame from Sensor...',
                                    style: TextStyle(
                                      fontFamily: AppTypography.fontFamily,
                                      fontSize: 12.0,
                                      color: Color(0xFF94A3B8),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),

              // 3. Opening / Configuring Loading State
              if (state.isOpeningCapture)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(
                          width: 32,
                          height: 32,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: AppColors.primary,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          state.captureStatus == CameraCaptureStatus.opening
                              ? 'Opening Camera Hardware...'
                              : 'Configuring Camera2 Pipeline...',
                          style: const TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: 14.0,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.xxs),
                        const Text(
                          'Allocating hardware preview surface',
                          style: TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: 11.0,
                            color: Color(0xFF94A3B8),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

              // 4. Capture Error State
              if (state.hasCaptureError && !state.isCapturing && !state.isOpeningCapture)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: AppColors.error.withOpacity(0.15),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.error_outline_rounded,
                            size: 32,
                            color: AppColors.error,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        const Text(
                          'Camera Capture Error',
                          style: TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: 14.0,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.xxs),
                        Text(
                          state.captureError ?? 'Hardware capture unavailable',
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: 11.0,
                            color: Color(0xFFFDA4AF),
                            height: 1.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

              // 5. Idle Standby State (When not capturing and no error)
              if (!state.isCapturing && !state.isOpeningCapture && !state.hasCaptureError)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E293B),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: const Color(0xFF475569),
                              width: 1.0,
                            ),
                          ),
                          child: const Icon(
                            Icons.videocam_outlined,
                            size: 36,
                            color: Color(0xFF94A3B8),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        const Text(
                          'Camera Standby',
                          style: TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: 16.0,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                            letterSpacing: -0.2,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.xxs),
                        const Text(
                          'Camera hardware idle. Press Start Camera to initiate local preview.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: 12.0,
                            color: Color(0xFF94A3B8),
                            height: 1.35,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

              // 6. Top Overlay Bar: Status Tag (Left) & Resolution Tag (Right)
              Positioned(
                top: AppSpacing.sm,
                left: AppSpacing.sm,
                right: AppSpacing.sm,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    // Status Badge
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.xs,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xCC1E293B),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                        border: Border.all(
                          color: state.isCapturing
                              ? AppColors.primary
                              : const Color(0xFF475569),
                          width: 0.5,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              color: state.isPreviewReady
                                  ? AppColors.statusOnline
                                  : (state.isCapturing || state.isOpeningCapture
                                      ? AppColors.warning
                                      : (state.hasCaptureError
                                          ? AppColors.error
                                          : const Color(0xFF94A3B8))),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: AppSpacing.xxs),
                          Text(
                            state.isPreviewReady
                                ? 'LIVE PREVIEW (LOCAL)'
                                : (state.isCapturing
                                    ? 'PREVIEW STARTING'
                                    : (state.isOpeningCapture
                                        ? 'INITIALIZING'
                                        : (state.hasCaptureError
                                            ? 'CAPTURE ERROR'
                                            : 'PREVIEW STANDBY'))),
                            style: const TextStyle(
                              fontFamily: AppTypography.monoFontFamily,
                              fontSize: 10.0,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Resolution Tag (Monospace)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.xs,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xCC1E293B),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                        border: Border.all(
                          color: const Color(0xFF475569),
                          width: 0.5,
                        ),
                      ),
                      child: Text(
                        state.isCapturing
                            ? 'ACTUAL: ${state.activeCaptureWidth ?? 1280}x${state.activeCaptureHeight ?? 720} • ${state.activeCaptureFps ?? state.targetFps} FPS'
                            : 'PREF: ${state.resolutionTag} • ${state.targetFps} FPS',
                        style: const TextStyle(
                          fontFamily: AppTypography.monoFontFamily,
                          fontSize: 10.0,
                          fontWeight: FontWeight.w500,
                          color: Color(0xFFCBD5E1),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // 7. Bottom Overlay Bar: Lens (Left) & Transport/Viewer Status (Right)
              Positioned(
                bottom: AppSpacing.sm,
                left: AppSpacing.sm,
                right: AppSpacing.sm,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    // Active / Preferred Lens Tag
                    Text(
                      state.isCapturing
                          ? 'ACTIVE: ${state.displayLens.toUpperCase()} (ID: ${state.currentHardwareCamera?.cameraId ?? '0'})'
                          : 'PREF LENS: ${state.displayLens.toUpperCase()}',
                      style: const TextStyle(
                        fontFamily: AppTypography.monoFontFamily,
                        fontSize: 10.0,
                        color: Color(0xFF94A3B8),
                        letterSpacing: 0.3,
                      ),
                    ),

                    // Honest Transport / Remote Viewer Tag
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          state.isCapturing
                              ? Icons.sensors_outlined
                              : Icons.visibility_outlined,
                          size: 12,
                          color: const Color(0xFF94A3B8),
                        ),
                        const SizedBox(width: AppSpacing.xxs),
                        Text(
                          state.transportStatusLabel,
                          style: const TextStyle(
                            fontFamily: AppTypography.monoFontFamily,
                            fontSize: 10.0,
                            color: Color(0xFF94A3B8),
                            letterSpacing: 0.3,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StandbyGridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white
      ..strokeWidth = 1.0;

    const step = 24.0;
    for (double x = 0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
