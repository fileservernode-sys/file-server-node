import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import 'widgets/setup_stepper.dart';

/// Step 1 — Device Preparation Screen
class SetupDeviceScreen extends StatelessWidget {
  const SetupDeviceScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Server Setup Wizard',
        showBackButton: true,
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
                  const SetupStepper(
                    currentStep: 1,
                    stepTitle: 'Prepare Device',
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  const Text(
                    'This phone will become your personal file server.',
                    style: AppTypography.pageTitle,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  const Text(
                    'Your files remain stored directly on this Android device. The application will host a private local web server.',
                    style: AppTypography.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Device Preparation Conceptual Checklist
                  const AppCard(
                    padding: EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Pre-requisites Checklist',
                            style: AppTypography.cardTitle),
                        SizedBox(height: AppSpacing.md),
                        _ChecklistTile(
                          isCompleted: true,
                          title: 'Android device available',
                          subtitle:
                              'Android 5.0 (Lollipop) or newer host phone',
                        ),
                        Divider(height: AppSpacing.lg),
                        _ChecklistTile(
                          isCompleted: true,
                          title: 'Internet connection',
                          subtitle: 'Active Wi-Fi or cellular connection',
                        ),
                        Divider(height: AppSpacing.lg),
                        _ChecklistTile(
                          isCompleted: false,
                          title: 'Device storage & power',
                          subtitle:
                              'Sufficient storage space & keep plugged into charger',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  PrimaryButton(
                    label: 'Continue',
                    icon: Icons.arrow_forward,
                    onPressed: () {
                      Navigator.pushNamed(
                          context, '/server/setup/configuration');
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ChecklistTile extends StatelessWidget {
  final bool isCompleted;
  final String title;
  final String subtitle;

  const _ChecklistTile({
    required this.isCompleted,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(
          isCompleted
              ? Icons.check_circle_rounded
              : Icons.radio_button_unchecked,
          color: isCompleted ? AppColors.statusOnline : AppColors.textMuted,
          size: 22,
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style:
                      AppTypography.body.copyWith(fontWeight: FontWeight.w500)),
              Text(subtitle, style: AppTypography.caption),
            ],
          ),
        ),
      ],
    );
  }
}
