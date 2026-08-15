import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Reusable Responsive Text Input Field
class AppTextField extends StatelessWidget {
  final String label;
  final String? hintText;
  final String? helperText;
  final String? errorText;
  final TextEditingController? controller;
  final TextInputType keyboardType;
  final bool obscureText;
  final ValueChanged<String>? onChanged;
  final FormFieldValidator<String>? validator;

  const AppTextField({
    super.key,
    required this.label,
    this.hintText,
    this.helperText,
    this.errorText,
    this.controller,
    this.keyboardType = TextInputType.text,
    this.obscureText = false,
    this.onChanged,
    this.validator,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTypography.label),
        const SizedBox(height: AppSpacing.xxs),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          obscureText: obscureText,
          onChanged: onChanged,
          validator: validator,
          style: AppTypography.body,
          decoration: InputDecoration(
            hintText: hintText,
            hintStyle:
                AppTypography.bodySmall.copyWith(color: AppColors.textMuted),
            helperText: helperText,
            helperStyle: AppTypography.caption,
            errorText: errorText,
            errorStyle:
                AppTypography.caption.copyWith(color: AppColors.statusError),
            filled: true,
            fillColor: AppColors.surface,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.md,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              borderSide: const BorderSide(color: AppColors.borderSubtle),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              borderSide: const BorderSide(color: AppColors.borderSubtle),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              borderSide:
                  const BorderSide(color: AppColors.borderFocused, width: 1.5),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              borderSide: const BorderSide(color: AppColors.statusError),
            ),
          ),
        ),
      ],
    );
  }
}
