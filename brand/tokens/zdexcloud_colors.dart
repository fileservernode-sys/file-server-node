import 'package:flutter/material.dart';

/// Centralized Design System Color & Theme Tokens for ZdexCloud
/// Phase ZC-1: Master Brand Foundation
class ZdexCloudColors {
  // Brand & Accent Colors
  static const Color primary = Color(0xFF2563EB); // Zdex Royal Blue 600
  static const Color primaryHover = Color(0xFF1D4ED8); // Royal Blue 700
  static const Color primaryActive = Color(0xFF1E40AF); // Royal Blue 800
  static const Color primarySubtle = Color(0xFFEFF6FF); // 10% Royal Tint 50

  // Brand Navy & Neutrals
  static const Color navy = Color(0xFF0F172A); // Deep Slate Navy 900
  static const Color navyLight = Color(0xFF1E293B); // Slate Navy 800

  // Text Hierarchy
  static const Color textPrimary = Color(0xFF0F172A); // Deep Slate Navy (14.5:1)
  static const Color textSecondary = Color(0xFF334155); // High-contrast Body (7.5:1)
  static const Color textMuted = Color(0xFF64748B); // Metadata & Labels (4.8:1)
  static const Color textSubtle = Color(0xFF94A3B8); // Inactive hints & placeholders
  static const Color textInverse = Color(0xFFFFFFFF); // Pure white

  // Surfaces & Backgrounds
  static const Color background = Color(0xFFFAFAFC); // Premium Off-White Canvas
  static const Color surface = Color(0xFFFFFFFF); // Pure White Card Surface
  static const Color surfaceSubtle = Color(0xFFF1F5F9); // Neutral Slate Fill
  static const Color surfaceElevated = Color(0xFFFFFFFF); // Floating Modal / Card

  // Borders & Dividers
  static const Color borderSubtle = Color(0xFFE2E8F0); // Card Borders
  static const Color borderHover = Color(0xFFCBD5E1); // Interactive Hover Border
  static const Color borderFocused = Color(0xFF2563EB); // Focus Border

  // Semantic Status Tokens
  static const Color statusOnline = Color(0xFF059669); // Emerald Green 600
  static const Color statusOnlineBg = Color(0xFFECFDF5);
  static const Color statusConnecting = Color(0xFFD97706); // Amber 600
  static const Color statusConnectingBg = Color(0xFFFFFBEB);
  static const Color statusOffline = Color(0xFF64748B); // Slate 500
  static const Color statusOfflineBg = Color(0xFFF1F5F9);
  static const Color statusError = Color(0xFFDC2626); // Crimson Red 600
  static const Color statusErrorBg = Color(0xFFFEF2F2);
}

/// ZdexCloud Typography & Spacing Constants
class ZdexCloudThemeTokens {
  // Spacing (8-pt scale)
  static const double space4 = 4.0;
  static const double space8 = 8.0;
  static const double space12 = 12.0;
  static const double space16 = 16.0;
  static const double space24 = 24.0;
  static const double space32 = 32.0;
  static const double space48 = 48.0;
  static const double space64 = 64.0;

  // Border Radii
  static const double radiusSm = 8.0;
  static const double radiusMd = 12.0;
  static const double radiusLg = 16.0;
  static const double radiusXl = 24.0;
  static const double radiusPill = 999.0;
}
