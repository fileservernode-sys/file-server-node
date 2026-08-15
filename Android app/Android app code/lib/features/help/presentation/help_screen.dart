import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';

/// Help & Documentation Screen — Provides conceptual guide categories
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
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
        'title': 'File Storage',
        'subtitle': 'Managing internal storage and permissions'
      },
      {
        'icon': Icons.wifi_outlined,
        'title': 'Remote Access',
        'subtitle': 'Accessing your files securely over HTTPS'
      },
      {
        'icon': Icons.build_outlined,
        'title': 'Troubleshooting',
        'subtitle': 'Solving common connection and battery issues'
      },
      {
        'icon': Icons.security_outlined,
        'title': 'Security & Privacy',
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
            child: ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: helpCategories.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, index) {
                final item = helpCategories[index];
                return AppCard(
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
                                '${item['title']}: Read docs at https://remotenode.net/docs.')),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}
