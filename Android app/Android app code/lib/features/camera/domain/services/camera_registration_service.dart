import 'dart:convert';
import 'dart:io';
import '../../../../core/config/app_config.dart';
import '../../../../core/utils/logger.dart';
import '../application/camera_state.dart';

/// Abstract service contract for ZdexCloud Camera backend registration and discovery
abstract class CameraRegistrationService {
  /// Registers or binds an Android Device with purpose: 'CAMERA' via POST /api/v1/devices/register
  ///
  /// Reuses existing device installationId without creating duplicate Device records
  /// and without consuming the Storage 5-ServerInstance quota.
  Future<Map<String, dynamic>> registerCameraDevice({
    required String sessionToken,
    required String deviceName,
    required String installationId,
    String platform = 'Android',
    String? osVersion,
    String? appVersion,
  });

  /// Lists CameraInstances owned by the user, optionally filtered by deviceId
  ///
  /// Supports server-side pagination (page, limit) and returns { cameras, totalCount, page, limit, hasMore }.
  /// Used for idempotent registration verification before creating new camera instances.
  Future<Map<String, dynamic>> listCameras({
    required String sessionToken,
    String? deviceId,
    int? page,
    int? limit,
  });

  /// Retrieves a specific CameraInstance by ID
  Future<Map<String, dynamic>> getCamera({
    required String sessionToken,
    required String cameraId,
  });

  /// Registers or binds a CameraInstance under the authenticated user account via POST /api/v1/cameras
  Future<Map<String, dynamic>> registerCamera({
    required String sessionToken,
    required String cameraName,
    required String installationId,
    required CameraLensFacing lensFacing,
    required CameraResolutionPreset resolution,
    required int fps,
    required bool audioEnabled,
    String? deviceId,
  });

  /// Updates existing camera configuration via PATCH /api/v1/cameras/:cameraId
  Future<Map<String, dynamic>> updateCameraConfig({
    required String sessionToken,
    required String cameraId,
    String? cameraName,
    CameraResolutionPreset? resolution,
    int? fps,
    bool? audioEnabled,
    CameraLensFacing? lensFacing,
  });
}

/// HTTP implementation targeting Main Website Backend Camera & Device Endpoints
class HttpCameraRegistrationService implements CameraRegistrationService {
  final HttpClient _httpClient;
  final String _baseUrl;

  HttpCameraRegistrationService({
    HttpClient? httpClient,
    String? baseUrl,
  })  : _httpClient = httpClient ??
            (HttpClient()
              ..badCertificateCallback = (cert, host, port) =>
                  AppConfig.current.environment != 'production'),
        _baseUrl = baseUrl ?? AppConfig.current.apiBaseUrl;

