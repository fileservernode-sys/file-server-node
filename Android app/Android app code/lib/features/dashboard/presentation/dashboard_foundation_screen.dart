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
        title: 'RemoteNode',
        subtitle: 'Personal File Server',
        showBrandMark: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppSpacing.maxContentWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Page Header
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Control Center',
                              style: AppTypography.caption
                                  .copyWith(color: AppColors.primary, fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            const Text(
                              'Welcome back',
                              style: AppTypography.pageTitle,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceSubtle,
                          borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
                          border: Border.all(color: AppColors.borderSubtle),
                        ),
                        child: Text(
                          '1 / 5 Server Slots',
                          style: AppTypography.caption.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Your Device Hero Card
                  const Text('Your device', style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(AppSpacing.xs),
                              decoration: const BoxDecoration(
                                color: AppColors.surfaceSubtle,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.phone_android,
                                size: 24,
                                color: AppColors.primary,
                              ),
                            ),
                            const SizedBox(width: AppSpacing.md),
                            const Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Android Phone Host Node',
                                    style: AppTypography.cardTitle,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  SizedBox(height: 2),
                                  Text(
                                    'Android Phone → Physical Storage Host',
                                    style: AppTypography.caption,
                                  ),
                                ],
                              ),
                            ),
                            const StatusBadge(status: DeviceServerStatus.offline),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.lg),

                        Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSubtle,
                            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                            border: Border.all(color: AppColors.borderSubtle),
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.shield_outlined, size: 18, color: AppColors.primary),
                              SizedBox(width: AppSpacing.xs),
                              Expanded(
                                child: Text(
                                  'Turn this phone into your personal file server.',
                                  style: AppTypography.bodySmall,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpacing.xl),

                        PrimaryButton(
                          label: 'Set Up Server',
                          icon: Icons.dns_outlined,
                          onPressed: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Server Setup Wizard active in setup journey.'),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Storage Capacity Summary Card
                  const AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Row(
                                children: [
                                  Icon(Icons.sd_storage_outlined, size: 20, color: AppColors.primary),
                                  SizedBox(width: AppSpacing.xs),
                                  Flexible(
                                    child: Text(
                                      'Host Storage Capacity',
                                      style: AppTypography.cardTitle,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            SizedBox(width: AppSpacing.xs),
                            Text('64 GB Free', style: AppTypography.caption),
                          ],
                        ),
                        SizedBox(height: AppSpacing.sm),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text('0 GB used',
                                  style: AppTypography.bodySmall,
                                  overflow: TextOverflow.ellipsis),
                            ),
                            Text('64 GB total', style: AppTypography.caption),
                          ],
                        ),
                        SizedBox(height: AppSpacing.xs),
                        LinearProgressIndicator(
                          value: 0.0,
                          minHeight: 8.0,
                          backgroundColor: AppColors.surfaceSubtle,
                          valueColor: AlwaysStoppedAnimation<Color>(AppColors.primary),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Quick Information Section
                  const Text('Infrastructure Overview', style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),
                  const Row(
                    children: [
                      Expanded(
                        child: AppCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.sd_storage_outlined,
                                  size: 20, color: AppColors.textSecondary),
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
                                  size: 20, color: AppColors.textSecondary),
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
                            size: 20, color: AppColors.textSecondary),
                        SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Account Platform', style: AppTypography.caption),
                              SizedBox(height: AppSpacing.xxs),
                              Text('Platform account', style: AppTypography.body),
                            ],
                          ),
                        ),
                        Icon(Icons.chevron_right, size: 20, color: AppColors.textMuted),
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
