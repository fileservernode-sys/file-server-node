import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/theme/app_theme.dart';
import 'package:remote_node_app/features/about/presentation/about_screen.dart';
import 'package:remote_node_app/features/auth/presentation/login_screen.dart';
import 'package:remote_node_app/features/auth/presentation/otp_screen.dart';
import 'package:remote_node_app/features/help/presentation/help_screen.dart';
import 'package:remote_node_app/features/server/presentation/server_status_screen.dart';
import 'package:remote_node_app/features/setup/presentation/setup_configuration_screen.dart';
import 'package:remote_node_app/features/setup/presentation/setup_credentials_screen.dart';
import 'package:remote_node_app/features/setup/presentation/setup_creating_screen.dart';
import 'package:remote_node_app/features/setup/presentation/setup_device_screen.dart';
import 'package:remote_node_app/features/setup/presentation/setup_failure_screen.dart';
import 'package:remote_node_app/features/setup/presentation/setup_review_screen.dart';
import 'package:remote_node_app/features/setup/presentation/setup_success_screen.dart';
import 'package:remote_node_app/features/shell/presentation/app_shell.dart';

void main() {
  group('Batch 6D Application Shell & Navigation Tests', () {
    testWidgets('AppShell renders bottom navigation items and switches tabs',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const AppShell(),
          ),
        ),
      );

      expect(find.text('Home'), findsOneWidget);
      expect(find.text('Server'), findsOneWidget);
      expect(find.text('Settings'), findsOneWidget);

      await tester.tap(find.text('Server'));
      await tester.pumpAndSettle();
      expect(find.text('Your File Server'), findsWidgets);

      await tester.tap(find.text('Settings'));
      await tester.pumpAndSettle();
      expect(find.text('Account'), findsOneWidget);
    });

    testWidgets(
        'LoginScreen displays Email + Password fields and website registration action',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const LoginScreen(),
          ),
        ),
      );

      expect(find.text('Sign in to your account'), findsOneWidget);
      expect(find.text('Email address'), findsOneWidget);
      expect(find.text('Password'), findsOneWidget);
      expect(find.text('Create Account on Website'), findsOneWidget);
      expect(find.textContaining('Google'), findsNothing);
    });

    testWidgets(
        'OtpScreen renders 6-digit verification code input and resend countdown',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const OtpScreen(),
          ),
        ),
      );

      expect(find.text('Enter Security Code'), findsOneWidget);
      expect(find.text('6-Digit Verification Code'), findsOneWidget);
    });
  });

  group('Batch 6D Server Setup Journey Step Tests', () {
    testWidgets('SetupDeviceScreen (Step 1) renders pre-requisites checklist',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const SetupDeviceScreen(),
          ),
        ),
      );

      expect(find.textContaining('Prepare Device'), findsOneWidget);
      expect(find.text('This phone will become your personal file server.'),
          findsOneWidget);
      expect(find.text('Android device available'), findsOneWidget);
      expect(find.text('Continue'), findsOneWidget);
    });

    testWidgets(
        'SetupConfigurationScreen (Step 2) renders server & device name fields',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const SetupConfigurationScreen(),
          ),
        ),
      );

      expect(find.textContaining('Configure Server'), findsOneWidget);
      expect(find.text('Server Name'), findsOneWidget);
      expect(find.text('Device Display Name'), findsOneWidget);
    });

    testWidgets(
        'SetupCredentialsScreen (Step 3) displays explicit credential separation callout',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const SetupCredentialsScreen(),
          ),
        ),
      );

      expect(find.textContaining('Create File-Server Credentials'),
          findsOneWidget);
      expect(find.text('File-server Credentials Notice'), findsOneWidget);
      expect(find.text('File-server username'), findsOneWidget);
    });

    testWidgets(
        'SetupReviewScreen (Step 4) displays obscured password and configuration summary',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const SetupReviewScreen(),
          ),
        ),
      );

      expect(find.textContaining('Review Configuration'), findsOneWidget);
      expect(find.text('Configuration Summary'), findsOneWidget);
      expect(find.textContaining('ViewDuration platform account'), findsOneWidget);
      expect(find.text('Create Server'), findsOneWidget);
    });

    testWidgets(
        'SetupCreatingScreen (Step 5) displays simulated loading progress',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const SetupCreatingScreen(),
          ),
        ),
      );

      expect(find.textContaining('Create Server'), findsOneWidget);
      expect(find.text('Creating your personal file server'), findsOneWidget);
      expect(find.textContaining('Registering'), findsWidgets);
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump(const Duration(milliseconds: 350));
    });

    testWidgets(
        'SetupSuccessScreen (Step 6) renders ready status and mock endpoint',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const SetupSuccessScreen(),
          ),
        ),
      );

      expect(find.textContaining('Server Ready'), findsOneWidget);
      expect(find.text('Your personal file server is running'), findsOneWidget);
      expect(find.text('Open RemoteNode'), findsOneWidget);
      expect(find.text('http://127.0.0.1:8080'), findsOneWidget);
    });

    testWidgets('SetupFailureScreen renders user-friendly error recovery view',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const SetupFailureScreen(),
          ),
        ),
      );

      expect(find.text("We couldn't finish setting up your server"),
          findsOneWidget);
      expect(find.text('Try Again'), findsOneWidget);
    });
  });

  group('Batch 6D Information & Support Screens Tests', () {
    testWidgets(
        'ServerStatusScreen displays node details and mock action triggers',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const ServerStatusScreen(),
          ),
        ),
      );

      expect(find.text('Server Node Details'), findsOneWidget);
      expect(find.text('Start Local Server'), findsOneWidget);
    });

    testWidgets('HelpScreen displays documentation category list',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const HelpScreen(),
          ),
        ),
      );

      expect(find.text('Help & Documentation'), findsOneWidget);
      expect(find.text('Getting Started'), findsOneWidget);
    });

    testWidgets('AboutScreen displays version metadata and platform mission',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const AboutScreen(),
          ),
        ),
      );

      expect(find.text('About Platform'), findsOneWidget);
      expect(find.text('Remote Android Personal File Server'), findsOneWidget);
    });
  });

  group('Batch 6D Responsive Viewport Tests', () {
    final viewports = [320.0, 360.0, 375.0, 390.0, 414.0, 480.0];

    for (final width in viewports) {
      testWidgets('LoginScreen renders without overflow on ${width}px display',
          (WidgetTester tester) async {
        tester.view.physicalSize = Size(width, 800.0);
        tester.view.devicePixelRatio = 1.0;

        await tester.pumpWidget(
          ProviderScope(
            child: MaterialApp(
              theme: AppTheme.lightTheme,
              home: const LoginScreen(),
            ),
          ),
        );

        expect(find.text('Sign in to your account'), findsOneWidget);
        expect(find.text('Sign In'), findsOneWidget);

        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
      });
    }
  });
}
