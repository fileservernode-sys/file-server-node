import '../entities/auth_session.dart';
import '../../data/models/auth_models.dart';

/// Abstract Repository Contract for Platform Authentication
abstract class AuthRepository {
  /// Initiates email + password login on Main Website backend
  Future<AuthResponse> login(LoginRequest request);

  /// Verifies 6-digit security OTP sent via Serverbyt SMTP
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request);

  /// Resends security OTP to user email
  Future<bool> resendOtp(String email);

  /// Fetches currently authenticated session if valid
  Future<AuthSession?> getCurrentSession();

  /// Logs out of platform account and clears session token
  Future<void> logout();
}
