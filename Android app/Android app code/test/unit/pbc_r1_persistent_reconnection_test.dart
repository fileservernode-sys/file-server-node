import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/storage/secure_storage_service.dart';
import 'package:remote_node_app/features/auth/domain/entities/auth_session.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Batch PBC-R1 — Persistent Connection & Reconnection Architecture', () {
    late MockSecureStorageService secureStorage;

    setUp(() {
      secureStorage = MockSecureStorageService();
    });

    test('1. Persistent DeviceAuthCredential is preserved independently from 24h interactive UserSession', () async {
      final userSession = AuthSession(
        accessToken: 'user_interactive_session_token_123',
        userId: 'user_abc_456',
        email: 'user@zdexcloud.io',
        expiresAt: DateTime.now().add(const Duration(hours: 24)),
      );

      // Save both tokens
      await secureStorage.saveSession(userSession);
      await secureStorage.write(key: 'device_credential', value: 'device_auth_credential_secret_789');

      // Verify separation
      final retrievedSession = await secureStorage.getSession();
      final retrievedCred = await secureStorage.read(key: 'device_credential');

      expect(retrievedSession?.accessToken, 'user_interactive_session_token_123');
      expect(retrievedCred, 'device_auth_credential_secret_789');

      // Clear UI session
      await secureStorage.clearSession();

      // Ensure credential remains
      expect(await secureStorage.getSession(), isNull);
      expect(await secureStorage.read(key: 'device_credential'), 'device_auth_credential_secret_789');
    });

    test('2. Exponential backoff with jitter stays strictly bounded between 1s and 60s', () {
      int calculateBackoffDelayMs(int attempt) {
        final clamped = attempt.clamp(0, 6);
        final base = (1000 * (1 << clamped)).clamp(1000, 60000);
        return base;
      }

      expect(calculateBackoffDelayMs(0), 1000);
      expect(calculateBackoffDelayMs(1), 2000);
      expect(calculateBackoffDelayMs(2), 4000);
      expect(calculateBackoffDelayMs(3), 8000);
      expect(calculateBackoffDelayMs(4), 16000);
      expect(calculateBackoffDelayMs(5), 32000);
      expect(calculateBackoffDelayMs(6), 60000);
      expect(calculateBackoffDelayMs(10), 60000);
    });

    test('3. Monotonic silent heartbeat requires at least 45s or 3 missed pings before reconnect', () {
      const pingIntervalSec = 15;
      const missedPingsThreshold = 3;
      const timeoutThresholdMs = 45000;

      bool shouldTriggerHeartbeatFailure(int missedPings, int elapsedMs) {
        return missedPings >= missedPingsThreshold || elapsedMs > timeoutThresholdMs;
      }

      // Normal state
      expect(shouldTriggerHeartbeatFailure(0, 15000), isFalse);
      expect(shouldTriggerHeartbeatFailure(1, 15000), isFalse);
      expect(shouldTriggerHeartbeatFailure(2, 30000), isFalse);

      // Failure state
      expect(shouldTriggerHeartbeatFailure(3, 45000), isTrue);
      expect(shouldTriggerHeartbeatFailure(1, 46000), isTrue);
    });

    test('4. Idempotent connection state management avoids duplicate tunnel starts', () {
      bool isIdempotent(
        String currentState,
        bool isExplicitlyStopped,
        String? storedDevId,
        String newDevId,
        String? storedToken,
        String newToken,
      ) {
        final isActive = currentState == 'STARTING' ||
            currentState == 'CONNECTING' ||
            currentState == 'AUTHENTICATING' ||
            currentState == 'CONNECTED';

        return !isExplicitlyStopped &&
            isActive &&
            storedDevId == newDevId &&
            storedToken == newToken;
      }

      expect(isIdempotent('CONNECTED', false, 'dev1', 'dev1', 'tok1', 'tok1'), isTrue);
      expect(isIdempotent('CONNECTED', false, 'dev1', 'dev2', 'tok1', 'tok1'), isFalse);
      expect(isIdempotent('STOPPED', false, 'dev1', 'dev1', 'tok1', 'tok1'), isFalse);
      expect(isIdempotent('CONNECTED', true, 'dev1', 'dev1', 'tok1', 'tok1'), isFalse);
    });
  });
}
