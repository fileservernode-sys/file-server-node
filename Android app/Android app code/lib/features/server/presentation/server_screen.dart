import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';

/// Server Screen — Manages the Android Server Host Node (Mock State Only)
class ServerScreen extends StatelessWidget {
  final bool isConfiguredMock;

  const ServerScreen({
    super.key,
    this.isConfiguredMock = false,
  });

  @override
  Widget build(BuildContext context) {
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
                  if (!isConfiguredMock) ...[
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
                    // Configured Mock State
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.dns_rounded,
                                  size: 32, color: AppColors.primary),
                              SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Android Phone Host Node',
                                        style: AppTypography.cardTitle),
                                    SizedBox(height: AppSpacing.xxs),
                                    Text('Online and serving files',
                                        style: AppTypography.bodySmall),
                                  ],
                                ),
                              ),
                              StatusBadge(status: DeviceServerStatus.online),
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
