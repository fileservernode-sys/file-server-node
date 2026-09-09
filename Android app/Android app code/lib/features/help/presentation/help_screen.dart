import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/url_launcher_service.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import 'help_topic_screen.dart';

/// Help & Learn Hub — Authoritative Native Educational Center for ZdexCloud Android App
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final helpCategories = [
      {
        'id': 'getting-started',
        'icon': Icons.rocket_launch_outlined,
        'title': 'Getting Started',
        'subtitle': 'Set up your Android phone as a personal file server.',
      },
      {
        'id': 'how-it-works',
        'icon': Icons.account_tree_outlined,
        'title': 'How It Works',
        'subtitle':
            'See how your phone, secure connection service, and browser work together.',
      },
      {
        'id': 'your-server',
        'icon': Icons.dns_outlined,
        'title': 'Your Server',
        'subtitle':
            'Understand server status, credentials, and device management.',
      },
      {
        'id': 'storage-files',
        'icon': Icons.folder_special_outlined,
        'title': 'Storage & Files',
        'subtitle':
            'Learn where your files live and how remote file access works.',
      },
      {
        'id': 'permissions-battery',
        'icon': Icons.battery_charging_full_outlined,
        'title': 'Permissions & Battery',
        'subtitle':
            'Understand Android permissions and battery settings needed for reliable operation.',
      },
      {
        'id': 'remote-access',
        'icon': Icons.public_outlined,
        'title': 'Remote Access',
        'subtitle':
            'Learn how to access your server remotely without router port forwarding.',
      },
      {
        'id': 'security-privacy',
        'icon': Icons.shield_outlined,
        'title': 'Security & Privacy',
        'subtitle':
            'Understand account security, server credentials, and local storage.',
      },
      {
        'id': 'accounts-sessions',
        'icon': Icons.manage_accounts_outlined,
        'title': 'Accounts & Sessions',
        'subtitle':
            'Learn how your web account session differs from your Android server.',
      },
      {
        'id': 'multiple-servers',
        'icon': Icons.devices_other_outlined,
        'title': 'Multiple Servers',
        'subtitle':
            'Manage multiple Android storage hosts from one account where your plan allows it.',
      },
      {
        'id': 'troubleshooting',
        'icon': Icons.build_outlined,
        'title': 'Troubleshooting',
        'subtitle':
            'Diagnose common setup, connectivity, permission, and background operation problems.',
      },
      {
        'id': 'contact-support',
        'icon': Icons.support_agent_outlined,
        'title': 'Contact Support',
        'subtitle':
            'Get help without sharing passwords, OTPs, or private server credentials.',
      },
    ];

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Help & Learn',
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
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Hero Header Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    color: AppColors.primarySubtle.withValues(alpha: 0.45),
                    borderColor: AppColors.primary.withValues(alpha: 0.25),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.help_center_rounded,
                                size: 28, color: AppColors.primary),
                            SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Text(
                                'Learn how ZdexCloud works',
                                style: AppTypography.cardTitle,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Understand your Android server, remote access, storage, security, and everyday server management.',
                          style: AppTypography.bodySmall
                              .copyWith(color: AppColors.textPrimary, height: 1.4),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Categories Header
                  const Text('Educational Guides & Topics',
                      style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),

                  // 11 Category Cards
                  ...helpCategories.map(
                    (item) => Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: Semantics(
                        label: '${item['title']}: ${item['subtitle']}',
                        button: true,
                        child: AppCard(
                          child: ListTile(
                            leading: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: AppColors.primary.withValues(alpha: 0.08),
                                shape: BoxShape.circle,
                              ),
                              child: Icon(item['icon'] as IconData,
                                  size: 20, color: AppColors.primary),
                            ),
                            title: Text(item['title'] as String,
                                style: AppTypography.cardTitle),
                            subtitle: Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(
                                item['subtitle'] as String,
                                style: AppTypography.caption
                                    .copyWith(color: AppColors.textSecondary),
                              ),
                            ),
                            trailing: const Icon(Icons.chevron_right,
                                size: 20, color: AppColors.textMuted),
                            onTap: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => HelpTopicScreen(
                                      topicId: item['id'] as String),
                                ),
                              );
                            },
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Support Card Section
                  const Text('Need more help?', style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.headset_mic_outlined,
                                size: 24, color: AppColors.primary),
                            SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Text(
                                'Need more help?',
                                style: AppTypography.cardTitle,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Visit the ZdexCloud support and documentation pages for detailed guidance, or contact our support team at support@zdexcloud.com.',
                          style: AppTypography.bodySmall
                              .copyWith(color: AppColors.textSecondary),
                        ),
                        const SizedBox(height: AppSpacing.md),

                        // Security Callout
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSubtle,
                            borderRadius:
                                BorderRadius.circular(AppSpacing.radiusMd),
                            border: Border.all(color: AppColors.borderSubtle),
                          ),
                          child: const Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.shield_outlined,
                                  size: 18, color: AppColors.textSecondary),
                              SizedBox(width: AppSpacing.xs),
                              Expanded(
                                child: Text(
                                  'Never send your password, OTP, access token, or private server credentials to support.',
                                  style: AppTypography.caption,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpacing.lg),

                        // Action Buttons
                        Row(
                          children: [
                            Expanded(
                              child: SecondaryButton(
                                label: 'Full Documentation',
                                icon: Icons.menu_book_outlined,
                                onPressed: () {
                                  UrlLauncherService.openUrl(
                                      context, UrlLauncherService.documentationUrl);
                                },
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: PrimaryButton(
                                label: 'Contact Support',
                                icon: Icons.mail_outline_rounded,
                                onPressed: () {
                                  UrlLauncherService.openUrl(
                                      context, UrlLauncherService.contactUrl);
                                },
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
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
