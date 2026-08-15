import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';

/// Home Screen — Main Authenticated Application Dashboard Screen (Mock State Only)
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Personal File Server',
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
                  const Text('Good evening', style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xxs),
                  const Text('Your Personal File Server',
                      style: AppTypography.pageTitle),
                  const SizedBox(height: AppSpacing.xl),

                  // Host Device Node Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.phone_android,
                                size: 28, color: AppColors.primary),
                            SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Text('Android Phone Host',
                                  style: AppTypography.cardTitle),
                            ),
                            StatusBadge(status: DeviceServerStatus.offline),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),
                        const Text(
                          'Turn this phone into your personal file server.',
                          style: AppTypography.body,
                        ),
                        const SizedBox(height: AppSpacing.xl),
                        PrimaryButton(
                          label: 'Set Up Server',
                          icon: Icons.dns_outlined,
                          onPressed: () {
                            Navigator.pushNamed(
                                context, '/server/setup/device');
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // Quick Overview Grid
                  const Text('Quick Overview',
                      style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),
                  const Row(
                    children: [
                      Expanded(
                        child: AppCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.sd_storage_outlined,
                                  size: 22, color: AppColors.textSecondary),
                              SizedBox(height: AppSpacing.xs),
                              Text('Storage', style: AppTypography.caption),
                              SizedBox(height: AppSpacing.xxs),
                              Text('Not configured', style: AppTypography.body),
                            ],
                          ),
                        ),
                      ),
                      SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.wifi_outlined,
                                  size: 22, color: AppColors.textSecondary),
                              SizedBox(height: AppSpacing.xs),
                              Text('Connection', style: AppTypography.caption),
                              SizedBox(height: AppSpacing.xxs),
                              Text('Not connected', style: AppTypography.body),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  const AppCard(
                    child: Row(
                      children: [
                        Icon(Icons.power_settings_new_outlined,
                            size: 22, color: AppColors.textSecondary),
                        SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Server State',
                                  style: AppTypography.caption),
                              SizedBox(height: AppSpacing.xxs),
                              Text('Not running', style: AppTypography.body),
                            ],
                          ),
                        ),
                        StatusBadge(status: DeviceServerStatus.offline),
                      ],
                    ),
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
