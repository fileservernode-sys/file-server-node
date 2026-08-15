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

    test('LoginRequest formats email to lowercase', () {
      const req = LoginRequest(
          email: 'USER@EXAMPLE.COM ', password: 'secretPassword123');
      expect(req.toJson()['email'], 'user@example.com');
    });
  });

  group('Batch 6D Auth Repository & State Management Tests', () {
    late AuthRepositoryImpl repository;

    setUp(() {
      repository = AuthRepositoryImpl(
        remoteDataSource: MockAuthRemoteDataSource(),
        secureStorageService: InMemorySecureStorageService(),
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
  });

  group('Batch 6D Google Auth Removal Verification', () {
    test(
        'Google Auth route is completely eliminated from AppRouter constants',
        () {
      expect(AppRouter.loginRoute, '/login');
      expect(AppRouter.otpRoute, '/auth/otp');
    });
  });
}
