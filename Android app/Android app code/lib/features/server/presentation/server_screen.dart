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

/// Server Screen — Manages the Android Server Host Node with state recovery on restart
class ServerScreen extends ConsumerStatefulWidget {
  final bool isConfiguredMock;

  const ServerScreen({
    super.key,
    this.isConfiguredMock = false,
  });

  @override
  ConsumerState<ServerScreen> createState() => _ServerScreenState();
}

class _ServerScreenState extends ConsumerState<ServerScreen> {
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
    final isConfigured = widget.isConfiguredMock ||
        setup.deviceId != null ||
        setup.isLocalOnline ||
        setup.assignedSubdomain != null;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppHeader(
        title: 'Server Control',
        showBrandMark: true,
        subtitle: isConfigured
            ? (setup.isLocalOnline ? 'Node Online' : 'Node Stopped')
            : 'Unconfigured Node',
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
                  if (!isConfigured) ...[
                    // Unconfigured State
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(AppSpacing.sm),
                                decoration: BoxDecoration(
                                  color: AppColors.surfaceSubtle,
                                  borderRadius:
                                      BorderRadius.circular(AppSpacing.radiusMd),
                                ),
                                child: const Icon(
                                  Icons.dns_outlined,
                                  size: 28,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              const Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Your File Server',
                                        style: AppTypography.cardTitle),
                                    SizedBox(height: AppSpacing.xxs),
                                    Text('Not configured on this device',
                                        style: AppTypography.bodySmall),
                                  ],
                                ),
                              ),
                              const StatusBadge(
                                  status: DeviceServerStatus.offline),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          const Text(
                            'This phone has not been configured as a personal file server yet. Set up your node to enable local file hosting and encrypted remote access.',
                            style: AppTypography.body,
                          ),
                          const SizedBox(height: AppSpacing.xl),
                          PrimaryButton(
                            label: 'Set Up Server',
                            icon: Icons.add_circle_outline,
                            onPressed: () {
                              Navigator.pushNamed(
                                  context, '/server/setup/device');
                            },
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    // Configured Active State Hero Card
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(AppSpacing.sm),
                                decoration: BoxDecoration(
                                  color: AppColors.primarySubtle,
                                  borderRadius:
                                      BorderRadius.circular(AppSpacing.radiusMd),
                                ),
                                child: const Icon(
                                  Icons.dns_rounded,
                                  size: 28,
                                  color: AppColors.primary,
                                ),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      setup.serverName.isNotEmpty
                                          ? setup.serverName
                                          : setup.deviceName,
                                      style: AppTypography.cardTitle,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: AppSpacing.xxs),
                                    Text(
                                      'Android Phone Host • Node ID: ${setup.deviceId ?? 'inst-local-node'}',
                                      style: AppTypography.caption.copyWith(
                                        fontFamily: 'monospace',
                                        color: AppColors.textSecondary,
                                      ),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: AppSpacing.xs),
                              StatusBadge(
                                status: setup.isLocalOnline
                                    ? DeviceServerStatus.online
                                    : DeviceServerStatus.offline,
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.md),
                          const Divider(),
                          const SizedBox(height: AppSpacing.sm),
                          Row(
                            children: [
                              const Icon(Icons.language_rounded,
                                  size: 16, color: AppColors.primary),
                              const SizedBox(width: AppSpacing.xs),
                              Expanded(
                                child: Text(
                                  setup.assignedSubdomain != null
                                      ? '${setup.assignedSubdomain}.remotenode.net'
                                      : 'Remote Gateway Routing Active',
                                  style: AppTypography.caption.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.primary,
                                    fontFamily: 'monospace',
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          PrimaryButton(
                            label: 'View Server Details',
                            icon: Icons.tune_rounded,
                            onPressed: () {
                              Navigator.pushNamed(context, '/server/status');
                            },
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Gateway Outbound Tunnel Telemetry Card
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Expanded(
                                child: Row(
                                  children: [
                                    Icon(Icons.hub_outlined,
                                        size: 20, color: AppColors.primary),
                                    SizedBox(width: AppSpacing.xs),
                                    Flexible(
                                      child: Text(
                                        'Outbound Gateway Relay',
                                        style: AppTypography.cardTitle,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: AppSpacing.xs),
                              StatusBadge(
                                status: setup.isGatewayConnected
                                    ? DeviceServerStatus.online
                                    : DeviceServerStatus.offline,
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            setup.isGatewayConnected
                                ? 'Encrypted WebSocket tunnel active. Remote file manager is accessible via your secure account subdomain.'
                                : 'Gateway connection inactive. Start the local server engine to establish remote transport.',
                            style: AppTypography.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Local Storage Protection Banner
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      color: AppColors.surfaceSubtle,
                      borderColor: AppColors.borderSubtle,
                      child: Row(
                        children: [
                          const Icon(Icons.shield_outlined,
                              size: 24, color: AppColors.primary),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Physical Storage Host',
                                  style: AppTypography.bodySmall.copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                const SizedBox(height: AppSpacing.xxs),
                                const Text(
                                  'Your files remain stored physically on this Android phone host. No cloud storage migration occurs.',
                                  style: AppTypography.caption,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
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
