import 'package:flutter/material.dart';

/// Centralized Color Tokens — Matches Main Website Visual Identity Exactly
class AppColors {
  // Brand Palette
  static const Color primary = Color(0xFF2563EB); // Royal Blue
  static const Color primaryDark = Color(0xFF1D4ED8);
  static const Color primaryLight = Color(0xFF60A5FA);

  // Background & Surface Tokens
  static const Color background = Color(0xFFFAFAFC); // Off-White
  static const Color surface = Color(0xFFFFFFFF); // White
  static const Color surfaceSubtle = Color(0xFFF1F5F9);

  // Text & Content Tokens
  static const Color textPrimary = Color(0xFF0F172A); // Deep Slate Navy
  static const Color textSecondary = Color(0xFF475569);
  static const Color textMuted = Color(0xFF94A3B8);

  // Borders & Dividers
  static const Color borderSubtle = Color(0xFFE2E8F0);
  static const Color borderFocused = Color(0xFF2563EB);

  // Status Indicator Tokens (Exact Compliance with Main Website System)
  static const Color statusOnline = Color(0xFF059669); // Emerald
  static const Color statusOnlineBg = Color(0xFFECFDF5);

  static const Color statusConnecting = Color(0xFFD97706); // Amber
  static const Color statusConnectingBg = Color(0xFFFFFBEB);

  static const Color statusOffline = Color(0xFF64748B); // Slate
  static const Color statusOfflineBg = Color(0xFFF8FAFC);

  static const Color statusError = Color(0xFFDC2626); // Red
  static const Color statusErrorBg = Color(0xFFFEF2F2);
}
