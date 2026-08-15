import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/status_badge.dart';

/// Server Status Detail Screen — Displays mock server node metrics and control triggers
class ServerStatusScreen extends StatelessWidget {
  final DeviceServerStatus mockStatus;

  const ServerStatusScreen({
    super.key,
    this.mockStatus = DeviceServerStatus.online,
  });

  @override
  Widget build(BuildContext context) {
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
                                  const Text('Android Phone Host',
                                      style: AppTypography.cardTitle),
                                  const SizedBox(height: AppSpacing.xxs),
                                  Text(
                                    'Node ID: mock-device-node-01',
                                    style: AppTypography.caption
                                        .copyWith(fontFamily: 'monospace'),
                                  ),
                                ],
                              ),
                            ),
                            StatusBadge(status: mockStatus),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        const Divider(),
                        const SizedBox(height: AppSpacing.md),
                        const _StatusRow(
                            label: 'Server Name',
                            value: 'My Personal File Server'),
                        const SizedBox(height: AppSpacing.xs),
                        const _StatusRow(
                            label: 'Device Host',
                            value: 'Android Phone (Lollipop+)'),
                        const SizedBox(height: AppSpacing.xs),
                        const _StatusRow(
                            label: 'Last Heartbeat',
                            value: 'Just now (Mock data)'),
                        const SizedBox(height: AppSpacing.xs),
                        const _StatusRow(
                            label: 'Remote Endpoint',
                            value: 'https://demo-node.remotenode.net'),
                        const SizedBox(height: AppSpacing.xs),
                        const _StatusRow(
                            label: 'Local Storage',
                            value: '64.0 GB total / 18.5 GB free'),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // Server Management Actions
                  const Text('Node Operations',
                      style: AppTypography.sectionTitle),
                  const SizedBox(height: AppSpacing.sm),
                  PrimaryButton(
                    label: 'Start Server',
                    icon: Icons.play_arrow_outlined,
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text(
                                'Mock Action: Server start operation triggered.')),
                      );
                    },
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SecondaryButton(
                    label: 'Restart Server',
                    icon: Icons.refresh_outlined,
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text(
                                'Mock Action: Server restart operation triggered.')),
                      );
                    },
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  DestructiveButton(
                    label: 'Stop Server',
                    icon: Icons.stop_outlined,
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text(
                                'Mock Action: Server stop operation triggered.')),
                      );
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
