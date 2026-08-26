/**
 * REMOTENODE NOTIFICATION CENTER CLIENT (VANILLA JS)
 * Phase MW-1 — Track 4 Batch NT-1.3: Main Website Notification Center
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

  function getAuthHeader() {
    const token = localStorage.getItem('rn_auth_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
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
    if (!deepLinkUri) return null;
    const isInnerPage = window.location.pathname.includes('/pages/');
    const prefix = isInnerPage ? '' : 'pages/';

    if (deepLinkUri.startsWith('remotenode://filemanager')) {
      return `${prefix}file-manager.html`;
    }
    if (deepLinkUri.startsWith('remotenode://server/')) {
      const serverId = deepLinkUri.split('remotenode://server/')[1];
      return `${prefix}dashboard.html#server-${serverId}`;
    }
    if (deepLinkUri.startsWith('remotenode://security')) {
      return `${prefix}dashboard.html#security`;
    }
    if (deepLinkUri.startsWith('remotenode://device/')) {
      return `${prefix}dashboard.html`;
    }
    return `${prefix}dashboard.html`;
  }

  class NotificationCenterClient {
    constructor() {
      this.unreadCount = 0;
      this.popoverOpen = false;
      this.pollTimer = null;
      this.activeCategoryFilter = 'ALL';
      this.currentPage = 1;
    }

    init() {
      const authToken = localStorage.getItem('rn_auth_token');
      if (!authToken) return;

      this.injectBellButton();
      this.fetchUnreadCount();

      // Refresh on window focus & periodic 30s interval
      window.addEventListener('focus', () => this.fetchUnreadCount());
      this.pollTimer = setInterval(() => this.fetchUnreadCount(), 30000);

      // Close popover on click outside or ESC
      document.addEventListener('click', (e) => {
        const bellWrapper = document.getElementById('rn-notif-bell-wrapper');
        if (bellWrapper && !bellWrapper.contains(e.target)) {
          this.closePopover();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.popoverOpen) {
          this.closePopover();
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
          <span id="rn-notif-badge" class="rn-notif-badge" style="display: none;">0</span>
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
            <div class="rn-notif-popover-actions">
              <a href="${viewAllPath}" class="rn-notif-link-btn">View All</a>
            </div>
          </div>
          <div id="rn-notif-popover-body" class="rn-notif-popover-body">
            <div class="rn-notif-state-box">Loading notifications...</div>
          </div>
          <div class="rn-notif-popover-footer">
            <a href="${viewAllPath}" class="rn-notif-link-btn" style="width: 100%; display: inline-block;">Open Notification History Center</a>
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
    }

    async fetchUnreadCount() {
      try {
        const res = await fetch(`${getApiBase()}/notifications/unread-count`, {
          headers: getAuthHeader()
        });
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
      if (!badge) return;

      if (count <= 0) {
        badge.style.display = 'none';
        badge.textContent = '0';
      } else {
        badge.style.display = 'inline-block';
        badge.textContent = count > 99 ? '99+' : String(count);
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

      body.innerHTML = '<div class="rn-notif-state-box">Loading notifications...</div>';

      try {
        const res = await fetch(`${getApiBase()}/notifications?page=1&limit=5`, {
          headers: getAuthHeader()
        });

        if (!res.ok) {
          body.innerHTML = '<div class="rn-notif-state-box">Failed to load notifications. <button type="button" id="btn-retry-popover" class="rn-notif-link-btn">Retry</button></div>';
          const btnRetry = document.getElementById('btn-retry-popover');
          if (btnRetry) btnRetry.onclick = () => this.loadPopoverItems();
          return;
        }

        const json = await res.json();
        const items = json.data?.items || [];

        if (items.length === 0) {
          body.innerHTML = '<div class="rn-notif-state-box">No notifications found</div>';
          return;
        }

        body.innerHTML = '';
        items.forEach((item) => {
          const el = this.createPopoverItemElement(item);
          body.appendChild(el);
        });
      } catch (err) {
        body.innerHTML = '<div class="rn-notif-state-box">Error connecting to server.</div>';
      }
    }

    createPopoverItemElement(item) {
      const isUnread = item.state === 'UNREAD';
      const severityClass = getSeverityClass(item.severity);
      const timeAgo = formatTimeAgo(item.createdAt);
      const targetWebPath = resolveDeepLinkWebPath(item.deepLinkUri);

      const div = document.createElement('div');
      div.className = `rn-notif-item ${isUnread ? 'is-unread' : ''}`;
      div.setAttribute('tabindex', '0');

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

      div.addEventListener('click', async () => {
        if (isUnread) {
          await this.markAsRead(item.id);
        }
        this.closePopover();
        if (targetWebPath) {
          window.location.href = targetWebPath;
        }
      });

      return div;
    }

    async markAsRead(notificationId) {
      try {
        const res = await fetch(`${getApiBase()}/notifications/${notificationId}/read`, {
          method: 'PATCH',
          headers: getAuthHeader()
        });
        if (res.ok) {
          this.fetchUnreadCount();
        }
      } catch {}
    }

    async markAsArchived(notificationId) {
      try {
        const res = await fetch(`${getApiBase()}/notifications/${notificationId}/archive`, {
          method: 'PATCH',
          headers: getAuthHeader()
        });
        if (res.ok) {
          this.fetchUnreadCount();
        }
      } catch {}
    }

    escapeHtml(str) {
      if (!str) return '';
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
        <div class="rn-notif-filter-bar">
          <button type="button" class="rn-filter-btn is-active" data-category="ALL">All</button>
          <button type="button" class="rn-filter-btn" data-category="ACCOUNT_SECURITY">Security</button>
          <button type="button" class="rn-filter-btn" data-category="DEVICE_SERVER">Devices & Servers</button>
          <button type="button" class="rn-filter-btn" data-category="FILE_OPERATIONS">Files</button>
          <button type="button" class="rn-filter-btn" data-category="STORAGE">Storage</button>
          <button type="button" class="rn-filter-btn" data-category="SYSTEM">System</button>
        </div>

        <div id="rn-notif-history-list" class="rn-notif-card-list">
          <div class="rn-notif-state-box">Loading notification history...</div>
        </div>

        <div id="rn-notif-pagination" class="pagination-container" style="display: flex; justify-content: center; gap: 12px; margin-top: 24px;"></div>
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
    }

    async loadHistoryItems() {
      const listEl = document.getElementById('rn-notif-history-list');
      if (!listEl) return;

      listEl.innerHTML = '<div class="rn-notif-state-box">Loading notifications...</div>';

      try {
        let url = `${getApiBase()}/notifications?page=${this.currentPage}&limit=10`;
        if (this.activeCategoryFilter !== 'ALL') {
          url += `&category=${encodeURIComponent(this.activeCategoryFilter)}`;
        }

        const res = await fetch(url, { headers: getAuthHeader() });
        if (!res.ok) {
          listEl.innerHTML = '<div class="rn-notif-state-box">Failed to load notification history.</div>';
          return;
        }

        const json = await res.json();
        const items = json.data?.items || [];
        const total = json.data?.total || 0;

        if (items.length === 0) {
          listEl.innerHTML = '<div class="rn-notif-state-box">No notifications found for this filter.</div>';
          this.renderPagination(0, 1);
          return;
        }

        listEl.innerHTML = '';
        items.forEach((item) => {
          const card = this.createHistoryCardElement(item);
          listEl.appendChild(card);
        });

        this.renderPagination(total, 10);
      } catch {
        listEl.innerHTML = '<div class="rn-notif-state-box">Error loading notification history.</div>';
      }
    }

    createHistoryCardElement(item) {
      const isUnread = item.state === 'UNREAD';
      const severityClass = getSeverityClass(item.severity);
      const timeAgo = formatTimeAgo(item.createdAt);
      const targetWebPath = resolveDeepLinkWebPath(item.deepLinkUri);

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
          <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 12px 0; line-height: 1.5;">${this.escapeHtml(item.body)}</p>
          <div class="rn-notif-card-actions">
            ${targetWebPath ? `<a href="${targetWebPath}" class="btn btn-secondary btn-sm">Open Target</a>` : ''}
            ${isUnread ? `<button type="button" class="btn btn-ghost btn-sm btn-mark-read" data-id="${item.id}">Mark as Read</button>` : '<span style="font-size: 12px; color: var(--color-text-tertiary);">Read</span>'}
            <button type="button" class="btn btn-ghost btn-sm btn-archive" data-id="${item.id}" style="color: var(--color-text-tertiary);">Archive</button>
          </div>
        </div>
      `;

      const btnRead = div.querySelector('.btn-mark-read');
      if (btnRead) {
        btnRead.addEventListener('click', async () => {
          await this.markAsRead(item.id);
          await this.loadHistoryItems();
        });
      }

      const btnArchive = div.querySelector('.btn-archive');
      if (btnArchive) {
        btnArchive.addEventListener('click', async () => {
          await this.markAsArchived(item.id);
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
        <button type="button" class="btn btn-secondary btn-sm" id="btn-prev-page" ${this.currentPage <= 1 ? 'disabled' : ''}>Previous</button>
        <span style="font-size: 13px; display: inline-flex; align-items: center;">Page ${this.currentPage} of ${totalPages}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-next-page" ${this.currentPage >= totalPages ? 'disabled' : ''}>Next</button>
      `;

      const btnPrev = document.getElementById('btn-prev-page');
      if (btnPrev) {
        btnPrev.onclick = async () => {
          if (this.currentPage > 1) {
            this.currentPage--;
            await this.loadHistoryItems();
          }
        };
      }

      const btnNext = document.getElementById('btn-next-page');
      if (btnNext) {
        btnNext.onclick = async () => {
          if (this.currentPage < totalPages) {
            this.currentPage++;
            await this.loadHistoryItems();
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

      container.innerHTML = '<div class="rn-notif-state-box">Loading notification preferences...</div>';

      try {
        const res = await fetch(`${getApiBase()}/notifications/preferences`, {
          headers: getAuthHeader()
        });

        if (!res.ok) {
          container.innerHTML = '<div class="rn-notif-state-box">Failed to load preferences.</div>';
          return;
        }

        const json = await res.json();
        const prefs = json.data;

        this.renderPreferencesForm(container, prefs);
      } catch {
        container.innerHTML = '<div class="rn-notif-state-box">Error loading preferences.</div>';
      }
    }

    renderPreferencesForm(container, prefs) {
      container.innerHTML = `
        <div class="security-policy-notice">
          <svg class="icon icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: #D97706; flex-shrink: 0;">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <div>
            <h4>Security & Mandatory Notification Policy</h4>
            <p>RemoteNode enforces mandatory delivery for critical security events (login alerts, verification codes, device linking). Security notifications cannot be disabled to ensure your phone's personal storage remains protected.</p>
          </div>
        </div>

        <form id="form-notif-prefs" style="display: flex; flex-direction: column; gap: 20px;">
          <div class="card" style="padding: 20px;">
            <h3 style="font-size: 16px; font-weight: 700; margin-0 0 16px 0;">Global Delivery Channels</h3>
            
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--color-border);">
              <div>
                <strong style="display: block; font-size: 14px;">Android Push Notifications</strong>
                <span style="font-size: 12px; color: var(--color-text-secondary);">Deliver alerts directly to your paired Android phone</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="pref-global-push" ${prefs.globalPushEnabled ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
              <div>
                <strong style="display: block; font-size: 14px;">Email Delivery</strong>
                <span style="font-size: 12px; color: var(--color-text-secondary);">Send email notifications for non-critical alerts</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="pref-global-email" ${prefs.globalEmailEnabled ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end;">
            <button type="submit" id="btn-save-prefs" class="btn btn-primary">Save Notification Preferences</button>
          </div>
        </form>
      `;

      const form = document.getElementById('form-notif-prefs');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = document.getElementById('btn-save-prefs');
          if (btn) btn.disabled = true;

          const updatedGlobalPush = document.getElementById('pref-global-push').checked;
          const updatedGlobalEmail = document.getElementById('pref-global-email').checked;

          try {
            const patchRes = await fetch(`${getApiBase()}/notifications/preferences`, {
              method: 'PATCH',
              headers: {
                ...getAuthHeader(),
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                globalPushEnabled: updatedGlobalPush,
                globalEmailEnabled: updatedGlobalEmail
              })
            });

            if (patchRes.ok) {
              alert('Notification preferences updated successfully.');
            } else {
              alert('Failed to update preferences.');
            }
          } catch {
            alert('Error updating preferences.');
          } finally {
            if (btn) btn.disabled = false;
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

  window.RemoteNodeNotificationClient = client;

})();
