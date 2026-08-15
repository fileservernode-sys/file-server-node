import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/app_config.dart';
import 'core/routing/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/utils/logger.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Development Environment Configuration
  AppConfig.setEnvironment(AppConfig.development());
  AppLogger.info(
      'Initializing RemoteNode Android App Foundation (${AppConfig.current.environment})');

  runApp(
    const ProviderScope(
      child: RemoteNodeApp(),
    ),
  );
}

/// Root Application Widget with Lifecycle Monitoring
class RemoteNodeApp extends StatefulWidget {
  const RemoteNodeApp({super.key});

  @override
  State<RemoteNodeApp> createState() => _RemoteNodeAppState();
}

class _RemoteNodeAppState extends State<RemoteNodeApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
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
      title: 'RemoteNode Personal File Server',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      initialRoute: AppRouter.initialRoute,
      onGenerateRoute: AppRouter.generateRoute,
    );
  }
}
