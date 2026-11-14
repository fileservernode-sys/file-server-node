import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_dialog.dart';
import '../../../core/widgets/app_header.dart';
import '../../auth/application/auth_state.dart';
import '../application/camera_state.dart';
import '../domain/entities/camera_hardware_info.dart';
import 'widgets/camera_preview_standby.dart';
import 'widgets/camera_status_badge.dart';

/// Camera Mode Dashboard Screen — Premium SaaS Camera Server Experience
///
/// Implements Phase 21.3 / 21.3.1 camera permissions, Camera2 hardware capability discovery,
/// guided capture configuration, and backend device registration.
class CameraScreen extends ConsumerStatefulWidget {
  const CameraScreen({super.key});

  @override
  ConsumerState<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends ConsumerState<CameraScreen>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Non-prompting permission and registration check on mount (does not prompt user)
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await _checkPermissionsSafely();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    try {
      final camState = ref.read(cameraStateProvider);
      if (camState.isCapturing || camState.isOpeningCapture) {
        ref.read(cameraStateProvider.notifier).stopCapture();
      }
    } catch (_) {}
    super.dispose();
  }

  /// App resume lifecycle handler (Phase 21.3.6 / 21.3.7).
  /// Defers Camera authenticated operations until global resume validation completes.
  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycleState) {
    ref.read(cameraStateProvider.notifier).handleAppLifecycleState(lifecycleState);
    if (lifecycleState == AppLifecycleState.resumed && mounted) {
      _checkPermissionsSafely();
    }
  }

  /// Safely coordinates Camera permission and state checks with root session validation.
  ///
  /// Guarantees:
  /// 1. Awaits pending root session validation if one is currently in-flight.
  /// 2. If session is valid: checks permissions with active userId.
  /// 3. If session is expired or unauthenticated: cancels in-flight Camera operations immediately.
  /// 4. Does not trigger duplicate session validation or repeated cleanup.
  Future<void> _checkPermissionsSafely() async {
    final authNotifier = ref.read(authStateProvider.notifier);

    // If global session validation is already in progress at the root level,
    // await its resolution so we do NOT race an expired session or issue duplicate checks.
    final pendingValidation = authNotifier.currentResumeValidation;
    if (pendingValidation != null) {
      try {
        await pendingValidation;
      } catch (_) {}
    }

    if (!mounted) return;

    final auth = ref.read(authStateProvider);
    if (auth.status == AuthStatus.authenticated &&
        auth.session != null &&
        !auth.session!.isExpired) {
      // Session is confirmed valid — re-check Camera permission and hardware state
      ref
          .read(cameraStateProvider.notifier)
          .checkPermissions(currentUserId: auth.session?.user.id);
    } else {
      // Session is unauthenticated or expired — invalidate any Camera operations immediately
      ref.read(cameraStateProvider.notifier).invalidateInFlightRegistrations();
    }
  }

  void _showCameraPermissionExplanationDialog(BuildContext context) {
    AppDialog.show(
      context: context,
      title: 'Camera Access Required',
      message:
          'ZdexCloud requires camera hardware access to discover sensor capabilities and capture live video when Camera Server Mode is active.\n\n'
          'Permission is only active while the server is running and can be managed anytime in Android Settings.',
      primaryActionLabel: 'Authorize Camera',
      onPrimaryAction: () {
        ref.read(cameraStateProvider.notifier).requestCameraPermission();
      },
      secondaryActionLabel: 'Not Now',
    );
  }

  void _showMicrophoneExplanationDialog(BuildContext context) {
    AppDialog.show(
      context: context,
      title: 'Enable Microphone Audio (Optional)',
      message:
          'Microphone audio capture is completely optional. Video streaming functions fully without audio.\n\n'
          'Would you like to grant audio recording permission to stream sound alongside video?',
      primaryActionLabel: 'Authorize Audio',
      onPrimaryAction: () {
        ref.read(cameraStateProvider.notifier).requestMicrophonePermission();
      },
      secondaryActionLabel: 'Keep Audio Off',
      onSecondaryAction: () {
        ref.read(cameraStateProvider.notifier).setAudioEnabled(false);
      },
    );
  }

  void _showSetupRequiredDialog(BuildContext context) {
    AppDialog.show(
      context: context,
      title: 'Camera Setup Coming Soon',
      message:
          'Camera streaming requires native video capture encoding and camera foreground service supervision. '
          'Hardware capture (Phase 21.4), multi-engine supervision (Phase 21.5), and live WebRTC signaling (/ws/camera-signaling in Phase 21.6) '
          'will be activated in subsequent updates.',
      primaryActionLabel: 'Understood',
    );
  }

  void _showEditNameDialog(BuildContext context, String currentName) {
    final textController = TextEditingController(text: currentName);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.borderLg,
        ),
        title: const Text('Edit Camera Display Name',
            style: AppTypography.cardTitle),
        content: TextField(
          controller: textController,
          autofocus: true,
          decoration: InputDecoration(
            hintText: 'e.g. Front Porch Camera',
            helperText: 'Local display name preference',
            border: OutlineInputBorder(
              borderRadius: AppRadius.borderMd,
              borderSide: const BorderSide(color: AppColors.borderSubtle),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: AppRadius.borderMd,
              borderSide:
                  const BorderSide(color: AppColors.primary, width: 2.0),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: AppRadius.borderSm,
              ),
            ),
            onPressed: () {
              final newName = textController.text.trim();
              if (newName.isNotEmpty) {
                ref.read(cameraStateProvider.notifier).setCameraName(newName);
              }
              Navigator.pop(ctx);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final camera = ref.watch(cameraStateProvider);
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'ZdexCloud Camera',
        subtitle: 'Remote Security Camera Mode',
        showBrandMark: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpacing.maxContentWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // -----------------------------------------------------------
                  // 1. Header & Status Section
                  // -----------------------------------------------------------
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Security Camera Node',
                              style: AppTypography.caption.copyWith(
                                color: AppColors.primary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              camera.cameraName,
                              style: AppTypography.pageTitle,
                              softWrap: true,
                              maxLines: 2,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      CameraStatusBadge(status: camera.status),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Camera Mode interface preview. Remote security camera capabilities and independent service supervision will be introduced in subsequent Android integration phases.',
                    style: AppTypography.bodySmall
                        .copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // -----------------------------------------------------------
                  // Banners (Success / Errors)
                  // -----------------------------------------------------------
                  if (camera.successMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                        vertical: AppSpacing.sm,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.green.withOpacity(0.12),
                        borderRadius: AppRadius.borderMd,
                        border: Border.all(color: Colors.green.withOpacity(0.4)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.check_circle_outline,
                              color: Colors.green, size: 20),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text(
                              camera.successMessage!,
                              style: AppTypography.caption.copyWith(
                                color: Colors.green.shade800,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close, size: 16),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                            onPressed: () => ref
                                .read(cameraStateProvider.notifier)
                                .clearSuccessMessage(),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],

                  if (camera.registrationError != null ||
                      camera.errorMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                        vertical: AppSpacing.sm,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.red.withOpacity(0.10),
                        borderRadius: AppRadius.borderMd,
                        border: Border.all(color: Colors.red.withOpacity(0.3)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline,
                              color: Colors.red, size: 20),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text(
                              camera.registrationError ?? camera.errorMessage!,
                              style: AppTypography.caption.copyWith(
                                color: Colors.red.shade800,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close, size: 16),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                            onPressed: () => ref
                                .read(cameraStateProvider.notifier)
                                .clearError(),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],

                  // -----------------------------------------------------------
                  // 2. Camera Preview Standby View
                  // -----------------------------------------------------------
                  CameraPreviewStandby(state: camera),
                  const SizedBox(height: AppSpacing.lg),

                  // -----------------------------------------------------------
                  // 3. Primary Action Trigger
                  // -----------------------------------------------------------
                  PrimaryButton(
                    label: camera.isCapturing
                        ? 'Stop Camera Preview'
                        : (camera.isOpeningCapture
                            ? 'Starting Capture...'
                            : 'Start Camera Preview'),
                    icon: camera.isCapturing
                        ? Icons.videocam_off_outlined
                        : (camera.isOpeningCapture
                            ? Icons.hourglass_top_outlined
                            : Icons.videocam_outlined),
                    isLoading: camera.isOpeningCapture,
                    onPressed: camera.isOpeningCapture
                        ? null
                        : () async {
                            if (camera.isCapturing) {
                              await ref
                                  .read(cameraStateProvider.notifier)
                                  .stopCapture();
                            } else {
                              if (!camera.hasCameraPermission) {
                                _showCameraPermissionExplanationDialog(context);
                              } else {
                                await ref
                                    .read(cameraStateProvider.notifier)
                                    .startCapture();
                              }
                            }
                          },
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // -----------------------------------------------------------
                  // 4. Runtime Permission & Capability Card (Phase 21.3)
                  // -----------------------------------------------------------
                  _buildPermissionCard(context, camera),
                  const SizedBox(height: AppSpacing.lg),

                  // -----------------------------------------------------------
                  // 5. Camera Hardware Information Grid
                  // -----------------------------------------------------------
                  const Text('Camera Information',
                      style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),

                  Row(
                    children: [
                      Expanded(
                        child: AppCard(
                          onTap: () => _showEditNameDialog(
                              context, camera.cameraName),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Icon(Icons.badge_outlined,
                                      size: 20,
                                      color: AppColors.textSecondary),
                                  Icon(Icons.edit_outlined,
                                      size: 16, color: AppColors.primary),
                                ],
                              ),
                              const SizedBox(height: AppSpacing.xs),
                              const Text('Local Display Name',
                                  style: AppTypography.caption),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                camera.cameraName,
                                style: AppTypography.body
                                    .copyWith(fontWeight: FontWeight.w600),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Local device preference',
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.textMuted,
                                  fontSize: 10.0,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.hub_outlined,
                                  size: 20, color: AppColors.textSecondary),
                              const SizedBox(height: AppSpacing.xs),
                              const Text('Signaling Gateway',
                                  style: AppTypography.caption),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                'Not Connected',
                                style: AppTypography.body
                                    .copyWith(fontWeight: FontWeight.w600),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '/ws/camera-signaling (Phase 21.6)',
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.textMuted,
                                  fontSize: 10.0,
                                  fontFamily: AppTypography.monoFontFamily,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),

                  Row(
                    children: [
                      Expanded(
                        child: AppCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.hd_outlined,
                                  size: 20, color: AppColors.textSecondary),
                              const SizedBox(height: AppSpacing.xs),
                              const Text('Configured Preset',
                                  style: AppTypography.caption),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                '${camera.resolutionTag} • ${camera.targetFps} FPS',
                                style: AppTypography.body.copyWith(
                                  fontWeight: FontWeight.w600,
                                  fontFamily: AppTypography.monoFontFamily,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Streaming preference (Idle)',
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.textMuted,
                                  fontSize: 10.0,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.people_outline,
                                  size: 20, color: AppColors.textSecondary),
                              const SizedBox(height: AppSpacing.xs),
                              const Text('Active Stream Viewers',
                                  style: AppTypography.caption),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                camera.displayViewersCount,
                                style: AppTypography.body
                                    .copyWith(fontWeight: FontWeight.w600),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Requires live session',
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.textMuted,
                                  fontSize: 10.0,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // -----------------------------------------------------------
                  // 6. Camera Configuration & Presets (Phase 21.3 / 21.3.1 Extended)
                  // -----------------------------------------------------------
                  const Text('Capture Configuration',
                      style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),

                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Lens Facing Selector
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Hardware Lens',
                                style: AppTypography.cardTitle),
                            if (camera.currentHardwareCamera != null)
                              Text(
                                camera.currentHardwareCamera!.isLogical
                                    ? 'ID: ${camera.selectedCameraId} (Logical)'
                                    : 'ID: ${camera.selectedCameraId} (Physical)',
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.primary,
                                  fontFamily: AppTypography.monoFontFamily,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xxs),
                        Text(
                          camera.hasDiscoveredHardware
                              ? (camera.currentHardwareCamera?.displayTitle ??
                                  'Sensor characteristics verified via Camera2 HAL.')
                              : 'Select preferred sensor. Authorize camera to discover hardware capabilities.',
                          style: AppTypography.caption,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Row(
                          children: [
                            Expanded(
                              child: _buildSelectablePill(
                                label: camera.isLensAvailable(CameraLensFacing.back)
                                    ? 'Back (Primary)'
                                    : 'Back (Unavailable)',
                                isSelected:
                                    camera.selectedLens == CameraLensFacing.back,
                                isEnabled:
                                    camera.isLensAvailable(CameraLensFacing.back),
                                icon: Icons.camera_rear_outlined,
                                onTap: () => ref
                                    .read(cameraStateProvider.notifier)
                                    .setLens(CameraLensFacing.back),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: _buildSelectablePill(
                                label: camera.isLensAvailable(CameraLensFacing.front)
                                    ? 'Front (Selfie)'
                                    : 'Front (Unavailable)',
                                isSelected:
                                    camera.selectedLens == CameraLensFacing.front,
                                isEnabled:
                                    camera.isLensAvailable(CameraLensFacing.front),
                                icon: Icons.camera_front_outlined,
                                onTap: () => ref
                                    .read(cameraStateProvider.notifier)
                                    .setLens(CameraLensFacing.front),
                              ),
                            ),
                          ],
                        ),
                        const Divider(height: AppSpacing.xl),

                        // Resolution Presets
                        const Text('Video Resolution',
                            style: AppTypography.cardTitle),
                        const SizedBox(height: AppSpacing.xxs),
                        const Text(
                          'Select streaming preset preference. Unsupported selections for the active sensor are disabled.',
                          style: AppTypography.caption,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Wrap(
                          spacing: AppSpacing.xs,
                          runSpacing: AppSpacing.xs,
                          children: CameraResolutionPreset.values.map((preset) {
                            final isSelected =
                                camera.selectedResolution == preset;
                            final isSupported =
                                camera.isResolutionSupported(preset);
                            final tag = preset == CameraResolutionPreset.p360
                                ? '360p'
                                : (preset == CameraResolutionPreset.p480
                                    ? '480p'
                                    : (preset == CameraResolutionPreset.p720
                                        ? '720p'
                                        : '1080p'));

                            return ChoiceChip(
                              label: Text(
                                  isSupported ? tag : '$tag (Unsupported)'),
                              selected: isSelected,
                              selectedColor: AppColors.primarySubtle,
                              backgroundColor: AppColors.surface,
                              disabledColor: AppColors.surfaceSubtle,
                              labelStyle: TextStyle(
                                fontFamily: AppTypography.monoFontFamily,
                                fontSize: 12.0,
                                fontWeight: isSelected
                                    ? FontWeight.bold
                                    : FontWeight.w500,
                                color: !isSupported
                                    ? AppColors.textMuted
                                    : (isSelected
                                        ? AppColors.primary
                                        : AppColors.textPrimary),
                              ),
                              side: BorderSide(
                                color: !isSupported
                                    ? AppColors.borderSubtle.withOpacity(0.5)
                                    : (isSelected
                                        ? AppColors.primary
                                        : AppColors.borderSubtle),
                              ),
                              onSelected: isSupported
                                  ? (_) => ref
                                      .read(cameraStateProvider.notifier)
                                      .setResolution(preset)
                                  : null,
                            );
                          }).toList(),
                        ),
                        const Divider(height: AppSpacing.xl),

                        // Frame Rate Selector
                        const Text('Target Frame Rate',
                            style: AppTypography.cardTitle),
                        const SizedBox(height: AppSpacing.xxs),
                        const Text(
                          '15 FPS reduces battery and thermal load; 30 FPS provides smooth motion.',
                          style: AppTypography.caption,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Row(
                          children: [
                            ChoiceChip(
                              label: const Text('15 FPS (Battery Saver)'),
                              selected: camera.targetFps == 15,
                              selectedColor: AppColors.primarySubtle,
                              backgroundColor: AppColors.surface,
                              disabledColor: AppColors.surfaceSubtle,
                              labelStyle: TextStyle(
                                fontFamily: AppTypography.monoFontFamily,
                                fontSize: 12.0,
                                fontWeight: camera.targetFps == 15
                                    ? FontWeight.bold
                                    : FontWeight.w500,
                                color: !camera.isFpsSupported(15)
                                    ? AppColors.textMuted
                                    : (camera.targetFps == 15
                                        ? AppColors.primary
                                        : AppColors.textPrimary),
                              ),
                              side: BorderSide(
                                color: !camera.isFpsSupported(15)
                                    ? AppColors.borderSubtle.withOpacity(0.5)
                                    : (camera.targetFps == 15
                                        ? AppColors.primary
                                        : AppColors.borderSubtle),
                              ),
                              onSelected: camera.isFpsSupported(15)
                                  ? (_) => ref
                                      .read(cameraStateProvider.notifier)
                                      .setFps(15)
                                  : null,
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            ChoiceChip(
                              label: const Text('30 FPS (Standard)'),
                              selected: camera.targetFps == 30,
                              selectedColor: AppColors.primarySubtle,
                              backgroundColor: AppColors.surface,
                              disabledColor: AppColors.surfaceSubtle,
                              labelStyle: TextStyle(
                                fontFamily: AppTypography.monoFontFamily,
                                fontSize: 12.0,
                                fontWeight: camera.targetFps == 30
                                    ? FontWeight.bold
                                    : FontWeight.w500,
                                color: !camera.isFpsSupported(30)
                                    ? AppColors.textMuted
                                    : (camera.targetFps == 30
                                        ? AppColors.primary
                                        : AppColors.textPrimary),
                              ),
                              side: BorderSide(
                                color: !camera.isFpsSupported(30)
                                    ? AppColors.borderSubtle.withOpacity(0.5)
                                    : (camera.targetFps == 30
                                        ? AppColors.primary
                                        : AppColors.borderSubtle),
                              ),
                              onSelected: camera.isFpsSupported(30)
                                  ? (_) => ref
                                      .read(cameraStateProvider.notifier)
                                      .setFps(30)
                                  : null,
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),

                        // Combination Support Indicator (Phase 21.3.1)
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: AppSpacing.md,
                              vertical: AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: camera.combinationSupportStatus ==
                                    CombinationSupportStatus.halVerified
                                ? Colors.green.withOpacity(0.08)
                                : (camera.combinationSupportStatus ==
                                        CombinationSupportStatus.unsupported
                                    ? Colors.red.withOpacity(0.08)
                                    : AppColors.surfaceSubtle),
                            borderRadius: AppRadius.borderMd,
                            border: Border.all(
                              color: camera.combinationSupportStatus ==
                                      CombinationSupportStatus.halVerified
                                  ? Colors.green.withOpacity(0.3)
                                  : (camera.combinationSupportStatus ==
                                          CombinationSupportStatus.unsupported
                                      ? Colors.red.withOpacity(0.3)
                                      : AppColors.borderSubtle),
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                camera.combinationSupportStatus ==
                                        CombinationSupportStatus.halVerified
                                    ? Icons.verified_outlined
                                    : (camera.combinationSupportStatus ==
                                            CombinationSupportStatus.unsupported
                                        ? Icons.error_outline
                                        : Icons.info_outline),
                                size: 16,
                                color: camera.combinationSupportStatus ==
                                        CombinationSupportStatus.halVerified
                                    ? Colors.green.shade700
                                    : (camera.combinationSupportStatus ==
                                            CombinationSupportStatus.unsupported
                                        ? Colors.red.shade700
                                        : AppColors.textSecondary),
                              ),
                              const SizedBox(width: AppSpacing.xs),
                              Expanded(
                                child: Text(
                                  'Combination: ${camera.combinationSupportLabel}',
                                  style: AppTypography.caption.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: camera.combinationSupportStatus ==
                                            CombinationSupportStatus.halVerified
                                        ? Colors.green.shade800
                                        : (camera.combinationSupportStatus ==
                                                CombinationSupportStatus.unsupported
                                            ? Colors.red.shade800
                                            : AppColors.textSecondary),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Divider(height: AppSpacing.xl),

                        // Audio Toggle (Optional Microphone Permission)
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      const Text('Microphone Audio',
                                          style: AppTypography.cardTitle),
                                      const SizedBox(width: AppSpacing.xs),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: AppColors.surfaceSubtle,
                                          borderRadius: AppRadius.borderSm,
                                        ),
                                        child: Text(
                                          'OPTIONAL',
                                          style: TextStyle(
                                            fontSize: 9.0,
                                            fontWeight: FontWeight.w700,
                                            color: AppColors.textSecondary,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    camera.hasMicrophonePermission
                                        ? 'Microphone permission granted. Audio capture enabled.'
                                        : (camera.isMicrophonePermissionPermanentlyDenied
                                            ? 'Microphone permission permanently denied in Android Settings.'
                                            : 'Microphone audio is optional. Audio remains off until authorized.'),
                                    style: AppTypography.caption,
                                  ),
                                ],
                              ),
                            ),
                            Switch.adaptive(
                              value: camera.audioEnabled,
                              activeColor: AppColors.primary,
                              onChanged: (val) {
                                if (val) {
                                  if (camera.hasMicrophonePermission) {
                                    ref
                                        .read(cameraStateProvider.notifier)
                                        .setAudioEnabled(true);
                                  } else if (camera
                                      .isMicrophonePermissionPermanentlyDenied) {
                                    AppDialog.show(
                                      context: context,
                                      title: 'Microphone Permission Blocked',
                                      message:
                                          'Microphone permission is permanently denied. You can enable it in Android Settings, or continue streaming video without audio.',
                                      primaryActionLabel: 'Open Settings',
                                      onPrimaryAction: () => ref
                                          .read(cameraStateProvider.notifier)
                                          .openAppSettings(),
                                      secondaryActionLabel: 'Cancel',
                                    );
                                  } else {
                                    _showMicrophoneExplanationDialog(context);
                                  }
                                } else {
                                  ref
                                      .read(cameraStateProvider.notifier)
                                      .setAudioEnabled(false);
                                }
                              },
                            ),
                          ],
                        ),
                        const Divider(height: AppSpacing.xl),

                        // Actions Row (Save Preferences & Cloud Registration)
                        Row(
                          children: [
                            Expanded(
                              child: SecondaryButton(
                                label: 'Save Preferences',
                                icon: Icons.save_outlined,
                                onPressed: () {
                                  ref
                                      .read(cameraStateProvider.notifier)
                                      .saveLocalConfiguration();
                                },
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppColors.primary,
                                  foregroundColor: Colors.white,
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: AppRadius.borderMd,
                                  ),
                                  minimumSize: const Size.fromHeight(48),
                                ),
                                icon: camera.isRegistering
                                    ? const SizedBox(
                                        width: 16,
                                        height: 16,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white,
                                        ),
                                      )
                                    : const Icon(Icons.cloud_upload_outlined,
                                        size: 18),
                                label: Text(
                                  camera.isRegistering
                                      ? 'Registering...'
                                      : (camera.isRegistered
                                          ? 'Registered'
                                          : (camera.deviceId != null
                                              ? 'Retry Binding'
                                              : 'Register Node')),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13.0,
                                  ),
                                ),
                                onPressed: camera.isRegistering
                                    ? null
                                    : () async {
                                        final authNotifier = ref.read(authStateProvider.notifier);
                                        final pendingValidation = authNotifier.currentResumeValidation;
                                        if (pendingValidation != null) {
                                          try {
                                            await pendingValidation;
                                          } catch (_) {}
                                        }
                                        if (!mounted) return;

                                        final currentAuth = ref.read(authStateProvider);
                                        if (currentAuth.status != AuthStatus.authenticated ||
                                            currentAuth.session == null ||
                                            currentAuth.session!.isExpired) {
                                          ref.read(cameraStateProvider.notifier).invalidateInFlightRegistrations();
                                          AppDialog.show(
                                            context: context,
                                            title: 'Session Expired',
                                            message:
                                                'Your session has expired. Please sign in to your ZdexCloud account before registering a security camera node.',
                                            primaryActionLabel: 'Understood',
                                          );
                                          return;
                                        }

                                        final token = currentAuth.session?.accessToken;
                                        if (token == null || token.isEmpty) {
                                          AppDialog.show(
                                            context: context,
                                            title: 'Login Required',
                                            message:
                                                'You must sign in to your ZdexCloud account before registering a security camera node.',
                                            primaryActionLabel: 'Understood',
                                          );
                                          return;
                                        }
                                        ref
                                            .read(cameraStateProvider.notifier)
                                            .registerWithBackend(
                                                sessionToken: token,
                                                userId: currentAuth.session?.user.id);
                                      }
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // -----------------------------------------------------------
                  // 7. Architecture & Coexistence Callout
                  // -----------------------------------------------------------
                  AppCard(
                    color: AppColors.surfaceSubtle,
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.shield_outlined,
                          size: 24,
                          color: AppColors.primary,
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Single-App Architecture & Service Lifecycle',
                                style: AppTypography.cardTitle,
                              ),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                'ZdexCloud is designed to host both personal cloud storage and security camera capabilities in one unified Android application. '
                                'Independent background service lifecycle management and concurrent execution are planned for subsequent platform supervisor phases.',
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPermissionCard(BuildContext context, CameraState camera) {
    if (!camera.hasCameraPermission) {
      if (camera.isCameraPermissionPermanentlyDenied) {
        return AppCard(
          color: Colors.amber.withOpacity(0.08),
          borderColor: Colors.amber.withOpacity(0.3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.warning_amber_rounded,
                      color: Colors.amber, size: 22),
                  const SizedBox(width: AppSpacing.xs),
                  Text(
                    'Camera Permission Permanently Denied',
                    style: AppTypography.cardTitle.copyWith(
                      color: Colors.amber.shade900,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Camera hardware access has been permanently blocked by Android settings. '
                'Open App Settings to grant camera permission for hardware discovery and streaming.',
                style: AppTypography.caption.copyWith(
                  color: Colors.amber.shade900,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.amber.shade800,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: AppRadius.borderSm,
                  ),
                ),
                icon: const Icon(Icons.settings, size: 16),
                label: const Text('Open App Settings'),
                onPressed: () =>
                    ref.read(cameraStateProvider.notifier).openAppSettings(),
              ),
            ],
          ),
        );
      } else {
        return AppCard(
          color: AppColors.surface,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.camera_alt_outlined,
                      color: AppColors.primary, size: 22),
                  SizedBox(width: AppSpacing.xs),
                  Text('Camera Permission Required',
                      style: AppTypography.cardTitle),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              const Text(
                'ZdexCloud requires camera access to discover available lenses and capture video in Camera Server Mode.',
                style: AppTypography.caption,
              ),
              const SizedBox(height: AppSpacing.sm),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: AppRadius.borderSm,
                  ),
                ),
                icon: const Icon(Icons.lock_open, size: 16),
                label: const Text('Grant Camera Access'),
                onPressed: () =>
                    _showCameraPermissionExplanationDialog(context),
              ),
            ],
          ),
        );
      }
    }

    // Camera permission is granted
    return AppCard(
      color: AppColors.surface,
      borderColor: Colors.green.withOpacity(0.3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpacing.xs),
            decoration: BoxDecoration(
              color: Colors.green.withOpacity(0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.check, color: Colors.green, size: 18),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Camera Hardware Authorized',
                    style: AppTypography.cardTitle),
                const SizedBox(height: 2),
                Text(
                  camera.isDiscoveringHardware
                      ? 'Probing Camera2 hardware characteristics...'
                      : (camera.hasDiscoveredHardware
                          ? 'Discovered ${camera.hardwareCameras.length} physical/logical camera(s) via Camera2 HAL.'
                          : 'Hardware ready. Tap to scan capabilities.'),
                  style: AppTypography.caption,
                ),
              ],
            ),
          ),
          if (camera.isDiscoveringHardware)
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            TextButton(
              onPressed: () =>
                  ref.read(cameraStateProvider.notifier).discoverHardware(),
              child: const Text('Re-scan'),
            ),
        ],
      ),
    );
  }

  Widget _buildSelectablePill({
    required String label,
    required bool isSelected,
    required IconData icon,
    required VoidCallback onTap,
    bool isEnabled = true,
  }) {
    return ConstrainedBox(
      constraints: const BoxConstraints(
        minHeight: AppConstants.minTouchTargetSize,
      ),
      child: Material(
        color: !isEnabled
            ? AppColors.surfaceSubtle
            : (isSelected ? AppColors.primarySubtle : AppColors.surface),
        borderRadius: AppRadius.borderMd,
        child: InkWell(
          onTap: isEnabled ? onTap : null,
          borderRadius: AppRadius.borderMd,
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            decoration: BoxDecoration(
              borderRadius: AppRadius.borderMd,
              border: Border.all(
                color: !isEnabled
                    ? AppColors.borderSubtle.withOpacity(0.4)
                    : (isSelected ? AppColors.primary : AppColors.borderSubtle),
                width: isSelected ? 1.5 : 1.0,
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 18,
                  color: !isEnabled
                      ? AppColors.textMuted
                      : (isSelected
                          ? AppColors.primary
                          : AppColors.textSecondary),
                ),
                const SizedBox(width: AppSpacing.xs),
                Flexible(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontFamily: AppTypography.fontFamily,
                      fontSize: 13.0,
                      fontWeight:
                          isSelected ? FontWeight.bold : FontWeight.w500,
                      color: !isEnabled
                          ? AppColors.textMuted
                          : (isSelected
                              ? AppColors.primary
                              : AppColors.textPrimary),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
