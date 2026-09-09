import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/url_launcher_service.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';

/// About Screen — Displays ZdexCloud brand identity, architecture overview, and canonical web resources
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'About ZdexCloud',
        showBackButton: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpacing.maxContentWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                children: [
                  const SizedBox(height: AppSpacing.md),
                  const ContainerIconCircle(
                    icon: Icons.dns_rounded,
                    size: 44,
                    color: AppColors.primary,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  const Text(
                    'ZdexCloud',
                    style: AppTypography.pageTitle,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  const Text(
                    'Personal file server powered by your Android device.',
                    style: AppTypography.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    'Version 1.0.0',
                    style: AppTypography.caption
                        .copyWith(color: AppColors.textMuted),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Mission & Philosophy Card
                  const AppCard(
                    padding: EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('About the Platform',
                            style: AppTypography.cardTitle),
                        SizedBox(height: AppSpacing.xs),
                        Text(
                          'Your Android phone provides the storage. ZdexCloud provides the software and remote-access experience.',
                          style: AppTypography.body,
                        ),
                        SizedBox(height: AppSpacing.md),
                        Text(
                          'Transform everyday or spare Android smartphones into dedicated, eco-friendly private personal servers with instant browser access from any device.',
                          style: AppTypography.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Architecture Diagram Flow Card
                  const AppCard(
                    padding: EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Product Architecture Flow',
                            style: AppTypography.cardTitle),
                        SizedBox(height: AppSpacing.md),
                        _ArchStep(
                          stepNum: '1',
                          title: 'Physical Android Phone Host',
                          subtitle: 'Personal files stored locally on phone media',
                        ),
                        Divider(height: AppSpacing.lg),
                        _ArchStep(
                          stepNum: '2',
                          title: 'Local File Server Engine',
                          subtitle: 'Embedded on-device engine with local authentication',
                        ),
                        Divider(height: AppSpacing.lg),
                        _ArchStep(
                          stepNum: '3',
                          title: 'ZdexCloud Connection Service',
                          subtitle: 'Encrypted outbound connection without port forwarding',
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

                  // Canonical Website Links Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Official Website & Resources',
                            style: AppTypography.cardTitle),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Explore full architecture documentation, security whitepapers, and legal policies on zdexcloud.com.',
                          style: AppTypography.bodySmall
                              .copyWith(color: AppColors.textSecondary),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        _WebLinkTile(
                          icon: Icons.account_tree_outlined,
                          title: 'How It Works',
                          subtitle: 'See complete architecture guide',
                          onTap: () => UrlLauncherService.openUrl(
                              context, UrlLauncherService.howItWorksUrl),
                        ),
                        const Divider(),
                        _WebLinkTile(
                          icon: Icons.menu_book_outlined,
                          title: 'Documentation',
                          subtitle: 'Setup guides & technical documentation',
                          onTap: () => UrlLauncherService.openUrl(
                              context, UrlLauncherService.documentationUrl),
                        ),
                        const Divider(),
                        _WebLinkTile(
                          icon: Icons.shield_outlined,
                          title: 'Privacy Policy',
                          subtitle: 'How your data is protected',
                          onTap: () => UrlLauncherService.openUrl(
                              context, UrlLauncherService.privacyUrl),
                        ),
                        const Divider(),
                        _WebLinkTile(
                          icon: Icons.gavel_outlined,
                          title: 'Terms of Service',
                          subtitle: 'Platform terms and service boundaries',
                          onTap: () => UrlLauncherService.openUrl(
                              context, UrlLauncherService.termsUrl),
                        ),
                        const Divider(),
                        _WebLinkTile(
                          icon: Icons.mail_outline_rounded,
                          title: 'Contact Support',
                          subtitle: 'support@zdexcloud.com',
                          onTap: () => UrlLauncherService.openUrl(
                              context, UrlLauncherService.contactUrl),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  SecondaryButton(
                    label: 'Visit Main Website (zdexcloud.com)',
                    icon: Icons.open_in_new_rounded,
                    onPressed: () {
                      UrlLauncherService.openUrl(
                          context, UrlLauncherService.websiteBaseUrl);
                    },
                  ),
                  const SizedBox(height: AppSpacing.xl),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _WebLinkTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _WebLinkTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: AppColors.primary, size: 22),
      title: Text(title,
          style: AppTypography.body.copyWith(fontWeight: FontWeight.w500)),
      subtitle: Text(subtitle, style: AppTypography.caption),
      trailing: const Icon(Icons.open_in_new_rounded,
          size: 16, color: AppColors.textMuted),
      onTap: onTap,
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
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              stepNum,
              style: AppTypography.caption.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.primary,
              ),
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
