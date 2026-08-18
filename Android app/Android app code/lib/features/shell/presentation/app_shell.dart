import 'package:flutter/material.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../home/presentation/home_screen.dart';
import '../../server/presentation/server_screen.dart';
import '../../settings/presentation/settings_screen.dart';

/// Main Application Shell — Authenticated Shell with Mobile Bottom Navigation
class AppShell extends StatefulWidget {
  final int initialIndex;

  const AppShell({
    super.key,
    this.initialIndex = 0,
  });

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  late int _currentIndex;

  final List<Widget> _pages = const [
    HomeScreen(),
    ServerScreen(),
    SettingsScreen(),
  ];

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: IndexedStack(
        index: _currentIndex,
        children: _pages,
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(
            top: BorderSide(color: AppColors.borderSubtle, width: 1.0),
          ),
          boxShadow: [
            BoxShadow(
              color: Color(0x0A0F172A),
              blurRadius: 8,
              offset: Offset(0, -2),
            ),
          ],
        ),
        child: SafeArea(
          child: SizedBox(
            height: 60.0,
            child: Row(
              children: [
                _buildNavItem(
                  index: 0,
                  icon: Icons.space_dashboard_outlined,
                  activeIcon: Icons.space_dashboard,
                  label: 'Home',
                ),
                _buildNavItem(
                  index: 1,
                  icon: Icons.dns_outlined,
                  activeIcon: Icons.dns,
                  label: 'Server',
                ),
                _buildNavItem(
                  index: 2,
                  icon: Icons.settings_outlined,
                  activeIcon: Icons.settings,
                  label: 'Settings',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem({
    required int index,
    required IconData icon,
    required IconData activeIcon,
    required String label,
  }) {
    final isSelected = _currentIndex == index;
    final color = isSelected ? AppColors.primary : AppColors.textSecondary;

    return Expanded(
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minHeight: AppConstants.minTouchTargetSize,
          minWidth: AppConstants.minTouchTargetSize,
        ),
        child: InkWell(
          onTap: () {
            setState(() {
              _currentIndex = index;
            });
          },
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: isSelected
                      ? AppColors.primarySubtle
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
                ),
                child: Icon(
                  isSelected ? activeIcon : icon,
                  color: color,
                  size: 20,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: AppTypography.caption.copyWith(
                  color: color,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                  fontSize: 11.0,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
