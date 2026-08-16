import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
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
  String _localUrl = 'http://127.0.0.1:8080';
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _refreshServerStatus();
  }

  Future<void> _refreshServerStatus() async {
    final service = ref.read(serverServiceProvider);
    final status = await service.getServerStatus();
    final url = await service.getLocalUrl();
    if (mounted) {
      setState(() {
        _isLocalRunning = status['status'] == 'ONLINE';
        _localUrl = url;
      });
    }
  }

  Future<void> _handleStart() async {
    setState(() => _isLoading = true);
    final service = ref.read(serverServiceProvider);
    await service.startServer();
    await _refreshServerStatus();
    if (mounted) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Local HTTP File Server started on 0.0.0.0:8080')),
      );
    }
  }

  Future<void> _handleRestart() async {
    setState(() => _isLoading = true);
    final service = ref.read(serverServiceProvider);
    await service.restartServer();
    await _refreshServerStatus();
    if (mounted) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Local HTTP File Server restarted cleanly.')),
      );
    }
  }

  Future<void> _handleStop() async {
    setState(() => _isLoading = true);
    final service = ref.read(serverServiceProvider);
    await service.stopServer();
    await _refreshServerStatus();
    if (mounted) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Local HTTP File Server stopped.')),
      );
    }
  }

  Future<void> _handleDeleteServer() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Server?'),
        content: const Text(
          'Are you sure you want to permanently delete this file server?\n\n'
          'This will stop the local server engine, remove your allocated subdomain, '
          'and delete all server records from the database.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusError,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete Permanently'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      setState(() => _isLoading = true);
      final success = await ref.read(setupStateProvider.notifier).deleteServer();
      if (mounted) {
        setState(() => _isLoading = false);
        if (success) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Server deleted successfully.')),
          );
          Navigator.pushNamedAndRemoveUntil(context, '/home', (r) => false);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(ref.read(setupStateProvider).errorMessage ?? 'Failed to delete server.'),
              backgroundColor: AppColors.statusError,
            ),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final setup = ref.watch(setupStateProvider);
    final publicUrl = setup.publicUrl ??
        (setup.assignedSubdomain != null
            ? 'https://${setup.assignedSubdomain}'
            : 'https://gateway.viewduration.com');

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Server Node Details',
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
                  // -----------------------------------------------------------
                  // 1. Dedicated Public Server Access Card
                  // -----------------------------------------------------------
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    color: AppColors.primarySubtle.withValues(alpha: 0.5),
                    borderColor: AppColors.primary.withValues(alpha: 0.3),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.public_rounded,
                                    color: AppColors.primary, size: 22),
                                SizedBox(width: AppSpacing.xs),
                                Text('Public Server Endpoint',
                                    style: AppTypography.cardTitle),
                              ],
                            ),
                            StatusBadge(
                              status: setup.endpointStatus == 'ACTIVE'
                                  ? DeviceServerStatus.online
                                  : DeviceServerStatus.offline,
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        const Text(
                          'Public access URL routed through ViewDuration Remote Gateway:',
                          style: AppTypography.bodySmall,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: AppSpacing.md,
                              vertical: AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius:
                                BorderRadius.circular(AppSpacing.radiusMd),
                            border: Border.all(color: AppColors.borderSubtle),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.link_rounded,
                                  size: 20, color: AppColors.primary),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Text(
                                  publicUrl,
                                  style: AppTypography.bodySmall.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.primary,
                                    fontFamily: 'monospace',
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                icon: const Icon(Icons.copy_rounded, size: 18),
                                label: const Text('Copy Link'),
                                style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                      vertical: AppSpacing.sm),
                                  side: const BorderSide(
                                      color: AppColors.primary),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(
                                        AppSpacing.radiusMd),
                                  ),
                                ),
                                onPressed: () {
                                  Clipboard.setData(
                                      ClipboardData(text: publicUrl));
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(
                                          'Public link copied: $publicUrl'),
                                      duration: const Duration(seconds: 3),
                                    ),
                                  );
                                },
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: ElevatedButton.icon(
                                icon: const Icon(Icons.open_in_browser_rounded,
                                    size: 18),
                                label: const Text('Open Link'),
                                style: ElevatedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                      vertical: AppSpacing.sm),
                                  backgroundColor: AppColors.primary,
                                  foregroundColor: Colors.white,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(
                                        AppSpacing.radiusMd),
                                  ),
                                ),
                                onPressed: () {
                                  ref
                                      .read(serverServiceProvider)
                                      .openUrl(publicUrl);
                                },
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // -----------------------------------------------------------
                  // 2. Local Node & Engine Status Card
                  // -----------------------------------------------------------
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.dns_rounded,
                                size: 36, color: AppColors.primary),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(setup.deviceName,
                                      style: AppTypography.cardTitle),
                                  const SizedBox(height: AppSpacing.xxs),
                                  Text(
                                    'Node ID: ${setup.deviceId ?? 'inst-local-node-01'}',
                                    style: AppTypography.caption
                                        .copyWith(fontFamily: 'monospace'),
                                  ),
                                ],
                              ),
                            ),
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
                          value: setup.serverName,
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Device Host',
                          value: setup.deviceName,
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Local Engine Status',
                          value: _isLocalRunning ? 'ONLINE' : 'STOPPED',
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
                              ? 'CONNECTED (gateway.viewduration.com)'
                              : 'CONNECTED (Active)',
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Subdomain Status',
                          value: setup.endpointStatus,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // -----------------------------------------------------------
                  // 3. Node Management Actions
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
                    label: 'Delete Server & Release Subdomain',
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
