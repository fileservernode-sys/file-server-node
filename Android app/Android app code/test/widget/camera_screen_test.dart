// Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
// Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/theme/app_theme.dart';
import 'package:remote_node_app/features/camera/application/camera_state.dart';
import 'package:remote_node_app/features/camera/domain/entities/camera_hardware_info.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_hardware_service.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_permission_service.dart';
import 'package:remote_node_app/features/camera/domain/services/camera_registration_service.dart';
import 'package:remote_node_app/features/camera/presentation/camera_screen.dart';
import 'package:remote_node_app/features/camera/presentation/widgets/camera_preview_standby.dart';
import 'package:remote_node_app/features/camera/presentation/widgets/camera_status_badge.dart';

void main() {
  group('Phase 21.3 / 21.3.1 — Camera Mode Widget Tests [NOT RUN — DEFERRED TO PHASE 28]', () {
    testWidgets('CameraScreen renders header, permission card, and configuration UI',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            cameraStateProvider.overrideWith((ref) => CameraStateNotifier(
                  permissionService: MockCameraPermissionService(
                    cameraStatus: CameraPermissionStatus.denied,
                    micStatus: CameraPermissionStatus.denied,
                  ),
                  hardwareService: MockCameraHardwareService(),
                  registrationService: MockCameraRegistrationService(),
                )),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const CameraScreen(),
          ),
        ),
      );

      // Verify Header & Status
      expect(find.text('ZdexCloud Camera'), findsOneWidget);
      expect(find.text('Remote Security Camera Mode'), findsOneWidget);
      expect(find.byType(CameraStatusBadge), findsOneWidget);
      expect(find.text('NOT CONFIGURED'), findsOneWidget);

      // Verify Preview Standby
      expect(find.byType(CameraPreviewStandby), findsOneWidget);
      expect(find.text('Camera Standby'), findsOneWidget);
      expect(find.text('PREVIEW STANDBY'), findsOneWidget);
      expect(find.text('VIEWERS: NOT CONNECTED'), findsOneWidget);

      // Verify Primary Action Button
      expect(find.text('Start Camera Mode'), findsOneWidget);

      // Verify Permission Card (Phase 21.3)
      expect(find.text('Camera Permission Required'), findsOneWidget);
      expect(find.text('Grant Camera Access'), findsOneWidget);

      // Verify Information Grid (Honest Preferences & Placeholders)
      expect(find.text('Camera Information'), findsOneWidget);
      expect(find.text('Local Display Name'), findsOneWidget);
      expect(find.text('Signaling Gateway'), findsOneWidget);
      expect(find.text('Configured Preset'), findsOneWidget);
      expect(find.text('Active Stream Viewers'), findsOneWidget);
      expect(find.text('Not Connected'), findsWidgets);

      // Verify Configuration Section
      expect(find.text('Capture Configuration'), findsOneWidget);
      expect(find.text('Hardware Lens'), findsOneWidget);
      expect(find.text('Back (Primary)'), findsWidgets);
      expect(find.text('Front (Selfie)'), findsWidgets);
      expect(find.text('Video Resolution'), findsOneWidget);
      expect(find.text('Target Frame Rate'), findsOneWidget);
      expect(find.text('Microphone Audio'), findsOneWidget);
      expect(find.text('OPTIONAL'), findsOneWidget);

      // Verify Combination Support Indicator (Phase 21.3.1)
      expect(find.textContaining('Combination:'), findsOneWidget);

      // Verify Action Buttons
      expect(find.text('Save Preferences'), findsOneWidget);
      expect(find.text('Register Node'), findsOneWidget);

      // Verify Coexistence Card (Accurate Architecture Copy)
      expect(find.text('Single-App Architecture & Service Lifecycle'), findsOneWidget);
    });

    testWidgets('Tapping Grant Camera Access opens explanatory dialog first',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            cameraStateProvider.overrideWith((ref) => CameraStateNotifier(
                  permissionService: MockCameraPermissionService(
                    cameraStatus: CameraPermissionStatus.denied,
                    micStatus: CameraPermissionStatus.denied,
                  ),
                  hardwareService: MockCameraHardwareService(),
                  registrationService: MockCameraRegistrationService(),
                )),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const CameraScreen(),
          ),
        ),
      );

      await tester.tap(find.text('Grant Camera Access'));
      await tester.pumpAndSettle();

      expect(find.text('Camera Access Required'), findsOneWidget);
      expect(find.text('Authorize Camera'), findsOneWidget);
      expect(find.text('Not Now'), findsOneWidget);
    });

    testWidgets('Permanently denied camera permission renders Open App Settings button',
        (WidgetTester tester) async {
      final mockPerms = MockCameraPermissionService(
        cameraStatus: CameraPermissionStatus.permanentlyDenied,
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            cameraStateProvider.overrideWith((ref) => CameraStateNotifier(
                  permissionService: mockPerms,
                  hardwareService: MockCameraHardwareService(),
                  registrationService: MockCameraRegistrationService(),
                )),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const CameraScreen(),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Camera Permission Permanently Denied'), findsOneWidget);
      expect(find.text('Open App Settings'), findsOneWidget);
    });
  });
}
