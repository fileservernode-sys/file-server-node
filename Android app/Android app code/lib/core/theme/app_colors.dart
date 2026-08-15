import 'package:flutter/material.dart';

/// Centralized Color Tokens — Matches Main Website Visual Identity Exactly
class AppColors {
  // Brand & Core Palette
  static const Color primary = Color(0xFF2563EB); // Royal Blue
  static const Color primaryHover = Color(0xFF1D4ED8);
  static const Color primarySubtle = Color(0xFFEFF6FF);

  static const Color textPrimary = Color(0xFF0F172A); // Deep Slate Navy
  static const Color textSecondary = Color(0xFF475569); // Slate Grey
  static const Color textMuted = Color(0xFF94A3B8); // Muted Slate

  static const Color background = Color(0xFFFAFAFC); // Off-White
  static const Color surface = Color(0xFFFFFFFF); // Pure White
  static const Color surfaceSubtle = Color(0xFFF8FAFC); // Light Slate Surface

  static const Color borderSubtle = Color(0xFFE2E8F0); // Subtle Border
  static const Color borderFocused = Color(0xFF2563EB); // Focused Input Border

  // Semantic Status Tokens (Matching Website Badges)
  static const Color statusOnline = Color(0xFF059669); // Emerald Green
  static const Color statusOnlineBg = Color(0xFFECFDF5);

  static const Color statusConnecting = Color(0xFFD97706); // Amber Yellow
  static const Color statusConnectingBg = Color(0xFFFFFBEB);

  static const Color statusOffline = Color(0xFF64748B); // Slate Grey
  static const Color statusOfflineBg = Color(0xFFF1F5F9);

  static const Color statusError = Color(0xFFDC2626); // Destructive Red
  static const Color statusErrorBg = Color(0xFFFEF2F2);
}
