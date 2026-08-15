import 'package:flutter/foundation.dart';

/// Development-Safe Logging Abstraction (Prevents Secret Leaks in Release Builds)
class AppLogger {
  static const String _tag = '[RemoteNode]';

  static void info(String message) {
    if (!kReleaseMode) {
      debugPrint('$_tag ℹ️ INFO: ${_sanitize(message)}');
    }
  }

  static void warning(String message, [Object? error]) {
    if (!kReleaseMode) {
      debugPrint(
          '$_tag ⚠️ WARN: ${_sanitize(message)}${error != null ? ' | $error' : ''}');
    }
  }

  static void error(String message, [Object? error, StackTrace? stackTrace]) {
    if (!kReleaseMode) {
      debugPrint(
          '$_tag ❌ ERROR: ${_sanitize(message)}${error != null ? ' | $error' : ''}');
      if (stackTrace != null) {
        debugPrint(stackTrace.toString());
      }
    }
  }

  /// Sanitizes sensitive parameters to ensure no tokens, passwords, or OTPs leak to system logcat
  static String _sanitize(String text) {
    var sanitized = text;
    sanitized = sanitized.replaceAll(
        RegExp(r'password=([^& ]+)', caseSensitive: false),
        'password=[REDACTED]');
    sanitized = sanitized.replaceAll(
        RegExp(r'otp=([^& ]+)', caseSensitive: false), 'otp=[REDACTED]');
    sanitized = sanitized.replaceAll(
        RegExp(r'token=([^& ]+)', caseSensitive: false), 'token=[REDACTED]');
    return sanitized;
  }
}
