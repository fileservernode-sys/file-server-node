import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/app_text_field.dart';
import '../../../core/widgets/error_message.dart';
import '../application/auth_state.dart';

/// OTP Verification Screen — Step 2 of Email + Password + OTP Auth Flow
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key});

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _formKey = GlobalKey<FormState>();
  final _otpController = TextEditingController();
  int _countdownSeconds = 30;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startResendTimer();
  }

  void _startResendTimer() {
    setState(() {
      _countdownSeconds = 30;
    });
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_countdownSeconds > 0) {
        setState(() {
          _countdownSeconds--;
        });
      } else {
        timer.cancel();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _otpController.dispose();
    super.dispose();
  }

  void _handleVerifyOtp() async {
    if (_formKey.currentState?.validate() ?? false) {
      final success = await ref.read(authStateProvider.notifier).verifyOtp(
            _otpController.text,
          );

      if (success && mounted) {
        Navigator.pushReplacementNamed(context, '/home');
      }
    }
  }

  void _handleResendOtp() async {
    final success = await ref.read(authStateProvider.notifier).resendOtp();
    if (success && mounted) {
      _startResendTimer();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text(
                'A new 6-digit security code has been sent to your email.')),
      );
    }
  }

  String _maskEmail(String? email) {
    if (email == null || !email.contains('@')) return 'your email';
    final parts = email.split('@');
    final name = parts[0];
    final domain = parts[1];
    if (name.length <= 2) return '$name***@$domain';
    return '${name.substring(0, 2)}***@$domain';
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    final isSubmitting = authState.status == AuthStatus.submitting;
    final maskedEmail = _maskEmail(authState.pendingEmail);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Security Verification',
        showBackButton: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpacing.maxFormWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.xl),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(Icons.shield_outlined,
                        size: 48, color: AppColors.primary),
                    const SizedBox(height: AppSpacing.md),
                    const Text(
                      'Enter Security Code',
                      style: AppTypography.pageTitle,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'A 6-digit security code has been sent to $maskedEmail.',
                      style: AppTypography.bodySmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSpacing.xxl),
                    if (authState.errorMessage != null) ...[
                      ErrorMessageBanner(message: authState.errorMessage!),
                      const SizedBox(height: AppSpacing.md),
                    ],
                    AppTextField(
                      label: '6-Digit Verification Code',
                      hintText: '123456',
                      controller: _otpController,
                      keyboardType: TextInputType.number,
                      prefixIcon: const Icon(Icons.lock_clock_outlined),
                      enabled: !isSubmitting,
                      validator: (val) {
                        if (val == null || val.trim().length != 6) {
                          return 'Please enter a valid 6-digit code';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    PrimaryButton(
                      label: 'Verify & Sign In',
                      icon: Icons.check_circle_outline,
                      isLoading: isSubmitting,
                      onPressed: isSubmitting ? null : _handleVerifyOtp,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Center(
                      child: _countdownSeconds > 0
                          ? Text(
                              'Resend code available in ${_countdownSeconds}s',
                              style: AppTypography.caption,
                            )
                          : TertiaryButton(
                              label: 'Resend Security Code',
                              onPressed: isSubmitting ? null : _handleResendOtp,
                            ),
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
