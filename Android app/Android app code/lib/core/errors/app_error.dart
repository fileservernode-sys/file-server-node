/// Centralized Application Error Hierarchy
abstract class AppError implements Exception {
  final String message;
  final String? code;

  const AppError(this.message, {this.code});

  @override
  String toString() => '$runtimeType: $message${code != null ? ' ($code)' : ''}';
}

/// Network Connectivity Error
class NetworkError extends AppError {
  const NetworkError([
    super.message = 'Unable to connect to platform server. Please check network connection.',
    String? code = 'NETWORK_ERROR',
  ]) : super(code: code);
}

/// Request Timeout Error
class TimeoutError extends AppError {
  const TimeoutError([
    super.message = 'Connection timed out. Please try again.',
    String? code = 'TIMEOUT_ERROR',
  ]) : super(code: code);
}

/// Authentication Error
class AuthenticationError extends AppError {
  const AuthenticationError([
    super.message = 'Authentication failed or session expired.',
    String? code = 'UNAUTHORIZED',
  ]) : super(code: code);
}

/// Input Validation Error
class ValidationError extends AppError {
  const ValidationError([
    super.message = 'Invalid input parameters.',
    String? code = 'VALIDATION_ERROR',
  ]) : super(code: code);
}

/// Server / Control Plane Error
class ServerError extends AppError {
  const ServerError([
    super.message = 'Platform service error occurred.',
    String? code = 'SERVER_ERROR',
  ]) : super(code: code);
}

/// Unexpected Error
class UnknownError extends AppError {
  const UnknownError([
    super.message = 'An unexpected error occurred.',
    String? code = 'UNKNOWN_ERROR',
  ]) : super(code: code);
}
