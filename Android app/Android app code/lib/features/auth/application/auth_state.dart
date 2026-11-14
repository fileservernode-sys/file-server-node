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
  return FileSecureStorageService();
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

/// Structured category for session-clearance hook failures.
/// Never contains raw exception strings, stack traces, or credential values.
enum CleanupFailureCategory {
  /// A secure storage write operation failed (e.g. KeyStore unavailable)
  storageWriteFailure,

  /// A secure storage delete operation failed (e.g. entry locked or missing)
  storageDeleteFailure,

  /// A network or remote call during cleanup failed
  networkFailure,

  /// An unclassified error occurred during cleanup
  unknownFailure,
}

/// Result of executing session clearance hooks across components.
/// Diagnostics are structured allowlisted categories — no raw strings, tokens, or credentials.
class SessionClearedResult {
  final bool success;
  final int totalHooks;
  final int failedHooks;

  /// Structured failure categories for each failed hook, in hook-execution order.
  /// Never contains raw exception strings, stack traces, or credential data.
  final List<CleanupFailureCategory> failureCategories;

  const SessionClearedResult({
    required this.success,
    required this.totalHooks,
    required this.failedHooks,
    this.failureCategories = const [],
  });
}

/// Auth State Notifier — Controls Login, OTP Verification, and Logout Logic
class AuthStateNotifier extends StateNotifier<AuthState> {
  final AuthRepository _repository;
  Future<bool>? _activeResumeValidation;

  /// Returns the in-flight resume validation Future, if one is currently active.
  /// Allows UI screens (such as CameraScreen) to await pending validation before
  /// initiating authenticated operations, avoiding duplicate checks or racing expired sessions.
  Future<bool>? get currentResumeValidation => _activeResumeValidation;
  static final List<Future<void> Function()> _sessionClearedHooks = [];

  /// Synchronous (void) hooks called IMMEDIATELY at the start of logout/session-clear,
  /// BEFORE any asynchronous repository or cleanup await.
  /// Use for time-critical invalidation such as cancelling in-flight registrations.
  static final List<void Function()> _immediateInvalidationHooks = [];

  /// Registers a synchronous hook to be called immediately when a session is cleared,
  /// before any awaits. Used for instant in-flight operation cancellation.
  static void registerImmediateInvalidationHook(void Function() hook) {
    if (!_immediateInvalidationHooks.contains(hook)) {
      _immediateInvalidationHooks.add(hook);
    }
  }

  /// Unregisters a previously registered immediate invalidation hook.
  static void unregisterImmediateInvalidationHook(void Function() hook) {
    _immediateInvalidationHooks.remove(hook);
  }

  /// Removes all registered hooks.
  /// For use in unit tests only — never call in production code.
  // ignore: invalid_use_of_visible_for_testing_member
  static void clearAllHooksForTesting() {
    _sessionClearedHooks.clear();
    _immediateInvalidationHooks.clear();
  }

  /// Calls all registered immediate invalidation hooks synchronously.
  /// Never throws — failures are silently swallowed to guarantee all hooks execute.
  static void _fireImmediateInvalidation() {
    for (final hook in List.from(_immediateInvalidationHooks)) {
      try {
        hook();
      } catch (_) {
        // Intentionally suppressed — immediate hooks must not block logout
      }
    }
  }

  /// Registers a global hook to be executed whenever an active session is cleared
  /// (explicit logout, session expiration, or auth reset).
  static void registerSessionClearedHook(Future<void> Function() hook) {
    if (!_sessionClearedHooks.contains(hook)) {
      _sessionClearedHooks.add(hook);
    }
  }

  /// Unregisters a previously registered session cleared hook.
  static void unregisterSessionClearedHook(Future<void> Function() hook) {
    _sessionClearedHooks.remove(hook);
  }

  /// Executes all registered session cleared hooks safely, guaranteeing that failure
  /// in one hook never prevents subsequent hooks from executing.
  /// Classifies errors into structured diagnostic categories — raw exception strings,
  /// stack traces, and credential values are NEVER stored or logged.
  static Future<SessionClearedResult> notifySessionCleared() async {
    int total = 0;
    int failed = 0;
    final categories = <CleanupFailureCategory>[];

    for (final hook in List.from(_sessionClearedHooks)) {
      total++;
      try {
        await hook();
      } catch (e) {
        failed++;
        categories.add(_classifyCleanupFailure(e));
      }
    }

    return SessionClearedResult(
      success: failed == 0,
      totalHooks: total,
      failedHooks: failed,
      failureCategories: categories,
    );
  }

