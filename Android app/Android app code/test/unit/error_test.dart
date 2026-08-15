import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/errors/app_error.dart';

void main() {
  group('AppError Hierarchy Tests', () {
    test('NetworkError formats message and error code', () {
      const error = NetworkError();
      expect(error.code, 'NETWORK_ERROR');
      expect(error.toString(), contains('NETWORK_ERROR'));
    });

    test('TimeoutError formats message and error code', () {
      const error = TimeoutError();
      expect(error.code, 'TIMEOUT_ERROR');
    });

    test('AuthenticationError formats message and error code', () {
      const error = AuthenticationError();
      expect(error.code, 'UNAUTHORIZED');
    });
  });
}
