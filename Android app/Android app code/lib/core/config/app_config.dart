/// Centralized Environment Configuration for RemoteNode Android App
class AppConfig {
  final String environment;
  final String apiBaseUrl;
  final String webRegistrationUrl;
  final bool enableVerboseLogging;

  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.webRegistrationUrl,
    this.enableVerboseLogging = false,
  });

  /// Development Environment Configuration (Local/Staging API)
  factory AppConfig.development() {
    return const AppConfig(
      environment: 'development',
      apiBaseUrl: 'http://10.0.2.2:4000/api/v1',
      webRegistrationUrl: 'https://remotenode.net/pages/get-started.html',
      enableVerboseLogging: true,
    );
  }

  /// Production Environment Configuration
  factory AppConfig.production() {
    return const AppConfig(
      environment: 'production',
      apiBaseUrl: 'https://api.remotenode.net/api/v1',
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
