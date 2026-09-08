import 'package:flutter/material.dart';

/// Centralized Border Radius System — Restrained & Consistent (ZD-UX-1)
class AppRadius {
  /// Extra small radius (2.0 dp)
  static const double xs = 2.0;

  /// Small radius for tags, subtle badges, and small controls (4.0 dp)
  static const double sm = 4.0;

  /// Medium radius for cards, text fields, and standard buttons (8.0 dp)
  static const double md = 8.0;

  /// Large radius for dialogs, bottom sheets, and containers (12.0 dp)
  static const double lg = 12.0;

  /// Extra large radius for cards / floating surfaces (16.0 dp)
  static const double xl = 16.0;

  /// Pill / Full radius for status pills and rounded badges (999.0 dp)
  static const double pill = 999.0;
  static const double full = 999.0;

  // BorderRadius Helpers
  static BorderRadius get borderXs => BorderRadius.circular(xs);
  static BorderRadius get borderSm => BorderRadius.circular(sm);
  static BorderRadius get borderMd => BorderRadius.circular(md);
  static BorderRadius get borderLg => BorderRadius.circular(lg);
  static BorderRadius get borderXl => BorderRadius.circular(xl);
  static BorderRadius get borderPill => BorderRadius.circular(pill);
  static BorderRadius get borderFull => BorderRadius.circular(full);
}
