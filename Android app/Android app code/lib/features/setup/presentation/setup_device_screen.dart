import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../application/setup_state.dart';
import 'widgets/setup_stepper.dart';

enum ReadinessStatus { ready, recommended, required, blocked, checking }

/// Step 1 — Device Preparation & Dynamic Readiness Checklist Screen
class SetupDeviceScreen extends ConsumerStatefulWidget {
  const SetupDeviceScreen({super.key});

  @override
  ConsumerState<SetupDeviceScreen> createState() => _SetupDeviceScreenState();
}

class _SetupDeviceScreenState extends ConsumerState<SetupDeviceScreen>
    with WidgetsBindingObserver {
  bool _isChecking = true;
  String _deviceModel = 'Android Device';
  bool _isStorageSufficient = true;
  bool _isStorageLow = false;
  String _formattedAvailableStorage = '';
  bool _isCharging = true;
  int _batteryLevel = 100;
  bool _isNotificationGranted = true;
  bool _isBatteryOptimizationIgnored = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkDeviceReadiness();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkDeviceReadiness();
    }
  }

  Future<void> _checkDeviceReadiness() async {
    final service = ref.read(serverServiceProvider);
    setState(() => _isChecking = true);

    try {
      final model = await service.getDeviceModel();
      final storage = await service.getStorageReadiness();
      final power = await service.getPowerReadiness();
      final notifGranted = await service.isNotificationPermissionGranted();
      final batteryIgnored = await service.isBatteryOptimizationIgnored();

      if (mounted) {
        setState(() {
          _deviceModel = model;
          _isStorageSufficient = storage['isSufficient'] as bool? ?? true;
          _isStorageLow = storage['isLow'] as bool? ?? false;
          _formattedAvailableStorage = storage['formattedAvailable'] as String? ?? 'Available';
          _isCharging = power['isCharging'] as bool? ?? true;
          _batteryLevel = power['batteryLevel'] as int? ?? 100;
          _isNotificationGranted = notifGranted;
          _isBatteryOptimizationIgnored = batteryIgnored;
          _isChecking = false;
        });

        // Update SetupState deviceName if not customized yet
        final currentSetup = ref.read(setupStateProvider);
        if (currentSetup.deviceName.isEmpty || currentSetup.deviceName == 'Android Device') {
          ref.read(setupStateProvider.notifier).setConfiguration(
                serverName: currentSetup.serverName,
                deviceName: model,
                description: currentSetup.description,
              );
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isChecking = false);
      }
    }
  }

  Future<void> _handleRequestNotificationPermission() async {
    final service = ref.read(serverServiceProvider);
    await service.requestNotificationPermission();
    await _checkDeviceReadiness();
  }

  Future<void> _handleConfigureBattery() async {
    final service = ref.read(serverServiceProvider);
    await service.requestIgnoreBatteryOptimization();
    await _checkDeviceReadiness();
  }

  void _handleContinue() {
    if (!_isNotificationGranted) {
      // Show explanation dialog if notification permission is still missing
      showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppColors.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
          ),
          title: const Row(
            children: [
              Icon(Icons.notifications_active_outlined, color: AppColors.primary, size: 24),
              SizedBox(width: AppSpacing.xs),
              Flexible(
                child: Text('Enable Server Notifications',
                    style: AppTypography.cardTitle,
                    overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          content: const Text(
            'RemoteNode keeps your personal file server running in the background. Android requires RemoteNode to maintain a visible server notification while the server is active.',
            style: AppTypography.bodySmall,
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                Navigator.pushNamed(context, '/server/setup/configuration');
              },
              child: const Text('Skip for Now', style: TextStyle(color: AppColors.textSecondary)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
              ),
              onPressed: () async {
                Navigator.pop(ctx);
                await _handleRequestNotificationPermission();
                if (mounted) {
                  Navigator.pushNamed(context, '/server/setup/configuration');
                }
              },
              child: const Text('Allow Notifications'),
            ),
          ],
        ),
      );
    } else {
      Navigator.pushNamed(context, '/server/setup/configuration');
    }
  }

  @override
  Widget build(BuildContext context) {
    final setup = ref.watch(setupStateProvider);
    final isAlreadyConfigured = setup.deviceId != null ||
        setup.isLocalOnline ||
        setup.assignedSubdomain != null;

    final storageStatus = !_isStorageSufficient
        ? ReadinessStatus.blocked
        : (_isStorageLow ? ReadinessStatus.recommended : ReadinessStatus.ready);

    final powerStatus = _isCharging ? ReadinessStatus.ready : ReadinessStatus.recommended;
    final notifStatus = _isNotificationGranted ? ReadinessStatus.ready : ReadinessStatus.required;
    final batteryStatus = _isBatteryOptimizationIgnored ? ReadinessStatus.ready : ReadinessStatus.recommended;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Server Setup Wizard',
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
                  const SetupStepper(
                    currentStep: 1,
                    totalSteps: 3,
                    stepTitle: 'Prepare Device',
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  if (isAlreadyConfigured) ...[
                    AppCard(
                      color: AppColors.statusOnlineBg,
                      borderColor: AppColors.statusOnline,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.check_circle_rounded,
                                  color: AppColors.statusOnline, size: 22),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Text('Server Already Configured',
                                    style: AppTypography.cardTitle
                                        .copyWith(color: AppColors.statusOnline)),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text(
                            'Each mobile device can host exactly 1 personal server. A server (${setup.serverName.isNotEmpty ? setup.serverName : setup.deviceName}) is already configured on this phone.',
                            style: AppTypography.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                  ],

                  const Text(
                    'This phone will become your personal file server.',
                    style: AppTypography.pageTitle,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  const Text(
                    'Your files remain stored directly on this Android device. The application will host a private local web server.',
                    style: AppTypography.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Physical Device Storage Host Callout Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    color: AppColors.primarySubtle.withValues(alpha: 0.5),
                    borderColor: AppColors.primary.withValues(alpha: 0.3),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.phone_android_rounded,
                                size: 24, color: AppColors.primary),
                            SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Text('Physical Storage Host',
                                  style: AppTypography.cardTitle),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Host Device: $_deviceModel',
                          style: AppTypography.bodySmall
                              .copyWith(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: AppSpacing.xxs),
                        const Text(
                          'Your files remain stored physically on this phone. RemoteNode provides secure remote access without moving files to cloud storage.',
                          style: AppTypography.caption,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // -----------------------------------------------------------
                  // Dynamic Readiness Checklist Card
                  // -----------------------------------------------------------
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Device Readiness Checklist',
                                style: AppTypography.cardTitle),
                            if (_isChecking)
                              const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            else
                              IconButton(
                                icon: const Icon(Icons.refresh_rounded, size: 20),
                                onPressed: _checkDeviceReadiness,
                                tooltip: 'Recheck device readiness',
                              ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),

                        // 1. Device Available
                        _DynamicChecklistTile(
                          status: ReadinessStatus.ready,
                          title: 'Android device available',
                          subtitle: 'Host Model: $_deviceModel',
                        ),
                        const Divider(height: AppSpacing.lg),

                        // 2. Device Storage
                        _DynamicChecklistTile(
                          status: storageStatus,
                          title: 'Device storage',
                          subtitle: !_isStorageSufficient
                              ? 'Insufficient storage to operate server (<100MB)'
                              : (_isStorageLow
                                  ? 'Storage is low ($_formattedAvailableStorage free)'
                                  : 'Sufficient storage ($_formattedAvailableStorage free)'),
                        ),
                        const Divider(height: AppSpacing.lg),

                        // 3. Power / Charging
                        _DynamicChecklistTile(
                          status: powerStatus,
                          title: 'Power & battery',
                          subtitle: _isCharging
                              ? 'Device is connected to power ($_batteryLevel%)'
                              : 'Running on battery ($_batteryLevel%) • Keep plugged in for 24/7 uptime',
                        ),
                        const Divider(height: AppSpacing.lg),

                        // 4. Server Notifications (Runtime Permission)
                        _DynamicChecklistTile(
                          status: notifStatus,
                          title: 'Server notifications',
                          subtitle: _isNotificationGranted
                              ? 'Server notifications enabled'
                              : 'Notification permission required for background hosting',
                          actionLabel: !_isNotificationGranted ? 'Enable' : null,
                          onAction: !_isNotificationGranted
                              ? _handleRequestNotificationPermission
                              : null,
                        ),
                        const Divider(height: AppSpacing.lg),

                        // 5. Background Operation (System Settings)
                        _DynamicChecklistTile(
                          status: batteryStatus,
                          title: 'Background operation',
                          subtitle: _isBatteryOptimizationIgnored
                              ? 'Battery optimization configured for RemoteNode'
                              : 'Battery optimization active • Unrestricted recommended',
                          actionLabel: !_isBatteryOptimizationIgnored ? 'Configure' : null,
                          onAction: !_isBatteryOptimizationIgnored
                              ? _handleConfigureBattery
                              : null,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  if (!isAlreadyConfigured)
                    PrimaryButton(
                      label: 'Continue',
                      icon: Icons.arrow_forward_rounded,
                      onPressed: !_isStorageSufficient ? null : _handleContinue,
                    )
                  else
                    PrimaryButton(
                      label: 'View Active Server Status',
                      icon: Icons.dashboard_outlined,
                      onPressed: () {
                        Navigator.pushNamedAndRemoveUntil(
                            context, '/server/status', (r) => false);
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

class _DynamicChecklistTile extends StatelessWidget {
  final ReadinessStatus status;
  final String title;
  final String subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _DynamicChecklistTile({
    required this.status,
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    Widget icon;
    Color statusColor;

    switch (status) {
      case ReadinessStatus.ready:
        icon = const Icon(Icons.check_circle_rounded, color: AppColors.statusOnline, size: 22);
        statusColor = AppColors.statusOnline;
        break;
      case ReadinessStatus.recommended:
        icon = const Icon(Icons.info_outline_rounded, color: AppColors.statusConnecting, size: 22);
        statusColor = AppColors.statusConnecting;
        break;
      case ReadinessStatus.required:
      case ReadinessStatus.blocked:
        icon = const Icon(Icons.warning_amber_rounded, color: AppColors.statusError, size: 22);
        statusColor = AppColors.statusError;
        break;
      case ReadinessStatus.checking:
        icon = const SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(strokeWidth: 2),
        );
        statusColor = AppColors.textMuted;
        break;
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: icon,
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: AppTypography.body.copyWith(fontWeight: FontWeight.w600)),
              const SizedBox(height: AppSpacing.xxs),
              Text(subtitle,
                  style: AppTypography.caption.copyWith(
                    color: status == ReadinessStatus.required || status == ReadinessStatus.blocked
                        ? statusColor
                        : AppColors.textSecondary,
                  )),
            ],
          ),
        ),
        if (actionLabel != null && onAction != null) ...[
          const SizedBox(width: AppSpacing.xs),
          TextButton(
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 4),
              minimumSize: const Size(60, 36),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            onPressed: onAction,
            child: Text(
              actionLabel!,
              style: const TextStyle(
                color: AppColors.primary,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ],
    );
  }
}
