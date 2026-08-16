import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../application/setup_state.dart';
import 'widgets/setup_stepper.dart';

/// Step 4 — Review Configuration Screen
class SetupReviewScreen extends ConsumerWidget {
  const SetupReviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final setup = ref.watch(setupStateProvider);

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
                    currentStep: 4,
                    stepTitle: 'Review Configuration',
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  const Text(
                    'Review your server settings',
                    style: AppTypography.pageTitle,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  const Text(
                    'Confirm the configuration details before launching your server node.',
                    style: AppTypography.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Review Summary Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Configuration Summary',
                            style: AppTypography.cardTitle),
                        const SizedBox(height: AppSpacing.md),
                        _ReviewRow(
                            label: 'Host Device', value: setup.deviceName),
                        const Divider(height: AppSpacing.lg),
                        _ReviewRow(
                            label: 'Server Name', value: setup.serverName),
                        const Divider(height: AppSpacing.lg),
                        _ReviewRow(
                            label: 'File-server Username',
                            value: setup.fileServerUsername),
                        const Divider(height: AppSpacing.lg),
                        const _ReviewRow(
                            label: 'File-server Password', value: '••••••••'),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Security Reminder
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSubtle,
                      borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                      border: Border.all(color: AppColors.borderSubtle),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.shield_outlined,
                            size: 20, color: AppColors.textSecondary),
                        SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Text(
                            'Your file-server credentials are separate from your platform account credentials.',
                            style: AppTypography.caption,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  PrimaryButton(
                    label: 'Create Server',
                    icon: Icons.rocket_launch_outlined,
                    onPressed: () {
                      Navigator.pushNamed(context, '/server/setup/creating');
                    },
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SecondaryButton(
                    label: 'Back to Edit',
                    onPressed: () => Navigator.pop(context),
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

class _ReviewRow extends StatelessWidget {
  final String label;
  final String value;

  const _ReviewRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTypography.bodySmall),
        Text(value,
            style: AppTypography.body.copyWith(fontWeight: FontWeight.w600)),
      ],
    );
  }
}
