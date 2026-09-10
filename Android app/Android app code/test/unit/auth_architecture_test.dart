import 'package:flutter_test/flutter_test.dart';
import 'package:remote_node_app/core/routing/app_router.dart';
import 'package:remote_node_app/core/storage/secure_storage_service.dart';
import 'package:remote_node_app/features/auth/application/auth_state.dart';
import 'package:remote_node_app/features/auth/data/datasources/auth_remote_datasource.dart';
import 'package:remote_node_app/features/auth/data/models/auth_models.dart';
import 'package:remote_node_app/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:remote_node_app/features/auth/domain/entities/auth_session.dart';
import 'package:remote_node_app/features/auth/domain/entities/platform_user.dart';

void main() {
  group('Batch 6D Auth Domain Entities & DTO Tests', () {
    test('PlatformUser serializes and deserializes correctly', () {
      final now = DateTime.now();
      final user = PlatformUser(
        id: 'usr-123',
        email: 'user@example.com',
        emailVerified: true,
        status: 'ACTIVE',
        createdAt: now,
      );

      final json = user.toJson();
      expect(json['id'], 'usr-123');
      expect(json['email'], 'user@example.com');
      expect(json['emailVerified'], isTrue);

      final parsed = PlatformUser.fromJson(json);
      expect(parsed.id, 'usr-123');
      expect(parsed.email, 'user@example.com');
    });

    test('AuthSession evaluates expiration correctly', () {
      final expiredSession = AuthSession(
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        user: PlatformUser(
          id: '1',
          email: 'test@example.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now(),
        ),
        expiresAt: DateTime.now().subtract(const Duration(hours: 1)),
      );

      expect(expiredSession.isExpired, isTrue);
    });

    test('AuthSession enforces strict 24-hour non-sliding lifetime', () {
      final now = DateTime.now();
      // Case 1: Session issued 25 hours ago, even if expiresAt was set to future
      final expiredByAge = AuthSession(
        accessToken: 'token-1',
        refreshToken: 'token-1',
        user: PlatformUser(
          id: '1',
          email: 'test@example.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: now,
        ),
        issuedAt: now.subtract(const Duration(hours: 25)),
        expiresAt: now.add(const Duration(hours: 5)),
      );
      expect(expiredByAge.isExpired, isTrue);

      // Case 2: Session within 24 hours is valid
      final validSession = AuthSession(
        accessToken: 'token-2',
        refreshToken: 'token-2',
        user: PlatformUser(
          id: '2',
          email: 'valid@example.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: now,
        ),
        issuedAt: now.subtract(const Duration(hours: 12)),
        expiresAt: now.add(const Duration(hours: 12)),
      );
      expect(validSession.isExpired, isFalse);

      // Case 3: fromJson fallback defaults to max 24 hours
      final jsonSession = AuthSession.fromJson({
        'accessToken': 'token-3',
        'refreshToken': 'token-3',
        'userId': '3',
        'email': 'fallback@example.com',
      });
      expect(jsonSession.isExpired, isFalse);
      expect(
        jsonSession.expiresAt.difference(DateTime.now()).inHours,
        lessThanOrEqualTo(24),
      );
    });

    test('LoginRequest formats email to lowercase', () {
      const req = LoginRequest(
          email: 'USER@EXAMPLE.COM ', password: 'secretPassword123');
      expect(req.toJson()['email'], 'user@example.com');
    });
  });

  group('Batch 6D Auth Repository & State Management Tests', () {
    late AuthRepositoryImpl repository;
    late InMemorySecureStorageService secureStorage;

    setUp(() {
      secureStorage = InMemorySecureStorageService();
      repository = AuthRepositoryImpl(
        remoteDataSource: const MockAuthRemoteDataSource(),
        secureStorageService: secureStorage,
      );
    });

    test('Login triggers requiresOtp state', () async {
      final response = await repository.login(const LoginRequest(
        email: 'test@example.com',
        password: 'Password123!',
      ));

      expect(response.success, isTrue);
      expect(response.requiresOtp, isTrue);
    });

    test(
        'OtpVerification yields authenticated session and stores in secure storage',
        () async {
      final loginResp = await repository.login(const LoginRequest(
        email: 'test@example.com',
        password: 'Password123!',
      ));
      expect(loginResp.requiresOtp, isTrue);

      final otpResp = await repository.verifyOtp(const OtpVerificationRequest(
        email: 'test@example.com',
        otpCode: '123456',
      ));

      expect(otpResp.success, isTrue);
      expect(otpResp.session, isNotNull);

      final savedSession = await repository.getCurrentSession();
      expect(savedSession, isNotNull);
      expect(savedSession!.user.email, 'test@example.com');
    });

    test('AuthStateNotifier manages authentication state transitions',
        () async {
      final notifier = AuthStateNotifier(repository);
      expect(notifier.state.status, AuthStatus.unauthenticated);

      final loginSuccess =
          await notifier.login('test@example.com', 'Password123!');
      expect(loginSuccess, isTrue);
      expect(notifier.state.status, AuthStatus.awaitingOtp);
      expect(notifier.state.pendingEmail, 'test@example.com');

      final otpSuccess = await notifier.verifyOtp('123456');
      expect(otpSuccess, isTrue);
      expect(notifier.state.status, AuthStatus.authenticated);
      expect(notifier.state.session, isNotNull);

      await notifier.logout();
      expect(notifier.state.status, AuthStatus.unauthenticated);
      expect(notifier.state.session, isNull);
    });

    test('AuthStateNotifier purges expired session and sets unauthenticated message',
        () async {
      // Seed storage with an expired session
      final expired = AuthSession(
        accessToken: 'expired-token',
        refreshToken: 'expired-token',
        user: PlatformUser(
          id: 'exp-user',
          email: 'expired@example.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: DateTime.now(),
        ),
        expiresAt: DateTime.now().subtract(const Duration(minutes: 5)),
      );
      await secureStorage.saveSession(expired);

      final notifier = AuthStateNotifier(repository);
      final restored = await notifier.restoreSession();

      expect(restored, isFalse);
      expect(notifier.state.status, AuthStatus.unauthenticated);
      expect(notifier.state.session, isNull);
      expect(notifier.state.errorMessage,
          'Your session has expired. Please sign in again.');

      // Verify repository session is cleared
      final current = await repository.getCurrentSession();
      expect(current, isNull);
    });
  });

  group('Batch 6D Google Auth Removal Verification', () {
    test('Google Auth route is completely eliminated from AppRouter constants',
        () {
      expect(AppRouter.loginRoute, '/login');
      expect(AppRouter.otpRoute, '/auth/otp');
    });
  });

  group('NF-1 Persistent FileSecureStorageService Tests', () {
    test('FileSecureStorageService persists session across distinct service instances', () async {
      final storage1 = FileSecureStorageService();
      final now = DateTime.now();
      final session = AuthSession(
        accessToken: 'persist-token-abc',
        refreshToken: 'persist-token-abc',
        user: PlatformUser(
          id: 'usr-persisted',
          email: 'persist@zdexcloud.com',
          emailVerified: true,
          status: 'ACTIVE',
          createdAt: now,
        ),
        issuedAt: now,
        expiresAt: now.add(const Duration(hours: 24)),
      );

      await storage1.saveSession(session);

      // Create distinct instance to simulate app restart
      final storage2 = FileSecureStorageService();
      final restored = await storage2.getSession();

      expect(restored, isNotNull);
      expect(restored!.accessToken, 'persist-token-abc');
      expect(restored.user.email, 'persist@zdexcloud.com');
      expect(restored.isExpired, isFalse);

      // Clear session
      await storage2.clearSession();
      final storage3 = FileSecureStorageService();
      final cleared = await storage3.getSession();
      expect(cleared, isNull);
    });

    test('FileSecureStorageService persists key-value data across instances', () async {
      final storage1 = FileSecureStorageService();
      await storage1.write(key: 'device_pref_key', value: 'dark_mode');

      final storage2 = FileSecureStorageService();
      final val = await storage2.read(key: 'device_pref_key');
      expect(val, 'dark_mode');

      await storage2.delete(key: 'device_pref_key');
      final storage3 = FileSecureStorageService();
      expect(await storage3.read(key: 'device_pref_key'), isNull);
    });
  });
}
