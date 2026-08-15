import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_radius.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'app_button.dart';

/// Reusable Modal Dialog Foundation Component
class AppDialog extends StatelessWidget {
  final String title;
  final String message;
  final String primaryActionLabel;
  final VoidCallback onPrimaryAction;
  final String? secondaryActionLabel;
  final VoidCallback? onSecondaryAction;
  final bool isDestructive;

  const AppDialog({
    super.key,
    required this.title,
    required this.message,
    required this.primaryActionLabel,
    required this.onPrimaryAction,
    this.secondaryActionLabel,
    this.onSecondaryAction,
    this.isDestructive = false,
  });

  static Future<T?> show<T>({
    required BuildContext context,
    required String title,
    required String message,
    required String primaryActionLabel,
    required VoidCallback onPrimaryAction,
    String? secondaryActionLabel,
    VoidCallback? onSecondaryAction,
    bool isDestructive = false,
  }) {
    return showDialog<T>(
      context: context,
      builder: (_) => AppDialog(
        title: title,
        message: message,
        primaryActionLabel: primaryActionLabel,
        onPrimaryAction: onPrimaryAction,
        secondaryActionLabel: secondaryActionLabel,
        onSecondaryAction: onSecondaryAction,
        isDestructive: isDestructive,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.borderLg,
        side: const BorderSide(color: AppColors.borderSubtle, width: 1.0),
      ),
      backgroundColor: AppColors.surface,
      insetPadding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xl,
        vertical: AppSpacing.xxl,
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: AppTypography.sectionTitle),
            const SizedBox(height: AppSpacing.xs),
            Text(message, style: AppTypography.bodySmall),
            const SizedBox(height: AppSpacing.xl),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (secondaryActionLabel != null) ...[
                  SecondaryButton(
                    label: secondaryActionLabel!,
                    onPressed: () {
                      Navigator.of(context).pop();
                      if (onSecondaryAction != null) onSecondaryAction!();
                    },
                    isFullWidth: false,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                ],
                if (isDestructive)
                  DestructiveButton(
                    label: primaryActionLabel,
                    onPressed: () {
                      Navigator.of(context).pop();
                      onPrimaryAction();
                    },
                    isFullWidth: false,
                  )
                else
                  PrimaryButton(
                    label: primaryActionLabel,
                    onPressed: () {
                      Navigator.of(context).pop();
                      onPrimaryAction();
                    },
                    isFullWidth: false,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
