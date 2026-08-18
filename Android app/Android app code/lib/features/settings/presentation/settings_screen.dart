import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_dialog.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';
import '../../auth/application/auth_state.dart';
import '../../setup/application/setup_state.dart';

/// Settings Screen — Commercial-Grade SaaS Infrastructure & Account Control Center
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider);
    final setupState = ref.watch(setupStateProvider);

    final userEmail = (authState.session?.user.email.isNotEmpty ?? false)
        ? authState.session!.user.email
        : (authState.pendingEmail ?? 'user@example.com');

    final deviceId = setupState.deviceId ?? 'RN-8080-NODE';
    final serverName = setupState.serverName.isNotEmpty
        ? setupState.serverName
        : 'Personal File Server';
    final deviceName = setupState.deviceName.isNotEmpty
        ? setupState.deviceName
        : 'Android Phone Host';

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
                  // -----------------------------------------------------------
                  // 1. Account Overview Card
                  // -----------------------------------------------------------
                  const Text('Account', style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const ContainerIconBg(
                              icon: Icons.account_circle_rounded,
                              color: AppColors.primary,
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text('Platform Account',
                                      style: AppTypography.cardTitle),
                                  Text(
                                    userEmail,
                                    style: AppTypography.bodySmall.copyWith(
                                        color: AppColors.textSecondary,
                                        fontWeight: FontWeight.w500),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: AppSpacing.xs),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: AppSpacing.xs, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppColors.statusOnlineBg,
                                borderRadius: BorderRadius.circular(4),
                                border:
                                    Border.all(color: AppColors.statusOnline),
                              ),
                              child: Text(
                                'VERIFIED',
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.statusOnline,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 10,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        const Divider(),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Managed via RemoteNode Control Plane. Passwords & 6-Digit OTP security active.',
                          style: AppTypography.caption
                              .copyWith(color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // -----------------------------------------------------------
                  // 2. Physical Device & Server Host Management
                  // -----------------------------------------------------------
                  const Text('Device & Server Infrastructure',
                      style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const ContainerIconBg(
                              icon: Icons.phone_android_rounded,
                              color: AppColors.primary,
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(deviceName,
                                      style: AppTypography.cardTitle,
                                      overflow: TextOverflow.ellipsis),
                                  const Text(
                                    'Physical Android Host Node',
                                    style: AppTypography.caption,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: AppSpacing.xs),
                            StatusBadge(
                              status: setupState.isGatewayConnected
                                  ? DeviceServerStatus.online
                                  : (setupState.isLocalOnline
                                      ? DeviceServerStatus.connecting
                                      : DeviceServerStatus.offline),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),
                        const Divider(),
                        const SizedBox(height: AppSpacing.md),
                        _InfoRow(
                            label: 'Server Instance', value: serverName),
                        const SizedBox(height: AppSpacing.xs),
                        _InfoRow(
                          label: 'Installation ID',
                          value: deviceId,
                          isMonospace: true,
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        const _InfoRow(
                          label: 'Server Capacity',
                          value: '1 / 5 Slots Used',
                        ),
                        const SizedBox(height: AppSpacing.md),
                        const Divider(),
                        _buildSettingTile(
                          icon: Icons.dns_outlined,
                          title: 'File Server Details & Status',
                          subtitle: 'View live telemetry & node controls',
                          onTap: () =>
                              Navigator.pushNamed(context, '/server/status'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // -----------------------------------------------------------
                  // 3. Privacy & Physical Storage Guarantee Card
                  // -----------------------------------------------------------
                  AppCard(
                    color: AppColors.primarySubtle.withValues(alpha: 0.4),
                    borderColor: AppColors.primary.withValues(alpha: 0.3),
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.shield_outlined,
                                color: AppColors.primary, size: 22),
                            SizedBox(width: AppSpacing.xs),
                            Expanded(
                              child: Text(
                                'Your files stay on your Android phone',
                                style: AppTypography.cardTitle,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'RemoteNode provides secure remote access to the physical storage host. Your personal files are not migrated into generic cloud storage.',
                          style: AppTypography.bodySmall
                              .copyWith(color: AppColors.textPrimary),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // -----------------------------------------------------------
                  // 4. Security & Session Section
                  // -----------------------------------------------------------
                  const Text('Security & Authentication',
                      style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    child: Column(
                      children: [
                        _buildSettingTile(
                          icon: Icons.lock_outline_rounded,
                          title: 'Authentication Protocol',
                          subtitle: 'Email + Password + 6-Digit OTP',
                          onTap: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                    'Multi-factor authentication active on account.'),
                              ),
                            );
                          },
                        ),
                        const Divider(),
                        _buildSettingTile(
                          icon: Icons.shield_outlined,
                          title: 'Registered Account Login',
                          subtitle:
                              'Account: ${setupState.fileServerUsername}',
                          onTap: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                    'File Manager login uses your registered platform account email and password.'),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // -----------------------------------------------------------
                  // 5. Support & Information
                  // -----------------------------------------------------------
                  const Text('Support & Information',
                      style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    child: Column(
                      children: [
                        _buildSettingTile(
                          icon: Icons.help_outline_rounded,
                          title: 'Help & Documentation',
                          subtitle: 'Setup guides and troubleshooting',
                          onTap: () => Navigator.pushNamed(context, '/help'),
                        ),
                        const Divider(),
                        _buildSettingTile(
                          icon: Icons.info_outline_rounded,
                          title: 'About Platform',
                          subtitle: 'Version and product architecture',
                          onTap: () => Navigator.pushNamed(context, '/about'),
                        ),
                        const Divider(),
                        _buildSettingTile(
                          icon: Icons.palette_outlined,
                          title: 'Design System Showcase',
                          subtitle: 'Visual component reference tokens',
                          onTap: () => Navigator.pushNamed(context, '/showcase'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // -----------------------------------------------------------
                  // 6. Sign Out Security Action
                  // -----------------------------------------------------------
                  AppCard(
                    child: _buildSettingTile(
                      icon: Icons.logout_rounded,
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
                  const SizedBox(height: AppSpacing.xl),
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

class ContainerIconBg extends StatelessWidget {
  final IconData icon;
  final Color color;
  const ContainerIconBg({super.key, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        shape: BoxShape.circle,
      ),
      child: Icon(icon, color: color, size: 20),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isMonospace;

  const _InfoRow({
    required this.label,
    required this.value,
    this.isMonospace = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTypography.caption),
        Flexible(
          child: Text(
            value,
            style: isMonospace
                ? AppTypography.caption.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  )
                : AppTypography.bodySmall
                    .copyWith(fontWeight: FontWeight.w600),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

