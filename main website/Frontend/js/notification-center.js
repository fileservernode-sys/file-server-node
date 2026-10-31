/**
 * ZDEXCLOUD NOTIFICATION CENTER CLIENT (VANILLA JS)
 * Phase MW-1 — Track 4 Batch NT-1.8: Final Notification UX & Cross-Platform Polish
 */

(function () {
  'use strict';

  function getApiBase() {
    if (window.API_BASE_URL) return window.API_BASE_URL;
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    if (host === 'localhost' || host === '127.0.0.1' || protocol === 'file:' || !host) {
      return 'http://localhost:4000/api/v1';
    }
    return '/api/v1';
  }

  function getAuthHeader(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const csrfToken = typeof AuthService !== 'undefined' ? AuthService.getCsrfToken() : null;
    if (csrfToken) {
      headers['x-zdex-csrf-token'] = csrfToken;
    }
    return headers;
  }

  async function notifFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      credentials: 'include',
      headers: getAuthHeader(options.headers || {})
    });
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function getSeverityClass(severity) {
    switch ((severity || '').toUpperCase()) {
      case 'CRITICAL': return 'severity-critical';
      case 'SECURITY': return 'severity-security';
      case 'WARNING': return 'severity-warning';
      case 'SUCCESS': return 'severity-success';
      case 'INFO':
      default: return 'severity-info';
    }
  }

  function resolveDeepLinkWebPath(deepLinkUri) {
    if (!deepLinkUri || typeof deepLinkUri !== 'string') return null;
    const trimmed = deepLinkUri.trim();
    if (!trimmed.startsWith('remotenode://') && !trimmed.startsWith('zdexcloud://') && !trimmed.includes('zdexcloud.com')) return null;

    const isInnerPage = window.location.pathname.includes('/pages/');
    const prefix = isInnerPage ? '' : 'pages/';

    if (trimmed.startsWith('remotenode://filemanager') || trimmed.startsWith('zdexcloud://filemanager') || trimmed.includes('file-manager')) {
      return `${prefix}file-manager.html`;
    }
    if (trimmed.startsWith('remotenode://server/') || trimmed.startsWith('zdexcloud://server/')) {
      const rawId = trimmed.split(/server\//)[1] || '';
      const serverId = encodeURIComponent(rawId.trim());
      return `${prefix}dashboard.html#server-${serverId}`;
    }
    if (trimmed.includes('#server-')) {
      const rawId = trimmed.split('#server-')[1] || '';
      return `${prefix}dashboard.html#server-${encodeURIComponent(rawId.trim())}`;
    }
    if (trimmed.startsWith('remotenode://security') || trimmed.startsWith('zdexcloud://security') || trimmed.includes('#security')) {
      return `${prefix}dashboard.html#security`;
    }
    if (trimmed.startsWith('remotenode://billing') || trimmed.startsWith('zdexcloud://billing') || trimmed.includes('billing.html')) {
      return `${prefix}billing.html`;
    }
    if (trimmed.includes('invoices.html')) {
      return `${prefix}invoices.html`;
    }
    if (trimmed.includes('subscription.html')) {
      return `${prefix}subscription.html`;
    }
    if (trimmed.startsWith('remotenode://device/') || trimmed.startsWith('zdexcloud://device/')) {
      return `${prefix}dashboard.html`;
    }
    return `${prefix}dashboard.html`;
  }

  function classifyHttpError(res, fallbackMessage) {
    if (!res) {
      return {
        type: 'NETWORK_ERROR',
        title: 'Unable to Connect',
        message: 'Could not connect to ZdexCloud. Please check your network connection and try again.',
        isAuth: false
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        type: 'AUTH_EXPIRED',
        title: 'Session Expired',
        message: 'Your session has expired. Please sign in again to view your notifications.',
        isAuth: true
      };
    }
    if (res.status === 429) {
      return {
        type: 'RATE_LIMITED',
        title: 'Too Many Requests',
        message: 'You are making requests too quickly. Please wait a moment and try again.',
        isAuth: false
      };
    }
    if (res.status >= 500) {
      return {
        type: 'SERVER_ERROR',
        title: 'Service Temporarily Unavailable',
        message: 'The notification service is temporarily experiencing difficulties. Please try again shortly.',
        isAuth: false
      };
    }
    return {
      type: 'REQUEST_ERROR',
      title: 'Request Failed',
      message: fallbackMessage || 'Unable to complete notification request. Please try again.',
      isAuth: false
    };
  }

  class NotificationCenterClient {
    constructor() {
      this.unreadCount = 0;
      this.popoverOpen = false;
      this.pollTimer = null;
      this.activeCategoryFilter = 'ALL';
      this.currentPage = 1;
      this.cachedHistoryItems = [];
      this.isMarkingAllRead = false;
      this.isSavingPreferences = false;
      this.isRetryingDelivery = new Set();
    }

    async init() {
      if (typeof AuthService !== 'undefined') {
        const auth = await AuthService.initSession();
        if (!auth.authenticated) return;
      }

      this.injectBellButton();
      this.fetchUnreadCount();

      // Refresh on window focus & periodic 30s interval
      window.addEventListener('focus', () => this.fetchUnreadCount());
      this.pollTimer = setInterval(() => this.fetchUnreadCount(), 30000);

      // Close popover on click outside or ESC key press
      document.addEventListener('click', (e) => {
        const bellWrapper = document.getElementById('rn-notif-bell-wrapper');
        if (bellWrapper && !bellWrapper.contains(e.target) && this.popoverOpen) {
          this.closePopover();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.popoverOpen) {
          this.closePopover();
          const bellBtn = document.getElementById('rn-notif-bell-btn');
          if (bellBtn) bellBtn.focus();
        }
      });

      // Init history view if present on page
      if (document.getElementById('rn-notif-history-container')) {
        this.initHistoryView();
      }

      // Init preferences UI if present on page
      if (document.getElementById('rn-notif-preferences-container')) {
        this.initPreferencesView();
      }
    }

    injectBellButton() {
      const headerActions = document.querySelector('.header-actions');
      if (!headerActions || document.getElementById('rn-notif-bell-wrapper')) return;

      const wrapper = document.createElement('div');
      wrapper.id = 'rn-notif-bell-wrapper';
      wrapper.className = 'rn-notif-bell-wrapper';

      const isInnerPage = window.location.pathname.includes('/pages/');
      const viewAllPath = isInnerPage ? 'notifications.html' : 'pages/notifications.html';

      wrapper.innerHTML = `
        <button type="button" id="rn-notif-bell-btn" class="rn-notif-bell-btn" aria-label="Notifications" aria-expanded="false">
          <svg class="icon icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span id="rn-notif-badge" class="rn-notif-badge" style="display: none;" aria-hidden="true">0</span>
        </button>

        <div id="rn-notif-popover" class="rn-notif-popover" role="region" aria-label="Notifications Dropdown">
          <div class="rn-notif-popover-header">
            <h3 class="rn-notif-popover-title">
              <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              <span>Notifications</span>
            </h3>
            <div class="rn-notif-popover-actions" style="display: flex; align-items: center; gap: 8px;">
              <button type="button" id="rn-notif-popover-mark-all" class="rn-notif-link-btn" style="background: none; border: none; cursor: pointer; padding: 0; font-size: 12px; color: var(--color-primary, #2563eb);">Mark All Read</button>
              <span style="color: var(--color-border, #e2e8f0); font-size: 11px;">•</span>
              <a href="${viewAllPath}" class="rn-notif-link-btn">View All</a>
            </div>
          </div>
          <div id="rn-notif-popover-body" class="rn-notif-popover-body">
            <div class="rn-notif-skeleton-list">
              <div class="rn-notif-skeleton-row"></div>
              <div class="rn-notif-skeleton-row"></div>
              <div class="rn-notif-skeleton-row"></div>
            </div>
          </div>
          <div class="rn-notif-popover-footer">
            <a href="${viewAllPath}" class="rn-notif-link-btn" style="width: 100%; display: inline-block; text-align: center;">Open Notification History Center</a>
          </div>
        </div>
      `;

      headerActions.insertBefore(wrapper, headerActions.firstChild);

      const bellBtn = document.getElementById('rn-notif-bell-btn');
      if (bellBtn) {
        bellBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePopover();
        });
      }

      const markAllPopoverBtn = document.getElementById('rn-notif-popover-mark-all');
      if (markAllPopoverBtn) {
        markAllPopoverBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.markAllAsRead();
        });
      }
    }

    async fetchUnreadCount() {
      try {
        const res = await notifFetch(`${getApiBase()}/notifications/unread-count`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.success && typeof json.data?.unreadCount === 'number') {
          this.updateBadge(json.data.unreadCount);
        }
      } catch {}
    }

    updateBadge(count) {
      this.unreadCount = count;
      const badge = document.getElementById('rn-notif-badge');
      const bellBtn = document.getElementById('rn-notif-bell-btn');

      if (count <= 0) {
        if (badge) {
          badge.style.display = 'none';
          badge.textContent = '0';
        }
        if (bellBtn) bellBtn.setAttribute('aria-label', 'Notifications');
      } else {
        if (badge) {
          badge.style.display = 'inline-flex';
          badge.textContent = count > 99 ? '99+' : String(count);
        }
        if (bellBtn) bellBtn.setAttribute('aria-label', `Notifications (${count} unread)`);
      }
    }

    togglePopover() {
      if (this.popoverOpen) {
        this.closePopover();
      } else {
        this.openPopover();
      }
    }

    openPopover() {
      const popover = document.getElementById('rn-notif-popover');
      const bellBtn = document.getElementById('rn-notif-bell-btn');
      if (!popover) return;

      popover.classList.add('is-open');
      if (bellBtn) bellBtn.setAttribute('aria-expanded', 'true');
      this.popoverOpen = true;

      this.loadPopoverItems();
    }

    closePopover() {
      const popover = document.getElementById('rn-notif-popover');
      const bellBtn = document.getElementById('rn-notif-bell-btn');
      if (!popover) return;

      popover.classList.remove('is-open');
      if (bellBtn) bellBtn.setAttribute('aria-expanded', 'false');
      this.popoverOpen = false;
    }

    async loadPopoverItems() {
      const body = document.getElementById('rn-notif-popover-body');
      if (!body) return;

      body.setAttribute('aria-busy', 'true');
      body.innerHTML = `
        <div class="rn-notif-skeleton-list">
          <div class="rn-notif-skeleton-row"></div>
          <div class="rn-notif-skeleton-row"></div>
          <div class="rn-notif-skeleton-row"></div>
        </div>
      `;

      try {
        const res = await notifFetch(`${getApiBase()}/notifications?page=1&limit=5`);
        body.removeAttribute('aria-busy');

        if (!res.ok) {
          const errInfo = classifyHttpError(res, 'Unable to load notifications');
          const isInner = window.location.pathname.includes('/pages/');
          const loginUrl = isInner ? 'login.html' : 'pages/login.html';

          body.innerHTML = `
            <div class="rn-notif-state-box" role="alert">
              <h4 style="font-size: 13px; font-weight: 700; color: #991B1B; margin: 0 0 4px 0;">${errInfo.title}</h4>
              <p style="margin: 0 0 10px 0; font-size: 12px; color: #4B5563;">${errInfo.message}</p>
              ${errInfo.isAuth
                ? `<a href="${loginUrl}" class="rn-notif-link-btn" style="display: inline-block;">Sign In Again</a>`
                : `<button type="button" id="btn-retry-popover" class="rn-notif-link-btn">Retry</button>`}
            </div>
          `;
          const btnRetry = document.getElementById('btn-retry-popover');
          if (btnRetry) btnRetry.onclick = () => this.loadPopoverItems();
          return;
        }

        const json = await res.json();
        const items = json.data?.notifications || json.data?.items || [];

        if (items.length === 0) {
          body.innerHTML = `
            <div class="rn-notif-state-box" role="status" aria-live="polite">
              <svg class="rn-notif-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <h4 style="font-size: 14px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 4px 0;">You're all caught up</h4>
              <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0;">You have no unread or recent notifications.</p>
            </div>
          `;
          return;
        }

        body.innerHTML = '';
        items.forEach((item) => {
          const el = this.createPopoverItemElement(item);
          body.appendChild(el);
        });
      } catch (err) {
        body.removeAttribute('aria-busy');
        const errInfo = classifyHttpError(null, 'Network connection error');
        body.innerHTML = `
          <div class="rn-notif-state-box" role="alert">
            <h4 style="font-size: 13px; font-weight: 700; color: #991B1B; margin: 0 0 4px 0;">${errInfo.title}</h4>
            <p style="margin: 0 0 10px 0; font-size: 12px; color: #4B5563;">${errInfo.message}</p>
            <button type="button" id="btn-retry-popover-err" class="rn-notif-link-btn">Retry</button>
          </div>
        `;
        const btnRetry = document.getElementById('btn-retry-popover-err');
        if (btnRetry) btnRetry.onclick = () => this.loadPopoverItems();
      }
    }

    createPopoverItemElement(item) {
      const isUnread = (item.status || item.state) === 'UNREAD';
      const severityClass = getSeverityClass(item.severity);
      const timeAgo = formatTimeAgo(item.createdAt || item.occurredAt);
      const targetWebPath = item.deepLink?.webPath || resolveDeepLinkWebPath(item.deepLinkUri || item.deepLink?.uri);

      const div = document.createElement('div');
      div.className = `rn-notif-item ${isUnread ? 'is-unread' : ''}`;
      div.setAttribute('tabindex', '0');
      div.setAttribute('role', 'button');
      div.setAttribute('aria-label', `${item.title}. ${item.body}`);

      div.innerHTML = `
        <div class="rn-notif-icon-col">
          <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <div class="rn-notif-content-col">
          <div class="rn-notif-top-row">
            <h4 class="rn-notif-item-title">${this.escapeHtml(item.title)}</h4>
            <span class="rn-notif-item-time">${timeAgo}</span>
          </div>
          <p class="rn-notif-item-body">${this.escapeHtml(item.body)}</p>
          <div class="rn-notif-meta-row">
            <span class="severity-badge ${severityClass}">${item.severity}</span>
            <span class="category-tag">${item.category}</span>
          </div>
        </div>
      `;

      const handleTrigger = async () => {
        if (isUnread) {
          await this.markAsRead(item.id);
        }
        this.closePopover();
        if (targetWebPath) {
          window.location.href = targetWebPath;
        }
      };

      div.addEventListener('click', handleTrigger);
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleTrigger();
        }
      });

      return div;
    }

    async markAsRead(notificationId) {
      try {
        const res = await notifFetch(`${getApiBase()}/notifications/${notificationId}/read`, {
          method: 'PATCH'
        });
        if (res.ok) {
          this.fetchUnreadCount();
        }
      } catch {}
    }

    async markAllAsRead() {
      try {
        const res = await notifFetch(`${getApiBase()}/notifications/read-all`, {
          method: 'POST'
        });
        if (res.ok) {
          this.updateBadge(0);
          // Update popover items in-place
          const popoverUnread = document.querySelectorAll('#rn-notif-popover-body .rn-notif-item.is-unread');
          popoverUnread.forEach(el => el.classList.remove('is-unread'));
          // Update history items in-place if present
          const historyUnread = document.querySelectorAll('#rn-notif-history-list .rn-notif-card.is-unread');
          historyUnread.forEach(card => {
            card.classList.remove('is-unread');
            const btnRead = card.querySelector('.btn-mark-read');
            if (btnRead) {
              const span = document.createElement('span');
              span.style.fontSize = '12px';
              span.style.color = 'var(--color-text-tertiary)';
              span.textContent = 'Read';
              btnRead.replaceWith(span);
            }
          });
          await this.fetchUnreadCount();
        }
      } catch (err) {
        console.error('[NotificationCenter] Failed to mark all as read', err);
      }
    }

    async markAsUnread(notificationId) {
      try {
        const res = await notifFetch(`${getApiBase()}/notifications/${notificationId}/unread`, {
          method: 'PATCH'
        });
        if (res.ok) {
          await this.fetchUnreadCount();
          return true;
        }
        return false;
      } catch (err) {
        console.error('[NotificationCenter] Failed to mark as unread', err);
        return false;
      }
    }

    async markAsArchived(notificationId) {
      try {
        const res = await notifFetch(`${getApiBase()}/notifications/${notificationId}/archive`, {
          method: 'PATCH'
        });
        if (res.ok) {
          this.fetchUnreadCount();
        }
      } catch {}
    }

    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // -------------------------------------------------------------------------
    // History View Center
    // -------------------------------------------------------------------------
    async initHistoryView() {
      const container = document.getElementById('rn-notif-history-container');
      if (!container) return;

      this.renderHistoryLayout(container);
      await this.loadHistoryItems();
    }

    renderHistoryLayout(container) {
      container.innerHTML = `
        <div class="rn-notif-filter-bar" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
            <button type="button" class="rn-filter-btn is-active" data-category="ALL">All</button>
            <button type="button" class="rn-filter-btn" data-category="ACCOUNT_SECURITY">Security</button>
            <button type="button" class="rn-filter-btn" data-category="BILLING">Billing</button>
            <button type="button" class="rn-filter-btn" data-category="DEVICE_SERVER">Devices & Servers</button>
            <button type="button" class="rn-filter-btn" data-category="FILE_OPERATIONS">Files</button>
            <button type="button" class="rn-filter-btn" data-category="STORAGE">Storage</button>
            <button type="button" class="rn-filter-btn" data-category="SYSTEM">System</button>
          </div>
          <button type="button" id="btn-history-mark-all-read" class="btn btn-secondary btn-sm" style="min-height: 36px; padding: 0 14px; font-size: 13px;">
            Mark All as Read
          </button>
        </div>

        <div id="rn-notif-history-list" class="rn-notif-card-list">
          <div class="rn-notif-skeleton-list">
            <div class="rn-notif-skeleton-row"></div>
            <div class="rn-notif-skeleton-row"></div>
            <div class="rn-notif-skeleton-row"></div>
          </div>
        </div>

        <div id="rn-notif-pagination" class="pagination-container" style="display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 24px;"></div>
      `;

      const filterBtns = container.querySelectorAll('.rn-filter-btn');
      filterBtns.forEach((btn) => {
        btn.addEventListener('click', async () => {
          filterBtns.forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          this.activeCategoryFilter = btn.getAttribute('data-category');
          this.currentPage = 1;
          await this.loadHistoryItems();
        });
      });

      const btnHistoryMarkAll = container.querySelector('#btn-history-mark-all-read');
      if (btnHistoryMarkAll) {
        btnHistoryMarkAll.addEventListener('click', async () => {
          await this.markAllAsRead();
          await this.loadHistoryItems();
        });
      }
    }

    async loadHistoryItems(isPageNavigation = false) {
      const listEl = document.getElementById('rn-notif-history-list');
      if (!listEl) return;

      if (!isPageNavigation) {
        listEl.setAttribute('aria-busy', 'true');
        listEl.innerHTML = `
          <div class="rn-notif-skeleton-list">
            <div class="rn-notif-skeleton-row"></div>
            <div class="rn-notif-skeleton-row"></div>
            <div class="rn-notif-skeleton-row"></div>
          </div>
        `;
      }

      // Remove any existing pagination error banner
      const existingBanner = document.getElementById('rn-pagination-err-banner');
      if (existingBanner) existingBanner.remove();

      try {
        let url = `${getApiBase()}/notifications?page=${this.currentPage}&limit=10`;
        if (this.activeCategoryFilter !== 'ALL') {
          url += `&category=${encodeURIComponent(this.activeCategoryFilter)}`;
        }

        const res = await notifFetch(url);
        listEl.removeAttribute('aria-busy');

        if (!res.ok) {
          const errInfo = classifyHttpError(res, 'Unable to load notification history');
          if (isPageNavigation && this.cachedHistoryItems && this.cachedHistoryItems.length > 0) {
            this.showPaginationErrorBanner(errInfo);
            return;
          }
          const isInner = window.location.pathname.includes('/pages/');
          const loginUrl = isInner ? 'login.html' : 'pages/login.html';

          listEl.innerHTML = `
            <div class="rn-notif-error-box" role="alert">
              <h4>${errInfo.title}</h4>
              <p>${errInfo.message}</p>
              ${errInfo.isAuth
                ? `<a href="${loginUrl}" class="btn btn-primary btn-sm">Sign In Again</a>`
                : `<button type="button" id="btn-retry-history" class="btn btn-secondary btn-sm">Retry Loading</button>`}
            </div>
          `;
          const btnRetry = document.getElementById('btn-retry-history');
          if (btnRetry) btnRetry.onclick = () => this.loadHistoryItems();
          return;
        }

        const json = await res.json();
        const items = json.data?.notifications || json.data?.items || [];
        const total = json.data?.pagination?.total ?? json.data?.total ?? items.length;
        this.cachedHistoryItems = items;

        if (items.length === 0) {
          listEl.innerHTML = `
            <div class="rn-notif-state-box" role="status" aria-live="polite">
              <svg class="rn-notif-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              <h4 style="font-size: 15px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 4px 0;">No Notifications Found</h4>
              <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0;">You have no notifications for this filter category.</p>
            </div>
          `;
          this.renderPagination(0, 10);
          return;
        }

        listEl.innerHTML = '';
        items.forEach((item) => {
          const card = this.createHistoryCardElement(item);
          listEl.appendChild(card);
        });

        this.renderPagination(total, 10);
      } catch (err) {
        listEl.removeAttribute('aria-busy');
        const errInfo = classifyHttpError(null, 'Network connection error');
        if (isPageNavigation && this.cachedHistoryItems && this.cachedHistoryItems.length > 0) {
          this.showPaginationErrorBanner(errInfo);
          return;
        }
        listEl.innerHTML = `
          <div class="rn-notif-error-box" role="alert">
            <h4>${errInfo.title}</h4>
            <p>${errInfo.message}</p>
            <button type="button" id="btn-retry-history-err" class="btn btn-secondary btn-sm">Retry Loading</button>
          </div>
        `;
        const btnRetry = document.getElementById('btn-retry-history-err');
        if (btnRetry) btnRetry.onclick = () => this.loadHistoryItems();
      }
    }

    showPaginationErrorBanner(errInfo) {
      const listEl = document.getElementById('rn-notif-history-list');
      if (!listEl) return;

      let banner = document.getElementById('rn-pagination-err-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'rn-pagination-err-banner';
        banner.className = 'rn-pagination-error-banner';
        banner.setAttribute('role', 'alert');
        listEl.after(banner);
      }

      banner.innerHTML = `
        <span>${this.escapeHtml(errInfo.message)}</span>
        <button type="button" id="btn-retry-page" class="btn btn-secondary btn-sm" style="min-height: 32px;">Retry Page</button>
      `;
      const btnRetry = document.getElementById('btn-retry-page');
      if (btnRetry) {
        btnRetry.onclick = () => this.loadHistoryItems(true);
      }
    }

    createHistoryCardElement(item) {
      const isUnread = (item.status || item.state) === 'UNREAD';
      const severityClass = getSeverityClass(item.severity);
      const timeAgo = formatTimeAgo(item.createdAt || item.occurredAt);
      const targetWebPath = item.deepLink?.webPath || resolveDeepLinkWebPath(item.deepLinkUri || item.deepLink?.uri);

      // Delivery status indicators
      let deliveryBadgesHtml = '<span class="delivery-badge delivery-badge--inapp" title="Stored in your account notification history">In-App Available</span>';
      let isRetryable = false;

      if (item.deliveryStatus) {
        if (item.deliveryStatus.push) {
          const pStatus = String(item.deliveryStatus.push).toUpperCase();
          if (pStatus === 'DELIVERED') {
            deliveryBadgesHtml += '<span class="delivery-badge delivery-badge--success" title="Delivered to Android device">Push: Delivered</span>';
          } else if (pStatus === 'FAILED' || pStatus === 'QUEUED') {
            deliveryBadgesHtml += `<span class="delivery-badge delivery-badge--warning" title="Push delivery pending or delayed">Push: ${pStatus === 'QUEUED' ? 'Pending' : 'Failed'}</span>`;
          } else if (pStatus === 'PERMANENTLY_FAILED') {
            deliveryBadgesHtml += '<span class="delivery-badge delivery-badge--error" title="FCM token is no longer active">Push: Inactive</span>';
          }
        }
        if (item.deliveryStatus.email) {
          const eStatus = String(item.deliveryStatus.email).toUpperCase();
          if (eStatus === 'DELIVERED' || eStatus === 'SENT') {
            deliveryBadgesHtml += '<span class="delivery-badge delivery-badge--success" title="Delivered via Email">Email: Sent</span>';
          } else if (eStatus === 'FAILED' || eStatus === 'QUEUED') {
            deliveryBadgesHtml += `<span class="delivery-badge delivery-badge--warning" title="Email dispatch queued or delayed">Email: ${eStatus === 'QUEUED' ? 'Pending' : 'Delayed'}</span>`;
          } else if (eStatus === 'PERMANENTLY_FAILED') {
            deliveryBadgesHtml += '<span class="delivery-badge delivery-badge--error" title="Permanent email failure">Email: Bounced</span>';
          }
        }
        isRetryable = item.deliveryStatus.retryable === true;
      }

      const div = document.createElement('div');
      div.className = `rn-notif-card ${isUnread ? 'is-unread' : ''}`;

      div.innerHTML = `
        <div style="flex-grow: 1;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="severity-badge ${severityClass}">${item.severity}</span>
              <span class="category-tag">${item.category}</span>
            </div>
            <span class="rn-notif-item-time">${timeAgo}</span>
          </div>
          <h3 style="font-size: 15px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 6px 0;">${this.escapeHtml(item.title)}</h3>
          <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 8px 0; line-height: 1.5;">${this.escapeHtml(item.body)}</p>
          
          <div class="rn-delivery-status-row">
            ${deliveryBadgesHtml}
          </div>

          <div class="rn-notif-card-actions" style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${isUnread 
              ? `<button type="button" class="btn btn-secondary btn-sm btn-mark-read" data-id="${item.id}" style="min-height: 32px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px;">
                   <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                   <span>Mark as Read</span>
                 </button>` 
              : `<button type="button" class="btn btn-ghost btn-sm btn-mark-unread" data-id="${item.id}" style="min-height: 32px; font-size: 12px; color: var(--color-text-secondary); display: inline-flex; align-items: center; gap: 6px;">
                   <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
                   <span>Mark as Unread</span>
                 </button>
                 <span class="rn-read-badge" style="font-size: 12px; color: var(--color-text-tertiary); display: inline-flex; align-items: center; gap: 4px;">
                   <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-status-success, #10B981);" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                   <span>Read</span>
                 </span>`
            }
          </div>
        </div>
      `;

      const btnRead = div.querySelector('.btn-mark-read');
      if (btnRead) {
        btnRead.addEventListener('click', async () => {
          btnRead.disabled = true;
          btnRead.textContent = 'Updating...';
          await this.markAsRead(item.id);
          await this.loadHistoryItems();
        });
      }

      const btnUnread = div.querySelector('.btn-mark-unread');
      if (btnUnread) {
        btnUnread.addEventListener('click', async () => {
          btnUnread.disabled = true;
          btnUnread.textContent = 'Updating...';
          await this.markAsUnread(item.id);
          await this.loadHistoryItems();
        });
      }

      return div;
    }

    renderPagination(totalItems, pageSize) {
      const pagContainer = document.getElementById('rn-notif-pagination');
      if (!pagContainer) return;

      const totalPages = Math.ceil(totalItems / pageSize) || 1;
      if (totalPages <= 1) {
        pagContainer.innerHTML = '';
        return;
      }

      pagContainer.innerHTML = `
        <button type="button" class="btn btn-secondary btn-sm" id="btn-prev-page" style="min-height: 38px; padding: 0 14px;" ${this.currentPage <= 1 ? 'disabled' : ''}>Previous</button>
        <span style="font-size: 13px; display: inline-flex; align-items: center; font-weight: 500;">Page ${this.currentPage} of ${totalPages}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-next-page" style="min-height: 38px; padding: 0 14px;" ${this.currentPage >= totalPages ? 'disabled' : ''}>Next</button>
      `;

      const btnPrev = document.getElementById('btn-prev-page');
      if (btnPrev) {
        btnPrev.onclick = async () => {
          if (this.currentPage > 1) {
            this.currentPage--;
            await this.loadHistoryItems(true);
          }
        };
      }

      const btnNext = document.getElementById('btn-next-page');
      if (btnNext) {
        btnNext.onclick = async () => {
          if (this.currentPage < totalPages) {
            this.currentPage++;
            await this.loadHistoryItems(true);
          }
        };
      }
    }

    // -------------------------------------------------------------------------
    // Preferences View
    // -------------------------------------------------------------------------
    async initPreferencesView() {
      const container = document.getElementById('rn-notif-preferences-container');
      if (!container) return;

      container.setAttribute('aria-busy', 'true');
      container.innerHTML = `
        <div class="rn-notif-skeleton-list">
          <div class="rn-notif-skeleton-row"></div>
          <div class="rn-notif-skeleton-row"></div>
        </div>
      `;

      try {
        const res = await notifFetch(`${getApiBase()}/notifications/preferences`);
        container.removeAttribute('aria-busy');

        if (!res.ok) {
          const errInfo = classifyHttpError(res, 'Unable to load notification preferences');
          const isInner = window.location.pathname.includes('/pages/');
          const loginUrl = isInner ? 'login.html' : 'pages/login.html';

          container.innerHTML = `
            <div class="rn-notif-error-box" role="alert">
              <h4>${errInfo.title}</h4>
              <p>${errInfo.message}</p>
              ${errInfo.isAuth
                ? `<a href="${loginUrl}" class="btn btn-primary btn-sm">Sign In Again</a>`
                : `<button type="button" id="btn-retry-prefs" class="btn btn-secondary btn-sm">Retry Loading</button>`}
            </div>
          `;
          const btnRetry = document.getElementById('btn-retry-prefs');
          if (btnRetry) btnRetry.onclick = () => this.initPreferencesView();
          return;
        }

        const json = await res.json();
        const prefs = json.data || {};

        this.renderPreferencesForm(container, prefs);
      } catch {
        container.removeAttribute('aria-busy');
        const errInfo = classifyHttpError(null, 'Network connection error');
        container.innerHTML = `
          <div class="rn-notif-error-box" role="alert">
            <h4>${errInfo.title}</h4>
            <p>${errInfo.message}</p>
            <button type="button" id="btn-retry-prefs-err" class="btn btn-secondary btn-sm">Retry Loading</button>
          </div>
        `;
        const btnRetry = document.getElementById('btn-retry-prefs-err');
        if (btnRetry) btnRetry.onclick = () => this.initPreferencesView();
      }
    }

    renderPreferencesForm(container, prefs) {
      this.currentPreferences = prefs;
      this.hasUnsavedPreferences = false;

      const categoriesMeta = [
        {
          key: 'ACCOUNT_SECURITY',
          name: 'Account & Security',
          desc: 'Essential sign-in notifications, security alerts, device verification, and recovery events.',
          isMandatory: true,
          badge: 'Mandatory Policy'
        },
        {
          key: 'DEVICE_SERVER',
          name: 'Servers & Devices',
          desc: 'Server lifecycle events, node availability, paired host state changes, and gateway connections.',
          isMandatory: false,
          badge: 'Infrastructure'
        },
        {
          key: 'BILLING',
          name: 'Billing & Subscriptions',
          desc: 'Payment receipts, subscription renewals, plan changes, and invoice notifications. (Statutory tax invoices are always emailed).',
          isMandatory: false,
          badge: 'Finance'
        },
        {
          key: 'STORAGE',
          name: 'Storage & Capacity',
          desc: 'Storage utilization warnings, critical host capacity limits, and space recovery alerts.',
          isMandatory: false,
          badge: 'Resources'
        },
        {
          key: 'FILE_OPERATIONS',
          name: 'File Operations',
          desc: 'File upload completions, batch operations, folder downloads, and large transfer alerts.',
          isMandatory: false,
          badge: 'Transfers'
        },
        {
          key: 'SYSTEM',
          name: 'System Announcements',
          desc: 'Planned maintenance windows, major feature releases, and platform reliability updates.',
          isMandatory: false,
          badge: 'Platform'
        }
      ];

      const categories = prefs.categories || {};

      let categoryCardsHtml = '';
      for (const meta of categoriesMeta) {
        const catPref = categories[meta.key] || {
          enabled: true,
          channels: { IN_APP: true, PUSH: true, EMAIL: meta.key !== 'FILE_OPERATIONS' && meta.key !== 'SYSTEM' }
        };

        const isEnabled = meta.isMandatory ? true : (catPref.enabled !== false);
        const inAppChecked = meta.isMandatory ? true : (catPref.channels?.IN_APP !== false);
        const pushChecked = catPref.channels?.PUSH !== false;
        const emailChecked = meta.isMandatory ? true : (catPref.channels?.EMAIL !== false);

        categoryCardsHtml += `
          <div class="pref-category-card ${meta.isMandatory ? 'is-mandatory' : ''}" data-category="${meta.key}">
            <div class="pref-category-header">
              <div class="pref-category-info">
                <div class="pref-category-title-row">
                  <h4 class="pref-category-name">${meta.name}</h4>
                  <span class="pref-category-badge ${meta.isMandatory ? 'pref-category-badge--mandatory' : ''}">${meta.badge}</span>
                </div>
                <p class="pref-category-desc">${meta.desc}</p>
              </div>
              <label class="toggle-switch" style="min-width: 44px; min-height: 24px;" title="${meta.isMandatory ? 'Mandatory security category cannot be disabled' : 'Enable or disable this category'}">
                <input type="checkbox" class="cat-master-toggle" data-cat="${meta.key}" ${isEnabled ? 'checked' : ''} ${meta.isMandatory ? 'disabled' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="pref-channel-grid">
              <!-- In-App Channel -->
              <label class="pref-channel-item ${meta.isMandatory ? 'is-disabled' : ''}">
                <input type="checkbox" class="cat-channel-toggle" data-cat="${meta.key}" data-channel="IN_APP" ${inAppChecked ? 'checked' : ''} ${meta.isMandatory ? 'disabled' : ''}>
                <div class="pref-channel-label">
                  <span>In-App</span>
                  <span class="pref-channel-subtext">${meta.isMandatory ? 'Required' : 'History feed'}</span>
                </div>
              </label>

              <!-- Push Channel -->
              <label class="pref-channel-item">
                <input type="checkbox" class="cat-channel-toggle" data-cat="${meta.key}" data-channel="PUSH" ${pushChecked ? 'checked' : ''}>
                <div class="pref-channel-label">
                  <span>Push</span>
                  <span class="pref-channel-subtext">Android alert</span>
                </div>
              </label>

              <!-- Email Channel -->
              <label class="pref-channel-item ${meta.isMandatory ? 'is-disabled' : ''}">
                <input type="checkbox" class="cat-channel-toggle" data-cat="${meta.key}" data-channel="EMAIL" ${emailChecked ? 'checked' : ''} ${meta.isMandatory ? 'disabled' : ''}>
                <div class="pref-channel-label">
                  <span>Email</span>
                  <span class="pref-channel-subtext">${meta.isMandatory ? 'Required' : 'Inbox notice'}</span>
                </div>
              </label>
            </div>
          </div>
        `;
      }

      container.innerHTML = `
        <div class="security-policy-notice">
          <svg class="icon icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: #D97706; flex-shrink: 0;">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <div>
            <h4>Security & Mandatory Notification Policy</h4>
            <p>ZdexCloud enforces mandatory delivery for critical security events (login alerts, verification codes, device pairing). In-App and Email delivery for Account & Security cannot be disabled to ensure your personal file server nodes remain protected.</p>
          </div>
        </div>

        <div id="rn-notif-pref-feedback" style="display: none; margin-bottom: 16px; padding: 12px 16px; border-radius: 8px; font-size: 13px; font-weight: 500;"></div>

        <form id="form-notif-prefs" style="display: flex; flex-direction: column; gap: 24px;">
          <!-- Global Channels Card -->
          <div class="card" style="padding: 20px;">
            <h3 class="pref-section-title">Master Delivery Channels</h3>
            
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--color-border);">
              <div>
                <strong style="display: block; font-size: 14px;">Android Push Notifications</strong>
                <span style="font-size: 12px; color: var(--color-text-secondary);">Allow push notifications to be sent to paired Android devices</span>
              </div>
              <label class="toggle-switch" style="min-width: 44px; min-height: 24px;">
                <input type="checkbox" id="pref-global-push" ${prefs.globalPushEnabled !== false ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
              <div>
                <strong style="display: block; font-size: 14px;">Email Notifications</strong>
                <span style="font-size: 12px; color: var(--color-text-secondary);">Allow email notifications to be sent to your account email</span>
              </div>
              <label class="toggle-switch" style="min-width: 44px; min-height: 24px;">
                <input type="checkbox" id="pref-global-email" ${prefs.globalEmailEnabled !== false ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- Category Preferences Card -->
          <div class="card" style="padding: 20px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
              <h3 class="pref-section-title" style="margin-bottom: 0;">Notification Categories</h3>
              <span id="rn-unsaved-badge" style="display: none; font-size: 11px; font-weight: 600; color: #D97706; background: #FEF3C7; border: 1px solid #FCD34D; padding: 2px 8px; border-radius: 9999px;">Unsaved changes</span>
            </div>
            <div class="pref-category-list">
              ${categoryCardsHtml}
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; align-items: center;">
            <button type="submit" id="btn-save-prefs" class="btn btn-primary" style="min-height: 44px; padding: 0 24px;">Save Notification Preferences</button>
          </div>
        </form>
      `;

      // Track unsaved changes on any input change
      const markUnsaved = () => {
        this.hasUnsavedPreferences = true;
        const unsavedBadge = document.getElementById('rn-unsaved-badge');
        if (unsavedBadge) unsavedBadge.style.display = 'inline-block';
      };

      container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.addEventListener('change', markUnsaved);
      });

      // Window unload protection
      window.onbeforeunload = () => {
        if (this.hasUnsavedPreferences) {
          return 'You have unsaved notification preferences. Are you sure you want to leave?';
        }
      };

      const form = document.getElementById('form-notif-prefs');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (this.isSavingPreferences) return;
          this.isSavingPreferences = true;

          const btn = document.getElementById('btn-save-prefs');
          const feedback = document.getElementById('rn-notif-pref-feedback');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving Preferences...';
          }

          const updatedGlobalPush = document.getElementById('pref-global-push').checked;
          const updatedGlobalEmail = document.getElementById('pref-global-email').checked;

          const updatedCategories = {};
          categoriesMeta.forEach((meta) => {
            const masterToggle = container.querySelector(`.cat-master-toggle[data-cat="${meta.key}"]`);
            const inAppToggle = container.querySelector(`.cat-channel-toggle[data-cat="${meta.key}"][data-channel="IN_APP"]`);
            const pushToggle = container.querySelector(`.cat-channel-toggle[data-cat="${meta.key}"][data-channel="PUSH"]`);
            const emailToggle = container.querySelector(`.cat-channel-toggle[data-cat="${meta.key}"][data-channel="EMAIL"]`);

            updatedCategories[meta.key] = {
              enabled: meta.isMandatory ? true : (masterToggle ? masterToggle.checked : true),
              channels: {
                IN_APP: meta.isMandatory ? true : (inAppToggle ? inAppToggle.checked : true),
                PUSH: pushToggle ? pushToggle.checked : true,
                EMAIL: meta.isMandatory ? true : (emailToggle ? emailToggle.checked : true)
              }
            };
          });

          try {
            const patchRes = await notifFetch(`${getApiBase()}/notifications/preferences`, {
              method: 'PATCH',
              body: JSON.stringify({
                globalPushEnabled: updatedGlobalPush,
                globalEmailEnabled: updatedGlobalEmail,
                categories: updatedCategories
              })
            });

            if (patchRes.ok) {
              const resJson = await patchRes.json();
              const serverPrefs = resJson.data || {};
              this.hasUnsavedPreferences = false;
              window.onbeforeunload = null;

              if (feedback) {
                feedback.style.display = 'block';
                feedback.style.background = '#D1FAE5';
                feedback.style.color = '#065F46';
                feedback.style.border = '1px solid #A7F3D0';
                feedback.textContent = 'Notification preferences updated successfully.';
              }

              // Re-render from authoritative server response
              this.renderPreferencesForm(container, serverPrefs);
              const reFeedback = document.getElementById('rn-notif-pref-feedback');
              if (reFeedback) {
                reFeedback.style.display = 'block';
                reFeedback.style.background = '#D1FAE5';
                reFeedback.style.color = '#065F46';
                reFeedback.style.border = '1px solid #A7F3D0';
                reFeedback.textContent = 'Notification preferences updated successfully.';
                setTimeout(() => {
                  reFeedback.style.display = 'none';
                }, 5000);
              }
            } else {
              const errInfo = await classifyHttpError(patchRes, 'Failed to update notification preferences. Please try again.');
              if (feedback) {
                feedback.style.display = 'block';
                feedback.style.background = '#FEE2E2';
                feedback.style.color = '#991B1B';
                feedback.style.border = '1px solid #FCA5A5';
                feedback.innerHTML = errInfo.isSessionExpired
                  ? '<strong>Session Expired:</strong> Your session has expired. <a href="login.html" style="text-decoration:underline;color:#991B1B;font-weight:600;">Sign in again</a> to save your preferences.'
                  : errInfo.isRateLimited
                  ? '<strong>Rate Limited:</strong> Too many requests. Please wait a moment before saving again.'
                  : `<strong>Save Failed:</strong> ${escapeHtml(errInfo.message)} (Your unsaved changes are preserved below).`;
              }
              if (btn) {
                btn.disabled = false;
                btn.textContent = 'Save Notification Preferences';
              }
            }
          } catch {
            if (feedback) {
              feedback.style.display = 'block';
              feedback.style.background = '#FEE2E2';
              feedback.style.color = '#991B1B';
              feedback.style.border = '1px solid #FCA5A5';
              feedback.innerHTML = '<strong>Connection Error:</strong> Network error while saving notification preferences. Your changes are preserved.';
            }
            if (btn) {
              btn.disabled = false;
              btn.textContent = 'Save Notification Preferences';
            }
          } finally {
            this.isSavingPreferences = false;
          }
        });
      }
    }
  }

  const client = new NotificationCenterClient();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => client.init());
  } else {
    client.init();
  }

  window.ZdexCloudNotificationClient = client;

})();
