import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/app_config.dart';
import 'core/notifications/push_notification_service.dart';
import 'core/routing/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/utils/logger.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Testing/Staging Environment Configuration (Connects to live https://api.zdexcloud.com/api/v1)
  AppConfig.setEnvironment(AppConfig.testing());
  AppLogger.info(
      'Initializing ZdexCloud Android App Foundation (${AppConfig.current.environment} -> ${AppConfig.current.apiBaseUrl})');

  runApp(
    const ProviderScope(
      child: ZdexCloudApp(),
    ),
  );
}

/// Backward compatibility alias for legacy tests and references
typedef RemoteNodeApp = ZdexCloudApp;

/// Root Application Widget with Lifecycle Monitoring
class ZdexCloudApp extends StatefulWidget {
  const ZdexCloudApp({super.key});

  @override
  State<ZdexCloudApp> createState() => _ZdexCloudAppState();
}

class _ZdexCloudAppState extends State<ZdexCloudApp>
    with WidgetsBindingObserver {
  final _pushService = PushNotificationService();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _pushService.initialize();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    AppLogger.info('App Lifecycle State changed: $state');
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ZdexCloud Personal File Server',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      initialRoute: AppRouter.initialRoute,
      onGenerateRoute: AppRouter.generateRoute,
    );
  }
}
