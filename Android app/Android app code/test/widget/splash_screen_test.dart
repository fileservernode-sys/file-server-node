import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:remote_node_app/core/routing/app_router.dart';
import 'package:remote_node_app/features/splash/presentation/splash_screen.dart';

void main() {
  group('SplashScreen Widget Tests', () {
    testWidgets('SplashScreen renders RemoteNode branding and progress indicator',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            initialRoute: '/',
            onGenerateRoute: AppRouter.generateRoute,
          ),
        ),
      );

      // Verify Brand Name Text
      expect(find.text('Remote'), findsOneWidget);
      expect(find.text('Node'), findsOneWidget);
      expect(find.text('Personal Storage & Local Server Host'), findsOneWidget);

      // Verify Loading Indicator
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Starting secure server engine...'), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 500));
      await tester.pump(const Duration(seconds: 1));
      await tester.pump(const Duration(seconds: 2));
    });
  });
}
