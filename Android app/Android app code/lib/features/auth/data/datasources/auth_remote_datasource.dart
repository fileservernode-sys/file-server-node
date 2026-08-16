import 'dart:convert';
import 'dart:io';
import '../../../../core/config/app_config.dart';
import '../../domain/entities/auth_session.dart';
import '../../domain/entities/platform_user.dart';
import '../models/auth_models.dart';

/// Remote Data Source Interface for Authentication API Endpoints
abstract class AuthRemoteDataSource {
  Future<AuthResponse> login(LoginRequest request);
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request);
  Future<bool> resendOtp(String email);
  Future<void> logout();
}

/// HTTP API Client Implementation of AuthRemoteDataSource targeting Main Website Backend
class HttpAuthRemoteDataSource implements AuthRemoteDataSource {
  final HttpClient _httpClient;
  final String _baseUrl;

  HttpAuthRemoteDataSource({
    HttpClient? httpClient,
    String? baseUrl,
  })  : _httpClient = httpClient ?? HttpClient(),
        _baseUrl = baseUrl ?? AppConfig.current.apiBaseUrl;

  @override
  Future<AuthResponse> login(LoginRequest request) async {
    try {
      final url = Uri.parse('$_baseUrl/auth/login');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.write(jsonEncode(request.toJson()));

      final res = await req.close().timeout(const Duration(seconds: 8));
      final responseBody = await res.transform(utf8.decoder).join();
      final json = jsonDecode(responseBody) as Map<String, dynamic>;

      if (res.statusCode >= 400 || json['success'] == false) {
        final error = json['error'] as Map<String, dynamic>?;
        return AuthResponse(
          success: false,
          message: error?['message'] ?? 'Authentication failed (${res.statusCode})',
          errorCode: error?['code'] ?? 'AUTH_ERROR',
        );
      }

      return AuthResponse.fromJson(json);
    } catch (e) {
      return AuthResponse(
        success: false,
        message: 'Network error connecting to auth service: ${e.toString()}',
        errorCode: 'NETWORK_ERROR',
      );
    }
  }

  @override
  Future<AuthResponse> verifyOtp(OtpVerificationRequest request) async {
    try {
      final url = Uri.parse('$_baseUrl/auth/verify-otp');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.write(jsonEncode(request.toJson()));

      final res = await req.close().timeout(const Duration(seconds: 8));
      final responseBody = await res.transform(utf8.decoder).join();
      final json = jsonDecode(responseBody) as Map<String, dynamic>;

      if (res.statusCode >= 400 || json['success'] == false) {
        final error = json['error'] as Map<String, dynamic>?;
        return AuthResponse(
          success: false,
          message: error?['message'] ?? 'OTP Verification failed (${res.statusCode})',
          errorCode: error?['code'] ?? 'OTP_ERROR',
        );
      }

      return AuthResponse.fromJson(json);
    } catch (e) {
      return AuthResponse(
        success: false,
        message: 'Network error verifying OTP code: ${e.toString()}',
        errorCode: 'NETWORK_ERROR',
      );
    }
  }

  @override
  Future<bool> resendOtp(String email) async {
    try {
      final url = Uri.parse('$_baseUrl/auth/resend-otp');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      req.write(jsonEncode({'email': email}));

      final res = await req.close().timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  @override
  Future<void> logout() async {
    try {
      final url = Uri.parse('$_baseUrl/auth/logout');
      final req = await _httpClient.postUrl(url);
      req.headers.set('content-type', 'application/json');
      await req.close().timeout(const Duration(seconds: 3));
    } catch (e) {
      // Ignore logout connection errors
    }
  }
}

/// Mock Remote Data Source for Development Architecture Preparation
class MockAuthRemoteDataSource implements AuthRemoteDataSource {
  const MockAuthRemoteDataSource();

  @override
  Future<AuthResponse> login(LoginRequest request) async {
    await Future.delayed(const Duration(milliseconds: 400));

    if (request.email.isEmpty || request.password.isEmpty) {
      return const AuthResponse(
        success: false,
        message: 'Email and password are required.',
        errorCode: 'INVALID_INPUT',
      );
    }

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
      expiresAt: DateTime.now().add(const Duration(days: 30)),
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
