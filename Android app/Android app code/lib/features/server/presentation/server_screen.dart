import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';
import '../../setup/application/setup_state.dart';

/// Server Screen — Manages the Android Server Host Node
class ServerScreen extends ConsumerWidget {
  final bool isConfiguredMock;

  const ServerScreen({
    super.key,
    this.isConfiguredMock = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final setup = ref.watch(setupStateProvider);
    final isConfigured = isConfiguredMock || setup.deviceId != null || setup.isLocalOnline;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Your File Server',
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
                  if (!isConfigured) ...[
                    // Unconfigured State
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.dns_outlined,
                                  size: 32, color: AppColors.textSecondary),
                              SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Your File Server',
                                        style: AppTypography.cardTitle),
                                    SizedBox(height: AppSpacing.xxs),
                                    Text('Not configured',
                                        style: AppTypography.bodySmall),
                                  ],
                                ),
                              ),
                              StatusBadge(status: DeviceServerStatus.offline),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          const Text(
                            'This phone has not been configured as a personal file server yet.',
                            style: AppTypography.body,
                          ),
                          const SizedBox(height: AppSpacing.xl),
                          PrimaryButton(
                            label: 'Set Up Server',
                            icon: Icons.add_circle_outline,
                            onPressed: () {
                              Navigator.pushNamed(
                                  context, '/server/setup/device');
                            },
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    // Configured Active State
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.dns_rounded,
                                  size: 32, color: AppColors.primary),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(setup.deviceName,
                                        style: AppTypography.cardTitle),
                                    const SizedBox(height: AppSpacing.xxs),
                                    Text(
                                      setup.isLocalOnline
                                          ? 'Online on ${setup.localServerUrl}'
                                          : 'Offline / Stopped',
                                      style: AppTypography.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                              StatusBadge(
                                status: setup.isLocalOnline
                                    ? DeviceServerStatus.online
                                    : DeviceServerStatus.offline,
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xl),
                          PrimaryButton(
                            label: 'View Server Status',
                            icon: Icons.info_outline,
                            onPressed: () {
                              Navigator.pushNamed(context, '/server/status');
                            },
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
