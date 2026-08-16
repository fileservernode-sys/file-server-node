import 'package:flutter/material.dart';
import '../../features/about/presentation/about_screen.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/otp_screen.dart';
import '../../features/help/presentation/help_screen.dart';
import '../../features/server/presentation/server_status_screen.dart';
import '../../features/setup/presentation/setup_configuration_screen.dart';
import '../../features/setup/presentation/setup_credentials_screen.dart';
import '../../features/setup/presentation/setup_creating_screen.dart';
import '../../features/setup/presentation/setup_device_screen.dart';
import '../../features/setup/presentation/setup_failure_screen.dart';
import '../../features/setup/presentation/setup_review_screen.dart';
import '../../features/setup/presentation/setup_success_screen.dart';
import '../../features/shell/presentation/app_shell.dart';
import '../../features/showcase/presentation/design_system_showcase_screen.dart';
import '../../features/splash/presentation/splash_screen.dart';

/// Centralized Router Architecture — Manages Unauthenticated & Authenticated Journeys
class AppRouter {
  static const String initialRoute = '/';

  // Splash & Starting Route
  static const String splashRoute = '/splash';

  // Unauthenticated / Auth Routes (Email + Password + OTP Only)
  static const String authRoute = '/auth';
  static const String loginRoute = '/login';
  static const String otpRoute = '/auth/otp';

  // Authenticated Shell Routes
  static const String homeRoute = '/home';
  static const String serverRoute = '/server';
  static const String settingsRoute = '/settings';

  // Server Setup Journey Routes
  static const String setupDeviceRoute = '/server/setup/device';
  static const String setupConfigRoute = '/server/setup/configuration';
  static const String setupCredentialsRoute = '/server/setup/credentials';
  static const String setupReviewRoute = '/server/setup/review';
  static const String setupCreatingRoute = '/server/setup/creating';
  static const String setupSuccessRoute = '/server/setup/success';
  static const String setupFailureRoute = '/server/setup/failure';

  // Status & Information Routes
  static const String serverStatusRoute = '/server/status';
  static const String helpRoute = '/help';
  static const String aboutRoute = '/about';
  static const String showcaseRoute = '/showcase';

  static Route<dynamic> generateRoute(RouteSettings settings) {
    switch (settings.name) {
      case initialRoute:
      case splashRoute:
        return MaterialPageRoute(
          builder: (_) => const SplashScreen(),
          settings: settings,
        );
      case authRoute:
      case loginRoute:
        return MaterialPageRoute(
          builder: (_) => const LoginScreen(),
          settings: settings,
        );
      case otpRoute:
        return MaterialPageRoute(
          builder: (_) => const OtpScreen(),
          settings: settings,
        );
      case homeRoute:
        return MaterialPageRoute(
          builder: (_) => const AppShell(initialIndex: 0),
          settings: settings,
        );
      case serverRoute:
        return MaterialPageRoute(
          builder: (_) => const AppShell(initialIndex: 1),
          settings: settings,
        );
      case settingsRoute:
        return MaterialPageRoute(
          builder: (_) => const AppShell(initialIndex: 2),
          settings: settings,
        );
      case setupDeviceRoute:
        return MaterialPageRoute(
          builder: (_) => const SetupDeviceScreen(),
          settings: settings,
        );
      case setupConfigRoute:
        return MaterialPageRoute(
          builder: (_) => const SetupConfigurationScreen(),
          settings: settings,
        );
      case setupCredentialsRoute:
        return MaterialPageRoute(
          builder: (_) => const SetupCredentialsScreen(),
          settings: settings,
        );
      case setupReviewRoute:
        return MaterialPageRoute(
          builder: (_) => const SetupReviewScreen(),
          settings: settings,
        );
      case setupCreatingRoute:
        return MaterialPageRoute(
          builder: (_) => const SetupCreatingScreen(),
          settings: settings,
        );
      case setupSuccessRoute:
        return MaterialPageRoute(
          builder: (_) => const SetupSuccessScreen(),
          settings: settings,
        );
      case setupFailureRoute:
        return MaterialPageRoute(
          builder: (_) => const SetupFailureScreen(),
          settings: settings,
        );
      case serverStatusRoute:
        return MaterialPageRoute(
          builder: (_) => const ServerStatusScreen(),
          settings: settings,
        );
      case helpRoute:
        return MaterialPageRoute(
          builder: (_) => const HelpScreen(),
          settings: settings,
        );
      case aboutRoute:
        return MaterialPageRoute(
          builder: (_) => const AboutScreen(),
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
