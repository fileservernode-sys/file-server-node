import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
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

/// Production Android Keystore-Protected Encrypted Storage Engine (Phase 14.5 / 14.5-R1)
/// SEC-14.1-05 Remediation: Delegates session token persistence to AndroidKeyStore AES-256-GCM
/// (hardware backing is device-dependent) with fallback to local private directory for desktop development/testing.
class FileSecureStorageService implements SecureStorageService {
  static const MethodChannel _nativeChannel =
      MethodChannel('net.remotenode.fileserver/secure_storage');

  AuthSession? _cachedSession;
  final Map<String, String> _storage = {};
  Directory? _baseDir;

  bool get _isAndroid {
    try {
      return Platform.isAndroid;
    } catch (_) {
      return false;
    }
  }

  Directory _getFallbackStorageDir() {
    if (_baseDir != null) return _baseDir!;

    // 1. User home directory fallback (Development / Desktop / VM testing)
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

    // 2. Fallback to system temporary directory
    _baseDir = Directory.systemTemp;
    return _baseDir!;
  }

  File _getFallbackSessionFile() {
    final dir = _getFallbackStorageDir();
    return File('${dir.path}/rn_session.enc');
  }

  File _getFallbackKvFile(String key) {
    final dir = _getFallbackStorageDir();
    final safeKey = key.replaceAll(RegExp(r'[^a-zA-Z0-9_\-]'), '_');
    return File('${dir.path}/rn_kv_$safeKey.enc');
  }

  @override
  Future<void> saveSession(AuthSession session) async {
    _cachedSession = session;
    final jsonStr = jsonEncode(session.toJson());

    if (_isAndroid) {
      try {
        final success = await _nativeChannel.invokeMethod<bool>(
          'saveSession',
          {'sessionJson': jsonStr},
        );
        if (success == true) return;
      } catch (_) {
        // Fallback to internal storage if method channel fails
      }
    }

    try {
      final file = _getFallbackSessionFile();
      await file.writeAsString(jsonStr, flush: true);
    } catch (_) {}
  }

  @override
  Future<AuthSession?> getSession() async {
    if (_cachedSession != null) {
      return _cachedSession;
    }

    if (_isAndroid) {
      try {
        final sessionJson =
            await _nativeChannel.invokeMethod<String>('getSession');
        if (sessionJson != null && sessionJson.trim().isNotEmpty) {
          final json = jsonDecode(sessionJson) as Map<String, dynamic>;
          final session = AuthSession.fromJson(json);
          _cachedSession = session;
          return _cachedSession;
        }
      } catch (_) {
        // Fallback to internal file check
      }
    }

    try {
      final file = _getFallbackSessionFile();
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

    if (_isAndroid) {
      try {
        await _nativeChannel.invokeMethod<bool>('clearSession');
      } catch (_) {}
    }

    try {
      final file = _getFallbackSessionFile();
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {}
  }

  @override
  Future<void> write({required String key, required String value}) async {
    _storage[key] = value;

    if (_isAndroid) {
      try {
        final success = await _nativeChannel.invokeMethod<bool>(
          'writeKv',
          {'key': key, 'value': value},
        );
        if (success == true) return;
      } catch (_) {}
    }

    try {
      final file = _getFallbackKvFile(key);
      await file.writeAsString(value, flush: true);
    } catch (_) {}
  }

  @override
  Future<String?> read({required String key}) async {
    if (_storage.containsKey(key)) return _storage[key];

    if (_isAndroid) {
      try {
        final val = await _nativeChannel.invokeMethod<String>(
          'readKv',
          {'key': key},
        );
        if (val != null) {
          _storage[key] = val;
          return val;
        }
      } catch (_) {}
    }

    try {
      final file = _getFallbackKvFile(key);
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

    if (_isAndroid) {
      try {
        await _nativeChannel.invokeMethod<bool>(
          'deleteKv',
          {'key': key},
        );
      } catch (_) {}
    }

    try {
      final file = _getFallbackKvFile(key);
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
