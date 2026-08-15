/// Centralized Environment Configuration for RemoteNode Android App
class AppConfig {
  final String environment;
  final String apiBaseUrl;
  final String gatewayWsUrl;
  final String webRegistrationUrl;
  final bool enableVerboseLogging;

  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.gatewayWsUrl,
    required this.webRegistrationUrl,
    this.enableVerboseLogging = false,
  });

  /// Development Environment Configuration (Local/Staging API & Gateway)
  factory AppConfig.development() {
    return const AppConfig(
      environment: 'development',
      apiBaseUrl: 'http://10.0.2.2:4000/api/v1',
      gatewayWsUrl: 'ws://10.0.2.2:4001',
      webRegistrationUrl: 'https://remotenode.net/pages/get-started.html',
      enableVerboseLogging: true,
    );
  }

  /// Production Environment Configuration (Secure WSS Gateway)
  factory AppConfig.production() {
    return const AppConfig(
      environment: 'production',
      apiBaseUrl: 'https://api.remotenode.net/api/v1',
      gatewayWsUrl: 'wss://gateway.remotenode.net',
      webRegistrationUrl: 'https://remotenode.net/pages/get-started.html',
      enableVerboseLogging: false,
    );
  }

  static AppConfig _current = AppConfig.development();

  static AppConfig get current => _current;

  static void setEnvironment(AppConfig config) {
    _current = config;
  }
}
