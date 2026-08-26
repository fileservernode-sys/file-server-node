import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/notifications/notification_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/error_message.dart';
import '../../../core/widgets/loading_indicator.dart';
import '../domain/models/notification_item.dart';
import '../providers/notification_provider.dart';

class NotificationCenterScreen extends ConsumerStatefulWidget {
  const NotificationCenterScreen({super.key});

  @override
  ConsumerState<NotificationCenterScreen> createState() => _NotificationCenterScreenState();
}

class _NotificationCenterScreenState extends ConsumerState<NotificationCenterScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(notificationListProvider.notifier).loadNotifications();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(notificationListProvider);
    final notifier = ref.read(notificationListProvider.notifier);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppHeader(
        title: 'Notification Center',
        subtitle: state.unreadCount > 0 ? '${state.unreadCount} unread' : 'All updates',
        showBackButton: true,
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Category Filter Chips
            Container(
              height: 48,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  _buildFilterChip('ALL', 'All', state.activeCategoryFilter, notifier),
                  _buildFilterChip('ACCOUNT_SECURITY', 'Security', state.activeCategoryFilter, notifier),
                  _buildFilterChip('DEVICE_SERVER', 'Devices', state.activeCategoryFilter, notifier),
                  _buildFilterChip('FILE_OPERATIONS', 'Files', state.activeCategoryFilter, notifier),
                  _buildFilterChip('STORAGE', 'Storage', state.activeCategoryFilter, notifier),
                  _buildFilterChip('SYSTEM', 'System', state.activeCategoryFilter, notifier),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.borderSubtle),

            // Content List
            Expanded(
              child: _buildBody(state, notifier),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterChip(
    String categoryKey,
    String label,
    String activeCategory,
    NotificationListNotifier notifier,
  ) {
    final isSelected = activeCategory == categoryKey;
    return Padding(
      padding: const EdgeInsets.only(right: AppSpacing.xs),
      child: ChoiceChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (selected) {
          if (selected) {
            notifier.loadNotifications(category: categoryKey);
          }
        },
        selectedColor: AppColors.primary,
        backgroundColor: AppColors.surface,
        labelStyle: TextStyle(
          color: isSelected ? Colors.white : AppColors.textSecondary,
          fontSize: 12,
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        ),
      ),
    );
  }

  Widget _buildBody(NotificationListState state, NotificationListNotifier notifier) {
    if (state.isLoading) {
      return const Center(child: LoadingIndicator(message: 'Loading notifications...'));
    }

    if (state.errorMessage != null) {
      return Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: ErrorMessageBanner(
          message: state.errorMessage!,
          onRetry: () => notifier.loadNotifications(),
        ),
      );
    }

    if (state.items.isEmpty) {
      return const EmptyStateView(
        title: 'No Notifications Found',
        description: 'You have no active notifications for this filter.',
        iconData: Icons.notifications_none_rounded,
      );
    }

    return RefreshIndicator(
      onRefresh: () => notifier.loadNotifications(),
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: state.items.length,
        itemBuilder: (context, index) {
          final item = state.items[index];
          return _buildNotificationCard(item, notifier);
        },
      ),
    );
  }

  Widget _buildNotificationCard(NotificationItem item, NotificationListNotifier notifier) {
    final isUnread = item.state == NotificationStateEnum.unread;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: AppCard(
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _buildSeverityBadge(item.severity),
                const SizedBox(width: AppSpacing.xs),
                Text(
                  item.category,
                  style: AppTypography.caption.copyWith(color: AppColors.textTertiary),
                ),
                const Spacer(),
                if (isUnread)
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              item.title,
              style: AppTypography.cardTitle.copyWith(
                fontWeight: isUnread ? FontWeight.bold : FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              item.body,
              style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (item.deepLinkUri != null && item.deepLinkUri!.isNotEmpty)
                  TextButton(
                    onPressed: () {
                      final target = NotificationRouter.parsePayload({
                        'deepLink': item.deepLinkUri,
                        'serverId': item.serverId,
                      });
                      _handleTargetNavigation(target);
                    },
                    child: const Text('Open Target', style: TextStyle(fontSize: 12)),
                  ),
                if (isUnread)
                  IconButton(
                    icon: const Icon(Icons.mark_email_read_outlined, size: 18, color: AppColors.primary),
                    tooltip: 'Mark as read',
                    onPressed: () => notifier.markAsRead(item.id),
                  ),
                IconButton(
                  icon: const Icon(Icons.archive_outlined, size: 18, color: AppColors.textTertiary),
                  tooltip: 'Archive',
                  onPressed: () => notifier.markAsArchived(item.id),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSeverityBadge(String severity) {
    Color bg;
    Color fg;

    switch (severity.toUpperCase()) {
      case 'CRITICAL':
        bg = const Color(0xFFFEE2E2);
        fg = const Color(0xFF991B1B);
        break;
      case 'SECURITY':
        bg = const Color(0xFFFEF3C7);
        fg = const Color(0xFF92400E);
        break;
      case 'WARNING':
        bg = const Color(0xFFFFEDD5);
        fg = const Color(0xFF9A3412);
        break;
      case 'SUCCESS':
        bg = const Color(0xFFD1FAE5);
        fg = const Color(0xFF065F46);
        break;
      case 'INFO':
      default:
        bg = const Color(0xFFE0F2FE);
        fg = const Color(0xFF075985);
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        severity.toUpperCase(),
        style: TextStyle(color: fg, fontSize: 10, fontWeight: FontWeight.bold),
      ),
    );
  }

  void _handleTargetNavigation(NotificationTarget target) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Navigating to target: ${target.type.name}')),
    );
  }
}
