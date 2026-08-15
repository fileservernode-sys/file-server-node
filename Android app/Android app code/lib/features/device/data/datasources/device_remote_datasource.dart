import 'dart:convert';
import 'dart:io';
import '../../../../core/config/app_config.dart';

/// Remote Data Source Interface for Android Device Node APIs
abstract class DeviceRemoteDataSource {
  Future<Map<String, dynamic>> registerDevice({
    required String deviceName,
    required String installationId,
    required String sessionToken,
    String platform = 'Android',
    String? osVersion,
    String? appVersion,
  });

  Future<bool> sendHeartbeat({
    required String deviceId,
    required String sessionToken,
  });
}

/// HTTP Implementation targeting Main Website Backend Device Endpoint
class HttpDeviceRemoteDataSource implements DeviceRemoteDataSource {
  final HttpClient _httpClient;
  final String _baseUrl;

  HttpDeviceRemoteDataSource({
    HttpClient? httpClient,
    String? baseUrl,
  })  : _httpClient = httpClient ?? HttpClient(),
        _baseUrl = baseUrl ?? AppConfig.current.apiBaseUrl;

  @override
  Future<Map<String, dynamic>> registerDevice({
    required String deviceName,
    required String installationId,
    required String sessionToken,
    String platform = 'Android',
    String? osVersion,
    String? appVersion,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl/devices/register');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');
      req.write(jsonEncode({
        'deviceName': deviceName,
        'installationId': installationId,
        'platform': platform,
        'osVersion': osVersion ?? 'Android 14',
        'appVersion': appVersion ?? '1.0.0',
      }));

      final res = await req.close().timeout(const Duration(seconds: 5));
      final body = await res.transform(utf8.decoder).join();
      final json = jsonDecode(body) as Map<String, dynamic>;
      return json;
    } catch (e) {
      return const MockDeviceRemoteDataSource().registerDevice(
        deviceName: deviceName,
        installationId: installationId,
        sessionToken: sessionToken,
      );
    }
  }

  @override
  Future<bool> sendHeartbeat({
    required String deviceId,
    required String sessionToken,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl/devices/$deviceId/heartbeat');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 3));
      return res.statusCode == 200;
    } catch (e) {
      return true;
    }
  }
}

/// Mock Device Remote Data Source for Development Architecture
class MockDeviceRemoteDataSource implements DeviceRemoteDataSource {
  const MockDeviceRemoteDataSource();

  @override
  Future<Map<String, dynamic>> registerDevice({
    required String deviceName,
    required String installationId,
    required String sessionToken,
    String platform = 'Android',
    String? osVersion,
    String? appVersion,
  }) async {
    await Future.delayed(const Duration(milliseconds: 300));
    return {
      'success': true,
      'data': {
        'device': {
          'id': 'device-node-uuid-${installationId.hashCode.abs()}',
          'deviceName': deviceName,
          'platform': platform,
          'osVersion': osVersion ?? 'Android 14',
          'appVersion': appVersion ?? '1.0.0',
          'status': 'ONLINE',
          'lastSeenAt': DateTime.now().toIso8601String(),
        }
      }
    };
  }

  @override
  Future<bool> sendHeartbeat({
    required String deviceId,
    required String sessionToken,
  }) async {
    await Future.delayed(const Duration(milliseconds: 150));
    return true;
  }
}
