/// Canonical Category Preference Model for Android
class CategoryPreferenceItem {
  final bool enabled;
  final bool inApp;
  final bool push;
  final bool email;

  const CategoryPreferenceItem({
    this.enabled = true,
    this.inApp = true,
    this.push = true,
    this.email = true,
  });

  factory CategoryPreferenceItem.fromJson(Map<String, dynamic> json) {
    final channels = (json['channels'] as Map<String, dynamic>?) ?? {};
    return CategoryPreferenceItem(
      enabled: json['enabled'] as bool? ?? true,
      inApp: channels['IN_APP'] as bool? ?? true,
      push: channels['PUSH'] as bool? ?? true,
      email: channels['EMAIL'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'enabled': enabled,
      'channels': {
        'IN_APP': inApp,
        'PUSH': push,
        'EMAIL': email,
      },
    };
  }

  CategoryPreferenceItem copyWith({
    bool? enabled,
    bool? inApp,
    bool? push,
    bool? email,
  }) {
    return CategoryPreferenceItem(
      enabled: enabled ?? this.enabled,
      inApp: inApp ?? this.inApp,
      push: push ?? this.push,
      email: email ?? this.email,
    );
  }
}

/// Authoritative User Notification Preferences Model for Android
class NotificationPreferences {
  final String? userId;
  final bool globalPushEnabled;
  final bool globalEmailEnabled;
  final Map<String, CategoryPreferenceItem> categories;
  final DateTime? updatedAt;

  const NotificationPreferences({
    this.userId,
    this.globalPushEnabled = true,
    this.globalEmailEnabled = true,
    this.categories = const {},
    this.updatedAt,
  });

  static Map<String, CategoryPreferenceItem> get defaultCategories => {
        'ACCOUNT_SECURITY': const CategoryPreferenceItem(enabled: true, inApp: true, push: true, email: true),
        'DEVICE_SERVER': const CategoryPreferenceItem(enabled: true, inApp: true, push: true, email: true),
        'BILLING': const CategoryPreferenceItem(enabled: true, inApp: true, push: true, email: true),
        'STORAGE': const CategoryPreferenceItem(enabled: true, inApp: true, push: true, email: true),
        'FILE_OPERATIONS': const CategoryPreferenceItem(enabled: true, inApp: true, push: true, email: false),
        'SYSTEM': const CategoryPreferenceItem(enabled: true, inApp: true, push: true, email: false),
      };

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) {
    final rawCategories = (json['categories'] ?? json['categoryPreferences']) as Map<String, dynamic>? ?? {};

    final merged = Map<String, CategoryPreferenceItem>.from(defaultCategories);

    rawCategories.forEach((key, val) {
      if (val is Map<String, dynamic>) {
        final parsed = CategoryPreferenceItem.fromJson(val);
        merged[key] = parsed;
      }
    });

    // Enforce mandatory security policy invariant:
    final sec = merged['ACCOUNT_SECURITY'] ?? defaultCategories['ACCOUNT_SECURITY']!;
    merged['ACCOUNT_SECURITY'] = sec.copyWith(enabled: true, inApp: true, email: true);

    DateTime? updated;
    if (json['updatedAt'] != null) {
      updated = DateTime.tryParse(json['updatedAt'].toString());
    }

    return NotificationPreferences(
      userId: json['userId'] as String?,
      globalPushEnabled: json['globalPushEnabled'] as bool? ?? true,
      globalEmailEnabled: json['globalEmailEnabled'] as bool? ?? true,
      categories: merged,
      updatedAt: updated,
    );
  }

  Map<String, dynamic> toJson() {
    final catJson = <String, dynamic>{};
    categories.forEach((key, item) {
      catJson[key] = item.toJson();
    });

    return {
      if (userId != null) 'userId': userId,
      'globalPushEnabled': globalPushEnabled,
      'globalEmailEnabled': globalEmailEnabled,
      'categories': catJson,
      'categoryPreferences': catJson, // Backwards-compatible alias
      if (updatedAt != null) 'updatedAt': updatedAt!.toIso8601String(),
    };
  }

  NotificationPreferences copyWith({
    String? userId,
    bool? globalPushEnabled,
    bool? globalEmailEnabled,
    Map<String, CategoryPreferenceItem>? categories,
    DateTime? updatedAt,
  }) {
    return NotificationPreferences(
      userId: userId ?? this.userId,
      globalPushEnabled: globalPushEnabled ?? this.globalPushEnabled,
      globalEmailEnabled: globalEmailEnabled ?? this.globalEmailEnabled,
      categories: categories ?? this.categories,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  CategoryPreferenceItem getCategory(String key) {
    return categories[key] ?? defaultCategories[key] ?? const CategoryPreferenceItem();
  }
}
