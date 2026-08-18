import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';
import '../application/setup_state.dart';
import 'widgets/setup_stepper.dart';

/// Step 6 — Server Setup Success & Main Website Redirection Screen
class SetupSuccessScreen extends ConsumerWidget {
  const SetupSuccessScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final setup = ref.watch(setupStateProvider);
    final websiteUrl = AppConfig.current.websiteUrl;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) {
          Navigator.pushNamedAndRemoveUntil(context, '/home', (r) => false);
        }
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppHeader(
          title: 'Server Setup Complete',
          showBackButton: true,
          onBackPressed: () {
            Navigator.pushNamedAndRemoveUntil(context, '/home', (r) => false);
          },
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
                      totalSteps: 4,
                      stepTitle: 'Server Ready',
                    ),
                    const SizedBox(height: AppSpacing.xl),

                    const Center(
                      child: Icon(Icons.check_circle_outline_rounded,
                          size: 64, color: AppColors.statusOnline),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    const Text(
                      'Your personal file server is running',
                      style: AppTypography.pageTitle,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    const Text(
                      'This device is now active as a personal storage server node. Visit RemoteNode to access your file manager.',
                      style: AppTypography.bodySmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSpacing.xl),

                    // -----------------------------------------------------------
                    // 1. Central Web Access & Discovery Card
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
                              const Expanded(
                                child: Row(
                                  children: [
                                    Icon(Icons.public_rounded,
                                        color: AppColors.primary, size: 22),
                                    SizedBox(width: AppSpacing.xs),
                                    Flexible(
                                      child: Text('Access Your Server',
                                          style: AppTypography.cardTitle,
                                          overflow: TextOverflow.ellipsis),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: AppSpacing.xs),
                              StatusBadge(
                                status: setup.isGatewayConnected
                                    ? DeviceServerStatus.online
                                    : DeviceServerStatus.offline,
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          const Text(
                            'Your server is running and connected. Sign in to your account on the RemoteNode website to access your server and file manager.',
                            style: AppTypography.bodySmall,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          PrimaryButton(
                            label: 'Open RemoteNode',
                            icon: Icons.open_in_browser_rounded,
                            onPressed: () async {
                              final serverService = ref.read(serverServiceProvider);
                              await serverService.openUrl(websiteUrl);
                            },
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // -----------------------------------------------------------
                    // 2. Local Node Details Card
                    // -----------------------------------------------------------
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Expanded(
                                child: Text('Local Node Details',
                                    style: AppTypography.cardTitle,
                                    overflow: TextOverflow.ellipsis),
                              ),
                              const SizedBox(width: AppSpacing.xs),
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
                              label: 'Server Host',
                              value: setup.deviceName.isNotEmpty
                                  ? setup.deviceName
                                  : 'Android Host'),
                          const SizedBox(height: AppSpacing.xs),
                          _SuccessRow(
                              label: 'Server Name',
                              value: setup.serverName.isNotEmpty
                                  ? setup.serverName
                                  : 'Personal File Server'),
                          const SizedBox(height: AppSpacing.xs),
                          _SuccessRow(
                              label: 'Local Engine',
                              value: setup.localServerUrl),
                          const SizedBox(height: AppSpacing.xs),
                          _SuccessRow(
                            label: 'Node Status',
                            value: setup.isLocalOnline ? 'ACTIVE' : 'STOPPED',
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),

                    SecondaryButton(
                      label: 'View Local Node Status',
                      icon: Icons.dashboard_outlined,
                      onPressed: () {
                        Navigator.pushNamedAndRemoveUntil(
                            context, '/server/status', (r) => false);
                      },
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    TertiaryButton(
                      label: 'Back to Home',
                      icon: Icons.home_outlined,
                      onPressed: () {
                        Navigator.pushNamedAndRemoveUntil(
                            context, '/home', (r) => false);
                      },
                    ),
                  ],
                ),
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
