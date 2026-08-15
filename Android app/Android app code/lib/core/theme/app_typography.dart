import 'package:flutter/material.dart';
import 'app_colors.dart';

/// Centralized Typography Scale — Aligned with Main Website Typography
class AppTypography {
  static const TextStyle display = TextStyle(
    fontSize: 32.0,
    fontWeight: FontWeight.bold,
    color: AppColors.textPrimary,
    letterSpacing: -0.8,
  );

  static const TextStyle heading1 = TextStyle(
    fontSize: 24.0,
    fontWeight: FontWeight.bold,
    color: AppColors.textPrimary,
    letterSpacing: -0.5,
  );

  static const TextStyle heading2 = TextStyle(
    fontSize: 20.0,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
    letterSpacing: -0.3,
  );

  static const TextStyle heading3 = TextStyle(
    fontSize: 16.0,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
  );

  static const TextStyle body = TextStyle(
    fontSize: 14.0,
    fontWeight: FontWeight.normal,
    color: AppColors.textPrimary,
    height: 1.5,
  );

  static const TextStyle bodySmall = TextStyle(
    fontSize: 13.0,
    fontWeight: FontWeight.normal,
    color: AppColors.textSecondary,
    height: 1.4,
  );

  static const TextStyle caption = TextStyle(
    fontSize: 12.0,
    fontWeight: FontWeight.normal,
    color: AppColors.textMuted,
  );

  static const TextStyle button = TextStyle(
    fontSize: 14.0,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.2,
  );

  static const TextStyle label = TextStyle(
    fontSize: 12.0,
    fontWeight: FontWeight.w600,
    color: AppColors.textSecondary,
  );

  static const TextStyle status = TextStyle(
    fontSize: 11.0,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.5,
  );
}
