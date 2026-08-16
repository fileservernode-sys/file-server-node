import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';
import '../../setup/application/setup_state.dart';

/// Home Screen — Real-Time Connected Application Dashboard Screen
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(setupStateProvider.notifier).syncWithBackend();
    });
  }

  @override
  Widget build(BuildContext context) {
    final setup = ref.watch(setupStateProvider);
    final isConfigured = setup.deviceId != null ||
        setup.isLocalOnline ||
        setup.assignedSubdomain != null;
    final isOnline = setup.isLocalOnline;

    final displayName = setup.serverName.isNotEmpty
        ? setup.serverName
        : (setup.deviceName.isNotEmpty ? setup.deviceName : 'Android Phone Host');

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Personal File Server',
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
                  const Text('Dashboard', style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xxs),
                  const Text('Your Personal File Server',
                      style: AppTypography.pageTitle),
                  const SizedBox(height: AppSpacing.xl),

                  // Host Device Node Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              Icons.phone_android,
                              size: 28,
                              color: isOnline ? AppColors.primary : AppColors.textSecondary,
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Text(
                                displayName,
                                style: AppTypography.cardTitle,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            StatusBadge(
                              status: isOnline
                                  ? DeviceServerStatus.online
                                  : DeviceServerStatus.offline,
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Text(
                          isConfigured
                              ? (isOnline
                                  ? 'Active and serving files locally on ${setup.localServerUrl}'
                                  : 'Server configured on this device (Currently stopped).')
                              : 'Turn this phone into your personal file server.',
                          style: AppTypography.body,
                        ),
                        const SizedBox(height: AppSpacing.xl),
                        if (!isConfigured)
                          PrimaryButton(
                            label: 'Set Up Server',
                            icon: Icons.dns_outlined,
                            onPressed: () {
                              Navigator.pushNamed(
                                  context, '/server/setup/device');
                            },
                          )
                        else
                          PrimaryButton(
                            label: 'Manage Server',
                            icon: Icons.tune_rounded,
                            onPressed: () {
                              Navigator.pushNamed(context, '/server/status');
                            },
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // Quick Overview Grid
                  const Text('Quick Overview',
                      style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: [
                      Expanded(
                        child: AppCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.sd_storage_outlined,
                                  size: 22, color: AppColors.textSecondary),
                              const SizedBox(height: AppSpacing.xs),
                              const Text('Storage Interface', style: AppTypography.caption),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                isOnline ? '0.0.0.0:8080' : (isConfigured ? 'Port 8080' : 'Not configured'),
                                style: AppTypography.body.copyWith(fontWeight: FontWeight.w500),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.wifi_outlined,
                                  size: 22, color: AppColors.textSecondary),
                              const SizedBox(height: AppSpacing.xs),
                              const Text('Public Access', style: AppTypography.caption),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                setup.assignedSubdomain != null
                                    ? (setup.isGatewayConnected ? 'Connected' : 'Assigned')
                                    : (isConfigured ? 'Local Only' : 'Not connected'),
                                style: AppTypography.body.copyWith(fontWeight: FontWeight.w500),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppCard(
                    child: Row(
                      children: [
                        Icon(
                          Icons.power_settings_new_outlined,
                          size: 22,
                          color: isOnline ? AppColors.statusOnline : AppColors.textSecondary,
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Server State',
                                  style: AppTypography.caption),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                isOnline ? 'Online / Serving' : (isConfigured ? 'Offline / Idle' : 'Not running'),
                                style: AppTypography.body.copyWith(fontWeight: FontWeight.w500),
                              ),
                            ],
                          ),
                        ),
                        StatusBadge(
                          status: isOnline
                              ? DeviceServerStatus.online
                              : DeviceServerStatus.offline,
                        ),
                      ],
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
}
