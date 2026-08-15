import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';

/// About Screen — Displays platform brand identity, mission, and version metadata
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'About Platform',
        showBackButton: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpacing.maxContentWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.xl),
              child: Column(
                children: [
                  const SizedBox(height: AppSpacing.lg),
                  const Icon(Icons.dns_rounded,
                      size: 56, color: AppColors.primary),
                  const SizedBox(height: AppSpacing.md),
                  const Text(
                    'Remote Android Personal File Server',
                    style: AppTypography.pageTitle,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  const Text(
                    'Version 1.0.0 (Phase 1 — Batch 6C Foundation)',
                    style: AppTypography.caption,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  const AppCard(
                    padding: EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Our Mission', style: AppTypography.sectionTitle),
                        SizedBox(height: AppSpacing.xs),
                        Text(
                          'Transform unused older Android smartphones into powerful, self-hosted, private personal file servers with zero cloud dependency.',
                          style: AppTypography.body,
                        ),
                        SizedBox(height: AppSpacing.lg),
                        Text('Architecture Highlights',
                            style: AppTypography.sectionTitle),
                        SizedBox(height: AppSpacing.xs),
                        Text(
                          '• Android 5.0+ (Lollipop+) compatibility\n'
                          '• Clean separation of Platform & File-Server credentials\n'
                          '• Local Web File Manager hosted on physical phone storage\n'
                          '• Secure encrypted control plane architecture',
                          style: AppTypography.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),
                  TertiaryButton(
                    label: 'Visit Main Website (remotenode.net)',
                    icon: Icons.open_in_new,
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text('Opening https://remotenode.net...')),
                      );
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
