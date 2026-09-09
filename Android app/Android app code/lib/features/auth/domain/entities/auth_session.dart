import 'platform_user.dart';

class AuthSession {
  static const Duration maxSessionDuration = Duration(hours: 24);

  final String accessToken;
  final String refreshToken;
  final PlatformUser user;
  final DateTime expiresAt;
  final DateTime? issuedAt;

  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
    required this.expiresAt,
    this.issuedAt,
  });

  DateTime get effectiveIssuedAt =>
      issuedAt ?? expiresAt.subtract(maxSessionDuration);

  bool get isExpired {
    final now = DateTime.now();
    return now.isAfter(expiresAt) ||
        now.difference(effectiveIssuedAt) >= maxSessionDuration;
  }

  Map<String, dynamic> toJson() {
    return {
      'accessToken': accessToken,
      'refreshToken': refreshToken,
      'user': user.toJson(),
      'expiresAt': expiresAt.toIso8601String(),
      'issuedAt': effectiveIssuedAt.toIso8601String(),
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

    final issuedAt = json['issuedAt'] != null
        ? DateTime.parse(json['issuedAt'] as String)
        : null;

    return AuthSession(
      accessToken: (json['accessToken'] ?? json['token'] ?? '') as String,
      refreshToken: (json['refreshToken'] ?? json['token'] ?? '') as String,
      user: user,
      issuedAt: issuedAt,
      expiresAt: json['expiresAt'] != null
          ? DateTime.parse(json['expiresAt'] as String)
          : (issuedAt != null
              ? issuedAt.add(maxSessionDuration)
              : DateTime.now().add(maxSessionDuration)),
    );
  }
}
