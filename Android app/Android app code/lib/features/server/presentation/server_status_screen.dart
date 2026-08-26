import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/logger.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';
import '../../setup/application/setup_state.dart';

/// Server Status Detail Screen — Displays local HTTP file server engine state, public subdomain endpoint, and control triggers
class ServerStatusScreen extends ConsumerStatefulWidget {
  final DeviceServerStatus mockStatus;

  const ServerStatusScreen({
    super.key,
    this.mockStatus = DeviceServerStatus.online,
  });

  @override
  ConsumerState<ServerStatusScreen> createState() => _ServerStatusScreenState();
}

class _ServerStatusScreenState extends ConsumerState<ServerStatusScreen> {
  bool _isLocalRunning = true;
  bool _isServiceRunning = true;
  bool _isBatteryIgnored = true;
  String _localUrl = 'http://127.0.0.1:8080';
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _refreshServerStatus();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(setupStateProvider.notifier).syncWithBackend();
    });
  }

  Future<void> _refreshServerStatus() async {
    final service = ref.read(serverServiceProvider);
    final status = await service.getServerStatus();
    final url = await service.getLocalUrl();
    final serviceRunning = await service.isServiceRunning();
    final batteryIgnored = await service.isBatteryOptimizationIgnored();

    if (mounted) {
      setState(() {
        _isLocalRunning = status['status'] == 'ONLINE' || serviceRunning;
        _isServiceRunning = serviceRunning;
        _isBatteryIgnored = batteryIgnored;
        _localUrl = url;
      });
    }
  }

  Future<void> _handleStart() async {
    AppLogger.info('[ServerControl] START SERVER triggered');
    final service = ref.read(serverServiceProvider);
    final hasNotificationPerm = await service.isNotificationPermissionGranted();

    if (!hasNotificationPerm && mounted) {
      final proceed = await showDialog<bool>(
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
                child: Text('Enable Notification',
                    style: AppTypography.cardTitle,
                    overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          content: const Text(
            'RemoteNode uses a persistent notification to show that your personal file server is running and ensure continuous background hosting.',
            style: AppTypography.bodySmall,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Not Now', style: TextStyle(color: AppColors.textSecondary)),
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
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Continue'),
            ),
          ],
        ),
      );

      if (proceed == true) {
        await service.requestNotificationPermission();
      }
    }

    setState(() => _isLoading = true);
    await ref.read(setupStateProvider.notifier).startServerNode();
    await _refreshServerStatus();
    if (mounted) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('File server & background persistent service started.')),
      );
    }
  }

  Future<void> _handleRestart() async {
    AppLogger.info('[ServerControl] RESTART SERVER triggered');
    setState(() => _isLoading = true);
    await ref.read(setupStateProvider.notifier).stopServerNode();
    await Future.delayed(const Duration(milliseconds: 500));
    await ref.read(setupStateProvider.notifier).startServerNode();
    await _refreshServerStatus();
    if (mounted) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('File server & background service restarted.')),
      );
    }
  }

  Future<void> _handleStop() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        ),
        title: const Row(
          children: [
            Icon(Icons.pause_circle_outline, color: AppColors.textSecondary, size: 24),
            SizedBox(width: AppSpacing.xs),
            Flexible(
              child: Text('Stop Local Server?',
                  style: AppTypography.cardTitle,
                  overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
        content: const Text(
          'Stopping the server will temporarily disable local file hosting, background service, and remote access.\n\n'
          'Your files remain safe on this phone. You can restart the server engine at any time.',
          style: AppTypography.bodySmall,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.textPrimary,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Stop Server'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    AppLogger.info('[ServerControl] STOP SERVER triggered');
    setState(() => _isLoading = true);
    await ref.read(setupStateProvider.notifier).stopServerNode();
    await _refreshServerStatus();
    if (mounted) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('File server & background service stopped.')),
      );
    }
  }

  Future<void> _handleDeleteServer() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        ),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded,
                color: AppColors.statusError, size: 24),
            SizedBox(width: AppSpacing.xs),
            Flexible(
              child: Text('Delete Server Node?',
                  style: AppTypography.cardTitle,
                  overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
        content: const Text(
          'Are you sure you want to permanently delete this file server?\n\n'
          'This will stop the local server engine, remove your allocated subdomain, '
          'and delete all server records from the database. Your physical files remain safe on this phone.',
          style: AppTypography.bodySmall,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusError,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete Server'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() => _isLoading = true);
    await ref.read(setupStateProvider.notifier).deleteServer();
    if (mounted) {
      setState(() => _isLoading = false);
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final setup = ref.watch(setupStateProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Server Node Details',
        subtitle: 'Node Telemetry & Control',
        showBrandMark: true,
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
                  // 1. Remote Access Gateway Card
                  // -----------------------------------------------------------
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
                                  Icon(Icons.public_rounded,
                                      color: AppColors.primary, size: 22),
                                  SizedBox(width: AppSpacing.xs),
                                  Flexible(
                                    child: Text('Access Your Server',
                                        style: AppTypography.cardTitle,
                                        overflow: TextOverflow.ellipsis),
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
                        const Text(
                          'Your server is running and active. Visit the RemoteNode website to access your file manager and manage storage.',
                          style: AppTypography.bodySmall,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        PrimaryButton(
                          label: 'Open RemoteNode',
                          icon: Icons.open_in_browser_rounded,
                          onPressed: () async {
                            final serverService = ref.read(serverServiceProvider);
                            await serverService.openUrl(AppConfig.current.websiteUrl);
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // -----------------------------------------------------------
                  // 2. Battery Optimization Guidance Banner (if not ignored)
                  // -----------------------------------------------------------
                  if (!_isBatteryIgnored) ...[
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      color: AppColors.surfaceSubtle,
                      borderColor: AppColors.statusConnecting,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.battery_alert_rounded,
                                  size: 22, color: AppColors.statusConnecting),
                              SizedBox(width: AppSpacing.xs),
                              Flexible(
                                child: Text(
                                  'Background Optimization Active',
                                  style: AppTypography.cardTitle,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          const Text(
                            'For a phone used as a personal file server, Android battery optimization may restrict background operation. Allow unrestricted battery use for uninterrupted hosting.',
                            style: AppTypography.caption,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          SecondaryButton(
                            label: 'Configure Battery Settings',
                            icon: Icons.battery_saver_rounded,
                            onPressed: () async {
                              final serverService = ref.read(serverServiceProvider);
                              await serverService.requestIgnoreBatteryOptimization();
                              await _refreshServerStatus();
                            },
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                  ],

                  // -----------------------------------------------------------
                  // 3. Local Node & Persistent Service Status Card
                  // -----------------------------------------------------------
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
                                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                              ),
                              child: const Icon(Icons.dns_rounded,
                                  size: 28, color: AppColors.primary),
                            ),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    setup.deviceName.isNotEmpty
                                        ? setup.deviceName
                                        : 'Personal File Server',
                                    style: AppTypography.cardTitle,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  const SizedBox(height: AppSpacing.xxs),
                                  Text(
                                    'Node ID: ${setup.deviceId ?? 'inst-local-node-01'}',
                                    style: AppTypography.caption
                                        .copyWith(fontFamily: 'monospace'),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: AppSpacing.xs),
                            StatusBadge(
                              status: _isLocalRunning
                                  ? DeviceServerStatus.online
                                  : DeviceServerStatus.offline,
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        const Divider(),
                        const SizedBox(height: AppSpacing.md),
                        _StatusRow(
                          label: 'Server Name',
                          value: setup.serverName.isNotEmpty
                              ? setup.serverName
                              : 'Personal File Server',
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Device Host',
                          value: setup.deviceName.isNotEmpty
                              ? setup.deviceName
                              : 'Android Device',
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Local Engine Status',
                          value: _isLocalRunning ? 'ONLINE' : 'STOPPED',
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Persistent Foreground Service',
                          value: _isServiceRunning ? 'ACTIVE' : 'INACTIVE',
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Local Server URL',
                          value: _localUrl,
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Remote Gateway Access',
                          value: setup.isGatewayConnected
                              ? 'CONNECTED'
                              : 'DISCONNECTED',
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Gateway Status',
                          value: setup.endpointStatus,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // -----------------------------------------------------------
                  // 4. Node Management Operations
                  // -----------------------------------------------------------
                  const Text('Node Operations',
                      style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),
                  PrimaryButton(
                    label: 'Start Local Server',
                    icon: Icons.play_arrow_outlined,
                    isLoading: _isLoading,
                    onPressed: _isLocalRunning ? null : _handleStart,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SecondaryButton(
                    label: 'Restart Server Engine',
                    icon: Icons.refresh_outlined,
                    isLoading: _isLoading,
                    onPressed: _handleRestart,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  DestructiveButton(
                    label: 'Stop Local Server',
                    icon: Icons.stop_outlined,
                    isLoading: _isLoading,
                    onPressed: !_isLocalRunning ? null : _handleStop,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  const Divider(),
                  const SizedBox(height: AppSpacing.sm),
                  DestructiveButton(
                    label: 'Delete Server',
                    icon: Icons.delete_outline,
                    isLoading: _isLoading,
                    onPressed: _handleDeleteServer,
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

class _StatusRow extends StatelessWidget {
  final String label;
  final String value;

  const _StatusRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTypography.caption),
        const SizedBox(width: AppSpacing.xs),
        Flexible(
          child: Text(
            value,
            style:
                AppTypography.bodySmall.copyWith(fontWeight: FontWeight.w500),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
