import 'package:flutter/material.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';

/// About Screen — Displays platform brand identity, architecture diagram, and mission metadata
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final websiteUrl = AppConfig.current.websiteUrl;

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
                  const SizedBox(height: AppSpacing.md),
                  const ContainerIconCircle(
                    icon: Icons.dns_rounded,
                    size: 48,
                    color: AppColors.primary,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  const Text(
                    'Remote Android Personal File Server',
                    style: AppTypography.pageTitle,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  const Text(
                    'Version 1.0.0 (Phase 1 — Commercial SaaS Engine)',
                    style: AppTypography.caption,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Architecture Diagram Flow Card
                  const AppCard(
                    padding: EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Product Architecture Flow',
                            style: AppTypography.sectionTitle),
                        SizedBox(height: AppSpacing.md),
                        _ArchStep(
                          stepNum: '1',
                          title: 'Physical Android Phone Host',
                          subtitle: 'Personal files stored on phone media',
                        ),
                        Divider(height: AppSpacing.lg),
                        _ArchStep(
                          stepNum: '2',
                          title: 'Local HTTP File Server',
                          subtitle: 'Runs on 127.0.0.1:8080 on-device socket',
                        ),
                        Divider(height: AppSpacing.lg),
                        _ArchStep(
                          stepNum: '3',
                          title: 'RemoteNode Outbound Gateway',
                          subtitle: 'Encrypted WebSocket tunnel without port forwarding',
                        ),
                        Divider(height: AppSpacing.lg),
                        _ArchStep(
                          stepNum: '4',
                          title: 'Remote Web File Manager',
                          subtitle: 'Access files anywhere via browser interface',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Mission & Principles Card
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
                    icon: Icons.open_in_new_rounded,
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                            content: Text('Opening $websiteUrl...')),
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

class ContainerIconCircle extends StatelessWidget {
  final IconData icon;
  final double size;
  final Color color;

  const ContainerIconCircle({
    super.key,
    required this.icon,
    required this.size,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: size, color: color),
    );
  }
}

class _ArchStep extends StatelessWidget {
  final String stepNum;
  final String title;
  final String subtitle;

  const _ArchStep({
    required this.stepNum,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: const BoxDecoration(
            color: AppColors.primary,
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              stepNum,
              style: AppTypography.caption.copyWith(
                  color: Colors.white, fontWeight: FontWeight.bold),
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style:
                      AppTypography.body.copyWith(fontWeight: FontWeight.w600)),
              Text(subtitle, style: AppTypography.caption),
            ],
          ),
        ),
      ],
    );
  }
}

