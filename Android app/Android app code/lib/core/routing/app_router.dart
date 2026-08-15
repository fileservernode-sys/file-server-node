import 'package:flutter/material.dart';
import '../../features/auth/presentation/auth_foundation_screen.dart';
import '../../features/dashboard/presentation/dashboard_foundation_screen.dart';
import '../../features/setup/presentation/setup_foundation_screen.dart';
import '../../features/showcase/presentation/design_system_showcase_screen.dart';

/// Centralized Router Architecture
class AppRouter {
  static const String initialRoute = '/';
  static const String authRoute = '/auth';
  static const String dashboardRoute = '/dashboard';
  static const String setupRoute = '/setup';
  static const String showcaseRoute = '/showcase';

  static Route<dynamic> generateRoute(RouteSettings settings) {
    switch (settings.name) {
      case initialRoute:
      case authRoute:
        return MaterialPageRoute(
          builder: (_) => const AuthFoundationScreen(),
          settings: settings,
        );
      case dashboardRoute:
        return MaterialPageRoute(
          builder: (_) => const DashboardFoundationScreen(),
          settings: settings,
        );
      case setupRoute:
        return MaterialPageRoute(
          builder: (_) => const SetupFoundationScreen(),
          settings: settings,
        );
      case showcaseRoute:
        return MaterialPageRoute(
          builder: (_) => const DesignSystemShowcaseScreen(),
          settings: settings,
        );
      default:
        return MaterialPageRoute(
          builder: (_) => Scaffold(
            body: Center(
              child: Text('No route defined for ${settings.name}'),
            ),
          ),
        );
    }
  }
}
