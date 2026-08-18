import 'package:flutter/material.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';

/// Help & Documentation Screen — Structured Commercial Support Center
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final websiteUrl = AppConfig.current.websiteUrl;

    final helpCategories = [
      {
        'icon': Icons.rocket_launch_outlined,
        'title': 'Getting Started',
        'subtitle': 'How to set up your Android phone server'
      },
      {
        'icon': Icons.memory_outlined,
        'title': 'How the Server Works',
        'subtitle': 'Understanding phone hosting & node architecture'
      },
      {
        'icon': Icons.sd_storage_outlined,
        'title': 'File Storage & Privacy',
        'subtitle': 'Managing internal storage and physical file privacy'
      },
      {
        'icon': Icons.wifi_outlined,
        'title': 'Remote Gateway Access',
        'subtitle': 'Accessing your files securely over HTTPS'
      },
      {
        'icon': Icons.build_outlined,
        'title': 'Troubleshooting',
        'subtitle': 'Solving connection, battery, and socket issues'
      },
      {
        'icon': Icons.security_outlined,
        'title': 'Security & Credentials',
        'subtitle': 'Credential separation & zero-knowledge design'
      },
      {
        'icon': Icons.menu_book_outlined,
        'title': 'Documentation',
        'subtitle': 'Read complete docs at remotenode.net'
      },
    ];

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Help & Documentation',
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
                  // Support Hero Header
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    color: AppColors.primarySubtle.withValues(alpha: 0.5),
                    borderColor: AppColors.primary.withValues(alpha: 0.3),
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
                                'Support & Knowledge Base',
                                style: AppTypography.cardTitle,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Explore setup guides, node architecture, and troubleshooting for your personal file server.',
                          style: AppTypography.bodySmall
                              .copyWith(color: AppColors.textPrimary),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  const Text('Documentation Categories',
                      style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),

                  // Categories List
                  ...helpCategories.map((item) => Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: AppCard(
                          child: ListTile(
                            leading: Icon(item['icon'] as IconData,
                                color: AppColors.primary),
                            title: Text(item['title'] as String,
                                style: AppTypography.cardTitle),
                            subtitle: Text(item['subtitle'] as String,
                                style: AppTypography.caption),
                            trailing: const Icon(Icons.chevron_right,
                                size: 20, color: AppColors.textMuted),
                            onTap: () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                      '${item['title']}: Read full docs at $websiteUrl/docs.'),
                                ),
                              );
                            },
                          ),
                        ),
                      )),

                  const SizedBox(height: AppSpacing.lg),

                  // Troubleshooting Guide Card
                  const Text('Quick Troubleshooting',
                      style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  const AppCard(
                    padding: EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _TroubleItem(
                          title: 'Server Offline',
                          detail:
                              'Verify the Android app is active in foreground or disable OS battery optimization.',
                        ),
                        Divider(height: AppSpacing.lg),
                        _TroubleItem(
                          title: 'Gateway Disconnected',
                          detail:
                              'Check Wi-Fi or cellular internet connection to ensure outbound WebSocket relay.',
                        ),
                        Divider(height: AppSpacing.lg),
                        _TroubleItem(
                          title: 'File Access Issues',
                          detail:
                              'Confirm storage permissions are granted to RemoteNode on this Android host phone.',
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

class _TroubleItem extends StatelessWidget {
  final String title;
  final String detail;

  const _TroubleItem({required this.title, required this.detail});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.info_outline_rounded,
                size: 18, color: AppColors.primary),
            const SizedBox(width: AppSpacing.xs),
            Text(title,
                style:
                    AppTypography.body.copyWith(fontWeight: FontWeight.w600)),
          ],
        ),
        const SizedBox(height: AppSpacing.xxs),
        Text(detail, style: AppTypography.caption),
      ],
    );
  }
}