  /// Classifies a cleanup exception into a structured, allowlisted category.
  /// No raw exception message, stack trace, or credential value is ever retained.
  static CleanupFailureCategory _classifyCleanupFailure(Object e) {
    final msg = e.toString().toLowerCase();
    if (msg.contains('write') || msg.contains('persist') || msg.contains('keystore')) {
      return CleanupFailureCategory.storageWriteFailure;
    }
    if (msg.contains('delete') || msg.contains('remove') || msg.contains('clear')) {
      return CleanupFailureCategory.storageDeleteFailure;
    }
    if (msg.contains('network') ||
        msg.contains('socket') ||
        msg.contains('timeout') ||
        msg.contains('http') ||
        msg.contains('connection')) {
      return CleanupFailureCategory.networkFailure;
    }
    return CleanupFailureCategory.unknownFailure;
  }

  AuthStateNotifier(this._repository) : super(const AuthState());

  /// Restores persisted AuthSession on app boot
  Future<bool> restoreSession() async {
    try {
      final session = await _repository.getCurrentSession();
      if (session != null) {
        if (!session.isExpired) {
          state = state.copyWith(
            status: AuthStatus.authenticated,
            session: session,
          );
          return true;
        } else {
          // Session expired beyond strict 24-hour lifetime — clean up
          // 1. Immediately invalidate auth state and fire instant invalidation hooks
          state = state.copyWith(
            status: AuthStatus.unauthenticated,
            session: null,
            errorMessage: 'Your session has expired. Please sign in again.',
          );
          _fireImmediateInvalidation();
          try {
            await _repository.logout();
          } catch (_) {}
          final result = await notifySessionCleared();
          if (!result.success) {
            state = state.copyWith(
              errorMessage:
                  'Your session has expired. Warning: Some local credentials could not be cleared.',
            );
          }
          return false;
        }
      }
    } catch (_) {}
    return false;
  }

  /// Validates active session expiry when application resumes from background.
  /// If the session has expired (e.g. app suspended past maxSessionDuration),
  /// cleans up local credentials and transitions state to unauthenticated.
  ///
  /// Concurrency Guard: If a validation is already in-flight, returns the active Future
  /// to eliminate redundant execution and prevent races between root observer and sub-screens.
  Future<bool> validateSessionOnResume() async {
    if (_activeResumeValidation != null) {
      return _activeResumeValidation!;
    }

    final future = _performValidateSessionOnResume();
    _activeResumeValidation = future;
    try {
      return await future;
    } finally {
      _activeResumeValidation = null;
    }
  }

  Future<bool> _performValidateSessionOnResume() async {
    final current = state.session;
    if (current != null && current.isExpired) {
      await logout();
      state = state.copyWith(
        errorMessage: 'Your session has expired. Please sign in again.',
      );
      return false;
    }
    return await restoreSession();
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
        final prevUserId = state.session?.user.id;
        final newUserId = response.session?.user.id;
        if (prevUserId != null && newUserId != null && prevUserId != newUserId) {
          // Account switch detected during OTP verification — invalidate all previous operations synchronously
          _fireImmediateInvalidation();
        }

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

  /// Logs out of platform session and notifies session cleared hooks.
  /// Immediate session invalidation and in-flight cancellation occur BEFORE any await.
  Future<bool> logout() async {
    // 1. Immediately invalidate auth state — synchronous, no awaits
    state = const AuthState(status: AuthStatus.unauthenticated);

    // 2. Fire immediate invalidation hooks synchronously (cancels in-flight Camera registration
    //    and any other time-critical operations BEFORE repository network call begins)
    _fireImmediateInvalidation();

    // 3. Clear repository session (network/disk — may be slow)
    try {
      await _repository.logout();
    } catch (_) {}

    // 4. Invoke all registered async cleanup hooks
    final result = await notifySessionCleared();
    if (!result.success) {
      state = state.copyWith(
        errorMessage:
            'Signed out, but some local resources could not be fully cleared. Re-login will re-verify security state.',
      );
    }
    return result.success;
  }
}
