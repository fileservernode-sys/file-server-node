import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../application/camera_state.dart';

/// Reusable Camera Status Badge — Aligned with ZdexCloud Design System
class CameraStatusBadge extends StatelessWidget {
  final CameraLifecycleStatus status;

  const CameraStatusBadge({
    super.key,
    required this.status,
  });

  @override
  Widget build(BuildContext context) {
    late Color textColor;
    late Color bgColor;
    late String label;

    switch (status) {
      case CameraLifecycleStatus.notConfigured:
        textColor = AppColors.textMuted;
        bgColor = AppColors.surfaceSubtle;
        label = 'NOT CONFIGURED';
        break;
      case CameraLifecycleStatus.offline:
        textColor = AppColors.statusOffline;
        bgColor = AppColors.statusOfflineBg;
        label = 'OFFLINE';
        break;
      case CameraLifecycleStatus.connecting:
        textColor = AppColors.statusConnecting;
        bgColor = AppColors.statusConnectingBg;
        label = 'CONNECTING';
        break;
      case CameraLifecycleStatus.online:
        textColor = AppColors.statusOnline;
        bgColor = AppColors.statusOnlineBg;
        label = 'ONLINE';
        break;
      case CameraLifecycleStatus.streaming:
        textColor = AppColors.statusOnline;
        bgColor = AppColors.statusOnlineBg;
        label = 'LIVE STREAMING';
        break;
      case CameraLifecycleStatus.reconnecting:
        textColor = AppColors.statusConnecting;
        bgColor = AppColors.statusConnectingBg;
        label = 'RECONNECTING';
        break;
      case CameraLifecycleStatus.error:
        textColor = AppColors.statusError;
        bgColor = AppColors.statusErrorBg;
        label = 'ERROR';
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xs,
        vertical: AppSpacing.xxs,
      ),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
        border: Border.all(color: textColor.withValues(alpha: 0.3), width: 1.0),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: textColor,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: AppSpacing.xxs),
          Text(
            label,
            style: AppTypography.caption.copyWith(
              color: textColor,
              fontWeight: FontWeight.bold,
              fontSize: 10.0,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }
}
