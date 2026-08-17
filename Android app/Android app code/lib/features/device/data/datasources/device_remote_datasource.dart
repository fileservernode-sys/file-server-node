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
    String? serverName,
    String? adminUsername,
    String? adminPassword,
  });

  Future<bool> sendHeartbeat({
    required String deviceId,
    required String sessionToken,
  });

  Future<Map<String, dynamic>> getUserDevices({
    required String sessionToken,
  });

  Future<Map<String, dynamic>> getDevice({
    required String deviceId,
    required String sessionToken,
  });

  Future<Map<String, dynamic>> deleteDevice({
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
  })  : _httpClient = httpClient ??
            (HttpClient()
              ..badCertificateCallback = (cert, host, port) =>
                  AppConfig.current.environment != 'production'),
        _baseUrl = baseUrl ?? AppConfig.current.apiBaseUrl;

  @override
  Future<Map<String, dynamic>> registerDevice({
    required String deviceName,
    required String installationId,
    required String sessionToken,
    String platform = 'Android',
    String? osVersion,
    String? appVersion,
    String? serverName,
    String? adminUsername,
    String? adminPassword,
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
        if (serverName != null) 'serverName': serverName,
        if (adminUsername != null) 'adminUsername': adminUsername,
        if (adminPassword != null) 'adminPassword': adminPassword,
      }));

      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      final json = jsonDecode(body) as Map<String, dynamic>;
      return json;
    } catch (e) {
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to connect to backend control plane: ${e.toString()}'
        }
      };
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

      final res = await req.close().timeout(const Duration(seconds: 10));
      return res.statusCode == 200;
    } catch (e) {
      return true;
    }
  }

  @override
  Future<Map<String, dynamic>> getUserDevices({
    required String sessionToken,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl/devices');
      final req = await _httpClient.getUrl(url);
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 20));
      final body = await res.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to fetch user devices: ${e.toString()}'
        }
      };
    }
  }

  @override
  Future<Map<String, dynamic>> getDevice({
    required String deviceId,
    required String sessionToken,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl/devices/$deviceId');
      final req = await _httpClient.getUrl(url);
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 20));
      final body = await res.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to get device: ${e.toString()}'
        }
      };
    }
  }

  @override
  Future<Map<String, dynamic>> deleteDevice({
    required String deviceId,
    required String sessionToken,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl/devices/$deviceId');
      final req = await _httpClient.deleteUrl(url);
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to delete device: ${e.toString()}'
        }
      };
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
    String? serverName,
    String? adminUsername,
    String? adminPassword,
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

  @override
  Future<Map<String, dynamic>> getUserDevices({
    required String sessionToken,
  }) async {
    await Future.delayed(const Duration(milliseconds: 200));
    return {
      'success': true,
      'data': {
        'devices': [
          {
            'id': 'mock-device-node-01',
            'deviceName': 'Android Phone Host',
            'platform': 'Android',
            'status': 'ONLINE',
            'server': {
              'id': 'mock-srv-01',
              'status': 'RUNNING',
              'endpoint': {
                'id': 'mock-ep-01',
                'hostname': 'srv_alpha.gateway.viewduration.com',
                'publicUrl': 'https://srv_alpha.gateway.viewduration.com',
                'status': 'ACTIVE',
              }
            },
            'connection': {
              'id': 'mock-conn-01',
              'status': 'CONNECTED',
              'remoteEndpoint': 'https://srv_alpha.gateway.viewduration.com',
            }
          }
        ]
      }
    };
  }

  @override
  Future<Map<String, dynamic>> getDevice({
    required String deviceId,
    required String sessionToken,
  }) async {
    await Future.delayed(const Duration(milliseconds: 150));
    return {
      'success': true,
      'data': {
        'device': {
          'id': deviceId,
          'deviceName': 'Android Phone Host',
          'platform': 'Android',
          'status': 'ONLINE',
          'server': {
            'id': 'mock-srv-01',
            'status': 'RUNNING',
            'endpoint': {
              'id': 'mock-ep-01',
              'hostname': 'srv_alpha.gateway.viewduration.com',
              'publicUrl': 'https://srv_alpha.gateway.viewduration.com',
              'status': 'ACTIVE',
            }
          },
          'connection': {
            'id': 'mock-conn-01',
            'status': 'CONNECTED',
            'remoteEndpoint': 'https://srv_alpha.gateway.viewduration.com',
          }
        }
      }
    };
  }

  @override
  Future<Map<String, dynamic>> deleteDevice({
    required String deviceId,
    required String sessionToken,
  }) async {
    await Future.delayed(const Duration(milliseconds: 150));
    return {
      'success': true,
      'data': {'message': 'Device deleted successfully'}
    };
  }
}
