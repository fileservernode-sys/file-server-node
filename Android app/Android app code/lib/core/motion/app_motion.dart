import 'package:flutter/material.dart';

/// Centralized Motion Tokens & Curves (ZD-UX-1)
/// Mirrors the Main Website and File Manager motion design tokens exactly.
class AppMotion {
  // Durations
  static const Duration instant = Duration(milliseconds: 100);
  static const Duration fast = Duration(milliseconds: 150);
  static const Duration base = Duration(milliseconds: 220);
  static const Duration moderate = Duration(milliseconds: 320);
  static const Duration deliberate = Duration(milliseconds: 450);
  static const Duration complex = Duration(milliseconds: 600);

  // Curves (Easing Equivalents)
  /// Standard easing for subtle movement: cubic-bezier(0.2, 0.0, 0.0, 1.0)
  static const Curve standard = Cubic(0.2, 0.0, 0.0, 1.0);

  /// Emphasized easing for entrances & state morphs: cubic-bezier(0.16, 1.0, 0.3, 1.0)
  static const Curve emphasized = Cubic(0.16, 1.0, 0.3, 1.0);

  /// Decelerated enter curve: cubic-bezier(0.0, 0.0, 0.2, 1.0)
  static const Curve enter = Cubic(0.0, 0.0, 0.2, 1.0);

  /// Accelerated exit curve: cubic-bezier(0.4, 0.0, 1.0, 1.0)
  static const Curve exit = Cubic(0.4, 0.0, 1.0, 1.0);

  /// Spring physics curve for playful micro-interactions: cubic-bezier(0.34, 1.56, 0.64, 1.0)
  static const Curve spring = Cubic(0.34, 1.56, 0.64, 1.0);

  // Motion Distances (dp)
  static const double distanceXs = 4.0;
  static const double distanceSm = 12.0;
  static const double distanceMd = 24.0;

  /// Helper to check if system animations are disabled or reduced
  static bool isReducedMotion(BuildContext context) {
    return MediaQuery.maybeOf(context)?.disableAnimations ?? false;
  }
}
