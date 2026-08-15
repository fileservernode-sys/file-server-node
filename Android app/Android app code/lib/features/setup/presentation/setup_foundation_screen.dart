import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// Setup Foundation Screen Placeholder
class SetupFoundationScreen extends StatelessWidget {
  const SetupFoundationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Server Setup Wizard'),
      ),
      body: const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Configure Storage Host', style: AppTypography.heading1),
              SizedBox(height: AppSpacing.sm),
              Text(
                'Create dedicated file-server credentials and assign a remote subdomain.',
                style: AppTypography.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
