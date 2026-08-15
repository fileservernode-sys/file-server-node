import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/widgets/status_badge.dart';

void main() {
  group('StatusBadge Widget Tests', () {
    testWidgets('StatusBadge renders ONLINE status text correctly',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: StatusBadge(status: DeviceServerStatus.online),
          ),
        ),
      );

      expect(find.text('ONLINE'), findsOneWidget);
    });

    testWidgets('StatusBadge renders OFFLINE status text correctly',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: StatusBadge(status: DeviceServerStatus.offline),
          ),
        ),
      );

      expect(find.text('OFFLINE'), findsOneWidget);
    });
  });
}
