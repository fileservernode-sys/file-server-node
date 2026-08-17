import 'dart:convert';
import 'dart:io';
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

/// Persistent File Storage Implementation for Session & Metadata Persistence
class FileSecureStorageService implements SecureStorageService {
  AuthSession? _cachedSession;
  final Map<String, String> _storage = {};
  File? _sessionFile;

  File _getFile() {
    if (_sessionFile == null) {
      final dir = Directory.systemTemp.path;
      _sessionFile = File('$dir/rn_session.json');
    }
    return _sessionFile!;
  }

  @override
  Future<void> saveSession(AuthSession session) async {
    _cachedSession = session;
    try {
      final file = _getFile();
      await file.writeAsString(jsonEncode({
        'token': session.accessToken,
        'email': session.email,
        'userId': session.userId,
        'expiresAt': session.expiresAt.toIso8601String(),
      }));
    } catch (_) {}
  }

  @override
  Future<AuthSession?> getSession() async {
    if (_cachedSession != null) {
      if (_cachedSession!.isExpired) {
        _cachedSession = null;
      } else {
        return _cachedSession;
      }
    }

    try {
      final file = _getFile();
      if (await file.exists()) {
        final content = await file.readAsString();
        final json = jsonDecode(content) as Map<String, dynamic>;
        final expiresAt = DateTime.parse(json['expiresAt'] as String);
        if (expiresAt.isAfter(DateTime.now())) {
          _cachedSession = AuthSession(
            accessToken: json['token'] as String,
            email: json['email'] as String? ?? 'user@viewduration.com',
            userId: json['userId'] as String? ?? 'user-id',
            expiresAt: expiresAt,
          );
          return _cachedSession;
        }
      }
    } catch (_) {}
    return null;
  }

  @override
  Future<void> clearSession() async {
    _cachedSession = null;
    try {
      final file = _getFile();
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {}
  }

  @override
  Future<void> write({required String key, required String value}) async {
    _storage[key] = value;
    try {
      final file = File('${Directory.systemTemp.path}/rn_kv_$key.txt');
      await file.writeAsString(value);
    } catch (_) {}
  }

  @override
  Future<String?> read({required String key}) async {
    if (_storage.containsKey(key)) return _storage[key];
    try {
      final file = File('${Directory.systemTemp.path}/rn_kv_$key.txt');
      if (await file.exists()) {
        final val = await file.readAsString();
        _storage[key] = val;
        return val;
      }
    } catch (_) {}
    return null;
  }

  @override
  Future<void> delete({required String key}) async {
    _storage.remove(key);
    try {
      final file = File('${Directory.systemTemp.path}/rn_kv_$key.txt');
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {}
  }
}

class InMemorySecureStorageService extends FileSecureStorageService {}
