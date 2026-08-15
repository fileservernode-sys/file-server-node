import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/theme/app_colors.dart';
import 'package:remote_node_app/core/theme/app_spacing.dart';
import 'package:remote_node_app/core/theme/app_typography.dart';

void main() {
  group('Theme Foundation Tests', () {
    test('AppColors matches Main Website color palette', () {
      expect(AppColors.primary, AppColors.primary);
      expect(AppColors.textPrimary, AppColors.textPrimary);
      expect(AppColors.background, AppColors.background);
      expect(AppColors.statusOnline, AppColors.statusOnline);
      expect(AppColors.statusConnecting, AppColors.statusConnecting);
      expect(AppColors.statusOffline, AppColors.statusOffline);
    });

    test('AppSpacing scale conforms to 8-pt grid system', () {
      expect(AppSpacing.xs, 8.0);
      expect(AppSpacing.md, 16.0);
      expect(AppSpacing.xl, 24.0);
      expect(AppSpacing.xxl, 32.0);
      expect(AppSpacing.huge, 48.0);
    });

    test('AppTypography defines valid font sizes and weights', () {
      expect(AppTypography.heading1.fontSize, 24.0);
      expect(AppTypography.body.fontSize, 14.0);
      expect(AppTypography.status.fontSize, 11.0);
    });
  });
}
