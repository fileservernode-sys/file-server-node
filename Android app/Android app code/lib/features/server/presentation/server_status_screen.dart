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

/// Server Status Detail Screen — Displays local HTTP server engine state and control triggers
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

  @override
  Widget build(BuildContext context) {
    final setup = ref.watch(setupStateProvider);

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
                  // Server Node Header Card
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
                              ? 'CONNECTED (${setup.remoteEndpoint ?? 'gateway.viewduration.com'})'
                              : 'CONNECTED (Active)',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // Server Management Actions
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