  @override
  Future<Map<String, dynamic>> registerCameraDevice({
    required String sessionToken,
    required String deviceName,
    required String installationId,
    String platform = 'Android',
    String? osVersion,
    String? appVersion,
  }) async {
    if (sessionToken.isEmpty) {
      return {
        'success': false,
        'error': {
          'code': 'UNAUTHENTICATED',
          'message': 'Account login required to register camera device.',
        }
      };
    }

    try {
      final url = Uri.parse('$_baseUrl/devices/register');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');

      final payload = {
        'deviceName': deviceName,
        'installationId': installationId,
        'platform': platform,
        'osVersion': osVersion ?? '14',
        'appVersion': appVersion ?? '1.0.0',
        'purpose': 'CAMERA',
      };

      req.write(jsonEncode(payload));

      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      final dynamic decoded = jsonDecode(body);

      if (decoded is! Map<String, dynamic>) {
        return {
          'success': false,
          'error': {
            'code': 'MALFORMED_RESPONSE',
            'message': 'Expected JSON object response from cameras endpoint.',
          }
        };
      }

      final json = decoded;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        final err = json['error'] as Map<String, dynamic>?;
        final errMsg = err?['message'] as String? ?? 'HTTP ${res.statusCode}';
        return {
          'success': false,
          'error': {
            'code': err?['code'] ?? 'HTTP_${res.statusCode}',
            'message': errMsg,
          }
        };
      }

      if (json['success'] != true || json['data'] is! Map) {
        final err = json['error'] as Map<String, dynamic>?;
        return {
          'success': false,
          'error': {
            'code': err?['code'] ?? 'INVALID_RESPONSE',
            'message': err?['message'] ?? 'Invalid response payload from server.',
          }
        };
      }

      return json;
    } catch (e) {
      AppLogger.error('[CameraRegistration] Network error during device registration', e);
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to reach device registration endpoint: ${e.toString()}',
        }
      };
    }
  }

  @override
  Future<Map<String, dynamic>> listCameras({
    required String sessionToken,
    String? deviceId,
    int? page,
    int? limit,
  }) async {
    if (sessionToken.isEmpty) {
      return {
        'success': false,
        'error': {
          'code': 'UNAUTHENTICATED',
          'message': 'Account login required to query cameras.',
        }
      };
    }

    try {
      final queryParams = <String>[];
      if (deviceId != null && deviceId.isNotEmpty) {
        queryParams.add('deviceId=${Uri.encodeComponent(deviceId)}');
      }
      if (page != null && page > 0) {
        queryParams.add('page=$page');
      }
      if (limit != null && limit > 0) {
        queryParams.add('limit=$limit');
      }
      final queryString = queryParams.isNotEmpty ? '?${queryParams.join('&')}' : '';
      final url = Uri.parse('$_baseUrl/cameras$queryString');
      final req = await _httpClient.getUrl(url);
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      final dynamic decoded = jsonDecode(body);

      if (decoded is! Map<String, dynamic>) {
        return {
          'success': false,
          'error': {
            'code': 'MALFORMED_RESPONSE',
            'message': 'Expected JSON object response from cameras endpoint.',
          }
        };
      }

      final json = decoded;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        final err = json['error'] as Map<String, dynamic>?;
        final errMsg = err?['message'] as String? ?? 'HTTP ${res.statusCode}';
        return {
          'success': false,
          'error': {
            'code': err?['code'] ?? 'HTTP_${res.statusCode}',
            'message': errMsg,
          }
        };
      }

      if (json['success'] != true || json['data'] is! Map) {
        final err = json['error'] as Map<String, dynamic>?;
        return {
          'success': false,
          'error': {
            'code': err?['code'] ?? 'INVALID_RESPONSE',
            'message': err?['message'] ?? 'Invalid response payload from server.',
          }
        };
      }

      return json;
    } catch (e) {
      AppLogger.error('[CameraRegistration] Network error during listCameras', e);
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to query camera instances: ${e.toString()}',
        }
      };
    }
  }

  @override
  Future<Map<String, dynamic>> getCamera({
    required String sessionToken,
    required String cameraId,
  }) async {
    if (sessionToken.isEmpty) {
      return {
        'success': false,
        'error': {
          'code': 'UNAUTHENTICATED',
          'message': 'Account login required to get camera instance.',
        }
      };
    }

    try {
      final url = Uri.parse('$_baseUrl/cameras/$cameraId');
      final req = await _httpClient.getUrl(url);
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      final dynamic decoded = jsonDecode(body);

      if (decoded is! Map<String, dynamic>) {
        return {
          'success': false,
          'error': {
            'code': 'MALFORMED_RESPONSE',
            'message': 'Expected JSON object response from cameras endpoint.',
          }
        };
      }

      final json = decoded;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        final err = json['error'] as Map<String, dynamic>?;
        final errMsg = err?['message'] as String? ?? 'HTTP ${res.statusCode}';
        return {
          'success': false,
          'error': {
            'code': err?['code'] ?? 'HTTP_${res.statusCode}',
            'message': errMsg,
          }
        };
      }

      if (json['success'] != true || json['data'] is! Map) {
        final err = json['error'] as Map<String, dynamic>?;
        return {
          'success': false,
          'error': {
            'code': err?['code'] ?? 'INVALID_RESPONSE',
            'message': err?['message'] ?? 'Invalid response payload from server.',
          }
        };
      }

      return json;
    } catch (e) {
      AppLogger.error('[CameraRegistration] Network error during getCamera', e);
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to fetch camera instance: ${e.toString()}',
        }
      };
    }
  }

  @override
  Future<Map<String, dynamic>> registerCamera({
    required String sessionToken,
    required String cameraName,
    required String installationId,
    required CameraLensFacing lensFacing,
    required CameraResolutionPreset resolution,
    required int fps,
    required bool audioEnabled,
    String? deviceId,
  }) async {
    if (sessionToken.isEmpty) {
      return {
        'success': false,
        'error': {
          'code': 'UNAUTHENTICATED',
          'message': 'Account login required to register camera node.',
        }
      };
    }

    try {
      final url = Uri.parse('$_baseUrl/cameras');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');

      final resolutionTag = resolution == CameraResolutionPreset.p360
          ? '360p'
          : (resolution == CameraResolutionPreset.p480
              ? '480p'
              : (resolution == CameraResolutionPreset.p720
                  ? '720p'
                  : '1080p'));

      final payload = {
        'cameraName': cameraName,
        'installationId': installationId,
        if (deviceId != null && deviceId.isNotEmpty) 'deviceId': deviceId,
        'lensFacing': lensFacing == CameraLensFacing.front ? 'FRONT' : 'BACK',
        'resolution': resolutionTag,
        'fps': fps,
        'audioEnabled': audioEnabled,
      };

      req.write(jsonEncode(payload));

      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      final json = jsonDecode(body) as Map<String, dynamic>;

      if (res.statusCode >= 200 && res.statusCode < 300) {
        AppLogger.info('[CameraRegistration] Registered camera successfully');
        return json;
      } else {
        final err = json['error'] as Map<String, dynamic>?;
        AppLogger.warn(
            '[CameraRegistration] Registration rejected: ${err?['code']} - ${err?['message']}');
        return json;
      }
    } catch (e) {
      AppLogger.error('[CameraRegistration] Network error during registration', e);
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to reach camera registration endpoint: ${e.toString()}',
        }
      };
    }
  }

  @override
  Future<Map<String, dynamic>> updateCameraConfig({
    required String sessionToken,
    required String cameraId,
    String? cameraName,
    CameraResolutionPreset? resolution,
    int? fps,
    bool? audioEnabled,
    CameraLensFacing? lensFacing,
  }) async {
    if (sessionToken.isEmpty) {
      return {
        'success': false,
        'error': {
          'code': 'UNAUTHENTICATED',
          'message': 'Account login required to update camera configuration.',
        }
      };
    }

    try {
      final url = Uri.parse('$_baseUrl/cameras/$cameraId');
      final req = await _httpClient.patchUrl(url);
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');

      final payload = <String, dynamic>{};
      if (cameraName != null) payload['cameraName'] = cameraName;
      if (resolution != null) {
        payload['resolution'] = resolution == CameraResolutionPreset.p360
            ? '360p'
            : (resolution == CameraResolutionPreset.p480
                ? '480p'
                : (resolution == CameraResolutionPreset.p720 ? '720p' : '1080p'));
      }
      if (fps != null) payload['fps'] = fps;
      if (audioEnabled != null) payload['audioEnabled'] = audioEnabled;
      if (lensFacing != null) {
        payload['lensFacing'] =
            lensFacing == CameraLensFacing.front ? 'FRONT' : 'BACK';
      }

      req.write(jsonEncode(payload));

      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      final dynamic decoded = jsonDecode(body);

      if (decoded is! Map<String, dynamic>) {
        return {
          'success': false,
          'error': {
            'code': 'MALFORMED_RESPONSE',
            'message': 'Expected JSON object response from cameras endpoint.',
          }
        };
      }

      final json = decoded;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        final err = json['error'] as Map<String, dynamic>?;
        final errMsg = err?['message'] as String? ?? 'HTTP ${res.statusCode}';
        return {
          'success': false,
          'error': {
            'code': err?['code'] ?? 'HTTP_${res.statusCode}',
            'message': errMsg,
          }
        };
      }

      if (json['success'] != true || json['data'] is! Map) {
        final err = json['error'] as Map<String, dynamic>?;
        return {
          'success': false,
          'error': {
            'code': err?['code'] ?? 'INVALID_RESPONSE',
            'message': err?['message'] ?? 'Invalid response payload from server.',
          }
        };
      }

      return json;
    } catch (e) {
      AppLogger.error('[CameraRegistration] Network error during updateCameraConfig', e);
      return {
        'success': false,
        'error': {
          'code': 'NETWORK_ERROR',
          'message': 'Failed to update camera config: ${e.toString()}',
        }
      };
    }
  }
}

