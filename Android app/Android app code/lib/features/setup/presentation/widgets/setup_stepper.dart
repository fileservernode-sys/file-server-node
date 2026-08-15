import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';

/// Responsive Setup Stepper Component — Adapts smoothly between 320px and wide displays
class SetupStepper extends StatelessWidget {
  final int currentStep;
  final int totalSteps;
  final String stepTitle;

  const SetupStepper({
    super.key,
    required this.currentStep,
    this.totalSteps = 6,
    required this.stepTitle,
  });

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final isCompact = screenWidth < 380;

    if (isCompact) {
      // Compact Screen Progress Layout (320px - 379px)
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Step $currentStep of $totalSteps',
                style: AppTypography.caption.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                '${((currentStep / totalSteps) * 100).round()}%',
                style: AppTypography.caption,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xxs),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: currentStep / totalSteps,
              backgroundColor: AppColors.borderSubtle,
              color: AppColors.primary,
              minHeight: 6,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(stepTitle, style: AppTypography.sectionTitle),
        ],
      );
    }

    // Wide Screen Step Row Layout (380px+)
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: List.generate(totalSteps, (index) {
            final stepNumber = index + 1;
            final isCompleted = stepNumber < currentStep;
            final isCurrent = stepNumber == currentStep;

            final circleColor = isCompleted
                ? AppColors.statusOnline
                : isCurrent
                    ? AppColors.primary
                    : AppColors.borderSubtle;

            final textColor =
                (isCompleted || isCurrent) ? Colors.white : AppColors.textMuted;

            return Expanded(
              child: Row(
                children: [
                  Container(
                    width: 24,
                    height: 24,
                    decoration: BoxDecoration(
                      color: circleColor,
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: isCompleted
                          ? const Icon(Icons.check,
                              size: 14, color: Colors.white)
                          : Text(
                              '$stepNumber',
                              style: AppTypography.caption.copyWith(
                                  color: textColor,
                                  fontWeight: FontWeight.bold),
                            ),
                    ),
                  ),
                  if (index < totalSteps - 1)
                    Expanded(
                      child: Container(
                        height: 2,
                        color: stepNumber < currentStep
                            ? AppColors.statusOnline
                            : AppColors.borderSubtle,
                      ),
                    ),
                ],
              ),
            );
          }),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Step $currentStep: $stepTitle',
          style: AppTypography.sectionTitle,
        ),
      ],
    );
  }
}
