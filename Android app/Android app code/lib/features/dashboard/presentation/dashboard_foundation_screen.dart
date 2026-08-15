import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/status_badge.dart';

/// Dashboard Foundation Screen Placeholder
class DashboardFoundationScreen extends StatelessWidget {
  const DashboardFoundationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Server Control Panel'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () {},
          ),
        ],
      ),
      body: const SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppCard(
                child: Row(
                  children: [
                    Icon(Icons.phone_android,
                        size: 36, color: AppColors.primary),
                    SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('This Phone Server Node',
                              style: AppTypography.heading3),
                          SizedBox(height: 2),
                          Text('Host Node Status',
                              style: AppTypography.caption),
                        ],
                      ),
                    ),
                    StatusBadge(status: DeviceServerStatus.offline),
                  ],
                ),
              ),
              SizedBox(height: AppSpacing.lg),
              Text('Server Life Cycle', style: AppTypography.heading2),
              SizedBox(height: AppSpacing.sm),
              Text(
                'Server creation, gateway tunneling, and file management will be enabled in future Android batches.',
                style: AppTypography.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