/// In-memory mock camera registration service for testing
class MockCameraRegistrationService implements CameraRegistrationService {
  bool shouldSucceed;
  String mockCameraId;
  String mockDeviceId;
  String mockDeviceCredential;
  String? failureCode;
  String? failureMessage;
  List<Map<String, dynamic>> existingCameras;
  int? failOnPage;
  bool simulateCeiling;
  int registerCameraCallCount = 0;
  int registerDeviceCallCount = 0;
  Future<void>? registerDeviceDelay;
  Future<void>? registerCameraDelay;

  MockCameraRegistrationService({
    this.shouldSucceed = true,
    this.mockCameraId = 'cam_mock_12345',
    this.mockDeviceId = 'dev_mock_67890',
    this.mockDeviceCredential = 'cred_mock_abcdef1234567890',
    this.failureCode,
    this.failureMessage,
    List<Map<String, dynamic>>? initialExistingCameras,
    this.failOnPage,
    this.simulateCeiling = false,
    this.registerDeviceDelay,
    this.registerCameraDelay,
  }) : existingCameras = initialExistingCameras ?? [];

  @override
  Future<Map<String, dynamic>> registerCameraDevice({
    required String sessionToken,
    required String deviceName,
    required String installationId,
    String platform = 'Android',
    String? osVersion,
    String? appVersion,
  }) async {
    registerDeviceCallCount++;
    if (registerDeviceDelay != null) {
      await registerDeviceDelay;
    }
    if (!shouldSucceed) {
      return {
        'success': false,
        'error': {
          'code': failureCode ?? 'DEVICE_REGISTRATION_FAILED',
          'message': failureMessage ?? 'Mock device registration rejected',
        }
      };
    }

    return {
      'success': true,
      'data': {
        'device': {
          'id': mockDeviceId,
          'installationId': installationId,
          'deviceName': deviceName,
          'status': 'ONLINE',
        },
        'deviceCredential': mockDeviceCredential,
      }
    };
  }

