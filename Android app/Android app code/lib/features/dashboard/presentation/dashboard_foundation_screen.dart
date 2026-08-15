import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';

/// Dashboard Foundation Screen — Visually demonstrates the Android UI Design System
class DashboardFoundationScreen extends StatelessWidget {
  const DashboardFoundationScreen({super.key});

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
                  // Greeting Subheading
                  const Text('Welcome back', style: AppTypography.pageTitle),
                  const SizedBox(height: AppSpacing.xs),
                  const Text(
                    'Manage your local device server node and view connectivity status.',
                    style: AppTypography.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Your Device Main Card
                  const Text('Your device', style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),
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
                              child: Text('Android Phone Host Node',
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
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                    'Server Setup Wizard will be active in future Android batches.'),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // Quick Information Section
                  const Text('Quick information',
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
                              Text('Not configured', style: AppTypography.body),
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
                        Icon(Icons.account_circle_outlined,
                            size: 22, color: AppColors.textSecondary),
                        SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Account Platform',
                                  style: AppTypography.caption),
                              SizedBox(height: AppSpacing.xxs),
                              Text('Platform account',
                                  style: AppTypography.body),
                            ],
                          ),
                        ),
                        Icon(Icons.chevron_right,
                            size: 20, color: AppColors.textMuted),
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
