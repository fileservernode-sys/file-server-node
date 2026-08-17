import '../../../../core/storage/secure_storage_service.dart';
import '../../data/datasources/device_remote_datasource.dart';
import '../services/device_identity_service.dart';

abstract class DeviceRepository {
  Future<String> getOrCreateInstallationId();
  Future<Map<String, dynamic>> registerDevice({
    required String deviceName,
    required String sessionToken,
  });
  Future<bool> sendHeartbeat({
    required String deviceId,
    required String sessionToken,
  });
}

class DeviceRepositoryImpl implements DeviceRepository {
  final DeviceRemoteDataSource _remoteDataSource;
  final DeviceIdentityService _identityService;

  DeviceRepositoryImpl({
    DeviceRemoteDataSource? remoteDataSource,
    DeviceIdentityService? identityService,
    SecureStorageService? secureStorageService,
  })  : _remoteDataSource = remoteDataSource ?? HttpDeviceRemoteDataSource(),
        _identityService = identityService ??
            MethodChannelDeviceIdentityService(
              storage: secureStorageService ?? FileSecureStorageService(),
            );

  @override
  Future<String> getOrCreateInstallationId() async {
    return _identityService.getInstallationId();
  }

  @override
  Future<Map<String, dynamic>> registerDevice({
    required String deviceName,
    required String sessionToken,
  }) async {
    final installationId = await getOrCreateInstallationId();
    return _remoteDataSource.registerDevice(
      deviceName: deviceName,
      installationId: installationId,
      sessionToken: sessionToken,
    );
  }

  @override
  Future<bool> sendHeartbeat({
    required String deviceId,
    required String sessionToken,
  }) async {
    return _remoteDataSource.sendHeartbeat(
      deviceId: deviceId,
      sessionToken: sessionToken,
    );
  }
}
