import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/loading_indicator.dart';
import '../domain/models/notification_preferences.dart';
import '../providers/notification_provider.dart';

class NotificationPreferencesScreen extends ConsumerStatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  ConsumerState<NotificationPreferencesScreen> createState() => _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState extends ConsumerState<NotificationPreferencesScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(notificationPreferencesProvider.notifier).fetchPreferences();
    });
  }

  @override
  Widget build(BuildContext context) {
    final prefsState = ref.watch(notificationPreferencesProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Notification Settings',
        showBackButton: true,
      ),
      body: SafeArea(
        child: prefsState.when(
          loading: () => const Center(child: LoadingIndicator(message: 'Loading preferences...')),
          error: (err, stack) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('Failed to load notification preferences'),
                ElevatedButton(
                  onPressed: () => ref.read(notificationPreferencesProvider.notifier).fetchPreferences(),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
          data: (prefs) => _buildForm(context, prefs),
        ),
      ),
    );
  }

  Widget _buildForm(BuildContext context, NotificationPreferences prefs) {
    final notifier = ref.read(notificationPreferencesProvider.notifier);

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        // Security Policy Disclaimer Banner
        Container(
          padding: const EdgeInsets.all(AppSpacing.sm),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF3C7),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: const Color(0xFFFCD34D)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.security, color: Color(0xFF92400E), size: 20),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Mandatory Security Alert Policy',
                      style: AppTypography.cardTitle.copyWith(color: const Color(0xFF92400E), fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Critical security notifications (login alerts, verification codes, device linking) bypass user preference toggles to maintain account and file server security.',
                      style: AppTypography.caption.copyWith(color: const Color(0xFF78350F)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),

        // Global Delivery Channels
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Delivery Channels', style: AppTypography.cardTitle),
              const SizedBox(height: AppSpacing.sm),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Android Push Notifications'),
                subtitle: const Text('Deliver push alerts directly to this phone'),
                value: prefs.globalPushEnabled,
                activeThumbColor: AppColors.primary,
                onChanged: (val) {
                  notifier.updatePreferences(globalPushEnabled: val);
                },
              ),
              const Divider(height: 1),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Email Notifications'),
                subtitle: const Text('Receive summary email notifications'),
                value: prefs.globalEmailEnabled,
                activeThumbColor: AppColors.primary,
                onChanged: (val) {
                  notifier.updatePreferences(globalEmailEnabled: val);
                },
              ),
            ],
          ),
        ),
      ],
    );
  }
}
