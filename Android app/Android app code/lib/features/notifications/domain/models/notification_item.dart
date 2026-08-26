enum NotificationStateEnum { unread, read, archived }

class NotificationItem {
  final String id;
  final String eventId;
  final String userId;
  final String? deviceId;
  final String? serverId;
  final String eventType;
  final String category;
  final String severity;
  final String title;
  final String body;
  final String? deepLinkUri;
  final String? webPath;
  final NotificationStateEnum state;
  final DateTime createdAt;

  const NotificationItem({
    required this.id,
    required this.eventId,
    required this.userId,
    this.deviceId,
    this.serverId,
    required this.eventType,
    required this.category,
    required this.severity,
    required this.title,
    required this.body,
    this.deepLinkUri,
    this.webPath,
    required this.state,
    required this.createdAt,
  });

  factory NotificationItem.fromJson(Map<String, dynamic> json) {
    NotificationStateEnum parseState(String? st) {
      switch ((st ?? '').toUpperCase()) {
        case 'READ':
          return NotificationStateEnum.read;
        case 'ARCHIVED':
          return NotificationStateEnum.archived;
        case 'UNREAD':
        default:
          return NotificationStateEnum.unread;
      }
    }

    return NotificationItem(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      deviceId: json['deviceId'] as String?,
      serverId: json['serverId'] as String?,
      eventType: json['eventType'] as String? ?? json['type'] as String? ?? 'GENERAL',
      category: json['category'] as String? ?? 'SYSTEM',
      severity: json['severity'] as String? ?? 'INFO',
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      deepLinkUri: json['deepLinkUri'] as String? ?? (json['deepLink'] is Map ? json['deepLink']['uri'] as String? : null),
      webPath: json['webPath'] as String? ?? (json['deepLink'] is Map ? json['deepLink']['webPath'] as String? : null),
      state: parseState(json['state'] as String? ?? json['status'] as String?),
      createdAt: json['createdAt'] != null
          ? DateTime.parse(json['createdAt'] as String)
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'userId': userId,
      'deviceId': deviceId,
      'serverId': serverId,
      'eventType': eventType,
      'category': category,
      'severity': severity,
      'title': title,
      'body': body,
      'deepLinkUri': deepLinkUri,
      'webPath': webPath,
      'state': state.name.toUpperCase(),
      'createdAt': createdAt.toIso8601String(),
    };
  }

  NotificationItem copyWith({
    NotificationStateEnum? state,
  }) {
    return NotificationItem(
      id: id,
      eventId: eventId,
      userId: userId,
      deviceId: deviceId,
      serverId: serverId,
      eventType: eventType,
      category: category,
      severity: severity,
      title: title,
      body: body,
      deepLinkUri: deepLinkUri,
      webPath: webPath,
      state: state ?? this.state,
      createdAt: createdAt,
    );
  }
}
