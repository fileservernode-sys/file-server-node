import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/notifications/push_notification_service.dart';
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
  NotificationPreferences? _localPrefs;
  bool _isSaving = false;
  bool _hasChanges = false;
  bool? _isOsPermissionGranted;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(notificationPreferencesProvider.notifier).fetchPreferences();
      _checkOsPermission();
    });
  }

  Future<void> _checkOsPermission() async {
    final granted = await PushNotificationService.instance.checkNotificationPermission();
    if (mounted) {
      setState(() {
        _isOsPermissionGranted = granted;
      });
    }
  }

  void _initLocalCopy(NotificationPreferences serverPrefs) {
    if (_localPrefs == null || !_hasChanges) {
      _localPrefs = serverPrefs;
    }
  }

  Future<void> _savePreferences() async {
    if (_localPrefs == null || _isSaving) return;

    setState(() {
      _isSaving = true;
    });

    final success = await ref
        .read(notificationPreferencesProvider.notifier)
        .savePreferences(_localPrefs!);

    if (!mounted) return;

    setState(() {
      _isSaving = false;
      if (success) {
        _hasChanges = false;
      }
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          success
              ? 'Notification preferences saved successfully.'
              : 'Failed to save preferences. Your unsaved changes have been kept. Please retry.',
        ),
        backgroundColor: success ? AppColors.success : AppColors.error,
        duration: const Duration(seconds: 3),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final prefsState = ref.watch(notificationPreferencesProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppHeader(
        title: 'Notification Settings',
        showBackButton: true,
        actions: [
          if (_hasChanges)
            TextButton(
              onPressed: _isSaving ? null : _savePreferences,
              child: _isSaving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text(
                      'Save',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                    ),
            ),
        ],
      ),
      body: SafeArea(
        child: prefsState.when(
          loading: () => const Center(child: LoadingIndicator(message: 'Loading preferences...')),
          error: (err, stack) => Center(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error_outline, size: 48, color: AppColors.error),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'Failed to load notification preferences',
                    style: AppTypography.cardTitle,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    err.toString(),
                    style: AppTypography.caption,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  ElevatedButton(
                    onPressed: () => ref.read(notificationPreferencesProvider.notifier).fetchPreferences(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
          data: (serverPrefs) {
            _initLocalCopy(serverPrefs);
            return RefreshIndicator(
              onRefresh: () async {
                await ref.read(notificationPreferencesProvider.notifier).fetchPreferences();
                await _checkOsPermission();
                setState(() {
                  _hasChanges = false;
                  _localPrefs = null;
                });
              },
              child: _buildForm(context, _localPrefs ?? serverPrefs),
            );
          },
        ),
      ),
    );
  }

  Widget _buildForm(BuildContext context, NotificationPreferences prefs) {
    final isPermissionDenied = _isOsPermissionGranted == false;

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        // 1. Android OS Notification Permission Banner
        Container(
          padding: const EdgeInsets.all(AppSpacing.sm),
          decoration: BoxDecoration(
            color: isPermissionDenied ? const Color(0xFFFEF3C7) : const Color(0xFFEFF6FF),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isPermissionDenied ? const Color(0xFFFCD34D) : const Color(0xFFBFDBFE),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    isPermissionDenied ? Icons.notifications_off_outlined : Icons.notifications_active_outlined,
                    color: isPermissionDenied ? const Color(0xFF92400E) : const Color(0xFF1D4ED8),
                    size: 20,
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isPermissionDenied
                              ? 'Android Notification Permission Disabled'
                              : 'Android System Notification Permission',
                          style: AppTypography.cardTitle.copyWith(
                            color: isPermissionDenied ? const Color(0xFF92400E) : const Color(0xFF1D4ED8),
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          isPermissionDenied
                              ? 'System notification permission is currently off on this device. Push notifications cannot be delivered until enabled in your device settings.'
                              : 'Android system permission functions independently from account push preferences. Even when Push is enabled on your account, system permission is required to display alerts.',
                          style: AppTypography.caption.copyWith(
                            color: isPermissionDenied ? const Color(0xFF78350F) : const Color(0xFF1E40AF),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (isPermissionDenied)
                    TextButton.icon(
                      onPressed: () async {
                        await PushNotificationService.instance.requestNotificationPermission();
                        await _checkOsPermission();
                      },
                      icon: const Icon(Icons.check_circle_outline, size: 16),
                      label: const Text('Grant Permission', style: TextStyle(fontSize: 12)),
                      style: TextButton.styleFrom(
                        foregroundColor: const Color(0xFF92400E),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      ),
                    ),
                  TextButton.icon(
                    onPressed: () {
                      PushNotificationService.instance.openNotificationSettings();
                    },
                    icon: const Icon(Icons.settings, size: 16),
                    label: const Text('System Settings', style: TextStyle(fontSize: 12)),
                    style: TextButton.styleFrom(
                      foregroundColor: isPermissionDenied ? const Color(0xFF92400E) : const Color(0xFF1D4ED8),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.sm),

        // 2. Security Policy Disclaimer Banner
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
                      'Critical security notifications (login alerts, verification codes, device linking) are mandatory and cannot be disabled to protect your personal file servers.',
                      style: AppTypography.caption.copyWith(color: const Color(0xFF78350F)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),

        // 3. Global Delivery Channels
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Master Delivery Channels', style: AppTypography.cardTitle),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Global toggles apply across all configurable notification categories.',
                style: AppTypography.caption,
              ),
              const SizedBox(height: AppSpacing.sm),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Android Push Notifications'),
                subtitle: const Text('Deliver push alerts directly to paired Android devices'),
                value: prefs.globalPushEnabled,
                activeThumbColor: AppColors.primary,
                onChanged: _isSaving
                    ? null
                    : (val) {
                        setState(() {
                          _localPrefs = prefs.copyWith(globalPushEnabled: val);
                          _hasChanges = true;
                        });
                      },
              ),
              const Divider(height: 1),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Email Notifications'),
                subtitle: const Text('Deliver notification emails to your registered address'),
                value: prefs.globalEmailEnabled,
                activeThumbColor: AppColors.primary,
                onChanged: _isSaving
                    ? null
                    : (val) {
                        setState(() {
                          _localPrefs = prefs.copyWith(globalEmailEnabled: val);
                          _hasChanges = true;
                        });
                      },
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),

        // 4. Granular Category Preferences
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: AppSpacing.xs, vertical: AppSpacing.xs),
          child: Text('Notification Categories', style: AppTypography.cardTitle),
        ),

        // Category 1: ACCOUNT_SECURITY
        _buildCategoryCard(
          title: 'Account & Security',
          description: 'Sign-in alerts, device verification, password resets, and critical account activity.',
          categoryKey: 'ACCOUNT_SECURITY',
          item: prefs.getCategory('ACCOUNT_SECURITY'),
          isMandatory: true,
        ),
        const SizedBox(height: AppSpacing.sm),

        // Category 2: DEVICE_SERVER
        _buildCategoryCard(
          title: 'Servers & Devices',
          description: 'Server state changes, background host connectivity, node online/offline, and gateway tunnels.',
          categoryKey: 'DEVICE_SERVER',
          item: prefs.getCategory('DEVICE_SERVER'),
        ),
        const SizedBox(height: AppSpacing.sm),

        // Category 3: BILLING
        _buildCategoryCard(
          title: 'Billing & Subscriptions',
          description: 'Payment receipts, subscription renewals, plan changes, and invoices. (Statutory tax invoices are always emailed).',
          categoryKey: 'BILLING',
          item: prefs.getCategory('BILLING'),
        ),
        const SizedBox(height: AppSpacing.sm),

        // Category 4: STORAGE
        _buildCategoryCard(
          title: 'Storage & Capacity',
          description: 'Storage utilization warnings, low free disk thresholds, and volume recovery alerts.',
          categoryKey: 'STORAGE',
          item: prefs.getCategory('STORAGE'),
        ),
        const SizedBox(height: AppSpacing.sm),

        // Category 5: FILE_OPERATIONS
        _buildCategoryCard(
          title: 'File Operations',
          description: 'Upload completion, batch archive creation, folder transfers, and large transfer alerts.',
          categoryKey: 'FILE_OPERATIONS',
          item: prefs.getCategory('FILE_OPERATIONS'),
        ),
        const SizedBox(height: AppSpacing.sm),

        // Category 6: SYSTEM
        _buildCategoryCard(
          title: 'System Announcements',
          description: 'Maintenance schedules, platform status advisories, and system reliability alerts.',
          categoryKey: 'SYSTEM',
          item: prefs.getCategory('SYSTEM'),
        ),
        const SizedBox(height: AppSpacing.lg),

        // 5. Save Button
        ElevatedButton(
          onPressed: (_isSaving || !_hasChanges) ? null : _savePreferences,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          child: _isSaving
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Text(_hasChanges ? 'Save Notification Preferences' : 'Preferences Saved'),
        ),
        const SizedBox(height: AppSpacing.xl),
      ],
    );
  }

  Widget _buildCategoryCard({
    required String title,
    required String description,
    required String categoryKey,
    required CategoryPreferenceItem item,
    bool isMandatory = false,
  }) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(title, style: AppTypography.cardTitle),
                        if (isMandatory) ...[
                          const SizedBox(width: AppSpacing.xs),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFEF3C7),
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(color: const Color(0xFFFCD34D)),
                            ),
                            child: const Text(
                              'Mandatory',
                              style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF92400E)),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(description, style: AppTypography.caption),
                  ],
                ),
              ),
              Switch(
                value: isMandatory ? true : item.enabled,
                activeThumbColor: AppColors.primary,
                onChanged: (isMandatory || _isSaving)
                    ? null
                    : (val) {
                        _updateCategoryItem(categoryKey, item.copyWith(enabled: val));
                      },
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          const Divider(height: 1),
          const SizedBox(height: AppSpacing.xs),
          // Channel toggles row
          Row(
            children: [
              // In-App Channel
              Expanded(
                child: CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text('In-App', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
                  value: isMandatory ? true : item.inApp,
                  onChanged: (isMandatory || _isSaving || !item.enabled)
                      ? null
                      : (val) {
                          _updateCategoryItem(categoryKey, item.copyWith(inApp: val ?? true));
                        },
                  controlAffinity: ListTileControlAffinity.leading,
                ),
              ),
              // Push Channel
              Expanded(
                child: CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text('Push', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
                  value: item.push,
                  onChanged: (_isSaving || (!isMandatory && !item.enabled))
                      ? null
                      : (val) {
                          _updateCategoryItem(categoryKey, item.copyWith(push: val ?? true));
                        },
                  controlAffinity: ListTileControlAffinity.leading,
                ),
              ),
              // Email Channel
              Expanded(
                child: CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text('Email', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
                  value: isMandatory ? true : item.email,
                  onChanged: (isMandatory || _isSaving || !item.enabled)
                      ? null
                      : (val) {
                          _updateCategoryItem(categoryKey, item.copyWith(email: val ?? false));
                        },
                  controlAffinity: ListTileControlAffinity.leading,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _updateCategoryItem(String key, CategoryPreferenceItem updatedItem) {
    if (_localPrefs == null) return;

    final updatedMap = Map<String, CategoryPreferenceItem>.from(_localPrefs!.categories);
    updatedMap[key] = updatedItem;

    // Preserve mandatory security policy invariant:
    if (key == 'ACCOUNT_SECURITY') {
      updatedMap[key] = updatedItem.copyWith(enabled: true, inApp: true, email: true);
    }

    setState(() {
      _localPrefs = _localPrefs!.copyWith(categories: updatedMap);
      _hasChanges = true;
    });
  }
}
