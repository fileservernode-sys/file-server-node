import '../../domain/entities/auth_session.dart';

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
    return {
      'email': email.trim().toLowerCase(),
      'otpCode': otpCode.trim(),
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
    return AuthResponse(
      success: json['success'] as bool? ?? false,
      requiresOtp: json['requiresOtp'] as bool? ?? false,
      session: json['session'] != null
          ? AuthSession.fromJson(json['session'] as Map<String, dynamic>)
          : null,
      message: json['message'] as String?,
      errorCode: json['errorCode'] as String?,
    );
  }
}
