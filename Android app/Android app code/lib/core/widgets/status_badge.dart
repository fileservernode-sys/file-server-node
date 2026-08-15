import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

enum DeviceServerStatus { online, connecting, reconnecting, offline }

/// Reusable Status Badge Component — Matches Main Website Status Tokens Exactly
class StatusBadge extends StatelessWidget {
  final DeviceServerStatus status;

  const StatusBadge({
    super.key,
    required this.status,
  });

  @override
  Widget build(BuildContext context) {
    late Color textColor;
    late Color bgColor;
    late String label;

    switch (status) {
      case DeviceServerStatus.online:
        textColor = AppColors.statusOnline;
        bgColor = AppColors.statusOnlineBg;
        label = 'ONLINE';
        break;
      case DeviceServerStatus.connecting:
        textColor = AppColors.statusConnecting;
        bgColor = AppColors.statusConnectingBg;
        label = 'CONNECTING';
        break;
      case DeviceServerStatus.reconnecting:
        textColor = AppColors.statusConnecting;
        bgColor = AppColors.statusConnectingBg;
        label = 'RECONNECTING';
        break;
      case DeviceServerStatus.offline:
        textColor = AppColors.statusOffline;
        bgColor = AppColors.statusOfflineBg;
        label = 'OFFLINE';
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
            style: AppTypography.status.copyWith(color: textColor),
          ),
        ],
      ),
    );
  }
}
