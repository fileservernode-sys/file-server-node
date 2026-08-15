import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/theme/app_theme.dart';
import 'package:remote_node_app/core/widgets/app_card.dart';
import 'package:remote_node_app/core/widgets/app_header.dart';
import 'package:remote_node_app/core/widgets/app_text_field.dart';
import 'package:remote_node_app/core/widgets/empty_state.dart';
import 'package:remote_node_app/core/widgets/error_message.dart';
import 'package:remote_node_app/core/widgets/loading_indicator.dart';
import 'package:remote_node_app/features/dashboard/presentation/dashboard_foundation_screen.dart';

void main() {
  group('UI Design System Widget Tests', () {
    testWidgets('AppTextField renders label, hint, and error text correctly',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(
            body: AppTextField(
              label: 'Username',
              hintText: 'Enter username',
              errorText: 'Username required',
            ),
          ),
        ),
      );

      expect(find.text('Username'), findsOneWidget);
      expect(find.text('Enter username'), findsOneWidget);
      expect(find.text('Username required'), findsOneWidget);
    });

    testWidgets(
        'EmptyStateView renders title, description, and primary action label',
        (WidgetTester tester) async {
      bool actionTapped = false;
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(
            body: EmptyStateView(
              icon: Icons.inbox,
              title: 'No Data',
              description: 'There is no information to display.',
              actionLabel: 'Refresh',
              onAction: () => actionTapped = true,
            ),
          ),
        ),
      );

      expect(find.text('No Data'), findsOneWidget);
      expect(find.text('There is no information to display.'), findsOneWidget);
      await tester.tap(find.text('Refresh'));
      expect(actionTapped, isTrue);
    });

    testWidgets('ErrorMessageBanner renders human readable error text',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(
            body: ErrorMessageBanner(
              message:
                  'Unable to connect. Check your internet connection and try again.',
            ),
          ),
        ),
      );

      expect(
          find.text(
              'Unable to connect. Check your internet connection and try again.'),
          findsOneWidget);
    });

    testWidgets('AppCard renders child content inside container',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(
            body: AppCard(
              child: Text('Card Content'),
            ),
          ),
        ),
      );

      expect(find.text('Card Content'), findsOneWidget);
    });

    testWidgets('AppHeader renders title and back button',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(
            appBar: AppHeader(
              title: 'Settings',
              showBackButton: true,
            ),
          ),
        ),
      );

      expect(find.text('Settings'), findsOneWidget);
      expect(find.byIcon(Icons.arrow_back), findsOneWidget);
    });

    testWidgets('SkeletonLoader renders without error',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(
            body: SkeletonLoader(height: 24, width: 100),
          ),
        ),
      );

      expect(find.byType(SkeletonLoader), findsOneWidget);
    });
  });

  group('Responsive Layout Viewport Tests', () {
    final viewports = [320.0, 360.0, 375.0, 390.0, 414.0, 480.0];

    for (final width in viewports) {
      testWidgets(
          'DashboardFoundationScreen renders without overflow on width ${width}px',
          (WidgetTester tester) async {
        tester.view.physicalSize = Size(width, 800.0);
        tester.view.devicePixelRatio = 1.0;

        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.lightTheme,
            home: const DashboardFoundationScreen(),
          ),
        );

        expect(find.text('Personal File Server'), findsOneWidget);
        expect(find.text('Welcome back'), findsOneWidget);
        expect(find.text('Your device'), findsOneWidget);

        // Reset view size
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
      });
    }
  });
}
