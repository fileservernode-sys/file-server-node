import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/app_config.dart';
import 'core/notifications/notification_router.dart';
import 'core/notifications/push_notification_service.dart';
import 'core/routing/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/utils/logger.dart';
import 'core/storage/secure_storage_service.dart';
import 'features/auth/application/auth_state.dart';
import 'features/camera/application/camera_state.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Register Camera immediate invalidation hook at application startup (Phase 21.3.7).
  // Runs synchronously BEFORE any async repository or network logout, independently
  // of whether CameraScreen has ever been opened.
  AuthStateNotifier.registerImmediateInvalidationHook(CameraStateNotifier.invalidateAllActiveRegistrations);

  // Register Camera secure storage cleanup on auth session clearance (Phase 21.3.4 / 21.3.7).
  // This hook runs even when CameraScreen / cameraStateProvider is not alive.
  AuthStateNotifier.registerSessionClearedHook(() async {
    await CameraStateNotifier.handleGlobalSessionCleared(FileSecureStorageService());
  });

  // Initialize Testing/Staging Environment Configuration (Connects to live https://api.zdexcloud.com/api/v1)
  AppConfig.setEnvironment(AppConfig.testing());
  AppLogger.info(
      'Initializing ZdexCloud Android App Foundation (\ -> \)');

  runApp(
    const ProviderScope(
      child: ZdexCloudApp(),
    ),
  );
}

/// Backward compatibility alias for legacy tests and references
typedef RemoteNodeApp = ZdexCloudApp;

/// Root Application Widget with Lifecycle Monitoring.
///
/// Implements root WidgetsBindingObserver to validate session expiry whenever the
/// application returns to the foreground, regardless of which route or tab is open (Phase 21.3.6 / 21.3.7).
class ZdexCloudApp extends ConsumerStatefulWidget {
  const ZdexCloudApp({super.key});

  @override
  ConsumerState<ZdexCloudApp> createState() => _ZdexCloudAppState();
}

class _ZdexCloudAppState extends ConsumerState<ZdexCloudApp>
    with WidgetsBindingObserver {
  final _pushService = PushNotificationService();
  StreamSubscription<NotificationTarget>? _tapSubscription;

  /// Concurrency guard: prevents overlapping validation runs if the OS fires
  /// multiple rapid lifecycle events (e.g. split-screen, partial occlusion, quick toggle).
  bool _isValidatingResume = false;

  /// Tracks observer registration to avoid duplicate registrations during widget lifecycle.
  bool _isObserverRegistered = false;

  @override
  void initState() {
    super.initState();
    if (!_isObserverRegistered) {
      WidgetsBinding.instance.addObserver(this);
      _isObserverRegistered = true;
    }

    // Ensure immediate invalidation hook is registered at the root widget lifecycle boundary.
    // Idempotent: checks for existence before adding, preventing duplicate registration.
    AuthStateNotifier.registerImmediateInvalidationHook(CameraStateNotifier.invalidateAllActiveRegistrations);

    _pushService.initialize();
    _tapSubscription = _pushService.onNotificationTap.listen(_handleNotificationNavigation);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _pushService.checkInitialNotification();
    });
  }

  void _handleNotificationNavigation(NotificationTarget target) {
    AppLogger.info('[AppRouter] Executing notification navigation target: ');
    final nav = AppRouter.navigatorKey.currentState;
    if (nav == null) return;

    switch (target.type) {
      case NotificationTargetType.serverDetail:
        nav.pushNamed(AppRouter.serverStatusRoute);
        break;
      case NotificationTargetType.securitySettings:
      case NotificationTargetType.deviceDetail:
        nav.pushNamed(AppRouter.settingsRoute);
        break;
      case NotificationTargetType.billing:
        nav.pushNamed(AppRouter.notificationsRoute);
        break;
      case NotificationTargetType.fileManager:
      case NotificationTargetType.dashboard:
      case NotificationTargetType.unknown:
        nav.pushNamed(AppRouter.homeRoute);
        break;
    }
  }

  @override
  void dispose() {
    if (_isObserverRegistered) {
      WidgetsBinding.instance.removeObserver(this);
      _isObserverRegistered = false;
    }

    // Safely unregister root hook when root widget is disposed
    AuthStateNotifier.unregisterImmediateInvalidationHook(CameraStateNotifier.invalidateAllActiveRegistrations);

    _tapSubscription?.cancel();
    _pushService.dispose();
    super.dispose();
  }

  /// Global app-lifecycle resume handler (Phase 21.3.6 / 21.3.7 / 21.3.8).
  ///
  /// Validates session expiry whenever the application comes back to the foreground,
  /// across all tabs/routes (Home, Storage Server, Camera, Settings).
  ///
  /// Concurrency & Fault-Tolerance Guarantees (Phase 21.3.8):
  /// 1. Guarded by [_isValidatingResume] to prevent duplicate concurrent validation calls.
  /// 2. Asynchronous validation failures are explicitly caught in [_performResumeValidation],
  ///    ensuring NO unhandled Future is propagated to the root event loop.
  /// 3. [_isValidatingResume] is ALWAYS reset in a finally block, ensuring subsequent resume
  ///    events can retry validation.
  /// 4. Failed validations use safe, non-sensitive diagnostic logs and never falsely mark
  ///    an invalid/expired session as valid.
  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycleState) {
    AppLogger.info('App Lifecycle State changed: ');

    if (lifecycleState == AppLifecycleState.resumed) {
      if (_isValidatingResume) {
        AppLogger.info('[Resume] Session validation already in progress — skipping duplicate event.');
        return;
      }
      _isValidatingResume = true;

      _performResumeValidation();
    }
  }

  /// Executes resume validation with explicit asynchronous error catching.
  Future<void> _performResumeValidation() async {
    try {
      final isValid =
          await ref.read(authStateProvider.notifier).validateSessionOnResume();
      if (!isValid) {
        AppLogger.info('[Resume] Session validation completed: session is invalid or expired.');
      } else {
        AppLogger.info('[Resume] Session validation completed: session is active.');
      }
    } catch (_) {
      // Catch all asynchronous validation rejections safely.
      // Log sanitized diagnostic message without any credentials or tokens.
      AppLogger.warning(
          '[Resume] Session validation encountered an error during resume. Safe retry permitted on next resume.');
    } finally {
      _isValidatingResume = false;
    }
  }
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: AppRouter.navigatorKey,
      title: 'ZdexCloud Personal File Server',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      initialRoute: AppRouter.initialRoute,
      onGenerateRoute: AppRouter.generateRoute,
    );
  }
}
