import 'dart:convert';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config/app_config.dart';
import '../../../core/storage/secure_storage_service.dart';
import '../../../core/utils/logger.dart';
import '../domain/models/notification_item.dart';
import '../domain/models/notification_preferences.dart';

class NotificationListState {
  final List<NotificationItem> items;
  final int unreadCount;
  final String activeCategoryFilter;
  final bool isLoading;
  final String? errorMessage;
  final bool isSessionExpired;
  final Set<String> inFlightRetryIds;

  const NotificationListState({
    this.items = const [],
    this.unreadCount = 0,
    this.activeCategoryFilter = 'ALL',
    this.isLoading = false,
    this.errorMessage,
    this.isSessionExpired = false,
    this.inFlightRetryIds = const {},
  });

  NotificationListState copyWith({
    List<NotificationItem>? items,
    int? unreadCount,
    String? activeCategoryFilter,
    bool? isLoading,
    String? errorMessage,
    bool? isSessionExpired,
    Set<String>? inFlightRetryIds,
  }) {
    return NotificationListState(
      items: items ?? this.items,
      unreadCount: unreadCount ?? this.unreadCount,
      activeCategoryFilter: activeCategoryFilter ?? this.activeCategoryFilter,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
      isSessionExpired: isSessionExpired ?? this.isSessionExpired,
      inFlightRetryIds: inFlightRetryIds ?? this.inFlightRetryIds,
    );
  }
}

class NotificationListNotifier extends StateNotifier<NotificationListState> {
  final SecureStorageService _storageService;
  final HttpClient _httpClient;

  NotificationListNotifier({
    SecureStorageService? storageService,
    HttpClient? httpClient,
  })  : _storageService = storageService ?? InMemorySecureStorageService(),
        _httpClient = httpClient ?? (HttpClient()..badCertificateCallback = (cert, host, port) => AppConfig.current.environment != 'production'),
        super(const NotificationListState());

  Future<void> loadNotifications({String? category}) async {
    if (state.isLoading) return;
    state = state.copyWith(isLoading: true, errorMessage: null, isSessionExpired: false);

    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) {
        state = state.copyWith(
          isLoading: false,
          isSessionExpired: true,
          errorMessage: 'Your session has expired. Please sign in again.',
        );
        return;
      }

      final baseUrl = AppConfig.current.apiBaseUrl;
      final selectedCategory = category ?? state.activeCategoryFilter;
      var urlStr = '$baseUrl/notifications?page=1&limit=20';
      if (selectedCategory != 'ALL') {
        urlStr += '&category=${Uri.encodeComponent(selectedCategory)}';
      }

