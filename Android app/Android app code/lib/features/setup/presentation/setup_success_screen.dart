import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

/// Step 6 — Server Setup Success & Public Access Screen
class SetupSuccessScreen extends ConsumerWidget {
  const SetupSuccessScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final setup = ref.watch(setupStateProvider);
    final publicUrl = setup.publicUrl ??
        (setup.assignedSubdomain != null
            ? 'https://${setup.assignedSubdomain}'
            : 'https://gateway.viewduration.com');

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
                    'Your personal file server is ready',
                    style: AppTypography.pageTitle,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  const Text(
                    'This phone is now active as a file server node accessible locally and over the public internet.',
                    style: AppTypography.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // -----------------------------------------------------------
                  // 1. Dedicated Public Server Access Card
                  // -----------------------------------------------------------
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    color: AppColors.primarySubtle.withValues(alpha: 0.5),
                    borderColor: AppColors.primary.withValues(alpha: 0.3),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.public_rounded,
                                    color: AppColors.primary, size: 22),
                                SizedBox(width: AppSpacing.xs),
                                Text('Public Server Access',
                                    style: AppTypography.cardTitle),
                              ],
                            ),
                            StatusBadge(
                              status: setup.endpointStatus == 'ACTIVE'
                                  ? DeviceServerStatus.online
                                  : DeviceServerStatus.offline,
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        const Text(
                          'Your server is publicly reachable through its unique secure subdomain endpoint:',
                          style: AppTypography.bodySmall,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: AppSpacing.md,
                              vertical: AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius:
                                BorderRadius.circular(AppSpacing.radiusMd),
                            border: Border.all(color: AppColors.borderSubtle),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.link_rounded,
                                  size: 20, color: AppColors.primary),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Text(
                                  publicUrl,
                                  style: AppTypography.bodySmall.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.primary,
                                    fontFamily: 'monospace',
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                icon: const Icon(Icons.copy_rounded, size: 18),
                                label: const Text('Copy Link'),
                                style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                      vertical: AppSpacing.sm),
                                  side: const BorderSide(
                                      color: AppColors.primary),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(
                                        AppSpacing.radiusMd),
                                  ),
                                ),
                                onPressed: () {
                                  Clipboard.setData(
                                      ClipboardData(text: publicUrl));
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(
                                          'Public link copied: $publicUrl'),
                                      duration: const Duration(seconds: 3),
                                    ),
                                  );
                                },
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: ElevatedButton.icon(
                                icon: const Icon(Icons.open_in_browser_rounded,
                                    size: 18),
                                label: const Text('Open Link'),
                                style: ElevatedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                      vertical: AppSpacing.sm),
                                  backgroundColor: AppColors.primary,
                                  foregroundColor: Colors.white,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(
                                        AppSpacing.radiusMd),
                                  ),
                                ),
                                onPressed: () {
                                  ref
                                      .read(serverServiceProvider)
                                      .openUrl(publicUrl);
                                },
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // -----------------------------------------------------------
                  // 2. Local Node & Gateway Status Card
                  // -----------------------------------------------------------
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Local Node Details',
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
                              ? 'CONNECTED (gateway.viewduration.com)'
                              : 'CONNECTED (Active)',
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _SuccessRow(
                          label: 'Endpoint Status',
                          value: setup.endpointStatus,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  PrimaryButton(
                    label: 'View Server Dashboard',
                    icon: Icons.dashboard_outlined,
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
