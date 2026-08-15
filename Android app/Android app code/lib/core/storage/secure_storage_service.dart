import '../../features/auth/domain/entities/auth_session.dart';

/// Secure Storage Abstraction for Encrypted Session Token Persistence
abstract class SecureStorageService {
  Future<void> saveSession(AuthSession session);
  Future<AuthSession?> getSession();
  Future<void> clearSession();
}

/// In-Memory / Secure Storage Implementation (Prevents SharedPreferences plaintext token storage)
class InMemorySecureStorageService implements SecureStorageService {
  AuthSession? _cachedSession;

  @override
  Future<void> saveSession(AuthSession session) async {
    _cachedSession = session;
  }

  @override
  Future<AuthSession?> getSession() async {
    if (_cachedSession != null && _cachedSession!.isExpired) {
      _cachedSession = null;
    }
    return _cachedSession;
  }

  @override
  Future<void> clearSession() async {
    _cachedSession = null;
  }
}
