import 'dart:math';
import 'package:flutter/services.dart';
import '../../../../core/storage/secure_storage_service.dart';
import '../../../../core/utils/logger.dart';

/// Abstract Service Contract for obtaining a stable, persistent Device/Installation Identity.
abstract class DeviceIdentityService {
  Future<String> getInstallationId();
}

/// MethodChannel implementation targeting Android SharedPreferences persistent store
/// with seamless local storage fallback for non-Android / testing environments.
class MethodChannelDeviceIdentityService implements DeviceIdentityService {
  static const MethodChannel _channel =
      MethodChannel('net.remotenode.fileserver/server_engine');

  final SecureStorageService _storage;
  String? _cachedInstallationId;

  MethodChannelDeviceIdentityService({
    SecureStorageService? storage,
  }) : _storage = storage ?? FileSecureStorageService();

  @override
  Future<String> getInstallationId() async {
    if (_cachedInstallationId != null && _cachedInstallationId!.isNotEmpty) {
      return _cachedInstallationId!;
    }

    // 1. Try Native Android Platform Channel (backed by Android SharedPreferences)
    try {
      final nativeId =
          await _channel.invokeMethod<String>('getInstallationId');
      if (nativeId != null && nativeId.isNotEmpty) {
        _cachedInstallationId = nativeId;
        _logIdentityRedacted(nativeId);
        return nativeId;
      }
    } catch (_) {
      // Platform channel unavailable (e.g. running in test runner or desktop)
    }

    // 2. Fallback to Persistent Storage Abstraction
    const key = 'device_installation_id';
    var storedId = await _storage.read(key: key);
    if (storedId == null || storedId.isEmpty) {
      storedId = _generateSecureUuid();
      await _storage.write(key: key, value: storedId);
    }

    _cachedInstallationId = storedId;
    _logIdentityRedacted(storedId);
    return storedId;
  }

  void _logIdentityRedacted(String id) {
    if (id.length > 8) {
      final suffix = id.substring(id.length - 4);
      AppLogger.info('[DeviceIdentity] Resolved installationId: inst_****$suffix');
    } else {
      AppLogger.info('[DeviceIdentity] Resolved installationId: inst_****');
    }
  }

  static String _generateSecureUuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    // Set UUID version 4 (bits 12-15 of time_hi_and_version to 0100)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set UUID variant (bits 6-7 of clock_seq_hi_and_reserved to 10)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return 'inst-${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}';
  }
}

/// In-memory mock implementation for unit tests
class MockDeviceIdentityService implements DeviceIdentityService {
  String _id;

  MockDeviceIdentityService({String? initialId})
      : _id = initialId ?? 'inst-mock-node-uuid-101';

  void setInstallationId(String id) {
    _id = id;
  }

  @override
  Future<String> getInstallationId() async {
    return _id;
  }
}
