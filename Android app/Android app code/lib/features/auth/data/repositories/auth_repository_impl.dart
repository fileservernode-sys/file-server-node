import '../../domain/entities/auth_session.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_remote_datasource.dart';
import '../models/auth_models.dart';
import '../../../../core/storage/secure_storage_service.dart';

/// Production Implementation of AuthRepository
class AuthRepositoryImpl implements AuthRepository {
  final AuthRemoteDataSource _remoteDataSource;
  final SecureStorageService _secureStorageService;

  AuthRepositoryImpl({
    required AuthRemoteDataSource remoteDataSource,
    required SecureStorageService secureStorageService,
  })  : _remoteDataSource = remoteDataSource,
        _secureStorageService = secureStorageService;

  @override
  Future<AuthResponse> login(LoginRequest request) {
    return _remoteDataSource.login(request);
  }

  @override
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request) async {
    final response = await _remoteDataSource.verifyOtp(request);
    if (response.success && response.session != null) {
      await _secureStorageService.saveSession(response.session!);
    }
    return response;
  }

  @override
  Future<bool> resendOtp(String email) {
    return _remoteDataSource.resendOtp(email);
  }

  @override
  Future<AuthSession?> getCurrentSession() {
    return _secureStorageService.getSession();
  }

  @override
  Future<void> logout() async {
    await _remoteDataSource.logout();
    await _secureStorageService.clearSession();
  }
}