      final req = await _httpClient.getUrl(Uri.parse(urlStr));
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 10));
      final bodyStr = await res.transform(utf8.decoder).join();

      if (res.statusCode == 200) {
        final json = jsonDecode(bodyStr);
        final rawItems = (json['data']?['notifications'] ?? json['data']?['items']) as List<dynamic>? ?? [];
        final items = rawItems.map((e) => NotificationItem.fromJson(e as Map<String, dynamic>)).toList();

        int unreadCount = 0;
        try {
          final unreadReq = await _httpClient.getUrl(Uri.parse('$baseUrl/notifications/unread-count'));
          unreadReq.headers.set('authorization', 'Bearer $sessionToken');
          final unreadRes = await unreadReq.close().timeout(const Duration(seconds: 5));
          final unreadBodyStr = await unreadRes.transform(utf8.decoder).join();

          if (unreadRes.statusCode == 200) {
            final unreadJson = jsonDecode(unreadBodyStr);
            unreadCount = unreadJson['data']?['unreadCount'] as int? ?? 0;
          }
        } catch (_) {
          unreadCount = items.where((i) => i.state == NotificationStateEnum.unread).length;
        }

        state = state.copyWith(
          items: items,
          unreadCount: unreadCount,
          activeCategoryFilter: selectedCategory,
          isLoading: false,
          errorMessage: null,
          isSessionExpired: false,
        );
      } else if (res.statusCode == 401 || res.statusCode == 403) {
        state = state.copyWith(
          isLoading: false,
          isSessionExpired: true,
          errorMessage: 'Your session has expired. Please sign in again.',
        );
      } else if (res.statusCode == 429) {
        state = state.copyWith(
          isLoading: false,
          errorMessage: 'Too many requests. Please wait a moment before retrying.',
        );
      } else {
        state = state.copyWith(
          isLoading: false,
          errorMessage: 'Server error (${res.statusCode}) while loading notifications.',
        );
      }
    } catch (e) {
      AppLogger.error('[NotificationProvider] Error loading notifications', e);
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Unable to connect to server. Check your connection and retry.',
      );
    }
  }

  Future<void> markAsRead(String notificationId) async {
    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) return;

      final updatedItems = state.items.map((item) {
        if (item.id == notificationId) {
          return item.copyWith(state: NotificationStateEnum.read);
        }
        return item;
      }).toList();

      final newUnreadCount = (state.unreadCount - 1).clamp(0, 9999);
      state = state.copyWith(items: updatedItems, unreadCount: newUnreadCount);

      final baseUrl = AppConfig.current.apiBaseUrl;
      final req = await _httpClient.openUrl('PATCH', Uri.parse('$baseUrl/notifications/$notificationId/read'));
      req.headers.set('authorization', 'Bearer $sessionToken');
      await req.close().timeout(const Duration(seconds: 10));
    } catch (e) {
      AppLogger.error('[NotificationProvider] Error marking read', e);
    }
  }

  Future<void> markAllAsRead() async {
    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) return;

      final updatedItems = state.items.map((item) {
        return item.copyWith(state: NotificationStateEnum.read);
      }).toList();

      state = state.copyWith(items: updatedItems, unreadCount: 0);

      final baseUrl = AppConfig.current.apiBaseUrl;
      final req = await _httpClient.openUrl('POST', Uri.parse('$baseUrl/notifications/read-all'));
      req.headers.set('authorization', 'Bearer $sessionToken');
      await req.close().timeout(const Duration(seconds: 10));
    } catch (e) {
      AppLogger.error('[NotificationProvider] Error marking all read', e);
    }
  }

  Future<void> markAsArchived(String notificationId) async {
    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) return;

      final updatedItems = state.items.where((item) => item.id != notificationId).toList();
      state = state.copyWith(items: updatedItems);

      final baseUrl = AppConfig.current.apiBaseUrl;
      final req = await _httpClient.openUrl('PATCH', Uri.parse('$baseUrl/notifications/$notificationId/archive'));
      req.headers.set('authorization', 'Bearer $sessionToken');
      await req.close().timeout(const Duration(seconds: 10));
    } catch (e) {
      AppLogger.error('[NotificationProvider] Error marking archived', e);
    }
  }

  Future<Map<String, dynamic>> retryDelivery(String notificationId) async {
    if (state.inFlightRetryIds.contains(notificationId)) {
      return {'success': false, 'message': 'Retry already in progress.'};
    }

    final updatedInFlight = Set<String>.from(state.inFlightRetryIds)..add(notificationId);
    state = state.copyWith(inFlightRetryIds: updatedInFlight);

    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) {
        state = state.copyWith(
          inFlightRetryIds: Set<String>.from(state.inFlightRetryIds)..remove(notificationId),
          isSessionExpired: true,
        );
        return {'success': false, 'message': 'Session expired. Please log in again.'};
      }

      final baseUrl = AppConfig.current.apiBaseUrl;
      final req = await _httpClient.openUrl('POST', Uri.parse('$baseUrl/notifications/$notificationId/retry'));
      req.headers.set('authorization', 'Bearer $sessionToken');
      req.headers.set('content-type', 'application/json');

      final res = await req.close().timeout(const Duration(seconds: 10));
      final bodyStr = await res.transform(utf8.decoder).join();
      final json = bodyStr.isNotEmpty ? jsonDecode(bodyStr) as Map<String, dynamic> : <String, dynamic>{};

      if (res.statusCode == 200) {
        final data = json['data'] as Map<String, dynamic>? ?? {};
        final deliveryStatusMap = data['deliveryStatus'] as Map<String, dynamic>?;

        final updatedItems = state.items.map((item) {
          if (item.id == notificationId) {
            final newDeliveryStatus = deliveryStatusMap != null
                ? NotificationDeliveryStatus.fromJson(deliveryStatusMap)
                : item.deliveryStatus;
            return item.copyWith(deliveryStatus: newDeliveryStatus);
          }
          return item;
        }).toList();

        state = state.copyWith(
          items: updatedItems,
          inFlightRetryIds: Set<String>.from(state.inFlightRetryIds)..remove(notificationId),
        );

        final msg = data['alreadyDelivered'] == true
            ? 'All channels already delivered.'
            : 'Notification redelivery requested.';

        return {'success': true, 'message': msg, 'data': data};
      } else if (res.statusCode == 401 || res.statusCode == 403) {
        state = state.copyWith(
          inFlightRetryIds: Set<String>.from(state.inFlightRetryIds)..remove(notificationId),
          isSessionExpired: true,
        );
        return {'success': false, 'message': 'Session expired. Please sign in again.'};
      } else if (res.statusCode == 429) {
        state = state.copyWith(
          inFlightRetryIds: Set<String>.from(state.inFlightRetryIds)..remove(notificationId),
        );
        return {'success': false, 'message': 'Rate limited: please wait a moment before retrying.'};
      } else {
        final errMessage = (json['error'] is Map ? json['error']['message'] : null) as String? ?? 'Redelivery failed.';
        state = state.copyWith(
          inFlightRetryIds: Set<String>.from(state.inFlightRetryIds)..remove(notificationId),
        );
        return {'success': false, 'message': errMessage};
      }
    } catch (e) {
      AppLogger.error('[NotificationProvider] Error retrying notification delivery', e);
      state = state.copyWith(
        inFlightRetryIds: Set<String>.from(state.inFlightRetryIds)..remove(notificationId),
      );
      return {'success': false, 'message': 'Connection error during redelivery request.'};
    }
  }
}

