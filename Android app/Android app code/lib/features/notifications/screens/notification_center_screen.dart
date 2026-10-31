import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config/app_config.dart';
import '../../../core/notifications/notification_router.dart';
import '../../../core/routing/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/url_launcher_service.dart';
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
        actions: [
          if (state.unreadCount > 0)
            TextButton(
              onPressed: () => notifier.markAllAsRead(),
              child: const Text(
                'Read All',
                style: TextStyle(
                  color: AppColors.primary,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
        ],
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
                  _buildFilterChip('BILLING', 'Billing', state.activeCategoryFilter, notifier),
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
    if (state.isLoading && state.items.isEmpty) {
      return const Center(child: LoadingIndicator(message: 'Loading notifications...'));
    }

    if (state.isSessionExpired && state.items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.lock_clock_outlined, size: 56, color: AppColors.error),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Session Expired',
                style: AppTypography.cardTitle.copyWith(color: AppColors.error),
              ),
              const SizedBox(height: AppSpacing.xs),
              const Text(
                'Your session has expired. Please sign in again to view your notifications.',
                style: AppTypography.caption,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.md),
              ElevatedButton(
                onPressed: () => Navigator.pushNamed(context, AppRouter.loginRoute),
                child: const Text('Sign In Again'),
              ),
            ],
          ),
        ),
      );
    }

    if (state.errorMessage != null && state.items.isEmpty) {
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
        icon: Icons.notifications_none_rounded,
      );
    }

    return Column(
      children: [
        if (state.isLoading) const LinearProgressIndicator(minHeight: 2),
        if (state.isSessionExpired)
          Container(
            margin: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, 0),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
            decoration: BoxDecoration(
              color: const Color(0xFFFEF2F2),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: const Color(0xFFFCA5A5)),
            ),
            child: Row(
              children: [
                const Icon(Icons.lock_clock_outlined, color: AppColors.error, size: 18),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'Session expired. Please sign in again.',
                    style: TextStyle(fontSize: 12, color: AppColors.error, fontWeight: FontWeight.w600),
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.pushNamed(context, AppRouter.loginRoute),
                  child: const Text('Sign In', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.error)),
                ),
              ],
            ),
          )
        else if (state.errorMessage != null)
          Container(
            margin: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, 0),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
            decoration: BoxDecoration(
              color: const Color(0xFFFFFBEB),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: const Color(0xFFFDE68A)),
            ),
            child: Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: Color(0xFFB45309), size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    state.errorMessage!,
                    style: const TextStyle(fontSize: 12, color: Color(0xFF92400E)),
                  ),
                ),
                TextButton(
                  onPressed: () => notifier.loadNotifications(),
                  child: const Text('Retry', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFB45309))),
                ),
              ],
            ),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => notifier.loadNotifications(),
            child: ListView.builder(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: state.items.length,
              itemBuilder: (context, index) {
                final item = state.items[index];
                return _buildNotificationCard(item, state, notifier);
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildNotificationCard(
    NotificationItem item,
    NotificationListState state,
    NotificationListNotifier notifier,
  ) {
    final isUnread = item.state == NotificationStateEnum.unread;
    final isRetrying = state.inFlightRetryIds.contains(item.id);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        onTap: (item.deepLinkUri != null && item.deepLinkUri!.isNotEmpty)
            ? () {
                final target = NotificationRouter.parsePayload({
                  'deepLink': item.deepLinkUri,
                  'serverId': item.serverId,
                });
                _handleTargetNavigation(target);
              }
            : null,
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
                    style: AppTypography.caption.copyWith(color: AppColors.textSecondary),
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
              const SizedBox(height: AppSpacing.xs),
              _buildDeliveryBadges(item.deliveryStatus),
              const SizedBox(height: AppSpacing.xs),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (item.deliveryStatus.retryable) ...[
                    TextButton.icon(
                      onPressed: isRetrying
                          ? null
                          : () async {
                              final res = await notifier.retryDelivery(item.id);
                              if (mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(res['message'] as String? ?? 'Redelivery requested'),
                                    backgroundColor: res['success'] == true ? AppColors.success : AppColors.error,
                                    duration: const Duration(seconds: 3),
                                  ),
                                );
                              }
                            },
                      icon: isRetrying
                          ? const SizedBox(
                              width: 12,
                              height: 12,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh, size: 14),
                      label: Text(
                        isRetrying ? 'Retrying...' : 'Retry Delivery',
                        style: const TextStyle(fontSize: 11),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.xs),
                  ],
                  if (isUnread)
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        minimumSize: const Size(0, 30),
                        side: const BorderSide(color: AppColors.borderSubtle),
                      ),
                      icon: const Icon(Icons.check, size: 14, color: AppColors.primary),
                      label: const Text(
                        'Mark as Read',
                        style: TextStyle(fontSize: 11, color: AppColors.primary, fontWeight: FontWeight.w600),
                      ),
                      onPressed: () => notifier.markAsRead(item.id),
                    )
                  else
                    const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.check_circle, size: 14, color: AppColors.success),
                        SizedBox(width: 4),
                        Text(
                          'Read',
                          style: TextStyle(fontSize: 11, color: AppColors.textMuted, fontWeight: FontWeight.w500),
                        ),
                      ],
                    ),
                  const SizedBox(width: AppSpacing.xs),
                  IconButton(
                    icon: const Icon(Icons.archive_outlined, size: 18, color: AppColors.textSecondary),
                    tooltip: 'Archive',
                    onPressed: () => notifier.markAsArchived(item.id),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDeliveryBadges(NotificationDeliveryStatus ds) {
    final badges = <Widget>[
      _buildBadge(
        'In-App Available',
        const Color(0xFFF1F5F9),
        const Color(0xFF475569),
        const Color(0xFFCBD5E1),
      ),
    ];

    if (ds.push != null) {
      final pStatus = ds.push!.toUpperCase();
      if (pStatus == 'DELIVERED') {
        badges.add(
          _buildBadge(
            'Push: Delivered',
            const Color(0xFFECFDF5),
            const Color(0xFF065F46),
            const Color(0xFFA7F3D0),
          ),
        );
      } else if (pStatus == 'FAILED' || pStatus == 'QUEUED' || pStatus == 'PENDING') {
        badges.add(
          _buildBadge(
            'Push: ${pStatus == 'QUEUED' ? 'Pending' : 'Failed'}',
            const Color(0xFFFFFBEB),
            const Color(0xFF92400E),
            const Color(0xFFFDE68A),
          ),
        );
      }
      // Never render PERMANENTLY_FAILED, matching website behavior
    }

    if (ds.email != null) {
      final eStatus = ds.email!.toUpperCase();
      if (eStatus == 'DELIVERED' || eStatus == 'SENT') {
        badges.add(
          _buildBadge(
            'Email: Sent',
            const Color(0xFFECFDF5),
            const Color(0xFF065F46),
            const Color(0xFFA7F3D0),
          ),
        );
      } else if (eStatus == 'FAILED' || eStatus == 'QUEUED') {
        badges.add(
          _buildBadge(
            'Email: ${eStatus == 'QUEUED' ? 'Pending' : 'Delayed'}',
            const Color(0xFFFFFBEB),
            const Color(0xFF92400E),
            const Color(0xFFFDE68A),
          ),
        );
      } else if (eStatus == 'PERMANENTLY_FAILED') {
        badges.add(
          _buildBadge(
            'Email: Bounced',
            const Color(0xFFFEF2F2),
            const Color(0xFF991B1B),
            const Color(0xFFFECACA),
          ),
        );
      }
    }

    return Wrap(
      spacing: 6,
      runSpacing: 4,
      children: badges,
    );
  }

  Widget _buildBadge(String label, Color bg, Color fg, Color border) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      child: Text(
        label,
        style: TextStyle(color: fg, fontSize: 10, fontWeight: FontWeight.w600),
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
    switch (target.type) {
      case NotificationTargetType.serverDetail:
        Navigator.pushNamed(context, AppRouter.serverStatusRoute);
        break;
      case NotificationTargetType.securitySettings:
      case NotificationTargetType.deviceDetail:
        Navigator.pushNamed(context, AppRouter.settingsRoute);
        break;
      case NotificationTargetType.billing:
        UrlLauncherService.openUrl(context, '${AppConfig.current.portalBaseUrl}/pages/billing.html');
        break;
      case NotificationTargetType.fileManager:
        UrlLauncherService.openUrl(context, '${AppConfig.current.portalBaseUrl}/pages/file-manager.html');
        break;
      case NotificationTargetType.dashboard:
        Navigator.pushNamedAndRemoveUntil(context, AppRouter.homeRoute, (route) => false);
        break;
      case NotificationTargetType.unknown:
        Navigator.pushNamed(context, AppRouter.homeRoute);
        break;
    }
  }
}
