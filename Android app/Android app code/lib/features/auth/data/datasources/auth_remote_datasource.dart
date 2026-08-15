import '../models/auth_models.dart';
import '../../domain/entities/auth_session.dart';
import '../../domain/entities/platform_user.dart';

/// Remote Data Source Interface for Authentication API Endpoints
abstract class AuthRemoteDataSource {
  Future<AuthResponse> login(LoginRequest request);
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request);
  Future<bool> resendOtp(String email);
  Future<void> logout();
}

/// Mock Remote Data Source for Development Architecture Preparation
class MockAuthRemoteDataSource implements AuthRemoteDataSource {
  @override
  Future<AuthResponse> login(LoginRequest request) async {
    await Future.delayed(const Duration(milliseconds: 400));

    // Basic UI validation check
    if (request.email.isEmpty || request.password.isEmpty) {
      return const AuthResponse(
        success: false,
        message: 'Email and password are required.',
        errorCode: 'INVALID_INPUT',
      );
    }

    // Returns requiresOtp=true as per product design
    return const AuthResponse(
      success: true,
      requiresOtp: true,
      message:
          'Credentials verified. 6-digit security code sent to your email.',
    );
  }

  @override
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request) async {
    await Future.delayed(const Duration(milliseconds: 400));

    if (request.otpCode.length != 6) {
      return const AuthResponse(
        success: false,
        message: 'Invalid code format. Enter a 6-digit number.',
        errorCode: 'INVALID_OTP_FORMAT',
      );
    }

    // Mock successful session
    final mockUser = PlatformUser(
      id: 'mock-user-uuid-101',
      email: request.email,
      emailVerified: true,
      status: 'ACTIVE',
      createdAt: DateTime.now(),
    );

    final mockSession = AuthSession(
      accessToken: 'mock-jwt-access-token',
      refreshToken: 'mock-jwt-refresh-token',
      user: mockUser,
      expiresAt: DateTime.now().add(const Duration(days: 7)),
    );

    return AuthResponse(
      success: true,
      requiresOtp: false,
      session: mockSession,
      message: 'Authentication successful.',
    );
  }

  @override
  Future<bool> resendOtp(String email) async {
    await Future.delayed(const Duration(milliseconds: 300));
    return true;
  }

  @override
  Future<void> logout() async {
    await Future.delayed(const Duration(milliseconds: 200));
  }
}
