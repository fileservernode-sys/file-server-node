import '../../../../core/storage/secure_storage_service.dart';
import '../../data/datasources/device_remote_datasource.dart';

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
  final SecureStorageService _secureStorageService;

  DeviceRepositoryImpl({
    DeviceRemoteDataSource? remoteDataSource,
    SecureStorageService? secureStorageService,
  })  : _remoteDataSource = remoteDataSource ?? HttpDeviceRemoteDataSource(),
        _secureStorageService =
            secureStorageService ?? InMemorySecureStorageService();

  @override
  Future<String> getOrCreateInstallationId() async {
    const key = 'device_installation_id';
    var installationId = await _secureStorageService.read(key: key);
    if (installationId == null || installationId.isEmpty) {
      installationId = 'inst-node-${DateTime.now().millisecondsSinceEpoch}';
      await _secureStorageService.write(key: key, value: installationId);
    }
    return installationId;
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
