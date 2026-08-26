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

  const NotificationListState({
    this.items = const [],
    this.unreadCount = 0,
    this.activeCategoryFilter = 'ALL',
    this.isLoading = false,
    this.errorMessage,
  });

  NotificationListState copyWith({
    List<NotificationItem>? items,
    int? unreadCount,
    String? activeCategoryFilter,
    bool? isLoading,
    String? errorMessage,
  }) {
    return NotificationListState(
      items: items ?? this.items,
      unreadCount: unreadCount ?? this.unreadCount,
      activeCategoryFilter: activeCategoryFilter ?? this.activeCategoryFilter,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
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
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) {
        state = state.copyWith(isLoading: false, errorMessage: 'Unauthenticated');
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

        final unreadReq = await _httpClient.getUrl(Uri.parse('$baseUrl/notifications/unread-count'));
        unreadReq.headers.set('authorization', 'Bearer $sessionToken');
        final unreadRes = await unreadReq.close().timeout(const Duration(seconds: 10));
        final unreadBodyStr = await unreadRes.transform(utf8.decoder).join();

        int unreadCount = 0;
        if (unreadRes.statusCode == 200) {
          final unreadJson = jsonDecode(unreadBodyStr);
          unreadCount = unreadJson['data']?['unreadCount'] as int? ?? 0;
        }

        state = state.copyWith(
          items: items,
          unreadCount: unreadCount,
          activeCategoryFilter: selectedCategory,
          isLoading: false,
        );
      } else {
        state = state.copyWith(isLoading: false, errorMessage: 'Failed to load notifications');
      }
    } catch (e) {
      AppLogger.error('[NotificationProvider] Error loading notifications', e);
      state = state.copyWith(isLoading: false, errorMessage: 'Network error');
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

  Future<bool> updatePreferences({bool? globalPushEnabled, bool? globalEmailEnabled}) async {
    try {
      final session = await _storageService.getSession();
      final sessionToken = session?.accessToken;
      if (sessionToken == null) return false;

      final current = state.value ?? const NotificationPreferences();
      final updated = current.copyWith(
        globalPushEnabled: globalPushEnabled,
        globalEmailEnabled: globalEmailEnabled,
      );

      state = AsyncValue.data(updated);

      final baseUrl = AppConfig.current.apiBaseUrl;
      final req = await _httpClient.openUrl('PATCH', Uri.parse('$baseUrl/notifications/preferences'));
      req.headers.set('content-type', 'application/json');
      req.headers.set('authorization', 'Bearer $sessionToken');
      req.write(jsonEncode(updated.toJson()));

      final res = await req.close().timeout(const Duration(seconds: 10));
      return res.statusCode == 200;
    } catch (e) {
      return false;
    }
  }
}

final notificationPreferencesProvider =
    StateNotifierProvider<NotificationPreferencesNotifier, AsyncValue<NotificationPreferences>>(
  (ref) => NotificationPreferencesNotifier(),
);
