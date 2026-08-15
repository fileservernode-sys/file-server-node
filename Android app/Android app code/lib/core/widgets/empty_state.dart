import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'app_button.dart';

/// Reusable Empty State View Component
class EmptyStateView extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final String? actionLabel;
  final VoidCallback? onAction;

  const EmptyStateView({
    super.key,
    required this.icon,
    required this.title,
    required this.description,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: const BoxDecoration(
              color: AppColors.surfaceSubtle,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 48, color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(title,
              style: AppTypography.heading2, textAlign: TextAlign.center),
          const SizedBox(height: AppSpacing.xs),
          Text(
            description,
            style: AppTypography.bodySmall,
            textAlign: TextAlign.center,
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: AppSpacing.xl),
            PrimaryButton(
              label: actionLabel!,
              onPressed: onAction,
              isFullWidth: false,
            ),
          ],
        ],
      ),
    );
  }
}
