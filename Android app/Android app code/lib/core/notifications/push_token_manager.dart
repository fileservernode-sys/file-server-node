import 'dart:async';
import 'dart:convert';
import 'dart:io';
import '../config/app_config.dart';
import '../storage/secure_storage_service.dart';
import '../utils/logger.dart';

abstract class FcmTokenAdapter {
  Future<String?> getToken();
  Stream<String> get onTokenRefresh;
  Future<void> deleteToken();
}

class MockFcmTokenAdapter implements FcmTokenAdapter {
  String? _currentToken = 'mock_fcm_token_initial_100';
  final _refreshController = StreamController<String>.broadcast();

  @override
  Future<String?> getToken() async => _currentToken;

  @override
  Stream<String> get onTokenRefresh => _refreshController.stream;

  @override
  Future<void> deleteToken() async {
    _currentToken = null;
  }

  void simulateTokenRefresh(String newToken) {
    _currentToken = newToken;
    _refreshController.add(newToken);
  }
}

class PushTokenManager {
  final FcmTokenAdapter _fcmAdapter;
  final SecureStorageService _storageService;
  final HttpClient _httpClient;

  String? _lastRegisteredToken;
  String? _lastRegisteredDeviceId;

  PushTokenManager({
    FcmTokenAdapter? fcmAdapter,
    SecureStorageService? storageService,
    HttpClient? httpClient,
  })  : _fcmAdapter = fcmAdapter ?? MockFcmTokenAdapter(),
        _storageService = storageService ?? InMemorySecureStorageService(),
        _httpClient = httpClient ??
            (HttpClient()
              ..badCertificateCallback = (cert, host, port) => AppConfig.current.environment != 'production');

  String? get lastRegisteredToken => _lastRegisteredToken;
  String? get lastRegisteredDeviceId => _lastRegisteredDeviceId;

  Future<bool> registerPushToken({
    required String deviceId,
    String platform = 'ANDROID',
    String appVersion = '1.0.0',
  }) async {
    try {
      final token = await _fcmAdapter.getToken();
      if (token == null || token.isEmpty) {
        AppLogger.warning('[PushTokenManager] No FCM token available to register.');
        return false;
      }

      if (_lastRegisteredToken == token && _lastRegisteredDeviceId == deviceId) {
        AppLogger.info('[PushTokenManager] Push token already up-to-date.');
        return true;
      }

      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) {
        AppLogger.warning('[PushTokenManager] Cannot register push token: No active session.');
        return false;
      }

      final baseUrl = AppConfig.current.apiBaseUrl;
      final uri = Uri.parse('$baseUrl/devices/$deviceId/push-token');

      final req = await _httpClient.postUrl(uri);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');
      req.write(jsonEncode({
        'token': token,
        'platform': platform,
        'appVersion': appVersion,
      }));

      final res = await req.close().timeout(const Duration(seconds: 10));
      if (res.statusCode == 200 || res.statusCode == 201) {
        _lastRegisteredToken = token;
        _lastRegisteredDeviceId = deviceId;
        AppLogger.info('[PushTokenManager] Push token registered successfully for device: $deviceId');
        return true;
      } else {
        AppLogger.warning('[PushTokenManager] Failed to register token. Status: ${res.statusCode}');
        return false;
      }
    } catch (e, stack) {
      AppLogger.error('[PushTokenManager] Error registering push token', e, stack);
      return false;
    }
  }

  Future<bool> rotatePushToken({
    required String deviceId,
    required String newToken,
    String platform = 'ANDROID',
    String appVersion = '1.0.0',
  }) async {
    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) return false;

      final baseUrl = AppConfig.current.apiBaseUrl;
      final uri = Uri.parse('$baseUrl/devices/$deviceId/push-token');

      final req = await _httpClient.openUrl('PATCH', uri);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');
      req.write(jsonEncode({
        'token': newToken,
        'platform': platform,
        'appVersion': appVersion,
      }));

      final res = await req.close().timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        _lastRegisteredToken = newToken;
        _lastRegisteredDeviceId = deviceId;
        AppLogger.info('[PushTokenManager] Push token rotated successfully.');
        return true;
      }
      return false;
    } catch (e) {
      AppLogger.error('[PushTokenManager] Error rotating push token', e);
      return false;
    }
  }

  Future<bool> revokePushToken({required String deviceId}) async {
    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) return true;

      final baseUrl = AppConfig.current.apiBaseUrl;
      final uri = Uri.parse('$baseUrl/devices/$deviceId/push-token');

      final req = await _httpClient.deleteUrl(uri);
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 10));
      _lastRegisteredToken = null;
      _lastRegisteredDeviceId = null;
      await _fcmAdapter.deleteToken();

      AppLogger.info('[PushTokenManager] Push token revoked for device: $deviceId');
      return res.statusCode == 200;
    } catch (e) {
      AppLogger.error('[PushTokenManager] Error revoking push token', e);
      _lastRegisteredToken = null;
      _lastRegisteredDeviceId = null;
      return false;
    }
  }

  void listenToTokenRefresh({required String deviceId}) {
    _fcmAdapter.onTokenRefresh.listen((newToken) {
      rotatePushToken(deviceId: deviceId, newToken: newToken);
    });
  }
}
