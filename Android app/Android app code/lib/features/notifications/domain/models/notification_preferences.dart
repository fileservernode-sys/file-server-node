class NotificationPreferences {
  final bool globalPushEnabled;
  final bool globalEmailEnabled;
  final Map<String, dynamic> categoryPreferences;

  const NotificationPreferences({
    this.globalPushEnabled = true,
    this.globalEmailEnabled = true,
    this.categoryPreferences = const {},
  });

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) {
    return NotificationPreferences(
      globalPushEnabled: json['globalPushEnabled'] as bool? ?? true,
      globalEmailEnabled: json['globalEmailEnabled'] as bool? ?? true,
      categoryPreferences: (json['categoryPreferences'] as Map<String, dynamic>?) ?? {},
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'globalPushEnabled': globalPushEnabled,
      'globalEmailEnabled': globalEmailEnabled,
      'categoryPreferences': categoryPreferences,
    };
  }

  NotificationPreferences copyWith({
    bool? globalPushEnabled,
    bool? globalEmailEnabled,
    Map<String, dynamic>? categoryPreferences,
  }) {
    return NotificationPreferences(
      globalPushEnabled: globalPushEnabled ?? this.globalPushEnabled,
      globalEmailEnabled: globalEmailEnabled ?? this.globalEmailEnabled,
      categoryPreferences: categoryPreferences ?? this.categoryPreferences,
    );
  }
}
