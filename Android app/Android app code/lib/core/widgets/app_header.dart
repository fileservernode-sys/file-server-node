import 'package:flutter/material.dart';
import '../constants/app_constants.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'status_badge.dart';

/// Reusable Compact Application Header / AppBar System
class AppHeader extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final String? subtitle;
  final bool showBackButton;
  final VoidCallback? onBackPressed;
  final List<Widget>? actions;
  final DeviceServerStatus? status;
  final bool showBrandMark;

  const AppHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.showBackButton = false,
    this.onBackPressed,
    this.actions,
    this.status,
    this.showBrandMark = false,
  });

  @override
  Size get preferredSize => Size.fromHeight(subtitle != null ? 64.0 : 56.0);

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: AppColors.borderSubtle, width: 1.0),
        ),
      ),
      child: SafeArea(
        child: Container(
          height: preferredSize.height,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          child: Row(
            children: [
              if (showBackButton)
                ConstrainedBox(
                  constraints: const BoxConstraints(
                    minWidth: AppConstants.minTouchTargetSize,
                    minHeight: AppConstants.minTouchTargetSize,
                  ),
                  child: IconButton(
                    icon: const Icon(Icons.arrow_back,
                        color: AppColors.textPrimary),
                    onPressed:
                        onBackPressed ?? () => Navigator.maybePop(context),
                  ),
                )
              else if (showBrandMark)
                Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.sm),
                  child: Container(
                    padding: const EdgeInsets.all(AppSpacing.xxs),
                    decoration: BoxDecoration(
                      color: AppColors.primarySubtle,
                      borderRadius: BorderRadius.circular(6.0),
                    ),
                    child: const Icon(
                      Icons.dns_rounded,
                      color: AppColors.primary,
                      size: 20,
                    ),
                  ),
                ),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            title,
                            style: AppTypography.cardTitle,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (status != null) ...[
                          const SizedBox(width: AppSpacing.xs),
                          StatusBadge(status: status!),
                        ],
                      ],
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: AppTypography.caption
                            .copyWith(color: AppColors.textSecondary),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              if (actions != null) ...actions!,
            ],
          ),
        ),
      ),
    );
  }
}
