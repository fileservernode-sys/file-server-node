import '../../domain/entities/auth_session.dart';
import '../../domain/entities/platform_user.dart';

/// Data Transfer Object — Login Request Credentials
class LoginRequest {
  final String email;
  final String password;

  const LoginRequest({
    required this.email,
    required this.password,
  });

  Map<String, dynamic> toJson() {
    return {
      'email': email.trim().toLowerCase(),
      'password': password,
    };
  }
}

/// Data Transfer Object — 6-Digit OTP Verification Request
class OtpVerificationRequest {
  final String email;
  final String otpCode;

  const OtpVerificationRequest({
    required this.email,
    required this.otpCode,
  });

  Map<String, dynamic> toJson() {
    final code = otpCode.trim();
    return {
      'email': email.trim().toLowerCase(),
      'otp': code,
      'code': code,
      'otpCode': code,
    };
  }
}

/// Data Transfer Object — Generic Authentication Response
class AuthResponse {
  final bool success;
  final bool requiresOtp;
  final AuthSession? session;
  final String? message;
  final String? errorCode;

  const AuthResponse({
    required this.success,
    this.requiresOtp = false,
    this.session,
    this.message,
    this.errorCode,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) {
    // Unwraps backend API standard response format: { success: true, data: { ... } }
    final isSuccess = json['success'] as bool? ?? true;
    final payload = json['data'] is Map<String, dynamic>
        ? json['data'] as Map<String, dynamic>
        : json;

    AuthSession? session;
    if (payload['session'] != null) {
      session =
          AuthSession.fromJson(payload['session'] as Map<String, dynamic>);
    } else if (payload['token'] != null && payload['user'] != null) {
      session = AuthSession(
        accessToken: payload['token'] as String,
        refreshToken: payload['token'] as String,
        user: PlatformUser.fromJson(payload['user'] as Map<String, dynamic>),
        expiresAt: DateTime.now().add(const Duration(days: 30)),
      );
    }

    return AuthResponse(
      success: isSuccess,
      requiresOtp: payload['requiresOtp'] as bool? ?? false,
      session: session,
      message: payload['message'] as String?,
      errorCode: payload['errorCode'] as String?,
    );
  }
}
