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

/// Server Status Detail Screen - Displays local HTTP file server engine state, public subdomain endpoint, and control triggers
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
  String _localUrl = 'Active (Local Loopback)';
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
    final serviceRunning = await service.isServiceRunning();
    final batteryIgnored = await service.isBatteryOptimizationIgnored();

    if (mounted) {
      setState(() {
        _isLocalRunning = status['status'] == 'ONLINE' || serviceRunning;
        _isServiceRunning = serviceRunning;
        _isBatteryIgnored = batteryIgnored;
        _localUrl = _isLocalRunning ? 'Active (Local Loopback)' : 'Stopped';
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
              Expanded(
                child: Text('Enable Notification',
                    style: AppTypography.cardTitle,
                    softWrap: true),
              ),
            ],
          ),
          content: const Text(
            'ZdexCloud uses a persistent notification to show that your personal file server is running and ensure continuous background hosting.',
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
            content: Text('Starting server engine and connecting to remote gateway...')),
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
            content: Text('Restarting server engine and reconnecting remote gateway...')),
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
            Expanded(
              child: Text('Stop Local Server?',
                  style: AppTypography.cardTitle,
                  softWrap: true),
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
    bool deleteFiles = false;
    final setup = ref.read(setupStateProvider);
    final targetServerName = setup.serverName.isNotEmpty
        ? setup.serverName
        : (setup.deviceName.isNotEmpty ? setup.deviceName : 'Server');
    final expectedPhrase = '${targetServerName.trim()} DELETE';
    final confirmController = TextEditingController();
    bool isPhraseMatching = false;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: AppColors.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
          ),
          title: const Row(
            children: [
              Icon(Icons.warning_amber_rounded,
                  color: AppColors.statusError, size: 24),
              SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Text('Delete Server Node',
                    style: AppTypography.cardTitle,
                    softWrap: true),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  margin: const EdgeInsets.only(bottom: AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.statusError.withValues(alpha: 0.08),
                    border: Border.all(
                      color: AppColors.statusError.withValues(alpha: 0.25),
                    ),
                    borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        targetServerName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          color: AppColors.statusError,
                          fontSize: 14,
                        ),
                      ),
                      if (setup.deviceId != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          'ID: ${setup.deviceId}',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppColors.statusError.withValues(alpha: 0.8),
                            fontFamily: 'monospace',
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const Text(
                  'Choose whether to preserve or purge your uploaded files when deleting this server node:',
                  style: AppTypography.bodySmall,
                ),
                const SizedBox(height: AppSpacing.md),

                // Option 1: Keep files on phone (Default)
                InkWell(
                  onTap: () {
                    setDialogState(() => deleteFiles = false);
                  },
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                  child: Container(
                    padding: const EdgeInsets.all(AppSpacing.sm),
                    decoration: BoxDecoration(
                      color: !deleteFiles
                          ? AppColors.primary.withValues(alpha: 0.06)
                          : AppColors.background,
                      border: Border.all(
                        color: !deleteFiles
                            ? AppColors.primary
                            : AppColors.borderSubtle,
                        width: !deleteFiles ? 2 : 1,
                      ),
                      borderRadius:
                          BorderRadius.circular(AppSpacing.radiusMd),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 2, right: AppSpacing.xs),
                          child: Icon(
                            !deleteFiles
                                ? Icons.radio_button_checked
                                : Icons.radio_button_unchecked,
                            color: !deleteFiles
                                ? AppColors.primary
                                : AppColors.textMuted,
                            size: 20,
                          ),
                        ),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Keep files on phone (Delete Server Only)',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.textPrimary,
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                'Unregister server and release web endpoint. All uploaded files, photos, videos, and folders remain safely stored on this phone. (Recommended)',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: AppColors.textSecondary,
                                  height: 1.3,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),

                // Option 2: Delete files & server
                InkWell(
                  onTap: () {
                    setDialogState(() => deleteFiles = true);
                  },
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                  child: Container(
                    padding: const EdgeInsets.all(AppSpacing.sm),
                    decoration: BoxDecoration(
                      color: deleteFiles
                          ? AppColors.statusError.withValues(alpha: 0.06)
                          : AppColors.background,
                      border: Border.all(
                        color: deleteFiles
                            ? AppColors.statusError
                            : AppColors.borderSubtle,
                        width: deleteFiles ? 2 : 1,
                      ),
                      borderRadius:
                          BorderRadius.circular(AppSpacing.radiusMd),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 2, right: AppSpacing.xs),
                          child: Icon(
                            deleteFiles
                                ? Icons.radio_button_checked
                                : Icons.radio_button_unchecked,
                            color: deleteFiles
                                ? AppColors.statusError
                                : AppColors.textMuted,
                            size: 20,
                          ),
                        ),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Delete uploaded files & server',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.statusError,
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                'Permanently purge all files, videos, and folders in the server storage folder, unregister server, and release the endpoint. This cannot be undone.',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: AppColors.textSecondary,
                                  height: 1.3,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: AppSpacing.md),
                const Divider(height: 1),
                const SizedBox(height: AppSpacing.md),

                Text.rich(
                  TextSpan(
                    text: 'To confirm, type ',
                    style: AppTypography.bodySmall,
                    children: [
                      TextSpan(
                        text: expectedPhrase,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.statusError,
                          fontFamily: 'monospace',
                        ),
                      ),
                      const TextSpan(text: ' in the box below:'),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                TextField(
                  controller: confirmController,
                  autofocus: false,
                  decoration: InputDecoration(
                    hintText: expectedPhrase,
                    hintStyle: TextStyle(
                      color: AppColors.textMuted.withValues(alpha: 0.6),
                      fontFamily: 'monospace',
                      fontSize: 13,
                    ),
                    filled: true,
                    fillColor: AppColors.surfaceSubtle,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.xs,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      borderSide: const BorderSide(color: AppColors.borderSubtle),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      borderSide: BorderSide(
                        color: isPhraseMatching
                            ? AppColors.success
                            : AppColors.borderSubtle,
                      ),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      borderSide: BorderSide(
                        color: isPhraseMatching
                            ? AppColors.success
                            : AppColors.statusError,
                        width: 1.5,
                      ),
                    ),
                  ),
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  onChanged: (val) {
                    final matches = val.trim() == expectedPhrase;
                    if (matches != isPhraseMatching) {
                      setDialogState(() {
                        isPhraseMatching = matches;
                      });
                    }
                  },
                ),
              ],
            ),
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
                disabledBackgroundColor:
                    AppColors.statusError.withValues(alpha: 0.35),
                disabledForegroundColor: Colors.white.withValues(alpha: 0.6),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
              ),
              onPressed: isPhraseMatching ? () => Navigator.pop(ctx, true) : null,
              child: Text(deleteFiles
                  ? 'Delete & Purge Files'
                  : 'Delete Server (Keep Files)'),
            ),
          ],
        ),
      ),
    );

    confirmController.dispose();
    if (confirmed != true) return;

    setState(() => _isLoading = true);
    await ref
        .read(setupStateProvider.notifier)
        .deleteServer(deleteFiles: deleteFiles);
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
                                  Expanded(
                                    child: Text('Access Your Server',
                                        style: AppTypography.cardTitle,
                                        softWrap: true),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: AppSpacing.xs),
                            StatusBadge(
                              status: setup.isServerRunning
                                  ? DeviceServerStatus.online
                                  : (setup.isLocalOnline
                                      ? setup.serverStatus
                                      : DeviceServerStatus.offline),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          setup.isServerRunning
                              ? 'Your server is running and active. Visit the ZdexCloud website to access your file manager and manage storage.'
                              : (setup.isLocalOnline
                                  ? (setup.endpointStatus == 'RECONNECTING'
                                      ? 'Server local engine is running. Reconnecting to remote gateway...'
                                      : (setup.endpointStatus == 'FAILED'
                                          ? 'Server local engine is running. Remote gateway connection failed.'
                                          : 'Server local engine is running. Connecting to remote gateway...'))
                                  : 'Your server is stopped. Start the server engine to enable local hosting and remote access.'),
                          style: AppTypography.bodySmall,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        PrimaryButton(
                          label: 'Open ZdexCloud',
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
                  // 2. Account Plan & Server Limits Card
                  // -----------------------------------------------------------
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: AppSpacing.sm,
                          runSpacing: AppSpacing.xs,
                          alignment: WrapAlignment.spaceBetween,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.workspace_premium_rounded,
                                    color: AppColors.primary, size: 20),
                                const SizedBox(width: AppSpacing.xs),
                                Text(
                                  setup.planName,
                                  style: AppTypography.cardTitle,
                                ),
                              ],
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.primarySubtle,
                                borderRadius:
                                    BorderRadius.circular(AppSpacing.radiusFull),
                              ),
                              child: Text(
                                '${setup.activeServersCount} / ${setup.maxServers} Active Node${setup.maxServers > 1 ? 's' : ''}',
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.primary,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Your account supports up to ${setup.maxServers} active server instance${setup.maxServers > 1 ? 's' : ''} according to your ${setup.planName}. Manage your subscription on the ZdexCloud website.',
                          style: AppTypography.caption,
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
                              Expanded(
                                child: Text(
                                  'Background Optimization Active',
                                  style: AppTypography.cardTitle,
                                  softWrap: true,
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
                                    softWrap: true,
                                    maxLines: 2,
                                  ),
                                  const SizedBox(height: AppSpacing.xxs),
                                  Text(
                                    'Node ID: ${setup.deviceId ?? 'inst-local-node-01'}',
                                    style: AppTypography.caption
                                        .copyWith(fontFamily: 'monospace'),
                                    softWrap: true,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: AppSpacing.xs),
                            StatusBadge(
                              status: setup.serverStatus,
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
                          label: 'Server Status',
                          value: setup.serverStatusLabel.toUpperCase(),
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
                          label: 'Local Storage Engine',
                          value: _localUrl,
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Connection Service',
                          value: setup.isGatewayConnected
                              ? 'CONNECTED'
                              : (setup.isLocalOnline
                                  ? (setup.endpointStatus == 'RECONNECTING'
                                      ? 'RECONNECTING'
                                      : (setup.endpointStatus == 'FAILED'
                                          ? 'FAILED'
                                          : 'CONNECTING'))
                                  : 'DISCONNECTED'),
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Upload Storage Location',
                          value: setup.storagePath.isNotEmpty
                              ? setup.storagePath
                              : '/storage/emulated/0/Download',
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        _StatusRow(
                          label: 'Remote Relay Status',
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
                    label: setup.isLocalOnline
                        ? (setup.isServerRunning ? 'Server Running' : 'Connecting to Gateway...')
                        : 'Start Local Server',
                    icon: Icons.play_arrow_outlined,
                    isLoading: _isLoading,
                    onPressed: _isLocalRunning ? null : _handleStart,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (!setup.isGatewayConnected && _isLocalRunning) ...[
                    SecondaryButton(
                      label: 'Reconnect Gateway Relay',
                      icon: Icons.sync_rounded,
                      isLoading: _isLoading,
                      onPressed: () async {
                        setState(() => _isLoading = true);
                        await ref.read(setupStateProvider.notifier).reconnectGateway();
                        await _refreshServerStatus();
                        if (mounted) setState(() => _isLoading = false);
                      },
                    ),
                    const SizedBox(height: AppSpacing.sm),
                  ],
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
    final isMonospace = value.startsWith('/') ||
        value.startsWith('http') ||
        value.startsWith('inst-');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 4,
            child: Text(
              label,
              style: AppTypography.caption
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            flex: 5,
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: isMonospace
                  ? AppTypography.caption.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    )
                  : AppTypography.bodySmall.copyWith(
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
              softWrap: true,
            ),
          ),
        ],
      ),
    );
  }
}
