import 'package:flutter/material.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';

/// Auth Foundation Screen Placeholder — Enforces Android App LOGIN ONLY rule
class AuthFoundationScreen extends StatelessWidget {
  const AuthFoundationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Product Logo Mark
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
                    ),
                    child: const Center(
                      child: Text(
                        'RN',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 28,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Product Title & Subtitle
                  const Text('RemoteNode', style: AppTypography.heading1),
                  const SizedBox(height: AppSpacing.xxs),
                  const Text(
                    'Personal File Server',
                    style: AppTypography.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // Authentication Card Container
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SecondaryButton(
                          label: 'Continue with Google',
                          icon: Icons.g_mobiledata_rounded,
                          onPressed: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                    'Google Auth will be active in Batch 6B.'),
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: AppSpacing.md),
                        PrimaryButton(
                          label: 'Continue with Email',
                          icon: Icons.email_outlined,
                          onPressed: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                    'Email/Password Auth will be active in Batch 6B.'),
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: AppSpacing.xl),
                        const Divider(),
                        const SizedBox(height: AppSpacing.lg),

                        // Enforced Rule: App does NOT provide registration
                        const Text(
                          "Don't have an account?",
                          style: AppTypography.caption,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: AppSpacing.xxs),
                        const Text(
                          'Create your account on our website:',
                          style: AppTypography.bodySmall,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        SelectableText(
                          AppConfig.current.webRegistrationUrl,
                          style: AppTypography.label.copyWith(
                            color: AppColors.primary,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
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
