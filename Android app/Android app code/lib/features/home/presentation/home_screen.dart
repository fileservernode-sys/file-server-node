import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/error_message.dart';
import '../../../core/widgets/loading_indicator.dart';
import '../../../core/widgets/status_badge.dart';
import '../../auth/application/auth_state.dart';
import '../../setup/application/setup_state.dart';

/// HomeScreen — Premium SaaS Control Plane & Personal File Server Control Center
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
    final auth = ref.watch(authStateProvider);

    final isConfigured = setup.deviceId != null ||
        setup.isLocalOnline ||
        setup.assignedSubdomain != null;
    final isOnline = setup.isLocalOnline;

    final displayName = setup.serverName.isNotEmpty
        ? setup.serverName
        : (setup.deviceName.isNotEmpty ? setup.deviceName : 'Android Phone Host');

    final userEmail = auth.session?.user.email ?? 'Account User';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppHeader(
        title: 'RemoteNode',
        subtitle: userEmail,
        showBrandMark: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_outlined, size: 20, color: AppColors.textSecondary),
            tooltip: 'Sync Server Status',
            onPressed: () {
              ref.read(setupStateProvider.notifier).syncWithBackend();
            },
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppSpacing.maxContentWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Page Header
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Control Center',
                              style: AppTypography.caption
                                  .copyWith(color: AppColors.primary, fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            const Text(
                              'Server Control Center',
                              style: AppTypography.pageTitle,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceSubtle,
                          borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
                          border: Border.all(color: AppColors.borderSubtle),
                        ),
                        child: Text(
                          '1 / 5 Server Slots',
                          style: AppTypography.caption.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Error Banner if present
                  if (setup.errorMessage != null) ...[
                    ErrorMessageBanner(
                      message: setup.errorMessage!,
                      onRetry: () => ref.read(setupStateProvider.notifier).syncWithBackend(),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                  ],

                  // Loading Skeleton State if syncing
                  if (setup.isProcessing) ...[
                    const SkeletonLoader(height: 180),
                    const SizedBox(height: AppSpacing.lg),
                    const Row(
                      children: [
                        Expanded(child: SkeletonLoader(height: 90)),
                        SizedBox(width: AppSpacing.md),
                        Expanded(child: SkeletonLoader(height: 90)),
                      ],
                    ),
                  ] else ...[
                    // Primary Host Device Card
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(AppSpacing.xs),
                                decoration: BoxDecoration(
                                  color: isOnline ? AppColors.statusOnlineBg : AppColors.surfaceSubtle,
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(
                                  Icons.phone_android,
                                  size: 24,
                                  color: isOnline ? AppColors.statusOnline : AppColors.textSecondary,
                                ),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      displayName,
                                      style: AppTypography.cardTitle,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 2),
                                    const Text(
                                      'Android Phone - Physical Storage Host',
                                      style: AppTypography.caption,
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
                          const SizedBox(height: AppSpacing.lg),

                          // Storage Host & Endpoint Description
                          Container(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceSubtle,
                              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                              border: Border.all(color: AppColors.borderSubtle),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.shield_outlined, size: 18, color: AppColors.primary),
                                const SizedBox(width: AppSpacing.xs),
                                Expanded(
                                  child: Text(
                                    isConfigured
                                        ? (isOnline
                                            ? 'Local Interface: ${setup.localServerUrl}'
                                            : 'Server configured on this Android host (Currently stopped).')
                                        : 'Turn this phone into your remotely accessible personal file server.',
                                    style: AppTypography.bodySmall,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: AppSpacing.xl),

                          // Primary Action CTA
                          if (!isConfigured)
                            PrimaryButton(
                              label: 'Set Up Server',
                              icon: Icons.dns_outlined,
                              onPressed: () {
                                Navigator.pushNamed(context, '/server/setup/device');
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
                    const SizedBox(height: AppSpacing.xl),

                    // Storage Capacity Summary Card
                    AppCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Expanded(
                                child: Row(
                                  children: [
                                    Icon(Icons.sd_storage_outlined, size: 20, color: AppColors.primary),
                                    SizedBox(width: AppSpacing.xs),
                                    Flexible(
                                      child: Text(
                                        'Host Storage Capacity',
                                        style: AppTypography.cardTitle,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: AppSpacing.xs),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppColors.primarySubtle,
                                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                                ),
                                child: Text(
                                  '64 GB Free',
                                  style: AppTypography.caption
                                      .copyWith(color: AppColors.primary, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          const Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text('0 GB used',
                                    style: AppTypography.bodySmall,
                                    overflow: TextOverflow.ellipsis),
                              ),
                              Text('64 GB total', style: AppTypography.caption),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
                            child: LinearProgressIndicator(
                              value: isOnline ? 0.15 : 0.0,
                              minHeight: 8.0,
                              backgroundColor: AppColors.surfaceSubtle,
                              valueColor: const AlwaysStoppedAnimation<Color>(AppColors.primary),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            'Your files remain stored physically on this Android phone host.',
                            style: AppTypography.caption.copyWith(color: AppColors.textMuted),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),

                    // Quick Overview 2x2 Grid
                    const Text('Infrastructure Overview', style: AppTypography.sectionTitle),
                    const SizedBox(height: AppSpacing.sm),

                    Row(
                      children: [
                        Expanded(
                          child: AppCard(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(Icons.phone_android_outlined, size: 20, color: AppColors.textSecondary),
                                const SizedBox(height: AppSpacing.xs),
                                const Text('Device Model', style: AppTypography.caption),
                                const SizedBox(height: AppSpacing.xxs),
                                Text(
                                  setup.deviceName,
                                  style: AppTypography.body.copyWith(fontWeight: FontWeight.w600),
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
                                const Icon(Icons.lan_outlined, size: 20, color: AppColors.textSecondary),
                                const SizedBox(height: AppSpacing.xs),
                                const Text('Local Port', style: AppTypography.caption),
                                const SizedBox(height: AppSpacing.xxs),
                                Text(
                                  isOnline ? 'Port 8080' : 'Idle',
                                  style: AppTypography.body.copyWith(fontWeight: FontWeight.w600),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),

                    Row(
                      children: [
                        Expanded(
                          child: AppCard(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(Icons.vpn_key_outlined, size: 20, color: AppColors.textSecondary),
                                const SizedBox(height: AppSpacing.xs),
                                const Text('Gateway Tunnel', style: AppTypography.caption),
                                const SizedBox(height: AppSpacing.xxs),
                                Text(
                                  setup.isGatewayConnected
                                      ? 'TLS 1.3 Active'
                                      : (setup.assignedSubdomain != null ? 'Assigned' : 'Local Only'),
                                  style: AppTypography.body.copyWith(fontWeight: FontWeight.w600),
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
                                const Icon(Icons.storage_outlined, size: 20, color: AppColors.textSecondary),
                                const SizedBox(height: AppSpacing.xs),
                                const Text('Server Capacity', style: AppTypography.caption),
                                const SizedBox(height: AppSpacing.xxs),
                                Text(
                                  '1 / 5 Limit',
                                  style: AppTypography.body.copyWith(fontWeight: FontWeight.w600),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
