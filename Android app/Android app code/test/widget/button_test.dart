import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/widgets/app_button.dart';

void main() {
  group('AppButton Widget Tests', () {
    testWidgets('PrimaryButton renders label and triggers onPressed',
        (WidgetTester tester) async {
      bool pressed = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PrimaryButton(
              label: 'Submit Action',
              onPressed: () => pressed = true,
            ),
          ),
        ),
      );

      expect(find.text('Submit Action'), findsOneWidget);
      await tester.tap(find.text('Submit Action'));
      expect(pressed, isTrue);
    });

    testWidgets(
        'PrimaryButton renders loading indicator when isLoading is true',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PrimaryButton(
              label: 'Submit Action',
              isLoading: true,
              onPressed: () {},
            ),
          ),
        ),
      );

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Submit Action'), findsNothing);
    });
  });
}
