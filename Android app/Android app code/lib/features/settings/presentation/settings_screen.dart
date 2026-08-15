import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_dialog.dart';
import '../../../core/widgets/app_header.dart';

/// Settings Screen — Centralized App Preferences Foundation
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Settings',
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
                  // Account Settings
                  const Text('Account', style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    child: Column(
                      children: [
                        _buildSettingTile(
                          icon: Icons.account_circle_outlined,
                          title: 'Platform Account',
                          subtitle: 'View website account details',
                          onTap: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content: Text(
                                      'Account settings managed on https://remotenode.net.')),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Server Settings
                  const Text('Server Node', style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    child: Column(
                      children: [
                        _buildSettingTile(
                          icon: Icons.dns_outlined,
                          title: 'File Server Configuration',
                          subtitle: 'Manage local host properties',
                          onTap: () =>
                              Navigator.pushNamed(context, '/server/status'),
                        ),
                        const Divider(),
                        _buildSettingTile(
                          icon: Icons.vpn_key_outlined,
                          title: 'File-Server Credentials',
                          subtitle: 'Credentials for phone file web manager',
                          onTap: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content: Text(
                                      'Re-configure credentials in Server Setup.')),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Support & Information
                  const Text('Support & Information',
                      style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    child: Column(
                      children: [
                        _buildSettingTile(
                          icon: Icons.help_outline,
                          title: 'Help & Documentation',
                          subtitle: 'Setup guides and troubleshooting',
                          onTap: () => Navigator.pushNamed(context, '/help'),
                        ),
                        const Divider(),
                        _buildSettingTile(
                          icon: Icons.info_outline,
                          title: 'About Platform',
                          subtitle: 'Version and product details',
                          onTap: () => Navigator.pushNamed(context, '/about'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Sign Out Placeholder
                  AppCard(
                    child: _buildSettingTile(
                      icon: Icons.logout,
                      title: 'Sign Out',
                      subtitle: 'Sign out of Android control application',
                      titleColor: AppColors.statusError,
                      onTap: () {
                        AppDialog.show(
                          context: context,
                          title: 'Sign Out',
                          message:
                              'Are you sure you want to sign out of the control app?',
                          primaryActionLabel: 'Sign Out',
                          isDestructive: true,
                          onPrimaryAction: () {
                            Navigator.pushReplacementNamed(context, '/auth');
                          },
                          secondaryActionLabel: 'Cancel',
                        );
                      },
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

  Widget _buildSettingTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    Color titleColor = AppColors.textPrimary,
  }) {
    return ListTile(
      leading: Icon(icon, color: titleColor),
      title: Text(title,
          style: AppTypography.body
              .copyWith(color: titleColor, fontWeight: FontWeight.w500)),
      subtitle: Text(subtitle, style: AppTypography.caption),
      trailing:
          const Icon(Icons.chevron_right, size: 20, color: AppColors.textMuted),
      onTap: onTap,
    );
  }
}
