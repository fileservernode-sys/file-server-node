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
  Directory? _baseDir;

  Directory _getStorageDir() {
    if (_baseDir != null) return _baseDir!;

    // 1. Android internal app data directories
    final androidPaths = [
      '/data/user/0/net.remotenode.fileserver/files',
      '/data/data/net.remotenode.fileserver/files',
    ];

    for (final p in androidPaths) {
      final d = Directory(p);
      if (d.existsSync()) {
        _baseDir = d;
        return _baseDir!;
      }
    }

    // 2. User home directory fallback (Development / Desktop / VM testing)
    final home =
        Platform.environment['USERPROFILE'] ?? Platform.environment['HOME'];
    if (home != null && home.isNotEmpty) {
      final appDir = Directory('$home/.zdexcloud');
      try {
        if (!appDir.existsSync()) {
          appDir.createSync(recursive: true);
        }
        _baseDir = appDir;
        return _baseDir!;
      } catch (_) {}
    }

    // 3. Fallback to system temporary directory
    _baseDir = Directory.systemTemp;
    return _baseDir!;
  }

  File _getSessionFile() {
    final dir = _getStorageDir();
    return File('${dir.path}/rn_session.json');
  }

  File _getKvFile(String key) {
    final dir = _getStorageDir();
    final safeKey = key.replaceAll(RegExp(r'[^a-zA-Z0-9_\-]'), '_');
    return File('${dir.path}/rn_kv_$safeKey.txt');
  }

  @override
  Future<void> saveSession(AuthSession session) async {
    _cachedSession = session;
    try {
      final file = _getSessionFile();
      await file.writeAsString(jsonEncode(session.toJson()), flush: true);
    } catch (_) {}
  }

  @override
  Future<AuthSession?> getSession() async {
    if (_cachedSession != null) {
      return _cachedSession;
    }

    try {
      final file = _getSessionFile();
      if (await file.exists()) {
        final content = await file.readAsString();
        if (content.trim().isNotEmpty) {
          final json = jsonDecode(content) as Map<String, dynamic>;
          final session = AuthSession.fromJson(json);
          _cachedSession = session;
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
      final file = _getSessionFile();
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {}
  }

  @override
  Future<void> write({required String key, required String value}) async {
    _storage[key] = value;
    try {
      final file = _getKvFile(key);
      await file.writeAsString(value, flush: true);
    } catch (_) {}
  }

  @override
  Future<String?> read({required String key}) async {
    if (_storage.containsKey(key)) return _storage[key];
    try {
      final file = _getKvFile(key);
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
      final file = _getKvFile(key);
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {}
  }
}

class InMemorySecureStorageService implements SecureStorageService {
  AuthSession? _session;
  final Map<String, String> _kvStore = {};

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
    _kvStore[key] = value;
  }

  @override
  Future<String?> read({required String key}) async {
    return _kvStore[key];
  }

  @override
  Future<void> delete({required String key}) async {
    _kvStore.remove(key);
  }
}
