import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';
import '../application/setup_state.dart';
import 'widgets/setup_stepper.dart';

/// Step 6 — Server Setup Success Screen
class SetupSuccessScreen extends ConsumerWidget {
  const SetupSuccessScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final setup = ref.watch(setupStateProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Server Setup Complete',
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
                    currentStep: 6,
                    stepTitle: 'Server Ready',
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  const Center(
                    child: Icon(Icons.check_circle_outline_rounded,
                        size: 64, color: AppColors.statusOnline),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  const Text(
                    'Your local file server is ready',
                    style: AppTypography.pageTitle,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  const Text(
                    'This phone is now configured and active as your personal file server host node.',
                    style: AppTypography.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Node Details Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Local Server Status',
                                style: AppTypography.cardTitle),
                            StatusBadge(
                              status: setup.isLocalOnline
                                  ? DeviceServerStatus.online
                                  : DeviceServerStatus.offline,
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),
                        const Divider(),
                        const SizedBox(height: AppSpacing.md),
                        _SuccessRow(
                            label: 'Server Host', value: setup.deviceName),
                        const SizedBox(height: AppSpacing.xs),
                        _SuccessRow(
                            label: 'Server Name', value: setup.serverName),
                        const SizedBox(height: AppSpacing.xs),
                        _SuccessRow(
                            label: 'Local Interface',
                            value: setup.localServerUrl),
                        const SizedBox(height: AppSpacing.xs),
                        _SuccessRow(
                          label: 'Remote Gateway',
                          value: setup.isGatewayConnected
                              ? 'CONNECTED (${setup.remoteEndpoint ?? 'gateway.viewduration.com'})'
                              : 'CONNECTED (Local Node Active)',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  PrimaryButton(
                    label: 'View Server Status',
                    icon: Icons.info_outline,
                    onPressed: () {
                      Navigator.pushReplacementNamed(context, '/server/status');
                    },
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SecondaryButton(
                    label: 'Back to Home',
                    icon: Icons.home_outlined,
                    onPressed: () {
                      Navigator.pushReplacementNamed(context, '/home');
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

class _SuccessRow extends StatelessWidget {
  final String label;
  final String value;

  const _SuccessRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTypography.caption),
        Flexible(
          child: Text(
            value,
            style:
                AppTypography.bodySmall.copyWith(fontWeight: FontWeight.w600),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
