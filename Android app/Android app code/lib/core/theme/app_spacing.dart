import 'package:flutter/material.dart';

/// Centralized 8-pt Grid System & Spacing Tokens (ZD-UX-1)
class AppSpacing {
  static const double xxs = 4.0;
  static const double xs = 8.0;
  static const double sm = 12.0;
  static const double md = 16.0;
  static const double lg = 20.0;
  static const double xl = 24.0;
  static const double xxl = 32.0;
  static const double xxxl = 40.0;
  static const double huge = 48.0;
  static const double massive = 64.0;
  static const double gigantic = 96.0;

  // Responsive Content Max Width Constraints
  static const double maxFormWidth = 420.0;
  static const double maxContentWidth = 640.0;

  // Responsive Breakpoints for Flutter Adaptive Layouts
  static const double breakpointCompact = 360.0;
  static const double breakpointMedium = 600.0;
  static const double breakpointExpanded = 840.0;

  // Padding EdgeInset Helpers
  static const EdgeInsets paddingXs = EdgeInsets.all(xs);
  static const EdgeInsets paddingSm = EdgeInsets.all(sm);
  static const EdgeInsets paddingMd = EdgeInsets.all(md);
  static const EdgeInsets paddingLg = EdgeInsets.all(lg);
  static const EdgeInsets paddingXl = EdgeInsets.all(xl);

  // Border Radius Tokens (Referencing AppRadius)
  static const double radiusSm = 4.0;
  static const double radiusMd = 8.0;
  static const double radiusLg = 12.0;
  static const double radiusFull = 999.0;
}
