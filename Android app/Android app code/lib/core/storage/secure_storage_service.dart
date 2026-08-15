import '../../features/auth/domain/entities/auth_session.dart';

/// Secure Storage Abstraction for Encrypted Session Token Persistence & Key-Value Metadata
abstract class SecureStorageService {
  Future<void> saveSession(AuthSession session);
  Future<AuthSession?> getSession();
  Future<void> clearSession();

  Future<void> write({required String key, required String value});
  Future<String?> read({required String key});
  Future<void> delete({required String key});
}

/// In-Memory / Secure Storage Implementation (Prevents SharedPreferences plaintext token storage)
class InMemorySecureStorageService implements SecureStorageService {
  AuthSession? _cachedSession;
  final Map<String, String> _storage = {};

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
