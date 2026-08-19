/// Centralized Environment Configuration for RemoteNode Android App
class AppConfig {
  final String environment;
  final String baseDomain;
  final String websiteUrl;
  final String apiBaseUrl;
  final String gatewayWsUrl;
  final String webRegistrationUrl;
  final bool enableVerboseLogging;

  const AppConfig({
    required this.environment,
    required this.baseDomain,
    required this.websiteUrl,
    required this.apiBaseUrl,
    required this.gatewayWsUrl,
    required this.webRegistrationUrl,
    this.enableVerboseLogging = false,
  });

  /// Development Environment Configuration (Local/Emulator loopback)
  factory AppConfig.development() {
    return const AppConfig(
      environment: 'development',
      baseDomain: 'localhost',
      websiteUrl: 'http://10.0.2.2:3000/?from=app',
      apiBaseUrl: 'http://10.0.2.2:4000/api/v1',
      gatewayWsUrl: 'ws://10.0.2.2:4001',
      webRegistrationUrl: 'http://10.0.2.2:3000/pages/get-started.html',
      enableVerboseLogging: true,
    );
  }

  /// Testing & Staging Environment Configuration (Temporary testing domain: viewduration.com)
  factory AppConfig.testing() {
    return const AppConfig(
      environment: 'testing',
      baseDomain: 'file-server-node-1.onrender.com',
      websiteUrl: 'https://file-server-node-1.onrender.com/?from=app',
      apiBaseUrl: 'https://file-server-node-1.onrender.com/api/v1',
      gatewayWsUrl: 'wss://file-server-node-1.onrender.com',
      webRegistrationUrl: 'https://file-server-node-1.onrender.com/pages/get-started.html',
      enableVerboseLogging: true,
    );
  }

  /// Production Environment Configuration (Configurable production domain)
  factory AppConfig.production({String baseDomain = 'remotenode.net'}) {
    return AppConfig(
      environment: 'production',
      baseDomain: baseDomain,
      websiteUrl: 'https://$baseDomain/?from=app',
      apiBaseUrl: 'https://api.$baseDomain/api/v1',
      gatewayWsUrl: 'wss://gateway.$baseDomain',
      webRegistrationUrl: 'https://$baseDomain/pages/get-started.html',
      enableVerboseLogging: false,
    );
  }

  static AppConfig _current = AppConfig.testing();

  static AppConfig get current => _current;

  static void setEnvironment(AppConfig config) {
    _current = config;
  }
}