  @override
  Future<Map<String, dynamic>> listCameras({
    required String sessionToken,
    String? deviceId,
    int? page,
    int? limit,
  }) async {
    final p = page ?? 1;

    if (failOnPage != null && p == failOnPage) {
      return {
        'success': false,
        'error': {
          'code': 'PAGE_ERROR',
          'message': 'Simulated page $p failure',
        }
      };
    }

    if (!shouldSucceed) {
      return {
        'success': false,
        'error': {
          'code': failureCode ?? 'LIST_CAMERAS_FAILED',
          'message': failureMessage ?? 'Mock list cameras rejected',
        }
      };
    }

    final filtered = deviceId != null
        ? existingCameras.where((c) => c['deviceId'] == deviceId).toList()
        : existingCameras;

    final l = limit ?? 20;
    final startIndex = (p - 1) * l;
    final pageCameras = startIndex < filtered.length
        ? filtered.sublist(startIndex, (startIndex + l).clamp(0, filtered.length))
        : <Map<String, dynamic>>[];
    final hasMore = simulateCeiling || ((startIndex + pageCameras.length) < filtered.length);

    return {
      'success': true,
      'data': {
        'cameras': pageCameras,
        'totalCount': simulateCeiling ? 1000 : filtered.length,
        'page': p,
        'limit': l,
        'hasMore': hasMore,
      }
    };
  }

  @override
  Future<Map<String, dynamic>> getCamera({
    required String sessionToken,
    required String cameraId,
  }) async {
    if (!shouldSucceed) {
      return {
        'success': false,
        'error': {
          'code': failureCode ?? 'GET_CAMERA_FAILED',
          'message': failureMessage ?? 'Mock get camera rejected',
        }
      };
    }

    final found = existingCameras.firstWhere(
      (c) => c['id'] == cameraId,
      orElse: () => {
        'id': cameraId,
        'cameraName': 'Mock Camera',
        'status': 'OFFLINE',
        'deviceId': mockDeviceId,
      },
    );

    return {
      'success': true,
      'data': {
        'camera': found,
      }
    };
  }

  @override
  Future<Map<String, dynamic>> registerCamera({
    required String sessionToken,
    required String cameraName,
    required String installationId,
    required CameraLensFacing lensFacing,
    required CameraResolutionPreset resolution,
    required int fps,
    required bool audioEnabled,
    String? deviceId,
  }) async {
    registerCameraCallCount++;
    if (registerCameraDelay != null) {
      await registerCameraDelay;
    }
    if (!shouldSucceed) {
      return {
        'success': false,
        'error': {
          'code': failureCode ?? 'REGISTRATION_FAILED',
          'message': failureMessage ?? 'Mock registration rejected',
        }
      };
    }

    final newCam = {
      'id': mockCameraId,
      'deviceId': deviceId ?? mockDeviceId,
      'cameraName': cameraName,
      'status': 'OFFLINE',
      'lensFacing': lensFacing == CameraLensFacing.front ? 'FRONT' : 'BACK',
      'resolution': resolution.name,
      'fps': fps,
      'audioEnabled': audioEnabled,
      'createdAt': DateTime.now().toIso8601String(),
    };
    existingCameras.add(newCam);

    return {
      'success': true,
      'data': {
        'camera': newCam,
      }
    };
  }

  @override
  Future<Map<String, dynamic>> updateCameraConfig({
    required String sessionToken,
    required String cameraId,
    String? cameraName,
    CameraResolutionPreset? resolution,
    int? fps,
    bool? audioEnabled,
    CameraLensFacing? lensFacing,
  }) async {
    if (!shouldSucceed) {
      return {
        'success': false,
        'error': {
          'code': failureCode ?? 'UPDATE_FAILED',
          'message': failureMessage ?? 'Mock update rejected',
        }
      };
    }

    return {
      'success': true,
      'data': {
        'camera': {
          'id': cameraId,
          'cameraName': cameraName ?? 'Updated Camera',
          'status': 'OFFLINE',
        },
        'configurationAppliedToDevice': false,
        'message': 'Configuration updated successfully.',
      }
    };
  }
}