final notificationListProvider = StateNotifierProvider<NotificationListNotifier, NotificationListState>(
  (ref) => NotificationListNotifier(),
);

class NotificationPreferencesNotifier extends StateNotifier<AsyncValue<NotificationPreferences>> {
  final SecureStorageService _storageService;
  final HttpClient _httpClient;

  NotificationPreferencesNotifier({
    SecureStorageService? storageService,
    HttpClient? httpClient,
  })  : _storageService = storageService ?? InMemorySecureStorageService(),
        _httpClient = httpClient ?? (HttpClient()..badCertificateCallback = (cert, host, port) => AppConfig.current.environment != 'production'),
        super(const AsyncValue.loading());

  Future<void> fetchPreferences() async {
    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) {
        state = AsyncValue.error('Unauthenticated', StackTrace.current);
        return;
      }

      final baseUrl = AppConfig.current.apiBaseUrl;
      final req = await _httpClient.getUrl(Uri.parse('$baseUrl/notifications/preferences'));
      req.headers.set('authorization', 'Bearer $sessionToken');

      final res = await req.close().timeout(const Duration(seconds: 10));
      final bodyStr = await res.transform(utf8.decoder).join();

      if (res.statusCode == 200) {
        final json = jsonDecode(bodyStr);
        final prefs = NotificationPreferences.fromJson(json['data'] as Map<String, dynamic>);
        state = AsyncValue.data(prefs);
      } else {
        state = AsyncValue.error('Failed to load preferences', StackTrace.current);
      }
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }

  Future<bool> savePreferences(NotificationPreferences preferences) async {
    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) return false;

      final baseUrl = AppConfig.current.apiBaseUrl;
      final req = await _httpClient.openUrl('PATCH', Uri.parse('$baseUrl/notifications/preferences'));
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');
      req.write(jsonEncode(preferences.toJson()));

      final res = await req.close().timeout(const Duration(seconds: 10));
      final bodyStr = await res.transform(utf8.decoder).join();

      if (res.statusCode == 200) {
        final json = jsonDecode(bodyStr);
        final serverPrefs = NotificationPreferences.fromJson(json['data'] as Map<String, dynamic>);
        state = AsyncValue.data(serverPrefs);
        return true;
      }
      return false;
    } catch (e) {
      AppLogger.error('[NotificationProvider] Error saving preferences', e);
      return false;
    }
  }

  Future<bool> updatePreferences({
    bool? globalPushEnabled,
    bool? globalEmailEnabled,
    Map<String, CategoryPreferenceItem>? categories,
  }) async {
    final current = state.value ?? const NotificationPreferences();
    final updated = current.copyWith(
      globalPushEnabled: globalPushEnabled,
      globalEmailEnabled: globalEmailEnabled,
      categories: categories,
    );

    return savePreferences(updated);
  }
}

final notificationPreferencesProvider =
    StateNotifierProvider<NotificationPreferencesNotifier, AsyncValue<NotificationPreferences>>(
  (ref) => NotificationPreferencesNotifier(),
);
