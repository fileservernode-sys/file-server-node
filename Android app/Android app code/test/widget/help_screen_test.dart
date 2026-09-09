import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/features/help/presentation/help_screen.dart';
import 'package:remote_node_app/features/help/presentation/help_topic_screen.dart';

void main() {
  group('Help & Learn Hub Widget Tests', () {
    testWidgets('HelpScreen renders hero header and all 11 category cards',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: HelpScreen(),
        ),
      );

      // Verify Hero Header
      expect(find.text('Learn how ZdexCloud works'), findsOneWidget);
      expect(find.text('Help & Learn'), findsOneWidget);

      // Verify 11 Category Cards
      expect(find.text('Getting Started'), findsOneWidget);
      expect(find.text('How It Works'), findsOneWidget);
      expect(find.text('Your Server'), findsOneWidget);
      expect(find.text('Storage & Files'), findsOneWidget);
      expect(find.text('Permissions & Battery'), findsOneWidget);
      expect(find.text('Remote Access'), findsOneWidget);
      expect(find.text('Security & Privacy'), findsOneWidget);
      expect(find.text('Accounts & Sessions'), findsOneWidget);
      expect(find.text('Multiple Servers'), findsOneWidget);
      expect(find.text('Troubleshooting'), findsOneWidget);
      expect(find.text('Contact Support'), findsNWidgets(2)); // Category card + button

      // Verify Support Section
      expect(find.text('Need more help?'), findsNWidgets(2)); // Header + card title
      expect(find.text('Full Documentation'), findsOneWidget);
    });

    testWidgets('HelpTopicScreen renders topic content and CTA button',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: HelpTopicScreen(topicId: 'getting-started'),
        ),
      );

      expect(find.text('Getting Started'), findsNWidgets(2)); // App bar + hero
      expect(find.text('Set up your Android phone as a personal file server'),
          findsOneWidget);
      expect(find.text('Key Concepts & Steps'), findsOneWidget);
      expect(find.text('View complete setup guide'), findsOneWidget);
    });

    testWidgets('HelpTopicScreen falls back safely for unknown topic ID',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: HelpTopicScreen(topicId: 'non-existent-topic'),
        ),
      );

      expect(find.text('Getting Started'), findsNWidgets(2));
    });
  });
}
