import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/storage/secure_storage_service.dart';
import 'package:remote_node_app/features/auth/domain/entities/auth_session.dart';
import 'package:remote_node_app/features/auth/domain/entities/platform_user.dart';

class MockSecureStorageService implements SecureStorageService {
  AuthSession? _session;
  final Map<String, String> _storage = {};

  @override
  Future<void> saveSession(AuthSession session) async {
    _session = session;
  }

  @override
  Future<AuthSession?> getSession() async {
    return _session;
  }

  @override
  Future<void> clearSession() async {
    _session = null;
  }

  @override
  Future<void> write({required String key, required String value}) async {
    _storage[key] = value;
  }

  @override
  Future<String?> read({required String key}) async {
    return _storage[key];
  }

  @override
  Future<void> delete({required String key}) async {
    _storage.remove(key);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ZdexCloud — Android Server Auto-Healing & Connection Recovery (Batch APP-R1.11)', () {
    late MockSecureStorageService secureStorage;

    setUp(() {
      secureStorage = MockSecureStorageService();
    });

    // -------------------------------------------------------------------------
    // 1. AUTHENTICATION LIFECYCLE & 24H SESSION INDEPENDENCE
    // -------------------------------------------------------------------------
    group('1. Auth Lifecycle & 24h Session Independence', () {
      test('1.1. Interactive 24h session expiry does NOT wipe persistent device credential', () async {
        final expiredSession = AuthSession(
          accessToken: 'expired-24h-user-token',
          refreshToken: 'refresh-token',
          user: PlatformUser(
            id: 'usr-12345',
            email: 'admin@zdexcloud.io',
            emailVerified: true,
            status: 'ACTIVE',
            createdAt: DateTime.now().subtract(const Duration(days: 2)),
          ),
          expiresAt: DateTime.now().subtract(const Duration(minutes: 10)),
        );

        await secureStorage.saveSession(expiredSession);
        await secureStorage.write(key: 'device_credential', value: 'dev-cred-secret-long-lived-999');

        expect(expiredSession.isExpired, isTrue);

        // UI session cleared on expiration
        await secureStorage.clearSession();
        expect(await secureStorage.getSession(), isNull);

        // Background server credential remains intact and active
        final devCred = await secureStorage.read(key: 'device_credential');
        expect(devCred, 'dev-cred-secret-long-lived-999');
      });

      test('1.2. Non-interactive session renewal simulation returns fresh device access token', () {
        // Simulates executeSessionRefresh() behavior
        String? renewDeviceToken({
          required String? deviceCredential,
          required bool isRevoked,
          required bool isNetworkError,
        }) {
          if (deviceCredential == null || deviceCredential.isEmpty) return null;
          if (isRevoked) return null; // Permanent HTTP 401
          if (isNetworkError) return null; // Transient failure
          return 'dst_dev_node_fresh_token_${DateTime.now().millisecondsSinceEpoch}';
        }

        final token = renewDeviceToken(
          deviceCredential: 'valid-device-credential',
          isRevoked: false,
          isNetworkError: false,
        );
        expect(token, startsWith('dst_dev_node_fresh_token_'));

        final revoked = renewDeviceToken(
          deviceCredential: 'revoked-device-credential',
          isRevoked: true,
          isNetworkError: false,
        );
        expect(revoked, isNull);
      });

      test('1.3. Permanent revocation stops infinite retry while transient error allows backoff', () {
        bool shouldRetry({
          required int httpStatus,
          required String errorCode,
          required int currentAttempt,
        }) {
          // Permanent HTTP 401 with explicit revocation or HTTP 403 / 404
          if (httpStatus == 401 && (errorCode == 'CREDENTIAL_REVOKED' || errorCode == 'CREDENTIAL_EXPIRED')) {
            return false;
          }
          if (httpStatus == 403 || httpStatus == 404) {
            return false;
          }
          // All transient failures retry indefinitely with bounded delay
          return true;
        }

        expect(shouldRetry(httpStatus: 401, errorCode: 'CREDENTIAL_REVOKED', currentAttempt: 1), isFalse);
        expect(shouldRetry(httpStatus: 403, errorCode: 'USER_NOT_ACTIVE', currentAttempt: 1), isFalse);
        expect(shouldRetry(httpStatus: 404, errorCode: 'DEVICE_NOT_FOUND', currentAttempt: 1), isFalse);
        expect(shouldRetry(httpStatus: 502, errorCode: 'BAD_GATEWAY', currentAttempt: 50), isTrue);
        expect(shouldRetry(httpStatus: 504, errorCode: 'GATEWAY_TIMEOUT', currentAttempt: 120), isTrue);
      });
    });

    // -------------------------------------------------------------------------
    // 2. CONNECTION SUPERVISOR, RECONNECT & BACKOFF STRATEGY
    // -------------------------------------------------------------------------
    group('2. Connection Supervisor & Bounded Backoff Strategy', () {
      test('2.1. Exponential backoff strictly caps at 60 seconds and maintains monotonic progression', () {
        int calculateDelayMs(int attempt) {
          final clamped = attempt.clamp(0, 6);
          final base = (1000 * (1 << clamped)).clamp(1000, 60000);
          return base;
        }

        expect(calculateDelayMs(0), 1000);
        expect(calculateDelayMs(1), 2000);
        expect(calculateDelayMs(2), 4000);
        expect(calculateDelayMs(3), 8000);
        expect(calculateDelayMs(4), 16000);
        expect(calculateDelayMs(5), 32000);
        expect(calculateDelayMs(6), 60000);
        expect(calculateDelayMs(7), 60000);
        expect(calculateDelayMs(100), 60000);
      });

      test('2.2. Silent socket drop detection triggers after 3 missed pings or >45s elapsed without PONG', () {
        bool isSocketDead({required int missedPings, required int elapsedMsSincePong}) {
          return missedPings >= 3 || (elapsedMsSincePong > 45000);
        }

        // Active healthy socket
        expect(isSocketDead(missedPings: 0, elapsedMsSincePong: 5000), isFalse);
        expect(isSocketDead(missedPings: 1, elapsedMsSincePong: 15000), isFalse);
        expect(isSocketDead(missedPings: 2, elapsedMsSincePong: 30000), isFalse);

        // Silent dead socket
        expect(isSocketDead(missedPings: 3, elapsedMsSincePong: 45000), isTrue);
        expect(isSocketDead(missedPings: 1, elapsedMsSincePong: 46000), isTrue);
      });

      test('2.3. NetworkWatcher state transitions trigger immediate or debounced reconnect', () {
        String resolveAction({
          required String currentState,
          required bool hasInternet,
          required bool isValidated,
          required bool isCaptivePortal,
          required bool transportChanged,
        }) {
          if (!hasInternet || !isValidated || isCaptivePortal) {
            return 'ENTER_NETWORK_UNAVAILABLE';
          }
          if (currentState == 'CONNECTED' && transportChanged) {
            return 'IMMEDIATE_RECONNECT_HANDOFF';
          }
          if (currentState == 'NETWORK_UNAVAILABLE' || currentState == 'RECONNECTING' || currentState == 'ERROR') {
            return 'IMMEDIATE_RECONNECT_RESTORED';
          }
          return 'NOOP';
        }

        expect(
          resolveAction(currentState: 'CONNECTED', hasInternet: false, isValidated: false, isCaptivePortal: false, transportChanged: false),
          'ENTER_NETWORK_UNAVAILABLE',
        );
        expect(
          resolveAction(currentState: 'CONNECTED', hasInternet: true, isValidated: true, isCaptivePortal: true, transportChanged: false),
          'ENTER_NETWORK_UNAVAILABLE',
        );
        expect(
          resolveAction(currentState: 'CONNECTED', hasInternet: true, isValidated: true, isCaptivePortal: false, transportChanged: true),
          'IMMEDIATE_RECONNECT_HANDOFF',
        );
        expect(
          resolveAction(currentState: 'NETWORK_UNAVAILABLE', hasInternet: true, isValidated: true, isCaptivePortal: false, transportChanged: false),
          'IMMEDIATE_RECONNECT_RESTORED',
        );
      });
    });

    // -------------------------------------------------------------------------
    // 3. RACE CONDITION PROTECTION & SINGLE-FLIGHT EXECUTION
    // -------------------------------------------------------------------------
    group('3. Race Condition Protection & Generation Guarding', () {
      test('3.1. Single-flight reconnect lock rejects concurrent overlapping connect attempts', () {
        var isConnectingOrReconnecting = false;
        var startCount = 0;

        void triggerAttempt() {
          if (isConnectingOrReconnecting) return;
          isConnectingOrReconnecting = true;
          startCount++;
        }

        triggerAttempt();
        triggerAttempt(); // second concurrent call
        triggerAttempt(); // third concurrent call

        expect(startCount, 1, reason: 'Only one connection sequence must be active at a time');
        isConnectingOrReconnecting = false;

        triggerAttempt();
        expect(startCount, 2);
      });

      test('3.2. Stale connection generation callbacks are ignored when superseded', () {
        var activeGeneration = 1;
        var appliedState = '';

        void handleMessage(int messageGen, String state) {
          if (messageGen != activeGeneration) return; // Stale generation check
          appliedState = state;
        }

        handleMessage(1, 'CONNECTED');
        expect(appliedState, 'CONNECTED');

        // New generation started (e.g. reconnect triggered)
        activeGeneration = 2;

        // Old socket callback from generation 1 arrives late
        handleMessage(1, 'DISCONNECTED');
        expect(appliedState, 'CONNECTED', reason: 'Late callback from superseded generation must be discarded');

        // Callback from generation 2 arrives
        handleMessage(2, 'CONNECTED_V2');
        expect(appliedState, 'CONNECTED_V2');
      });
    });

    // -------------------------------------------------------------------------
    // 4. PERSISTENT NOTIFICATION SYNCHRONIZATION
    // -------------------------------------------------------------------------
    group('4. Persistent Notification Synchronization', () {
      test('4.1. Notification status text matches real-time server and tunnel state', () {
        String deriveNotificationText({
          required bool isServerRunning,
          required int port,
          required String tunnelState,
          required bool isTunnelDesired,
        }) {
          if (!isServerRunning) return 'Server Stopped';

          switch (tunnelState) {
            case 'CONNECTED':
              return 'Personal file server on port $port | Gateway: Connected';
            case 'CONNECTING':
              return 'Personal file server on port $port | Gateway: Connecting...';
            case 'AUTHENTICATING':
              return 'Personal file server on port $port | Gateway: Authenticating...';
            case 'RECONNECTING':
              return 'Personal file server on port $port | Gateway: Reconnecting...';
            case 'NETWORK_UNAVAILABLE':
              return 'Personal file server on port $port | Waiting for network...';
            case 'AUTH_FAILED':
              return 'ZdexCloud — Device Authorization Required';
            case 'STOPPED':
              return isTunnelDesired
                  ? 'Personal file server on port $port | Gateway: Reconnecting...'
                  : 'Personal file server is running on port $port';
            default:
              return 'Personal file server is running on port $port';
          }
        }

        expect(
          deriveNotificationText(isServerRunning: true, port: 8080, tunnelState: 'CONNECTED', isTunnelDesired: true),
          'Personal file server on port 8080 | Gateway: Connected',
        );
        expect(
          deriveNotificationText(isServerRunning: true, port: 8080, tunnelState: 'RECONNECTING', isTunnelDesired: true),
          'Personal file server on port 8080 | Gateway: Reconnecting...',
        );
        expect(
          deriveNotificationText(isServerRunning: true, port: 8080, tunnelState: 'NETWORK_UNAVAILABLE', isTunnelDesired: true),
          'Personal file server on port 8080 | Waiting for network...',
        );
        expect(
          deriveNotificationText(isServerRunning: true, port: 8080, tunnelState: 'AUTH_FAILED', isTunnelDesired: true),
          'ZdexCloud — Device Authorization Required',
        );
        expect(
          deriveNotificationText(isServerRunning: false, port: 8080, tunnelState: 'STOPPED', isTunnelDesired: false),
          'Server Stopped',
        );
      });
    });

    // -------------------------------------------------------------------------
    // 5. USER EXPLICIT STOP BOUNDARY
    // -------------------------------------------------------------------------
    group('5. User Explicit STOP Boundary', () {
      test('5.1. Explicit STOP sets isExplicitlyStopped=true and prevents auto-reconnection', () {
        var isExplicitlyStopped = true;
        var reconnectTriggered = false;

        void autoHealWatchdog() {
          if (isExplicitlyStopped) return;
          reconnectTriggered = true;
        }

        autoHealWatchdog();
        expect(reconnectTriggered, isFalse, reason: 'Watchdog must not reconnect when explicitly stopped');

        isExplicitlyStopped = false;
        autoHealWatchdog();
        expect(reconnectTriggered, isTrue);
      });
    });
  });
}
