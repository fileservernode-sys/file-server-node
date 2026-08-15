import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Reusable Full-Screen or Inline Loading Spinner Indicator
class LoadingIndicator extends StatelessWidget {
  final String? message;
  final bool isFullScreen;

  const LoadingIndicator({
    super.key,
    this.message,
    this.isFullScreen = false,
  });

  @override
  Widget build(BuildContext context) {
    final content = Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const CircularProgressIndicator(
          valueColor: AlwaysStoppedAnimation<Color>(AppColors.primary),
        ),
        if (message != null) ...[
          const SizedBox(height: AppSpacing.md),
          Text(message!, style: AppTypography.bodySmall),
        ],
      ],
    );

    if (isFullScreen) {
      return Scaffold(
        backgroundColor: AppColors.background,
        body: Center(child: content),
      );
    }
    return Center(child: content);
  }
}
