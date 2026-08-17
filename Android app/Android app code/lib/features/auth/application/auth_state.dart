import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/datasources/auth_remote_datasource.dart';
import '../data/models/auth_models.dart';
import '../data/repositories/auth_repository_impl.dart';
import '../domain/entities/auth_session.dart';
import '../domain/repositories/auth_repository.dart';
import '../../../core/storage/secure_storage_service.dart';

/// State Status Enum for Authentication Flow
enum AuthStatus {
  unauthenticated,
  submitting,
  awaitingOtp,
  authenticated,
  error,
}

/// Immutable Authentication State Representation
class AuthState {
  final AuthStatus status;
  final String? pendingEmail;
  final AuthSession? session;
  final String? errorMessage;

  const AuthState({
    this.status = AuthStatus.unauthenticated,
    this.pendingEmail,
    this.session,
    this.errorMessage,
  });

  AuthState copyWith({
    AuthStatus? status,
    String? pendingEmail,
    AuthSession? session,
    String? errorMessage,
  }) {
    return AuthState(
      status: status ?? this.status,
      pendingEmail: pendingEmail ?? this.pendingEmail,
      session: session ?? this.session,
      errorMessage: errorMessage,
    );
  }
}

/// Riverpod Providers for Auth Architecture
final secureStorageProvider = Provider<SecureStorageService>((ref) {
  return InMemorySecureStorageService();
});

final authRemoteDataSourceProvider = Provider<AuthRemoteDataSource>((ref) {
  return HttpAuthRemoteDataSource();
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepositoryImpl(
    remoteDataSource: ref.watch(authRemoteDataSourceProvider),
    secureStorageService: ref.watch(secureStorageProvider),
  );
});

final authStateProvider =
    StateNotifierProvider<AuthStateNotifier, AuthState>((ref) {
  return AuthStateNotifier(ref.watch(authRepositoryProvider));
});

/// Auth State Notifier — Controls Login, OTP Verification, and Logout Logic
class AuthStateNotifier extends StateNotifier<AuthState> {
  final AuthRepository _repository;

  AuthStateNotifier(this._repository) : super(const AuthState());

  /// Restores persisted AuthSession on app boot
  Future<bool> restoreSession() async {
    try {
      final session = await _repository.getCurrentSession();
      if (session != null && !session.isExpired) {
        state = state.copyWith(
          status: AuthStatus.authenticated,
          session: session,
        );
        return true;
      }
    } catch (_) {}
    return false;
  }

  /// Sets an active session for unit testing
  void setSessionForTesting(AuthSession session) {
    state = state.copyWith(
      status: AuthStatus.authenticated,
      session: session,
    );
  }

  /// Submits email and password credentials to Main Website backend
  Future<bool> login(String email, String password) async {
    state = state.copyWith(
      status: AuthStatus.submitting,
      errorMessage: null,
    );

    try {
      final request = LoginRequest(email: email, password: password);
      final response = await _repository.login(request);

      if (response.success && response.requiresOtp) {
        state = state.copyWith(
          status: AuthStatus.awaitingOtp,
          pendingEmail: email.trim().toLowerCase(),
        );
        return true;
      } else if (!response.success) {
        state = state.copyWith(
          status: AuthStatus.error,
          errorMessage: response.message ?? 'Invalid email or password.',
        );
        return false;
      }
      return false;
    } catch (e) {
      state = state.copyWith(
        status: AuthStatus.error,
        errorMessage: 'Network error. Please check your connection.',
      );
      return false;
    }
  }

  /// Verifies 6-digit security OTP sent via Serverbyt SMTP
  Future<bool> verifyOtp(String otpCode) async {
    final email = state.pendingEmail;
    if (email == null) {
      state = state.copyWith(
        status: AuthStatus.error,
        errorMessage: 'Session expired. Please sign in again.',
      );
      return false;
    }

    state = state.copyWith(
      status: AuthStatus.submitting,
      errorMessage: null,
    );

    try {
      final request = OtpVerificationRequest(email: email, otpCode: otpCode);
      final response = await _repository.verifyOtp(request);

      if (response.success && response.session != null) {
        state = state.copyWith(
          status: AuthStatus.authenticated,
          session: response.session,
          pendingEmail: null,
        );
        return true;
      } else {
        state = state.copyWith(
          status: AuthStatus.error,
          errorMessage: response.message ?? 'Invalid verification code.',
        );
        return false;
      }
    } catch (e) {
      state = state.copyWith(
        status: AuthStatus.error,
        errorMessage: 'Verification failed. Please try again.',
      );
      return false;
    }
  }

  /// Resends security OTP
  Future<bool> resendOtp() async {
    final email = state.pendingEmail;
    if (email == null) return false;
    return await _repository.resendOtp(email);
  }

  /// Logs out of platform session
  Future<void> logout() async {
    await _repository.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}
