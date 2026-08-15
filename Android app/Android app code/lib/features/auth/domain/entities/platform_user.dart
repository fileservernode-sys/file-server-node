/// Strongly Typed Platform User Entity
class PlatformUser {
  final String id;
  final String email;
  final bool emailVerified;
  final String status;
  final DateTime createdAt;

  const PlatformUser({
    required this.id,
    required this.email,
    required this.emailVerified,
    required this.status,
    required this.createdAt,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'emailVerified': emailVerified,
      'status': status,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory PlatformUser.fromJson(Map<String, dynamic> json) {
    return PlatformUser(
      id: json['id'] as String,
      email: json['email'] as String,
      emailVerified: json['emailVerified'] as bool? ?? false,
      status: json['status'] as String? ?? 'ACTIVE',
      createdAt: json['createdAt'] != null
          ? DateTime.parse(json['createdAt'] as String)
          : DateTime.now(),
    );
  }
}
