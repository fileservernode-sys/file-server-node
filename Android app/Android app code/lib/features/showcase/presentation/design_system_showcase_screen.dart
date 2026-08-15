import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_bottom_sheet.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_dialog.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/app_text_field.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/error_message.dart';
import '../../../core/widgets/loading_indicator.dart';
import '../../../core/widgets/status_badge.dart';

/// Development UI Showcase Screen — Visual Verification of Design Tokens & Reusable Widgets
class DesignSystemShowcaseScreen extends StatelessWidget {
  const DesignSystemShowcaseScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Design System Showcase',
        showBackButton: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Typography Hierarchy
              const Text('Typography System',
                  style: AppTypography.sectionTitle),
              const SizedBox(height: AppSpacing.sm),
              const AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Display Title (28sp)', style: AppTypography.display),
                    SizedBox(height: AppSpacing.xs),
                    Text('Page Title (22sp)', style: AppTypography.pageTitle),
                    SizedBox(height: AppSpacing.xs),
                    Text('Section Title (18sp)',
                        style: AppTypography.sectionTitle),
                    SizedBox(height: AppSpacing.xs),
                    Text('Card Title (16sp)', style: AppTypography.cardTitle),
                    SizedBox(height: AppSpacing.xs),
                    Text('Body Text (14sp)', style: AppTypography.body),
                    SizedBox(height: AppSpacing.xs),
                    Text('Caption Text (12sp)', style: AppTypography.caption),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              // Button Component System
              const Text('Button System', style: AppTypography.sectionTitle),
              const SizedBox(height: AppSpacing.sm),
              PrimaryButton(
                label: 'Primary Button',
                onPressed: () {},
              ),
              const SizedBox(height: AppSpacing.sm),
              SecondaryButton(
                label: 'Secondary Button',
                onPressed: () {},
              ),
              const SizedBox(height: AppSpacing.sm),
              TertiaryButton(
                label: 'Tertiary Button',
                onPressed: () {},
              ),
              const SizedBox(height: AppSpacing.sm),
              DestructiveButton(
                label: 'Destructive Action',
                onPressed: () {},
              ),
              const SizedBox(height: AppSpacing.xl),

              // Form Control System
              const Text('Input Control System',
                  style: AppTypography.sectionTitle),
              const SizedBox(height: AppSpacing.sm),
              const AppTextField(
                label: 'Email Address',
                hintText: 'user@example.com',
                prefixIcon: Icon(Icons.email_outlined),
              ),
              const SizedBox(height: AppSpacing.md),
              const AppTextField(
                label: 'Password',
                obscureText: true,
                errorText: 'Password must be at least 8 characters.',
              ),
              const SizedBox(height: AppSpacing.xl),

              // Status Badge Indicators
              const Text('Status Indicators',
                  style: AppTypography.sectionTitle),
              const SizedBox(height: AppSpacing.sm),
              const Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  StatusBadge(status: DeviceServerStatus.online),
                  StatusBadge(status: DeviceServerStatus.connecting),
                  StatusBadge(status: DeviceServerStatus.reconnecting),
                  StatusBadge(status: DeviceServerStatus.offline),
                ],
              ),
              const SizedBox(height: AppSpacing.xl),

              // Modals & Bottom Sheets
              const Text('Dialogs & Bottom Sheets',
                  style: AppTypography.sectionTitle),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  Expanded(
                    child: SecondaryButton(
                      label: 'Show Dialog',
                      onPressed: () {
                        AppDialog.show(
                          context: context,
                          title: 'Confirm Action',
                          message:
                              'Are you sure you want to perform this design action?',
                          primaryActionLabel: 'Confirm',
                          onPrimaryAction: () {},
                          secondaryActionLabel: 'Cancel',
                        );
                      },
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: SecondaryButton(
                      label: 'Show Sheet',
                      onPressed: () {
                        AppBottomSheet.show(
                          context: context,
                          title: 'Bottom Sheet Preview',
                          child: const Padding(
                            padding:
                                EdgeInsets.symmetric(vertical: AppSpacing.md),
                            child: Text(
                                'Demonstration of bottom sheet styling.',
                                style: AppTypography.body),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xl),

              // Feedback States
              const Text('Feedback & Error States',
                  style: AppTypography.sectionTitle),
              const SizedBox(height: AppSpacing.sm),
              const ErrorMessageBanner(
                message:
                    'Unable to connect. Check your internet connection and try again.',
              ),
              const SizedBox(height: AppSpacing.md),
              const SkeletonLoader(height: 48),
              const SizedBox(height: AppSpacing.xl),

              // Empty State Demonstration
              const EmptyStateView(
                icon: Icons.devices_outlined,
                title: 'No Servers Registered',
                description:
                    'You have not linked any personal server nodes yet.',
                actionLabel: 'Learn More',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
