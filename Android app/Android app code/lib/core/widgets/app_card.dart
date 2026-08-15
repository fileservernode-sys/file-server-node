import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_radius.dart';
import '../theme/app_spacing.dart';

/// Reusable Surface Card Component with Subtle Border & Restrained Radius
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final Color? borderColor;

  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.md),
    this.onTap,
    this.color,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color ?? AppColors.surface,
      borderRadius: AppRadius.borderMd,
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          borderRadius: AppRadius.borderMd,
          border: Border.all(
            color: borderColor ?? AppColors.borderSubtle,
            width: 1.0,
          ),
        ),
        child: onTap != null
            ? InkWell(
                onTap: onTap,
                borderRadius: AppRadius.borderMd,
                child: child,
              )
            : child,
      ),
    );
  }
}
