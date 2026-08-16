import 'platform_user.dart';

/// Strongly Typed Authenticated Session Entity
class AuthSession {
  final String accessToken;
  final String refreshToken;
  final PlatformUser user;
  final DateTime expiresAt;

  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
    required this.expiresAt,
  });

  bool get isExpired => DateTime.now().isAfter(expiresAt);

  Map<String, dynamic> toJson() {
    return {
      'accessToken': accessToken,
      'refreshToken': refreshToken,
      'user': user.toJson(),
      'expiresAt': expiresAt.toIso8601String(),
    };
  }

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    PlatformUser user;
    if (json['user'] is Map<String, dynamic>) {
      user = PlatformUser.fromJson(json['user'] as Map<String, dynamic>);
    } else {
      user = PlatformUser(
        id: json['userId'] as String? ?? 'user-node',
        email: json['email'] as String? ?? '',
        emailVerified: true,
        status: 'ACTIVE',
        createdAt: DateTime.now(),
      );
    }

    return AuthSession(
      accessToken: (json['accessToken'] ?? json['token'] ?? '') as String,
      refreshToken: (json['refreshToken'] ?? json['token'] ?? '') as String,
      user: user,
      expiresAt: json['expiresAt'] != null
          ? DateTime.parse(json['expiresAt'] as String)
          : DateTime.now().add(const Duration(days: 30)),
    );
  }
}
