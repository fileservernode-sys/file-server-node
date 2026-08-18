import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/app_text_field.dart';
import '../application/setup_state.dart';
import 'widgets/setup_stepper.dart';

/// Step 3 — File-Server Credentials Screen with Explicit Credential Separation Callout
class SetupCredentialsScreen extends ConsumerStatefulWidget {
  const SetupCredentialsScreen({super.key});

  @override
  ConsumerState<SetupCredentialsScreen> createState() =>
      _SetupCredentialsScreenState();
}

class _SetupCredentialsScreenState
    extends ConsumerState<SetupCredentialsScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _usernameController;
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  @override
  void initState() {
    super.initState();
    final currentSetup = ref.read(setupStateProvider);
    _usernameController =
        TextEditingController(text: currentSetup.fileServerUsername);
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Server Setup Wizard',
        showBackButton: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpacing.maxFormWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SetupStepper(
                      currentStep: 3,
                      totalSteps: 4,
                      stepTitle: 'Create File-Server Credentials',
                    ),
                    const SizedBox(height: AppSpacing.xl),

                    // Prominent Credential Separation Callout Box
                    AppCard(
                      color: AppColors.primarySubtle,
                      borderColor: AppColors.primary.withValues(alpha: 0.3),
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.info_outline_rounded,
                                  color: AppColors.primary, size: 22),
                              SizedBox(width: AppSpacing.xs),
                              Expanded(
                                child: Text(
                                  'File-server Credentials Notice',
                                  style: AppTypography.cardTitle,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text(
                            'These credentials are used ONLY to log into the web file manager hosted locally on this phone.',
                            style: AppTypography.bodySmall
                                .copyWith(color: AppColors.textPrimary),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          const Divider(),
                          const SizedBox(height: AppSpacing.xs),
                          Text(
                            '• Platform Account: Used for Main Website & Android Control App.\n'
                            '• File-Server Account: Created here for browser file manager access.\n'
                            '• Never mix the two credentials.',
                            style: AppTypography.caption.copyWith(
                                color: AppColors.textSecondary, height: 1.4),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),

                    // Credential Input Fields
                    AppTextField(
                      label: 'File-server username',
                      hintText: 'e.g., admin_user',
                      controller: _usernameController,
                      prefixIcon: const Icon(Icons.person_outline),
                      validator: (val) {
                        if (val == null || val.trim().isEmpty) {
                          return 'Please enter a file-server username';
                        }
                        if (val.trim().length < 3) {
                          return 'Username must be at least 3 characters';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.md),

                    AppTextField(
                      label: 'Password',
                      hintText: 'Enter server password',
                      controller: _passwordController,
                      obscureText: true,
                      prefixIcon: const Icon(Icons.lock_outline),
                      helperText: 'Must be at least 8 characters with numbers',
                      validator: (val) {
                        if (val == null || val.length < 8) {
                          return 'Password must be at least 8 characters';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.md),

                    AppTextField(
                      label: 'Confirm password',
                      hintText: 'Re-enter server password',
                      controller: _confirmPasswordController,
                      obscureText: true,
                      prefixIcon: const Icon(Icons.lock_reset_outlined),
                      validator: (val) {
                        if (val != _passwordController.text) {
                          return 'Passwords do not match';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.xxl),

                    PrimaryButton(
                      label: 'Continue',
                      icon: Icons.arrow_forward_rounded,
                      onPressed: () {
                        if (_formKey.currentState?.validate() ?? false) {
                          ref.read(setupStateProvider.notifier).setCredentials(
                                username: _usernameController.text,
                                password: _passwordController.text,
                              );
                          Navigator.pushNamed(context, '/server/setup/review');
                        }
                      },
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    SecondaryButton(
                      label: 'Back',
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
