import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/config/app_config.dart';

void main() {
  group('Environment Configuration Tests', () {
    test('AppConfig development factory initializes dev API base URL', () {
      final config = AppConfig.development();
      expect(config.environment, 'development');
      expect(config.apiBaseUrl, contains('api/v1'));
      expect(config.enableVerboseLogging, isTrue);
    });

    test('AppConfig production factory initializes prod API base URL', () {
      final config = AppConfig.production();
      expect(config.environment, 'production');
      expect(config.apiBaseUrl, 'https://api.remotenode.net/api/v1');
      expect(config.enableVerboseLogging, isFalse);
    });
  });
}
