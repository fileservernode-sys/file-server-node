import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/storage/secure_storage_service.dart';
import 'package:remote_node_app/features/auth/data/models/auth_models.dart';
import 'package:remote_node_app/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:remote_node_app/features/auth/domain/entities/auth_session.dart';
import 'package:remote_node_app/features/auth/domain/entities/platform_user.dart';
import 'package:remote_node_app/features/auth/domain/repositories/auth_repository.dart';
import 'package:remote_node_app/features/auth/data/datasources/auth_remote_datasource.dart';

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

class MockAuthRemoteDataSource implements AuthRemoteDataSource {
  @override
  Future<AuthResponse> login(LoginRequest request) async {
    return const AuthResponse(success: true, requiresOtp: true);
  }

  @override
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request) async {
    return AuthResponse(
      success: true,
      session: AuthSession(
        accessToken: 'mock-interactive-session-token',
        refreshToken: 'mock-refresh-token',
        user: PlatformUser(
          id: 'usr-test-123',
          email: request.email,
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now(),
        ),
        expiresAt: DateTime.now().add(const Duration(hours: 24)),
      ),
    );
  }

  @override
  Future<bool> resendOtp(String email) async => true;

  @override
  Future<bool> logout() async => true;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ZdexCloud — Persistent Server Auth Lifecycle (Decoupled from 24h User Session)', () {
    late SecureStorageService secureStorage;
    late AuthRepository authRepository;

    setUp(() {
      secureStorage = MockSecureStorageService();
      authRepository = AuthRepositoryImpl(
        remoteDataSource: MockAuthRemoteDataSource(),
        secureStorageService: secureStorage,
      );
    });

    test('1. User Login & Device Setup persists interactive session and device credential independently', () async {
      // 1. Save interactive user session
      final session = AuthSession(
        accessToken: 'interactive-user-token-24h',
        refreshToken: 'refresh-token-24h',
        user: PlatformUser(
          id: 'usr-test-123',
          email: 'user@zdexcloud.io',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now(),
        ),
        expiresAt: DateTime.now().add(const Duration(hours: 24)),
      );
      await secureStorage.saveSession(session);

      // 2. Save long-lived device credential
      await secureStorage.write(key: 'device_credential', value: 'persistent-device-credential-hash-xyz');

      // Verify both exist
      final retrievedSession = await secureStorage.getSession();
      final retrievedCred = await secureStorage.read(key: 'device_credential');

      expect(retrievedSession, isNotNull);
      expect(retrievedSession?.accessToken, 'interactive-user-token-24h');
      expect(retrievedCred, 'persistent-device-credential-hash-xyz');
    });

    test('2. UI Logout clears interactive session but PRESERVES persistent device credential', () async {
      // Seed storage
      await secureStorage.saveSession(AuthSession(
        accessToken: 'interactive-token',
        refreshToken: 'refresh-token',
        user: PlatformUser(
          id: 'usr-test',
          email: 'user@zdexcloud.io',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now(),
        ),
        expiresAt: DateTime.now().add(const Duration(hours: 24)),
      ));
      await secureStorage.write(key: 'device_credential', value: 'device-credential-persists-across-logout');

      // Execute user logout
      await authRepository.logout();

      // Verify session is wiped
      final sessionAfterLogout = await secureStorage.getSession();
      expect(sessionAfterLogout, isNull, reason: 'UI session must be removed on logout');

      // Verify persistent device credential remains untouched for background native server
      final credAfterLogout = await secureStorage.read(key: 'device_credential');
      expect(credAfterLogout, 'device-credential-persists-across-logout',
          reason: 'Native server runtime credential must not be deleted on UI logout');
    });

    test('3. Expired Interactive Session (isExpired == true) is detected by auth layer without wiping device credential', () async {
      final expiredSession = AuthSession(
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        user: PlatformUser(
          id: 'usr-test',
          email: 'user@zdexcloud.io',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now().subtract(const Duration(days: 2)),
        ),
        expiresAt: DateTime.now().subtract(const Duration(minutes: 5)),
      );
      await secureStorage.saveSession(expiredSession);
      await secureStorage.write(key: 'device_credential', value: 'device-cred-persists');

      expect(expiredSession.isExpired, isTrue);

      // Auth layer clears expired session
      await authRepository.logout();
      expect(await secureStorage.getSession(), isNull);
      expect(await secureStorage.read(key: 'device_credential'), 'device-cred-persists');
    });

    test('4. Explicit Unlink / Delete Server cleanly removes device credential', () async {
      await secureStorage.write(key: 'device_credential', value: 'device-cred-to-delete');
      expect(await secureStorage.read(key: 'device_credential'), isNotNull);

      // Explicit delete
      await secureStorage.delete(key: 'device_credential');
      expect(await secureStorage.read(key: 'device_credential'), isNull);
    });
  });
}
