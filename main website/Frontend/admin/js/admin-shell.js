/**
 * ZDEXCLOUD ADMIN CONTROL PLANE — SPA SHELL & OPERATIONS UI MANAGER
 * Phase 7.5-E & Phase 8.7: Canonical Light Operations Console
 */

(function (window) {
  'use strict';

  const NAV_SCHEMA = [
    {
      group: 'Overview',
      items: [
        {
          id: 'dashboard',
          label: 'Operations Overview',
          icon: 'dashboard',
          permission: null
        }
      ]
    },
    {
      group: 'Core Operations',
      items: [
        {
          id: 'users',
          label: 'Customer Accounts',
          icon: 'users',
          permission: 'users.read'
        },
        {
          id: 'devices',
          label: 'Devices & Nodes',
          icon: 'server',
          permission: 'devices.read'
        },
        {
          id: 'servers',
          label: 'Server Instances',
          icon: 'hard-drive',
          permission: 'servers.read'
        },
        {
          id: 'gateway',
          label: 'Gateway & Relays',
          icon: 'radio',
          permission: 'gateway.read'
        }
      ]
    },
    {
      group: 'Commercial & Billing',
      items: [
        {
          id: 'subscriptions',
          label: 'Subscriptions & Dunning',
          icon: 'credit-card',
          permission: 'billing.read'
        }
      ]
    },
    {
      group: 'Security & Access',
      items: [
        {
          id: 'admin-roles',
          label: 'Roles & RBAC Matrix',
          icon: 'shield',
          permission: 'admin_roles.read'
        },
        {
          id: 'audit-logs',
          label: 'Security Audit Logs',
          icon: 'file-text',
          permission: 'audit.read'
        }
      ]
    }
  ];

  const ICONS = {
    'credit-card': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>',
    'hard-drive': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>',
    radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.8 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    'file-text': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
    'refresh-cw': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon" style="width:14px;height:14px;" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-search-icon"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    square: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;color:var(--admin-warning);"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>'
  };

  class AdminShellManager {
    constructor() {
      this.currentSection = 'dashboard';
      this.gatewayActiveTab = 'nodes';
      this.idleSecondsRemaining = 900;
      this.idleTimerInterval = null;

      // Module State Caches
      this.userState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.deviceState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '', platform: '' };
      this.serverState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.gatewayState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.connectionsState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '' };
      this.subscriptionState = { page: 1, pageSize: 20, total: 0, items: [], search: '', status: '', planCode: '' };
      this.auditState = { page: 1, limit: 20, total: 0, items: [], search: '', status: '', action: '', startDate: '', endDate: '' };
    }

    async init() {
      const authed = await window.AdminAuth.requireAuthGuard();
      if (!authed) return;

      this._renderHeaderProfile();
      this._renderSidebar();
      this._bindEventListeners();
      this._startIdleCountdown();
      this._handleHashRoute();
    }

    _renderHeaderProfile() {
      const user = window.AdminAuth.currentUser;
      const roles = window.AdminAuth.roles;
      if (!user) return;

      const initials = (user.fullName || user.email || 'A')
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

      const avatarEl = document.getElementById('adminAvatarInitials');
      if (avatarEl) avatarEl.textContent = initials;

      const headerNameEl = document.getElementById('adminHeaderName');
      if (headerNameEl) headerNameEl.textContent = user.fullName || user.email;

      const sidebarNameEl = document.getElementById('adminSidebarName');
      if (sidebarNameEl) sidebarNameEl.textContent = user.fullName || user.email;

      const primaryRole = (typeof roles[0] === 'string' ? roles[0] : roles[0]?.name) || (window.AdminAuth.isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN');
      const sidebarRoleEl = document.getElementById('adminSidebarRole');
      if (sidebarRoleEl) sidebarRoleEl.textContent = primaryRole;

      const dropdownNameEl = document.getElementById('adminDropdownName');
      if (dropdownNameEl) dropdownNameEl.textContent = user.fullName || user.name || 'Super Administrator';

      const dropdownEmailEl = document.getElementById('adminDropdownEmail');
      if (dropdownEmailEl) dropdownEmailEl.textContent = user.email;

      const rolesContainer = document.getElementById('adminDropdownRoles');
      if (rolesContainer) {
        rolesContainer.innerHTML = roles.map(r => {
          const roleName = typeof r === 'string' ? r : (r.name || r.slug || 'ADMIN');
          const isSuper = roleName === 'SUPER_ADMIN' || window.AdminAuth.isSuperAdmin;
          return `<span class="admin-role-badge ${isSuper ? 'super-admin' : ''}">${this._escape(roleName)}</span>`;
        }).join('') || '<span class="admin-role-badge super-admin">SUPER_ADMIN</span>';
      }
    }

    _renderSidebar() {
      const navContainer = document.getElementById('adminSidebarNav');
      if (!navContainer) return;

      let html = '';
      for (const group of NAV_SCHEMA) {
        html += `<div class="admin-nav-group">`;
        html += `<div class="admin-nav-group-label">${this._escape(group.group)}</div>`;

        for (const item of group.items) {
          const hasAccess = item.permission === null || window.AdminAuth.hasPermission(item.permission);
          const iconSvg = ICONS[item.icon] || ICONS.dashboard;

          if (hasAccess) {
            html += `
              <a href="#${item.id}" class="admin-nav-item" data-id="${item.id}">
                ${iconSvg}
                <span>${this._escape(item.label)}</span>
              </a>
            `;
          } else {
            html += `
              <div class="admin-nav-item restricted" title="Requires permission: ${item.permission}">
                ${iconSvg}
                <span>${this._escape(item.label)}</span>
                <span class="admin-nav-lock">${ICONS.lock}</span>
              </div>
            `;
          }
        }
        html += `</div>`;
      }

      navContainer.innerHTML = html;
    }

    _bindEventListeners() {
      window.addEventListener('hashchange', () => this._handleHashRoute());

      const profileBtn = document.getElementById('adminProfileBtn');
      const profileDropdown = document.getElementById('adminProfileDropdown');

      if (profileBtn && profileDropdown) {
        profileBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          profileDropdown.classList.toggle('open');
        });

        document.addEventListener('click', () => {
          profileDropdown.classList.remove('open');
        });
      }

      const logoutBtns = document.querySelectorAll('[data-action="logout"]');
      logoutBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          btn.disabled = true;
          this.toast('Signing out of ZdexCloud Operations...', 'info');
          await window.AdminAuth.logout();
        });
      });

      const menuToggle = document.getElementById('adminMenuToggle');
      const sidebar = document.getElementById('adminSidebar');
      const backdrop = document.getElementById('adminDrawerBackdrop');

      if (menuToggle && sidebar && backdrop) {
        const toggleDrawer = () => {
          sidebar.classList.toggle('open');
          backdrop.classList.toggle('active');
        };

        menuToggle.addEventListener('click', toggleDrawer);
        backdrop.addEventListener('click', toggleDrawer);
      }

      const resetActivity = () => {
        this.idleSecondsRemaining = 900;
      };
      window.addEventListener('mousemove', resetActivity, { passive: true });
      window.addEventListener('keydown', resetActivity, { passive: true });
      window.addEventListener('click', resetActivity, { passive: true });
    }

    _startIdleCountdown() {
      if (this.idleTimerInterval) clearInterval(this.idleTimerInterval);

      const timerEl = document.getElementById('adminSessionCountdown');

      this.idleTimerInterval = setInterval(() => {
        this.idleSecondsRemaining--;

        if (this.idleSecondsRemaining <= 0) {
          clearInterval(this.idleTimerInterval);
          this.toast('Admin session expired due to inactivity.', 'danger');
          setTimeout(() => {
            window.AdminAuth.logout();
          }, 1500);
          return;
        }

        if (timerEl) {
          const mins = Math.floor(this.idleSecondsRemaining / 60);
          const secs = this.idleSecondsRemaining % 60;
          timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
          
          if (this.idleSecondsRemaining < 120) {
            timerEl.parentElement.classList.add('expiring');
          } else {
            timerEl.parentElement.classList.remove('expiring');
          }
        }
      }, 1000);
    }

    _handleHashRoute() {
      const rawHash = window.location.hash.replace('#', '').trim() || 'dashboard';
      let hash = rawHash;
      if (rawHash === 'customers') hash = 'users';
      if (rawHash === 'audit') hash = 'audit-logs';
      if (rawHash === 'roles') hash = 'admin-roles';
      if (rawHash === 'billing' || rawHash === 'billing-subscriptions') hash = 'subscriptions';
      this.currentSection = hash;

      const navItems = document.querySelectorAll('.admin-nav-item[data-id]');
      navItems.forEach(el => {
        const itemId = el.getAttribute('data-id');
        if (itemId === hash || (rawHash === 'customers' && itemId === 'users') || (rawHash === 'audit' && itemId === 'audit-logs') || (rawHash === 'roles' && itemId === 'admin-roles') || ((rawHash === 'billing' || rawHash === 'billing-subscriptions') && itemId === 'subscriptions')) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });

      let currentItem = null;
      let currentGroup = null;

      for (const group of NAV_SCHEMA) {
        for (const item of group.items) {
          if (item.id === hash || item.id === rawHash) {
            currentItem = item;
            currentGroup = group;
            break;
          }
        }
        if (currentItem) break;
      }

      const breadcrumbGroup = document.getElementById('adminBreadcrumbGroup');
      const breadcrumbItem = document.getElementById('adminBreadcrumbCurrent');
      if (breadcrumbGroup && breadcrumbItem) {
        breadcrumbGroup.textContent = currentGroup ? currentGroup.group : 'Overview';
        breadcrumbItem.textContent = currentItem ? currentItem.label : (hash === 'users' ? 'Customer Accounts' : (hash === 'subscriptions' ? 'Subscriptions & Dunning' : 'Dashboard'));
      }

      if (currentItem && currentItem.permission && !window.AdminAuth.hasPermission(currentItem.permission)) {
        this._renderForbiddenView(currentItem);
        return;
      }

      this._renderView(hash);
    }

    _renderView(sectionId) {
      const container = document.getElementById('adminViewContainer');
      if (!container) return;

      switch (sectionId) {
        case 'dashboard':
          this._renderDashboardView(container);
          break;
        case 'customers':
        case 'users':
          this._renderUsersView(container);
          break;
        case 'devices':
          this._renderDevicesView(container);
          break;
        case 'servers':
          this._renderServersView(container);
          break;
        case 'gateway':
          this._renderGatewayView(container);
          break;
        case 'subscriptions':
        case 'billing':
        case 'billing-subscriptions':
          this._renderSubscriptionsView(container);
          break;
        case 'admin-roles':
        case 'roles':
          this._renderRolesView(container);
          break;
        case 'audit-logs':
        case 'audit':
          this._renderAuditLogsView(container);
          break;
        default:
          this._renderDashboardView(container);
      }
    }

    /* =========================================================================
       1. OVERVIEW DASHBOARD VIEW
       ========================================================================= */
    async _renderDashboardView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Operations Overview</h1>
            <p>Infrastructure state, edge node status, and administrative control telemetry.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell._renderDashboardView(document.getElementById('adminViewContainer'))">
              ${ICONS['refresh-cw']} Refresh State
            </button>
          </div>
        </div>

        <div id="adminDashCards" class="admin-grid-4">
          <div class="admin-card"><div class="admin-stat-label">Users</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Devices</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Servers</div><div class="admin-stat-value">...</div></div>
          <div class="admin-card"><div class="admin-stat-label">Gateway Nodes</div><div class="admin-stat-value">...</div></div>
        </div>

        <div class="admin-grid-2" style="margin-top:var(--space-xl);">
          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Operational Status Distribution</h3>
            <div id="adminDashBreakdown" style="display:flex;flex-direction:column;gap:0.75rem;">
              <p style="color:var(--admin-text-muted);font-size:0.875rem;">Loading telemetry metrics...</p>
            </div>
          </div>

          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Operational Control Planes</h3>
            <div style="display:flex;flex-direction:column;gap:0.75rem;">
              <a href="#users" class="admin-btn admin-btn-secondary" style="justify-content:space-between;width:100%;">
                <span>Manage Customer Accounts</span>
                <span class="admin-badge admin-badge-info">Phase 8.3</span>
              </a>
              <a href="#devices" class="admin-btn admin-btn-secondary" style="justify-content:space-between;width:100%;">
                <span>Inspect Devices & Edge Nodes</span>
                <span class="admin-badge admin-badge-info">Phase 8.4</span>
              </a>
              <a href="#servers" class="admin-btn admin-btn-secondary" style="justify-content:space-between;width:100%;">
                <span>Server Instances & Power Controls</span>
                <span class="admin-badge admin-badge-info">Phase 8.5</span>
              </a>
              <a href="#gateway" class="admin-btn admin-btn-secondary" style="justify-content:space-between;width:100%;">
                <span>Gateway Nodes & Cluster Telemetry</span>
                <span class="admin-badge admin-badge-info">Phase 8.6</span>
              </a>
            </div>
          </div>
        </div>
      `;

      try {
        const [usersRes, devicesRes, serversRes, telemetryRes] = await Promise.all([
          window.AdminApi.get('/admin/operations/users?pageSize=1').catch(() => ({ data: { total: 0 } })),
          window.AdminApi.get('/admin/operations/devices?pageSize=1').catch(() => ({ data: { total: 0 } })),
          window.AdminApi.get('/admin/operations/servers?pageSize=1').catch(() => ({ data: { total: 0 } })),
          window.AdminApi.get('/admin/operations/gateway/telemetry').catch(() => ({ data: { telemetry: {} } }))
        ]);

        const usersTotal = usersRes?.data?.total || 0;
        const devicesTotal = devicesRes?.data?.total || 0;
        const serversTotal = serversRes?.data?.total || 0;
        const telemetry = telemetryRes?.data?.telemetry || {};

        const cardsContainer = document.getElementById('adminDashCards');
        if (cardsContainer) {
          cardsContainer.innerHTML = `
            <div class="admin-card">
              <div class="admin-stat-label"><span>Total Customer Accounts</span><span class="admin-status-dot" style="background-color:var(--admin-success)"></span></div>
              <div class="admin-stat-value">${usersTotal}</div>
              <div class="admin-stat-subtext"><a href="#users" style="color:var(--admin-primary);">Inspect users &rarr;</a></div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label"><span>Registered Edge Devices</span><span class="admin-status-dot" style="background-color:var(--admin-primary)"></span></div>
              <div class="admin-stat-value">${devicesTotal}</div>
              <div class="admin-stat-subtext"><a href="#devices" style="color:var(--admin-primary);">Inspect devices &rarr;</a></div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label"><span>Server Instances</span><span class="admin-status-dot" style="background-color:var(--admin-warning)"></span></div>
              <div class="admin-stat-value">${serversTotal}</div>
              <div class="admin-stat-subtext"><a href="#servers" style="color:var(--admin-primary);">Power controls &rarr;</a></div>
            </div>
            <div class="admin-card">
              <div class="admin-stat-label"><span>Gateway Nodes</span><span class="admin-status-dot" style="background-color:var(--admin-success)"></span></div>
              <div class="admin-stat-value">${telemetry.totalGatewayNodes || 0}</div>
              <div class="admin-stat-subtext">Active Tunnels: <strong>${telemetry.totalActiveConnections || 0}</strong></div>
            </div>
          `;
        }

        const breakdownContainer = document.getElementById('adminDashBreakdown');
        if (breakdownContainer) {
          breakdownContainer.innerHTML = `
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--admin-border-subtle);">
              <span style="color:var(--admin-text-secondary);">Active Gateway Nodes:</span>
              <span class="admin-badge admin-badge-success">${telemetry.activeGatewayNodes || 0} ACTIVE</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--admin-border-subtle);">
              <span style="color:var(--admin-text-secondary);">Maintenance Gateway Nodes:</span>
              <span class="admin-badge admin-badge-warning">${telemetry.maintenanceGatewayNodes || 0} MAINTENANCE</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--admin-border-subtle);">
              <span style="color:var(--admin-text-secondary);">Connected Online Devices:</span>
              <span class="admin-badge admin-badge-info">${telemetry.connectedDevices || 0} ONLINE</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:0.5rem 0;">
              <span style="color:var(--admin-text-secondary);">Active File Transfers:</span>
              <strong>${telemetry.runtimeTelemetry?.activeTransfers || 0}</strong>
            </div>
          `;
        }
      } catch (err) {
        console.warn('Dashboard metrics fetch notice:', err);
      }
    }

    /* =========================================================================
       2. USERS MANAGEMENT VIEW
       ========================================================================= */
    async _renderUsersView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Customer Accounts</h1>
            <p>Manage customer identities, verification status, and administrative account suspensions.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.loadUsers()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-toolbar">
          <div class="admin-toolbar-left">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="userSearchInput" class="admin-search-input" placeholder="Search by email or name..." value="${this._escape(this.userState.search)}">
            </div>
            <select id="userStatusSelect" class="admin-select">
              <option value="" ${this.userState.status === '' ? 'selected' : ''}>All Statuses</option>
              <option value="ACTIVE" ${this.userState.status === 'ACTIVE' ? 'selected' : ''}>Active</option>
              <option value="SUSPENDED" ${this.userState.status === 'SUSPENDED' ? 'selected' : ''}>Suspended</option>
              <option value="PENDING_VERIFICATION" ${this.userState.status === 'PENDING_VERIFICATION' ? 'selected' : ''}>Pending Verification</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>User / Email</th>
                  <th>Full Name</th>
                  <th>Status</th>
                  <th>Verified</th>
                  <th>Devices</th>
                  <th>Sessions</th>
                  <th>Created</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="userTableBody">
                <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading customer directory...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="userPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('userSearchInput');
      const statusSelect = document.getElementById('userStatusSelect');

      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.userState.search = e.target.value.trim();
          this.userState.page = 1;
          this.loadUsers();
        }, 300);
      });

      statusSelect.addEventListener('change', (e) => {
        this.userState.status = e.target.value;
        this.userState.page = 1;
        this.loadUsers();
      });

      this.loadUsers();
    }

    async loadUsers() {
      const tbody = document.getElementById('userTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading users...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.userState.page.toString(),
          pageSize: this.userState.pageSize.toString()
        });
        if (this.userState.search) queryParams.set('search', this.userState.search);
        if (this.userState.status) queryParams.set('status', this.userState.status);

        const res = await window.AdminApi.get(`/admin/operations/users?${queryParams.toString()}`);
        const data = res.data;
        this.userState.items = data.items || [];
        this.userState.total = data.total || 0;

        if (this.userState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="admin-empty-box">
                  ${ICONS.users}
                  <div class="admin-empty-title">No customer accounts found</div>
                  <div class="admin-empty-desc">No accounts match your current filter parameters.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('userPaginationBar', this.userState, (p) => { this.userState.page = p; this.loadUsers(); });
          return;
        }

        const canSuspend = window.AdminAuth.hasPermission('users.suspend');

        tbody.innerHTML = this.userState.items.map(u => `
          <tr>
            <td>
              <strong style="color:var(--admin-text-primary);">${this._escape(u.email)}</strong>
              <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(u.id)}</div>
            </td>
            <td>${this._escape(u.fullName || '—')}</td>
            <td>${this._renderStatusBadge(u.status)}</td>
            <td>${u.emailVerified ? '<span class="admin-badge admin-badge-success">Verified</span>' : '<span class="admin-badge admin-badge-neutral">Unverified</span>'}</td>
            <td><strong>${u.deviceCount}</strong></td>
            <td>${u.activeSessionCount}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${new Date(u.createdAt).toLocaleDateString()}</td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectUser('${u.id}')" title="Inspect user profile">
                  ${ICONS.eye} Inspect
                </button>
                ${canSuspend && u.status === 'ACTIVE' ? `
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.confirmSuspendUser('${u.id}', '${this._escape(u.email)}')" title="Suspend account">
                    Suspend
                  </button>
                ` : ''}
                ${canSuspend && u.status === 'SUSPENDED' ? `
                  <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell.confirmRestoreUser('${u.id}', '${this._escape(u.email)}')" title="Restore account">
                    Restore
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');

        this._renderPagination('userPaginationBar', this.userState, (p) => { this.userState.page = p; this.loadUsers(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load users')}</td></tr>`;
      }
    }

    async inspectUser(userId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/users/${userId}`);
        const user = res.data.user;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Identity & Account</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">User ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(user.id)}</code></span>
              <span class="admin-property-label">Email Address:</span>
              <span class="admin-property-value"><strong>${this._escape(user.email)}</strong></span>
              <span class="admin-property-label">Full Name:</span>
              <span class="admin-property-value">${this._escape(user.fullName || '—')}</span>
              <span class="admin-property-label">Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(user.status)}</span>
              <span class="admin-property-label">Email Verified:</span>
              <span class="admin-property-value">${user.emailVerified ? 'Yes' : 'No'}</span>
              <span class="admin-property-label">Created At:</span>
              <span class="admin-property-value">${new Date(user.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Linked Edge Devices (${user.devices.length})</div>
            ${user.devices.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${user.devices.map(d => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong style="color:var(--admin-text-primary);font-size:0.875rem;">${this._escape(d.deviceName)}</strong>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);">${this._escape(d.platform)} &bull; ${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}</div>
                    </div>
                    ${this._renderStatusBadge(d.status)}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No devices paired to this account.</p>'}
          </div>

          ${user.billing ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Billing Information</div>
              <div class="admin-property-grid">
                <span class="admin-property-label">Billing Status:</span>
                <span class="admin-property-value">${this._escape(user.billing.status || 'Active')}</span>
                <span class="admin-property-label">Currency:</span>
                <span class="admin-property-value">${this._escape(user.billing.currency || 'USD')}</span>
                <span class="admin-property-label">Country:</span>
                <span class="admin-property-value">${this._escape(user.billing.billingCountry || 'Global')}</span>
              </div>
            </div>
          ` : ''}
        `;

        this._showDrawer(`Customer: ${user.email}`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect customer', 'danger');
      }
    }

    confirmSuspendUser(userId, email) {
      this.showConfirmModal({
        title: 'Suspend Customer Account',
        message: `Are you sure you want to suspend account <strong>${this._escape(email)}</strong>? This will revoke all active login sessions and restrict node access.`,
        warningText: 'Administrative suspension takes immediate effect.',
        confirmLabel: 'Suspend Account',
        confirmType: 'danger',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/users/${userId}/suspend`, { reason });
          this.toast(`User '${email}' suspended successfully.`, 'success');
          this.loadUsers();
        }
      });
    }

    confirmRestoreUser(userId, email) {
      this.showConfirmModal({
        title: 'Restore Customer Account',
        message: `Restore customer account <strong>${this._escape(email)}</strong> back to active status?`,
        confirmLabel: 'Restore Account',
        confirmType: 'primary',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/users/${userId}/restore`, { reason });
          this.toast(`User '${email}' restored successfully.`, 'success');
          this.loadUsers();
        }
      });
    }

    /* =========================================================================
       3. DEVICES MANAGEMENT VIEW
       ========================================================================= */
    async _renderDevicesView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Devices & Edge Nodes</h1>
            <p>Inspect connected edge hardware, platform metadata, and perform administrative session evictions.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.loadDevices()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-toolbar">
          <div class="admin-toolbar-left">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="deviceSearchInput" class="admin-search-input" placeholder="Search by name, OS, or user..." value="${this._escape(this.deviceState.search)}">
            </div>
            <select id="deviceStatusSelect" class="admin-select">
              <option value="" ${this.deviceState.status === '' ? 'selected' : ''}>All Statuses</option>
              <option value="ONLINE" ${this.deviceState.status === 'ONLINE' ? 'selected' : ''}>Online</option>
              <option value="OFFLINE" ${this.deviceState.status === 'OFFLINE' ? 'selected' : ''}>Offline</option>
              <option value="CONNECTING" ${this.deviceState.status === 'CONNECTING' ? 'selected' : ''}>Connecting</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Device Name</th>
                  <th>Owner</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Servers</th>
                  <th>Last Seen</th>
                  <th>Created</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="deviceTableBody">
                <tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading devices...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="devicePaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('deviceSearchInput');
      const statusSelect = document.getElementById('deviceStatusSelect');

      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.deviceState.search = e.target.value.trim();
          this.deviceState.page = 1;
          this.loadDevices();
        }, 300);
      });

      statusSelect.addEventListener('change', (e) => {
        this.deviceState.status = e.target.value;
        this.deviceState.page = 1;
        this.loadDevices();
      });

      this.loadDevices();
    }

    async loadDevices() {
      const tbody = document.getElementById('deviceTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading devices...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.deviceState.page.toString(),
          pageSize: this.deviceState.pageSize.toString()
        });
        if (this.deviceState.search) queryParams.set('search', this.deviceState.search);
        if (this.deviceState.status) queryParams.set('status', this.deviceState.status);

        const res = await window.AdminApi.get(`/admin/operations/devices?${queryParams.toString()}`);
        const data = res.data;
        this.deviceState.items = data.items || [];
        this.deviceState.total = data.total || 0;

        if (this.deviceState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="admin-empty-box">
                  ${ICONS.server}
                  <div class="admin-empty-title">No devices found</div>
                  <div class="admin-empty-desc">No hardware devices match your current filters.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('devicePaginationBar', this.deviceState, (p) => { this.deviceState.page = p; this.loadDevices(); });
          return;
        }

        const canDisconnect = window.AdminAuth.hasPermission('devices.disconnect');

        tbody.innerHTML = this.deviceState.items.map(d => `
          <tr>
            <td>
              <strong style="color:var(--admin-text-primary);">${this._escape(d.deviceName)}</strong>
              <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(d.id)}</div>
            </td>
            <td><span style="color:var(--admin-text-secondary);">${this._escape(d.userEmail)}</span></td>
            <td>${this._escape(d.platform)} ${d.osVersion ? `<span style="font-size:0.75rem;color:var(--admin-text-muted);">(v${this._escape(d.osVersion)})</span>` : ''}</td>
            <td>${this._renderStatusBadge(d.status)}</td>
            <td><strong>${d.serverCount}</strong></td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${new Date(d.createdAt).toLocaleDateString()}</td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectDevice('${d.id}')" title="Inspect device">
                  ${ICONS.eye} Inspect
                </button>
                ${canDisconnect && d.status !== 'OFFLINE' ? `
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.confirmDisconnectDevice('${d.id}', '${this._escape(d.deviceName)}')" title="Disconnect session">
                    Disconnect
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');

        this._renderPagination('devicePaginationBar', this.deviceState, (p) => { this.deviceState.page = p; this.loadDevices(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load devices')}</td></tr>`;
      }
    }

    async inspectDevice(deviceId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/devices/${deviceId}`);
        const dev = res.data.device;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Device Identity</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Device ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(dev.id)}</code></span>
              <span class="admin-property-label">Device Name:</span>
              <span class="admin-property-value"><strong>${this._escape(dev.deviceName)}</strong></span>
              <span class="admin-property-label">Owner Email:</span>
              <span class="admin-property-value">${this._escape(dev.user?.email || 'Unknown')}</span>
              <span class="admin-property-label">Platform / OS:</span>
              <span class="admin-property-value">${this._escape(dev.platform)} ${dev.osVersion ? `(${this._escape(dev.osVersion)})` : ''}</span>
              <span class="admin-property-label">App Version:</span>
              <span class="admin-property-value">${this._escape(dev.appVersion || '—')}</span>
              <span class="admin-property-label">Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(dev.status)}</span>
              <span class="admin-property-label">Last Seen:</span>
              <span class="admin-property-value">${dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleString() : 'Never'}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Active Gateway Connection</div>
            ${dev.activeConnection ? `
              <div class="admin-property-grid">
                <span class="admin-property-label">Tunnel Status:</span>
                <span class="admin-property-value">${this._renderStatusBadge(dev.activeConnection.status)}</span>
                <span class="admin-property-label">Remote Endpoint:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(dev.activeConnection.remoteEndpoint || '—')}</code></span>
                <span class="admin-property-label">Connected At:</span>
                <span class="admin-property-value">${dev.activeConnection.connectedAt ? new Date(dev.activeConnection.connectedAt).toLocaleString() : '—'}</span>
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No active gateway tunnel connection.</p>'}
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Linked Server Instances (${dev.servers.length})</div>
            ${dev.servers.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${dev.servers.map(s => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong style="color:var(--admin-text-primary);font-size:0.875rem;">${this._escape(s.serverName || 'Default Server')}</strong>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);">${s.endpoints.map(e => e.hostname).join(', ') || 'No endpoint'}</div>
                    </div>
                    ${this._renderStatusBadge(s.status)}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No server instances running on this device.</p>'}
          </div>
        `;

        this._showDrawer(`Device: ${dev.deviceName}`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect device', 'danger');
      }
    }

    confirmDisconnectDevice(deviceId, deviceName) {
      this.showConfirmModal({
        title: 'Disconnect Edge Device Session',
        message: `Forcibly disconnect device <strong>${this._escape(deviceName)}</strong>? This will terminate its active WebSocket connection on the gateway cluster.`,
        warningText: 'The device will need to reconnect to resume server relay operations.',
        confirmLabel: 'Disconnect Device',
        confirmType: 'danger',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/devices/${deviceId}/disconnect`, { reason });
          this.toast(`Device '${deviceName}' disconnected successfully.`, 'success');
          this.loadDevices();
        }
      });
    }

    /* =========================================================================
       4. SERVERS MANAGEMENT VIEW
       ========================================================================= */
    async _renderServersView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Server Instances</h1>
            <p>Control customer edge file servers, DNS endpoint routing, and power states.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.loadServers()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-toolbar">
          <div class="admin-toolbar-left">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="serverSearchInput" class="admin-search-input" placeholder="Search by name, host, or user..." value="${this._escape(this.serverState.search)}">
            </div>
            <select id="serverStatusSelect" class="admin-select">
              <option value="" ${this.serverState.status === '' ? 'selected' : ''}>All Statuses</option>
              <option value="RUNNING" ${this.serverState.status === 'RUNNING' ? 'selected' : ''}>Running</option>
              <option value="STARTING" ${this.serverState.status === 'STARTING' ? 'selected' : ''}>Starting</option>
              <option value="STOPPED" ${this.serverState.status === 'STOPPED' ? 'selected' : ''}>Stopped</option>
              <option value="ERROR" ${this.serverState.status === 'ERROR' ? 'selected' : ''}>Error</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Server Name</th>
                  <th>Owner</th>
                  <th>Device Node</th>
                  <th>Status</th>
                  <th>Endpoint Hostname</th>
                  <th>Started At</th>
                  <th style="text-align:right;">Power Actions</th>
                </tr>
              </thead>
              <tbody id="serverTableBody">
                <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading servers...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="serverPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('serverSearchInput');
      const statusSelect = document.getElementById('serverStatusSelect');

      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.serverState.search = e.target.value.trim();
          this.serverState.page = 1;
          this.loadServers();
        }, 300);
      });

      statusSelect.addEventListener('change', (e) => {
        this.serverState.status = e.target.value;
        this.serverState.page = 1;
        this.loadServers();
      });

      this.loadServers();
    }

    async loadServers() {
      const tbody = document.getElementById('serverTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading servers...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.serverState.page.toString(),
          pageSize: this.serverState.pageSize.toString()
        });
        if (this.serverState.search) queryParams.set('search', this.serverState.search);
        if (this.serverState.status) queryParams.set('status', this.serverState.status);

        const res = await window.AdminApi.get(`/admin/operations/servers?${queryParams.toString()}`);
        const data = res.data;
        this.serverState.items = data.items || [];
        this.serverState.total = data.total || 0;

        if (this.serverState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7">
                <div class="admin-empty-box">
                  ${ICONS['hard-drive']}
                  <div class="admin-empty-title">No servers found</div>
                  <div class="admin-empty-desc">No server instances match your current filters.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('serverPaginationBar', this.serverState, (p) => { this.serverState.page = p; this.loadServers(); });
          return;
        }

        const canPower = window.AdminAuth.hasPermission('servers.power');

        tbody.innerHTML = this.serverState.items.map(s => `
          <tr>
            <td>
              <strong style="color:var(--admin-text-primary);">${this._escape(s.serverName || 'Storage Server')}</strong>
              <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(s.id)}</div>
            </td>
            <td><span style="color:var(--admin-text-secondary);">${this._escape(s.userEmail)}</span></td>
            <td><span style="color:var(--admin-text-secondary);">${this._escape(s.deviceName)}</span></td>
            <td>${this._renderStatusBadge(s.status)}</td>
            <td><code class="admin-code-pill">${s.endpoints.map(e => this._escape(e.hostname)).join(', ') || 'No DNS record'}</code></td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${s.startedAt ? new Date(s.startedAt).toLocaleString() : 'Stopped'}</td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectServer('${s.id}')" title="Inspect server">
                  ${ICONS.eye} Inspect
                </button>
                ${canPower && (s.status === 'STOPPED' || s.status === 'ERROR') ? `
                  <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell.executeStartServer('${s.id}')" title="Start server">
                    ${ICONS.play} Start
                  </button>
                ` : ''}
                ${canPower && (s.status === 'RUNNING' || s.status === 'STARTING') ? `
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.confirmStopServer('${s.id}', '${this._escape(s.serverName || s.id)}')" title="Stop server">
                    ${ICONS.square} Stop
                  </button>
                ` : ''}
                ${canPower && s.status === 'RUNNING' ? `
                  <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.confirmRestartServer('${s.id}', '${this._escape(s.serverName || s.id)}')" title="Restart server">
                    ${ICONS.rotate} Restart
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');

        this._renderPagination('serverPaginationBar', this.serverState, (p) => { this.serverState.page = p; this.loadServers(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load servers')}</td></tr>`;
      }
    }

    async inspectServer(serverId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/servers/${serverId}`);
        const srv = res.data.server;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Server Instance Information</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Server ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(srv.id)}</code></span>
              <span class="admin-property-label">Server Name:</span>
              <span class="admin-property-value"><strong>${this._escape(srv.serverName || 'Default Server')}</strong></span>
              <span class="admin-property-label">Admin Username:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(srv.adminUsername || 'admin')}</code></span>
              <span class="admin-property-label">Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(srv.status)}</span>
              <span class="admin-property-label">Started At:</span>
              <span class="admin-property-value">${srv.startedAt ? new Date(srv.startedAt).toLocaleString() : 'Stopped'}</span>
              <span class="admin-property-label">Last Heartbeat:</span>
              <span class="admin-property-value">${srv.lastHeartbeatAt ? new Date(srv.lastHeartbeatAt).toLocaleString() : 'None'}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Host Device & Owner</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Device Name:</span>
              <span class="admin-property-value">${this._escape(srv.device?.deviceName || 'Unknown Device')}</span>
              <span class="admin-property-label">Owner Email:</span>
              <span class="admin-property-value">${this._escape(srv.user?.email || 'Unknown')}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Assigned Remote Endpoints (${srv.endpoints.length})</div>
            ${srv.endpoints.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${srv.endpoints.map(e => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
                    <code class="admin-code-pill" style="font-size:0.875rem;">${this._escape(e.hostname)}</code>
                    ${this._renderStatusBadge(e.status)}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No DNS endpoints assigned.</p>'}
          </div>
        `;

        this._showDrawer(`Server: ${srv.serverName || srv.id}`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect server', 'danger');
      }
    }

    async executeStartServer(serverId) {
      try {
        this.toast('Initiating server start...', 'info');
        await window.AdminApi.post(`/admin/operations/servers/${serverId}/start`, {});
        this.toast('Server start initiated successfully.', 'success');
        this.loadServers();
      } catch (err) {
        this.toast(err.message || 'Failed to start server', 'danger');
      }
    }

    confirmStopServer(serverId, serverName) {
      this.showConfirmModal({
        title: 'Stop Server Instance',
        message: `Are you sure you want to stop server <strong>${this._escape(serverName)}</strong>? This will terminate active gateway relay sessions.`,
        warningText: 'Customer file access will be unavailable until restarted.',
        confirmLabel: 'Stop Server',
        confirmType: 'danger',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/servers/${serverId}/stop`, { reason });
          this.toast(`Server '${serverName}' stopped successfully.`, 'success');
          this.loadServers();
        }
      });
    }

    confirmRestartServer(serverId, serverName) {
      this.showConfirmModal({
        title: 'Restart Server Instance',
        message: `Restart server instance <strong>${this._escape(serverName)}</strong>?`,
        confirmLabel: 'Restart Server',
        confirmType: 'primary',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/servers/${serverId}/restart`, { reason });
          this.toast(`Server '${serverName}' restart initiated.`, 'success');
          this.loadServers();
        }
      });
    }

    /* =========================================================================
       5. GATEWAY OPERATIONS & TELEMETRY VIEW
       ========================================================================= */
    async _renderGatewayView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Gateway & Relays</h1>
            <p>Monitor distributed WebSocket routing nodes, drain maintenance clusters, and inspect tunnel connections.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.refreshGatewaySubTab()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-tabs-nav">
          <button class="admin-tab-btn ${this.gatewayActiveTab === 'nodes' ? 'active' : ''}" onclick="AdminShell.switchGatewayTab('nodes')">
            ${ICONS.server} Gateway Nodes
          </button>
          <button class="admin-tab-btn ${this.gatewayActiveTab === 'telemetry' ? 'active' : ''}" onclick="AdminShell.switchGatewayTab('telemetry')">
            ${ICONS.dashboard} Live Telemetry
          </button>
          <button class="admin-tab-btn ${this.gatewayActiveTab === 'diagnostics' ? 'active' : ''}" onclick="AdminShell.switchGatewayTab('diagnostics')">
            ${ICONS.shield} Diagnostics
          </button>
          <button class="admin-tab-btn ${this.gatewayActiveTab === 'connections' ? 'active' : ''}" onclick="AdminShell.switchGatewayTab('connections')">
            ${ICONS.radio} Active Connections
          </button>
        </div>

        <div id="gatewayTabContent"></div>
      `;

      this.renderGatewayTabContent();
    }

    switchGatewayTab(tabKey) {
      this.gatewayActiveTab = tabKey;
      const tabBtns = document.querySelectorAll('.admin-tab-btn');
      tabBtns.forEach(btn => {
        if (btn.textContent.toLowerCase().includes(tabKey)) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      this.renderGatewayTabContent();
    }

    refreshGatewaySubTab() {
      this.renderGatewayTabContent();
    }

    async renderGatewayTabContent() {
      const container = document.getElementById('gatewayTabContent');
      if (!container) return;

      if (this.gatewayActiveTab === 'nodes') {
        container.innerHTML = `
          <div class="admin-table-card">
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Gateway Hostname</th>
                    <th>Region</th>
                    <th>Status</th>
                    <th>Active Tunnels</th>
                    <th>Total Tunnels</th>
                    <th>Last Heartbeat</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody id="gatewayNodeTableBody">
                  <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading gateway nodes...</td></tr>
                </tbody>
              </table>
            </div>
            <div id="gatewayNodePaginationBar" class="admin-pagination-bar"></div>
          </div>
        `;
        this.loadGatewayNodes();
      } else if (this.gatewayActiveTab === 'telemetry') {
        container.innerHTML = `<p style="color:var(--admin-text-muted);">Loading telemetry...</p>`;
        try {
          const res = await window.AdminApi.get('/admin/operations/gateway/telemetry');
          const t = res.data.telemetry;

          container.innerHTML = `
            <div class="admin-grid-4">
              <div class="admin-card">
                <div class="admin-stat-label"><span>Active Nodes</span><span class="admin-status-dot" style="background:var(--admin-success);"></span></div>
                <div class="admin-stat-value">${t.activeGatewayNodes || 0} / ${t.totalGatewayNodes || 0}</div>
                <div class="admin-stat-subtext">Maintenance: ${t.maintenanceGatewayNodes || 0}</div>
              </div>
              <div class="admin-card">
                <div class="admin-stat-label"><span>Active Tunnels</span><span class="admin-status-dot" style="background:var(--admin-primary);"></span></div>
                <div class="admin-stat-value">${t.totalActiveConnections || 0}</div>
                <div class="admin-stat-subtext">Historical: ${t.totalHistoricalConnections || 0}</div>
              </div>
              <div class="admin-card">
                <div class="admin-stat-label"><span>Connected Devices</span><span class="admin-status-dot" style="background:var(--admin-info);"></span></div>
                <div class="admin-stat-value">${t.connectedDevices || 0}</div>
                <div class="admin-stat-subtext">Active Sockets: ${t.runtimeTelemetry?.activeConnections || 0}</div>
              </div>
              <div class="admin-card">
                <div class="admin-stat-label"><span>Gateway Uptime</span><span class="admin-status-dot" style="background:var(--admin-success);"></span></div>
                <div class="admin-stat-value" style="font-size:1.35rem;">${Math.floor((t.runtimeTelemetry?.uptimeSeconds || 0) / 60)} mins</div>
                <div class="admin-stat-subtext">Status: <strong>${t.runtimeTelemetry?.gatewayStatus || 'ACTIVE'}</strong></div>
              </div>
            </div>

            <div class="admin-card" style="margin-top:var(--space-xl);">
              <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Runtime Traffic & Rate Limiting</h3>
              <div class="admin-property-grid">
                <span class="admin-property-label">Reconnect Events:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.reconnectCount || 0}</strong></span>
                <span class="admin-property-label">Rate Limit Events:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.rateLimitEvents || 0}</strong></span>
                <span class="admin-property-label">Timed-Out Requests:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.timedOutRequests || 0}</strong></span>
                <span class="admin-property-label">Failed Auth Attempts:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.failedAuthCount || 0}</strong></span>
                <span class="admin-property-label">Active Transfers:</span>
                <span class="admin-property-value"><strong>${t.runtimeTelemetry?.activeTransfers || 0}</strong></span>
              </div>
            </div>
          `;
        } catch (err) {
          container.innerHTML = `<p style="color:var(--admin-danger);">${this._escape(err.message || 'Failed to load telemetry')}</p>`;
        }
      } else if (this.gatewayActiveTab === 'diagnostics') {
        container.innerHTML = `<p style="color:var(--admin-text-muted);">Loading diagnostics...</p>`;
        try {
          const res = await window.AdminApi.get('/admin/operations/gateway/diagnostics');
          const d = res.data.diagnostics;

          container.innerHTML = `
            <div class="admin-grid-2">
              <div class="admin-card">
                <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Gateway Subsystem Health</h3>
                <div class="admin-property-grid">
                  <span class="admin-property-label">Process Status:</span>
                  <span class="admin-property-value"><span class="admin-badge admin-badge-success">${this._escape(d.gatewayProcessStatus)}</span></span>
                  <span class="admin-property-label">Control Plane:</span>
                  <span class="admin-property-value">${d.controlPlaneConnected ? '<span class="admin-badge admin-badge-success">Connected</span>' : '<span class="admin-badge admin-badge-danger">Disconnected</span>'}</span>
                  <span class="admin-property-label">In-Memory Sockets:</span>
                  <span class="admin-property-value"><strong>${d.activeConnectionCount}</strong></span>
                  <span class="admin-property-label">In-Memory Devices:</span>
                  <span class="admin-property-value"><strong>${d.inMemoryConnectedDevices}</strong></span>
                </div>
              </div>

              <div class="admin-card">
                <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Connection State Distribution</h3>
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                  <span class="admin-badge admin-badge-success">CONNECTED: ${d.connectionStateDistribution?.CONNECTED || 0}</span>
                  <span class="admin-badge admin-badge-neutral">DISCONNECTED: ${d.connectionStateDistribution?.DISCONNECTED || 0}</span>
                  <span class="admin-badge admin-badge-warning">CONNECTING: ${d.connectionStateDistribution?.CONNECTING || 0}</span>
                  <span class="admin-badge admin-badge-danger">FAILED: ${d.connectionStateDistribution?.FAILED || 0}</span>
                </div>
              </div>
            </div>
          `;
        } catch (err) {
          container.innerHTML = `<p style="color:var(--admin-danger);">${this._escape(err.message || 'Failed to load diagnostics')}</p>`;
        }
      } else if (this.gatewayActiveTab === 'connections') {
        container.innerHTML = `
          <div class="admin-table-card">
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Device Name</th>
                    <th>Remote Endpoint</th>
                    <th>Gateway Hostname</th>
                    <th>Status</th>
                    <th>Connected At</th>
                    <th>Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody id="gatewayConnTableBody">
                  <tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading tunnel connections...</td></tr>
                </tbody>
              </table>
            </div>
            <div id="gatewayConnPaginationBar" class="admin-pagination-bar"></div>
          </div>
        `;
        this.loadGatewayConnections();
      }
    }

    async loadGatewayNodes() {
      const tbody = document.getElementById('gatewayNodeTableBody');
      if (!tbody) return;

      try {
        const res = await window.AdminApi.get(`/admin/operations/gateway/nodes?page=${this.gatewayState.page}&pageSize=${this.gatewayState.pageSize}`);
        const data = res.data;
        this.gatewayState.items = data.items || [];
        this.gatewayState.total = data.total || 0;

        if (this.gatewayState.items.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">No gateway nodes registered.</td></tr>`;
          return;
        }

        const canDrain = window.AdminAuth.hasPermission('gateway.drain');
        const canWrite = window.AdminAuth.hasPermission('gateway.write');

        tbody.innerHTML = this.gatewayState.items.map(n => `
          <tr>
            <td>
              <strong style="color:var(--admin-text-primary);">${this._escape(n.hostname)}</strong>
              <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(n.id)}</div>
            </td>
            <td>${this._escape(n.region || 'Global')}</td>
            <td>${this._renderStatusBadge(n.status)}</td>
            <td><strong>${n.activeConnectionCount}</strong></td>
            <td>${n.totalConnectionCount}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt).toLocaleString() : 'Never'}</td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectGatewayNode('${n.id}')" title="Inspect node">
                  ${ICONS.eye} Inspect
                </button>
                ${canDrain && n.status !== 'MAINTENANCE' ? `
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.confirmDrainGatewayNode('${n.id}', '${this._escape(n.hostname)}')" title="Drain node">
                    Drain
                  </button>
                ` : ''}
                ${canWrite && (n.status === 'MAINTENANCE' || n.status === 'INACTIVE') ? `
                  <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminShell.confirmRestoreGatewayNode('${n.id}', '${this._escape(n.hostname)}')" title="Restore node">
                    Restore
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');

        this._renderPagination('gatewayNodePaginationBar', this.gatewayState, (p) => { this.gatewayState.page = p; this.loadGatewayNodes(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load gateway nodes')}</td></tr>`;
      }
    }

    async inspectGatewayNode(nodeId) {
      try {
        const res = await window.AdminApi.get(`/admin/operations/gateway/nodes/${nodeId}`);
        const node = res.data.node;

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Node Metadata</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Node ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(node.id)}</code></span>
              <span class="admin-property-label">Hostname:</span>
              <span class="admin-property-value"><strong>${this._escape(node.hostname)}</strong></span>
              <span class="admin-property-label">Region:</span>
              <span class="admin-property-value">${this._escape(node.region || 'Global')}</span>
              <span class="admin-property-label">Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(node.status)}</span>
              <span class="admin-property-label">Active Tunnels:</span>
              <span class="admin-property-value"><strong>${node.activeConnectionCount}</strong> active</span>
              <span class="admin-property-label">Heartbeat Age:</span>
              <span class="admin-property-value">${node.health.lastHeartbeatAgeSeconds !== null ? `${node.health.lastHeartbeatAgeSeconds}s ago` : 'None'}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Active Device Connections (${node.activeConnections.length})</div>
            ${node.activeConnections.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${node.activeConnections.map(c => `
                  <div style="background:var(--admin-bg-base);padding:0.75rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong style="color:var(--admin-text-primary);font-size:0.875rem;">${this._escape(c.deviceName)}</strong>
                      <div style="font-size:0.75rem;color:var(--admin-text-muted);"><code class="admin-code-pill">${this._escape(c.remoteEndpoint || '—')}</code></div>
                    </div>
                    ${this._renderStatusBadge(c.status)}
                  </div>
                `).join('')}
              </div>
            ` : '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No active device connections on this node.</p>'}
          </div>
        `;

        this._showDrawer(`Gateway Node: ${node.hostname}`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect gateway node', 'danger');
      }
    }

    confirmDrainGatewayNode(nodeId, hostname) {
      this.showConfirmModal({
        title: 'Drain Gateway Node',
        message: `Draining gateway node <strong>${this._escape(hostname)}</strong> will place it into MAINTENANCE mode and evict all active client tunnel connections.`,
        warningText: 'Active proxy traffic on this specific node will be disconnected.',
        confirmLabel: 'Drain Node',
        confirmType: 'danger',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/gateway/nodes/${nodeId}/drain`, { reason });
          this.toast(`Gateway node '${hostname}' drained successfully.`, 'success');
          this.loadGatewayNodes();
        }
      });
    }

    confirmRestoreGatewayNode(nodeId, hostname) {
      this.showConfirmModal({
        title: 'Restore Gateway Node',
        message: `Restore gateway node <strong>${this._escape(hostname)}</strong> back to ACTIVE status?`,
        confirmLabel: 'Restore Node',
        confirmType: 'primary',
        requireReason: true,
        onConfirm: async (reason) => {
          await window.AdminApi.post(`/admin/operations/gateway/nodes/${nodeId}/restore`, { reason });
          this.toast(`Gateway node '${hostname}' restored successfully.`, 'success');
          this.loadGatewayNodes();
        }
      });
    }

    async loadGatewayConnections() {
      const tbody = document.getElementById('gatewayConnTableBody');
      if (!tbody) return;

      try {
        const res = await window.AdminApi.get(`/admin/operations/gateway/connections?page=${this.connectionsState.page}&pageSize=${this.connectionsState.pageSize}`);
        const data = res.data;
        this.connectionsState.items = data.items || [];
        this.connectionsState.total = data.total || 0;

        if (this.connectionsState.items.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">No connection records found.</td></tr>`;
          return;
        }

        tbody.innerHTML = this.connectionsState.items.map(c => `
          <tr>
            <td><strong>${this._escape(c.deviceName)}</strong></td>
            <td><code class="admin-code-pill">${this._escape(c.remoteEndpoint || '—')}</code></td>
            <td><span style="color:var(--admin-text-secondary);">${this._escape(c.gatewayHostname || '—')}</span></td>
            <td>${this._renderStatusBadge(c.status)}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${c.connectedAt ? new Date(c.connectedAt).toLocaleString() : '—'}</td>
            <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt).toLocaleString() : '—'}</td>
          </tr>
        `).join('');

        this._renderPagination('gatewayConnPaginationBar', this.connectionsState, (p) => { this.connectionsState.page = p; this.loadGatewayConnections(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load connections')}</td></tr>`;
      }
    }

    /* =========================================================================
       6. ROLES & RBAC MATRIX VIEW
       ========================================================================= */
    _renderRolesView(container) {
      const roles = window.AdminAuth.roles || [];
      const permissions = window.AdminAuth.permissions || [];
      const isSuper = window.AdminAuth.isSuperAdmin;

      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Roles & RBAC Matrix</h1>
            <p>Inspect administrative roles, assignments, and granular security privileges.</p>
          </div>
        </div>

        <div class="admin-grid-2">
          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Assigned Administrative Roles</h3>
            <div style="display:flex;flex-direction:column;gap:0.75rem;">
              ${roles.map(r => {
                const roleName = typeof r === 'string' ? r : (r.name || r.slug || 'ADMIN');
                const roleDesc = typeof r === 'string' ? (r === 'SUPER_ADMIN' ? 'Full administrative authority with unrestricted wildcard access' : 'System administrative role') : (r.description || 'System administrative role');
                const isSuperRole = roleName === 'SUPER_ADMIN' || isSuper;
                return `
                <div style="background:var(--admin-bg-base);padding:0.875rem 1rem;border:1px solid var(--admin-border);border-radius:var(--radius-sm);">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
                    <strong style="font-size:0.9375rem;color:var(--admin-text-primary);">${this._escape(roleName)}</strong>
                    <span class="admin-role-badge ${isSuperRole ? 'super-admin' : ''}">${this._escape(roleName)}</span>
                  </div>
                  <p style="font-size:0.8125rem;color:var(--admin-text-secondary);">${this._escape(roleDesc)}</p>
                </div>
              `;
              }).join('') || '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No explicit roles assigned.</p>'}
            </div>
          </div>

          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Effective Permission Catalog</h3>
            <p style="font-size:0.8125rem;color:var(--admin-text-secondary);margin-bottom:1rem;">
              Total Permissions Granted: <strong>${isSuper ? 'ALL (Wildcard)' : permissions.length}</strong>
            </p>
            <div class="admin-permission-grid">
              ${isSuper
                ? `<span class="admin-perm-tag wildcard">SuperAdmin Wildcard (*) — Full Authority</span>`
                : permissions.map(p => `<span class="admin-perm-tag granted">${ICONS.check} ${this._escape(p)}</span>`).join('')
              }
            </div>
          </div>
        </div>
      `;
    }

    /* =========================================================================
       7. SECURITY AUDIT LOGS VIEW
       ========================================================================= */
    async _renderAuditLogsView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Security Audit Logs</h1>
            <p>Tamper-evident, cryptographically chained event log records and integrity verification.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="verifyChainBtn" onclick="AdminShell.verifyAuditIntegrity()">
              ${ICONS.shield} Verify Integrity Chain
            </button>
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.exportAuditLogs('csv')">
              ${ICONS['file-text']} Export CSV
            </button>
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.loadAuditLogs()">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div id="auditIntegrityBanner" style="display:none;margin-bottom:var(--space-md);"></div>

        <div class="admin-toolbar">
          <div class="admin-toolbar-left">
            <div class="admin-search-wrap">
              ${ICONS.search}
              <input type="text" id="auditSearchInput" class="admin-search-input" placeholder="Search by actor, IP, or metadata..." value="${this._escape(this.auditState.search)}">
            </div>
            <select id="auditActionSelect" class="admin-select">
              <option value="" ${this.auditState.action === '' ? 'selected' : ''}>All Actions</option>
              <option value="USER_LOGIN" ${this.auditState.action === 'USER_LOGIN' ? 'selected' : ''}>USER_LOGIN</option>
              <option value="ADMIN_LOGIN" ${this.auditState.action === 'ADMIN_LOGIN' ? 'selected' : ''}>ADMIN_LOGIN</option>
              <option value="USER_SUSPEND" ${this.auditState.action === 'USER_SUSPEND' ? 'selected' : ''}>USER_SUSPEND</option>
              <option value="USER_ACTIVATE" ${this.auditState.action === 'USER_ACTIVATE' ? 'selected' : ''}>USER_ACTIVATE</option>
              <option value="DEVICE_DEACTIVATE" ${this.auditState.action === 'DEVICE_DEACTIVATE' ? 'selected' : ''}>DEVICE_DEACTIVATE</option>
              <option value="DEVICE_DELETE" ${this.auditState.action === 'DEVICE_DELETE' ? 'selected' : ''}>DEVICE_DELETE</option>
              <option value="SERVER_RESTART" ${this.auditState.action === 'SERVER_RESTART' ? 'selected' : ''}>SERVER_RESTART</option>
              <option value="SERVER_STOP" ${this.auditState.action === 'SERVER_STOP' ? 'selected' : ''}>SERVER_STOP</option>
              <option value="GATEWAY_DRAIN" ${this.auditState.action === 'GATEWAY_DRAIN' ? 'selected' : ''}>GATEWAY_DRAIN</option>
              <option value="GATEWAY_UNDRAIN" ${this.auditState.action === 'GATEWAY_UNDRAIN' ? 'selected' : ''}>GATEWAY_UNDRAIN</option>
              <option value="GATEWAY_SESSION_TERMINATE" ${this.auditState.action === 'GATEWAY_SESSION_TERMINATE' ? 'selected' : ''}>GATEWAY_SESSION_TERMINATE</option>
            </select>
            <select id="auditStatusSelect" class="admin-select">
              <option value="" ${this.auditState.status === '' ? 'selected' : ''}>All Statuses</option>
              <option value="SUCCESS" ${this.auditState.status === 'SUCCESS' ? 'selected' : ''}>SUCCESS</option>
              <option value="FAILED" ${this.auditState.status === 'FAILED' ? 'selected' : ''}>FAILED</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor / Administrator</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>IP Address</th>
                  <th>SHA-256 Integrity</th>
                  <th style="text-align:right;">Details</th>
                </tr>
              </thead>
              <tbody id="auditTableBody">
                <tr><td colspan="7" class="admin-table-loading">Loading security audit records...</td></tr>
              </tbody>
            </table>
          </div>
          <div class="admin-pagination" id="auditPagination"></div>
        </div>
      `;

      const searchInput = document.getElementById('auditSearchInput');
      const actionSelect = document.getElementById('auditActionSelect');
      const statusSelect = document.getElementById('auditStatusSelect');

      let debounceTimer = null;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.auditState.search = e.target.value.trim();
            this.auditState.page = 1;
            this.loadAuditLogs();
          }, 350);
        });
      }

      if (actionSelect) {
        actionSelect.addEventListener('change', (e) => {
          this.auditState.action = e.target.value;
          this.auditState.page = 1;
          this.loadAuditLogs();
        });
      }

      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.auditState.status = e.target.value;
          this.auditState.page = 1;
          this.loadAuditLogs();
        });
      }

      await this.loadAuditLogs();
    }

    async loadAuditLogs() {
      const tbody = document.getElementById('auditTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" class="admin-table-loading">Querying immutable audit records...</td></tr>`;

      try {
        const params = new URLSearchParams({
          page: this.auditState.page,
          limit: this.auditState.limit
        });

        if (this.auditState.search) params.append('search', this.auditState.search);
        if (this.auditState.action) params.append('action', this.auditState.action);
        if (this.auditState.status) params.append('status', this.auditState.status);

        const res = await window.AdminApi.get(`/admin/audit-logs?${params.toString()}`);
        const data = res.data || {};
        const records = data.records || [];
        this.auditState.total = data.total || records.length;
        this.auditState.items = records;

        if (records.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="admin-table-empty">No security audit records match the current filters.</td></tr>`;
          return;
        }

        tbody.innerHTML = records.map(item => {
          const dateStr = new Date(item.createdAt).toLocaleString();
          const actorDisplay = item.admin ? (item.admin.email || item.admin.name || item.admin.id) : (item.adminId || 'System / Anonymous');
          const shortHash = item.hash ? `${item.hash.substring(0, 8)}...${item.hash.substring(item.hash.length - 6)}` : 'GENESIS';
          const isSuccess = item.status === 'SUCCESS';

          return `
            <tr>
              <td style="font-size:0.8125rem;color:var(--admin-text-secondary);">${this._escape(dateStr)}</td>
              <td>
                <div style="font-weight:600;font-size:0.875rem;">${this._escape(actorDisplay)}</div>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);font-family:var(--font-mono);">${this._escape(item.adminId || 'SYSTEM')}</div>
              </td>
              <td><span class="admin-badge admin-badge-info" style="font-family:var(--font-mono);font-size:0.75rem;">${this._escape(item.action)}</span></td>
              <td><span class="admin-badge ${isSuccess ? 'admin-badge-success' : 'admin-badge-danger'}">${this._escape(item.status || 'UNKNOWN')}</span></td>
              <td style="font-family:var(--font-mono);font-size:0.8125rem;">${this._escape(item.ipAddress || '—')}</td>
              <td>
                <span class="admin-badge admin-badge-neutral" style="font-family:var(--font-mono);font-size:0.75rem;" title="${this._escape(item.hash || '')}">
                  ${item.isGenesis ? '🌟 GENESIS' : this._escape(shortHash)}
                </span>
              </td>
              <td style="text-align:right;">
                <button class="admin-btn-icon" onclick="AdminShell.inspectAuditRecord('${this._escape(item.id)}')" title="Inspect Record Payload">
                  ${ICONS.eye}
                </button>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('auditPagination', {
          total: this.auditState.total,
          page: this.auditState.page,
          pageSize: this.auditState.limit
        }, (newPage) => {
          this.auditState.page = newPage;
          this.loadAuditLogs();
        });

      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load audit records')}</td></tr>`;
      }
    }

    inspectAuditRecord(id) {
      const item = this.auditState.items.find(x => x.id === id);
      if (!item) return;

      const dateStr = new Date(item.createdAt).toUTCString();
      const metaPretty = item.metadata ? JSON.stringify(item.metadata, null, 2) : 'No structured metadata recorded.';

      const content = `
        <div style="display:flex;flex-direction:column;gap:1rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0.75rem;border-bottom:1px solid var(--admin-border-subtle);">
            <div>
              <span class="admin-badge admin-badge-info" style="font-family:var(--font-mono);">${this._escape(item.action)}</span>
              <span class="admin-badge ${item.status === 'SUCCESS' ? 'admin-badge-success' : 'admin-badge-danger'}" style="margin-left:0.5rem;">${this._escape(item.status)}</span>
            </div>
            <span style="font-size:0.8125rem;color:var(--admin-text-secondary);">${this._escape(dateStr)}</span>
          </div>

          <div style="display:grid;grid-template-columns:120px 1fr;gap:0.5rem;font-size:0.875rem;">
            <strong style="color:var(--admin-text-secondary);">Record ID:</strong>
            <span style="font-family:var(--font-mono);">${this._escape(item.id)}</span>

            <strong style="color:var(--admin-text-secondary);">Actor Email:</strong>
            <span>${this._escape(item.admin?.email || item.adminId || 'System')}</span>

            <strong style="color:var(--admin-text-secondary);">IP Address:</strong>
            <span style="font-family:var(--font-mono);">${this._escape(item.ipAddress || '—')}</span>

            <strong style="color:var(--admin-text-secondary);">User Agent:</strong>
            <span style="font-size:0.8125rem;color:var(--admin-text-muted);">${this._escape(item.userAgent || '—')}</span>

            <strong style="color:var(--admin-text-secondary);">Previous Hash:</strong>
            <span style="font-family:var(--font-mono);font-size:0.75rem;word-break:break-all;">${this._escape(item.previousHash || 'GENESIS_HASH')}</span>

            <strong style="color:var(--admin-text-secondary);">Record Hash:</strong>
            <span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--admin-primary);word-break:break-all;">${this._escape(item.hash || '—')}</span>
          </div>

          <div>
            <h4 style="font-size:0.875rem;font-weight:700;margin-bottom:0.5rem;color:var(--admin-text-primary);">Sanitized Event Metadata</h4>
            <pre style="background:var(--admin-bg-subtle);padding:0.75rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border-subtle);font-family:var(--font-mono);font-size:0.8125rem;overflow-x:auto;max-height:220px;">${this._escape(metaPretty)}</pre>
          </div>
        </div>
      `;

      this._showDrawer(`Audit Record Details — ${item.action}`, content);
    }

    async verifyAuditIntegrity() {
      const banner = document.getElementById('auditIntegrityBanner');
      const btn = document.getElementById('verifyChainBtn');
      if (btn) btn.disabled = true;

      try {
        this.toast('Executing cryptographic SHA-256 chain verification...', 'info');
        const res = await window.AdminApi.post('/admin/audit-logs/verify-integrity', {});
        const data = res.data || {};

        if (banner) {
          banner.style.display = 'block';
          if (data.isValid) {
            banner.innerHTML = `
              <div style="background:#ecfdf5;border:1px solid #10b981;color:#065f46;padding:0.875rem 1rem;border-radius:var(--radius-sm);display:flex;align-items:center;gap:0.75rem;">
                ${ICONS.shield}
                <div>
                  <strong>Cryptographic Integrity Verified:</strong> All ${data.verifiedRecords || 0} audit records match SHA-256 chain hashes from Genesis root. No tampering detected.
                </div>
              </div>
            `;
            this.toast('Audit log chain integrity is 100% VALID.', 'success');
          } else {
            banner.innerHTML = `
              <div style="background:#fef2f2;border:1px solid #ef4444;color:#991b1b;padding:0.875rem 1rem;border-radius:var(--radius-sm);display:flex;align-items:center;gap:0.75rem;">
                ${ICONS.alert}
                <div>
                  <strong>Integrity Violation Detected:</strong> Audit log hash mismatch found! (${(data.errors || []).join(', ')})
                </div>
              </div>
            `;
            this.toast('Audit log integrity check detected a hash mismatch!', 'danger');
          }
        }
      } catch (err) {
        this.toast(err.message || 'Integrity verification failed', 'danger');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async exportAuditLogs(format = 'csv') {
      try {
        this.toast(`Preparing audit export in ${format.toUpperCase()} format...`, 'info');
        const params = new URLSearchParams({ format });
        if (this.auditState.action) params.append('action', this.auditState.action);
        if (this.auditState.status) params.append('status', this.auditState.status);

        const token = window.AdminAuth.token;
        const res = await fetch(`/api/v1/admin/audit-logs/export?${params.toString()}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!res.ok) {
          throw new Error(`Export failed with HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-export-${Date.now()}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        this.toast('Audit export downloaded successfully.', 'success');
      } catch (err) {
        this.toast(err.message || 'Audit export failed', 'danger');
      }
    }

    /* =========================================================================
       6B. SUBSCRIPTIONS & DUNNING MANAGEMENT VIEW (Phase 9 - Batch 9.2)
       ========================================================================= */
    _renderSubscriptionsView(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div>
            <h1 class="admin-view-title">Subscriptions & Dunning Operations</h1>
            <p class="admin-view-subtitle">Inspect subscription lifecycles, monitor dunning grace periods, diagnose provider sync, and execute safe lifecycle actions.</p>
          </div>
          <div class="admin-view-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" id="refreshSubscriptionsBtn">
              ${ICONS['refresh-cw']} Refresh
            </button>
          </div>
        </div>

        <div class="admin-filter-bar">
          <div class="admin-search-wrap">
            ${ICONS.search}
            <input type="text" id="subscriptionSearchInput" class="admin-search-input" placeholder="Search by email, subscription ID, or customer ID..." value="${this._escape(this.subscriptionState.search)}">
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <select id="subscriptionPlanSelect" class="admin-select">
              <option value="" ${!this.subscriptionState.planCode ? 'selected' : ''}>All Plans</option>
              <option value="FREE" ${this.subscriptionState.planCode === 'FREE' ? 'selected' : ''}>FREE</option>
              <option value="PRO_MONTHLY" ${this.subscriptionState.planCode === 'PRO_MONTHLY' ? 'selected' : ''}>PRO_MONTHLY</option>
              <option value="PRO_YEARLY" ${this.subscriptionState.planCode === 'PRO_YEARLY' ? 'selected' : ''}>PRO_YEARLY</option>
            </select>
            <select id="subscriptionStatusSelect" class="admin-select">
              <option value="" ${!this.subscriptionState.status ? 'selected' : ''}>All Statuses</option>
              <option value="ACTIVE" ${this.subscriptionState.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
              <option value="PAST_DUE" ${this.subscriptionState.status === 'PAST_DUE' ? 'selected' : ''}>PAST_DUE</option>
              <option value="GRACE_PERIOD" ${this.subscriptionState.status === 'GRACE_PERIOD' ? 'selected' : ''}>GRACE_PERIOD</option>
              <option value="CANCELLING" ${this.subscriptionState.status === 'CANCELLING' ? 'selected' : ''}>CANCELLING</option>
              <option value="EXPIRED" ${this.subscriptionState.status === 'EXPIRED' ? 'selected' : ''}>EXPIRED</option>
              <option value="UNPAID" ${this.subscriptionState.status === 'UNPAID' ? 'selected' : ''}>UNPAID</option>
            </select>
          </div>
        </div>

        <div class="admin-table-card">
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Customer / ID</th>
                  <th>Plan & Price</th>
                  <th>Interval</th>
                  <th>Lifecycle Status</th>
                  <th>Dunning & Grace</th>
                  <th>Period End</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="subscriptionTableBody">
                <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading subscriptions...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="subscriptionPaginationBar" class="admin-pagination-bar"></div>
        </div>
      `;

      const searchInput = document.getElementById('subscriptionSearchInput');
      const planSelect = document.getElementById('subscriptionPlanSelect');
      const statusSelect = document.getElementById('subscriptionStatusSelect');
      const refreshBtn = document.getElementById('refreshSubscriptionsBtn');

      let debounceTimer = null;
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.subscriptionState.search = e.target.value.trim();
            this.subscriptionState.page = 1;
            this.loadSubscriptions();
          }, 300);
        });
      }

      if (planSelect) {
        planSelect.addEventListener('change', (e) => {
          this.subscriptionState.planCode = e.target.value;
          this.subscriptionState.page = 1;
          this.loadSubscriptions();
        });
      }

      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.subscriptionState.status = e.target.value;
          this.subscriptionState.page = 1;
          this.loadSubscriptions();
        });
      }

      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.loadSubscriptions());
      }

      this.loadSubscriptions();
    }

    async loadSubscriptions() {
      const tbody = document.getElementById('subscriptionTableBody');
      if (!tbody) return;

      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-text-muted);">Loading subscriptions...</td></tr>`;

      try {
        const queryParams = new URLSearchParams({
          page: this.subscriptionState.page.toString(),
          pageSize: this.subscriptionState.pageSize.toString()
        });
        if (this.subscriptionState.search) queryParams.set('search', this.subscriptionState.search);
        if (this.subscriptionState.status) queryParams.set('status', this.subscriptionState.status);
        if (this.subscriptionState.planCode) queryParams.set('planCode', this.subscriptionState.planCode);

        const res = await window.AdminApi.get(`/admin/operations/billing/subscriptions?${queryParams.toString()}`);
        const data = res.data;
        this.subscriptionState.items = data.items || [];
        this.subscriptionState.total = data.total || 0;

        if (this.subscriptionState.items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7">
                <div class="admin-empty-box">
                  ${ICONS['credit-card']}
                  <div class="admin-empty-title">No subscriptions found</div>
                  <div class="admin-empty-desc">No customer subscriptions matched your query and filter criteria.</div>
                </div>
              </td>
            </tr>
          `;
          this._renderPagination('subscriptionPaginationBar', this.subscriptionState, (p) => { this.subscriptionState.page = p; this.loadSubscriptions(); });
          return;
        }

        const canCancel = window.AdminAuth.hasPermission('billing.write');

        tbody.innerHTML = this.subscriptionState.items.map(s => {
          const isDunning = s.dunningState && s.dunningState.isDunning;
          const graceDays = s.dunningState ? s.dunningState.gracePeriodDaysRemaining : null;
          let dunningBadge = '<span class="admin-badge admin-badge-neutral">Clean</span>';
          if (isDunning) {
            dunningBadge = `<span class="admin-badge admin-badge-warning" title="Dunning Grace Period Active">Grace (${graceDays !== null ? graceDays + 'd' : 'Active'})</span>`;
          } else if (s.status === 'PAST_DUE' || s.status === 'UNPAID') {
            dunningBadge = `<span class="admin-badge admin-badge-danger">Past Due</span>`;
          }

          const priceFormatted = s.price ? `${(s.price / 100).toFixed(2)} ${s.currency}` : '0.00 USD';
          const isCancelActive = s.status === 'ACTIVE' || s.status === 'PAST_DUE' || s.status === 'GRACE_PERIOD';

          return `
            <tr>
              <td>
                <strong style="color:var(--admin-text-primary);">${this._escape(s.userEmail)}</strong>
                <div class="admin-code-pill" style="font-size:0.6875rem;margin-top:2px;">${this._escape(s.id)}</div>
              </td>
              <td>
                <strong>${this._escape(s.planCode)}</strong>
                <div style="font-size:0.75rem;color:var(--admin-text-muted);">${priceFormatted}</div>
              </td>
              <td style="font-size:0.8125rem;">${this._escape(s.billingInterval || 'MONTHLY')}</td>
              <td>
                ${this._renderStatusBadge(s.status)}
                ${s.cancelAtPeriodEnd ? '<div style="font-size:0.6875rem;color:var(--admin-warning);margin-top:2px;">Cancels at term</div>' : ''}
              </td>
              <td>${dunningBadge}</td>
              <td style="font-size:0.8125rem;color:var(--admin-text-muted);">${s.periodEnd ? new Date(s.periodEnd).toLocaleDateString() : '—'}</td>
              <td style="text-align:right;">
                <div style="display:inline-flex;gap:4px;">
                  <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.inspectSubscription('${s.id}')" title="Inspect subscription & dunning lifecycle">
                    ${ICONS.eye} Inspect
                  </button>
                  ${canCancel && isCancelActive ? `
                    <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminShell.showCancelSubscriptionModal('${s.id}', '${this._escape(s.userEmail)}', '${this._escape(s.planCode)}')" title="Cancel subscription">
                      Cancel
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('');

        this._renderPagination('subscriptionPaginationBar', this.subscriptionState, (p) => { this.subscriptionState.page = p; this.loadSubscriptions(); });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--admin-danger);">${this._escape(err.message || 'Failed to load subscriptions')}</td></tr>`;
      }
    }

    async inspectSubscription(subId) {
      try {
        const [subRes, dunningRes, syncRes] = await Promise.all([
          window.AdminApi.get(`/admin/operations/billing/subscriptions/${subId}`),
          window.AdminApi.get(`/admin/operations/billing/subscriptions/${subId}/dunning`).catch(() => ({ data: { dunning: null } })),
          window.AdminApi.get(`/admin/operations/billing/subscriptions/${subId}/provider-sync`).catch(() => ({ data: { sync: null } }))
        ]);

        const sub = subRes.data.subscription;
        const entitlements = subRes.data.localEntitlements || {};
        const dunning = dunningRes.data.dunning;
        const sync = syncRes.data.sync;

        const priceDisplay = sub.price ? `${(sub.price / 100).toFixed(2)} ${sub.currency}` : '0.00';
        const canCancel = window.AdminAuth.hasPermission('billing.write') && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE' || sub.status === 'GRACE_PERIOD');

        const content = `
          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Subscription Overview</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Subscription ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(sub.id)}</code></span>
              <span class="admin-property-label">Customer Email:</span>
              <span class="admin-property-value"><strong>${this._escape(sub.userEmail || (sub.user ? sub.user.email : '—'))}</strong></span>
              <span class="admin-property-label">Customer ID:</span>
              <span class="admin-property-value"><code class="admin-code-pill">${this._escape(sub.userId)}</code></span>
              <span class="admin-property-label">Plan Code:</span>
              <span class="admin-property-value"><strong>${this._escape(sub.planCode)}</strong></span>
              <span class="admin-property-label">Lifecycle Status:</span>
              <span class="admin-property-value">${this._renderStatusBadge(sub.status)}</span>
              <span class="admin-property-label">Price & Interval:</span>
              <span class="admin-property-value">${priceDisplay} / ${this._escape(sub.billingInterval)}</span>
              <span class="admin-property-label">Current Period:</span>
              <span class="admin-property-value">${sub.periodStart ? new Date(sub.periodStart).toLocaleDateString() : '—'} &rarr; ${sub.periodEnd ? new Date(sub.periodEnd).toLocaleDateString() : '—'}</span>
              <span class="admin-property-label">Auto Renewal:</span>
              <span class="admin-property-value">${sub.cancelAtPeriodEnd ? '<span style="color:var(--admin-warning);font-weight:600;">Canceling at period end</span>' : '<span style="color:var(--admin-success);font-weight:600;">Active Auto-Renew</span>'}</span>
              <span class="admin-property-label">Created At:</span>
              <span class="admin-property-value">${new Date(sub.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Effective Entitlements Matrix</div>
            <div class="admin-property-grid">
              <span class="admin-property-label">Plan Tier:</span>
              <span class="admin-property-value"><strong>${this._escape(entitlements.planCode || sub.planCode)}</strong></span>
              <span class="admin-property-label">Max Active Devices:</span>
              <span class="admin-property-value"><strong>${this._escape(entitlements.maxDevices ?? '—')}</strong></span>
              <span class="admin-property-label">Max Storage Quota:</span>
              <span class="admin-property-value"><strong>${this._escape(entitlements.maxStorageGB ? entitlements.maxStorageGB + ' GB' : '—')}</strong></span>
              <span class="admin-property-label">High-Speed Relay:</span>
              <span class="admin-property-value">${entitlements.highSpeedRelay ? '<span class="admin-badge admin-badge-success">Enabled</span>' : '<span class="admin-badge admin-badge-neutral">Standard</span>'}</span>
              <span class="admin-property-label">Priority Support:</span>
              <span class="admin-property-value">${entitlements.prioritySupport ? '<span class="admin-badge admin-badge-success">Yes</span>' : '<span class="admin-badge admin-badge-neutral">Standard</span>'}</span>
            </div>
          </div>

          ${dunning ? `
            <div class="admin-drawer-section">
              <div class="admin-drawer-section-title">Dunning & Grace Period Lifecycle</div>
              <div class="admin-property-grid">
                <span class="admin-property-label">Dunning Active:</span>
                <span class="admin-property-value">${dunning.isDunning ? '<span class="admin-badge admin-badge-warning">Active Grace Period</span>' : '<span class="admin-badge admin-badge-success">Healthy / None</span>'}</span>
                <span class="admin-property-label">Grace Days Remaining:</span>
                <span class="admin-property-value"><strong>${dunning.gracePeriodDaysRemaining !== null ? dunning.gracePeriodDaysRemaining + ' days' : 'N/A'}</strong></span>
                <span class="admin-property-label">Grace Expiry Date:</span>
                <span class="admin-property-value">${dunning.gracePeriodExpiry ? new Date(dunning.gracePeriodExpiry).toLocaleString() : 'N/A'}</span>
                <span class="admin-property-label">Failed Invoices:</span>
                <span class="admin-property-value"><strong>${dunning.failedPaymentCount}</strong></span>
                <span class="admin-property-label">Entitlement Impact:</span>
                <span class="admin-property-value" style="font-size:0.8125rem;">${this._escape(dunning.entitlementConsequence)}</span>
                <span class="admin-property-label">Recommended Triage:</span>
                <span class="admin-property-value" style="font-size:0.8125rem;color:var(--admin-warning);"><strong>${this._escape(dunning.recommendedAction)}</strong></span>
              </div>
            </div>
          ` : ''}

          <div class="admin-drawer-section">
            <div class="admin-drawer-section-title">Payment Provider (Razorpay) State</div>
            ${sync ? `
              <div class="admin-property-grid">
                <span class="admin-property-label">Provider Sub ID:</span>
                <span class="admin-property-value"><code class="admin-code-pill">${this._escape(sync.providerSubscriptionId || 'None')}</code></span>
                <span class="admin-property-label">Provider Status:</span>
                <span class="admin-property-value">${this._escape(sync.providerStatus || 'UNKNOWN')}</span>
                <span class="admin-property-label">State Consistency:</span>
                <span class="admin-property-value">${sync.synced ? '<span class="admin-badge admin-badge-success">In Sync</span>' : '<span class="admin-badge admin-badge-danger">State Mismatch</span>'}</span>
                ${sync.mismatches && sync.mismatches.length > 0 ? `
                  <span class="admin-property-label">Mismatches:</span>
                  <span class="admin-property-value" style="color:var(--admin-danger);font-size:0.8125rem;">${this._escape(sync.mismatches.join('; '))}</span>
                ` : ''}
              </div>
              ${sync.livePayload ? `
                <div style="margin-top:0.75rem;">
                  <span style="font-size:0.75rem;font-weight:600;color:var(--admin-text-muted);display:block;margin-bottom:0.25rem;">Provider Metadata (Sanitized):</span>
                  <pre style="background:var(--admin-bg-base);padding:0.5rem;border-radius:var(--radius-xs);border:1px solid var(--admin-border);font-size:0.75rem;max-height:120px;overflow:auto;margin:0;"><code>${this._escape(JSON.stringify(sync.livePayload, null, 2))}</code></pre>
                </div>
              ` : ''}
            ` : '<p style="color:var(--admin-text-muted);font-size:0.8125rem;">No external payment provider record attached to this subscription.</p>'}
          </div>

          <div class="admin-drawer-section" style="margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap;">
            ${canCancel ? `
              <button class="admin-btn admin-btn-danger" onclick="AdminShell.showCancelSubscriptionModal('${sub.id}', '${this._escape(sub.userEmail || (sub.user ? sub.user.email : ''))}', '${this._escape(sub.planCode)}')">
                Cancel Subscription
              </button>
            ` : ''}
            <button class="admin-btn admin-btn-secondary" onclick="AdminShell.syncProviderSubscription('${sub.id}')">
              ${ICONS['refresh-cw']} Re-check Provider Sync
            </button>
          </div>
        `;

        this._showDrawer(`Subscription: ${sub.planCode} (${sub.id.substring(0, 12)}...)`, content);
      } catch (err) {
        this.toast(err.message || 'Failed to inspect subscription', 'danger');
      }
    }

    showCancelSubscriptionModal(subId, userEmail, currentPlan) {
      const existing = document.getElementById('adminConfirmModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminConfirmModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true" style="max-width:520px;">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">Administrative Subscription Cancellation</h3>
            <button class="admin-btn-icon" id="adminModalCloseBtn" aria-label="Close modal">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <p style="margin-bottom:1rem;font-size:0.875rem;">
              You are initiating an administrative cancellation for account <strong>${this._escape(userEmail)}</strong> (${this._escape(currentPlan)}).
            </p>

            <div style="margin-bottom:1rem;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.5rem;color:var(--admin-text-secondary);">
                Cancellation Enforcement Mode:
              </label>
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                <label style="display:flex;align-items:flex-start;gap:0.5rem;font-size:0.8125rem;cursor:pointer;padding:0.5rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);background:var(--admin-bg-base);">
                  <input type="radio" name="cancelModeRadio" value="PERIOD_END" checked style="margin-top:3px;">
                  <div>
                    <strong>End of Billing Period (Recommended)</strong>
                    <div style="color:var(--admin-text-muted);font-size:0.75rem;">Customer retains entitlements until their paid cycle expires. Auto-renewal is canceled.</div>
                  </div>
                </label>
                <label style="display:flex;align-items:flex-start;gap:0.5rem;font-size:0.8125rem;cursor:pointer;padding:0.5rem;border:1px solid var(--admin-border);border-radius:var(--radius-xs);background:var(--admin-bg-base);">
                  <input type="radio" name="cancelModeRadio" value="IMMEDIATE" style="margin-top:3px;">
                  <div>
                    <strong style="color:var(--admin-danger);">Immediate Revocation</strong>
                    <div style="color:var(--admin-text-muted);font-size:0.75rem;">Cancels subscription instantly, revokes premium quota, and downgrades account to FREE tier.</div>
                  </div>
                </label>
              </div>
            </div>

            <div style="background:var(--admin-warning-subtle);border-left:3px solid var(--admin-warning);padding:0.75rem 1rem;border-radius:var(--radius-xs);margin-bottom:1rem;font-size:0.8125rem;color:var(--admin-warning);">
              <strong>Notice:</strong> This action is recorded in the immutable SHA-256 administrative audit log chain.
            </div>

            <div>
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                Administrative Reason:
              </label>
              <input type="text" id="adminCancelReasonInput" class="admin-search-input" maxlength="255" placeholder="e.g. Customer support request, billing dispute, fraud..." style="padding-left:0.875rem;">
            </div>
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="adminModalCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-danger" id="adminModalConfirmCancelBtn">Confirm Cancellation</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminModalCloseBtn');
      const cancelBtn = document.getElementById('adminModalCancelBtn');
      const confirmBtn = document.getElementById('adminModalConfirmCancelBtn');
      const reasonInput = document.getElementById('adminCancelReasonInput');

      const closeModal = () => backdrop.remove();

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          const selectedMode = document.querySelector('input[name="cancelModeRadio"]:checked')?.value || 'PERIOD_END';
          const reason = reasonInput ? reasonInput.value.trim() : '';

          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Cancelling...';

          try {
            await window.AdminApi.post(`/admin/operations/billing/subscriptions/${subId}/cancel`, {
              mode: selectedMode,
              reason: reason || undefined
            });

            this.toast(`Subscription canceled (${selectedMode}) successfully.`, 'success');
            closeModal();
            this._closeDrawer();
            this.loadSubscriptions();
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Cancellation';
            this.toast(err.message || 'Failed to cancel subscription', 'danger');
          }
        });
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }

    async syncProviderSubscription(subId) {
      try {
        this.toast('Querying live provider synchronization state...', 'info');
        const res = await window.AdminApi.get(`/admin/operations/billing/subscriptions/${subId}/provider-sync`);
        const sync = res.data.sync;
        if (sync.synced) {
          this.toast(`Subscription is in sync with provider (${sync.providerStatus}).`, 'success');
        } else {
          this.toast(`Mismatch detected: ${sync.mismatches ? sync.mismatches.join(', ') : 'Check details'}`, 'warning');
        }
        this.inspectSubscription(subId);
      } catch (err) {
        this.toast(err.message || 'Provider sync check failed', 'danger');
      }
    }

    _renderForbiddenView(item) {
      const contentContainer = document.getElementById('adminViewContainer');
      if (!contentContainer) return;

      contentContainer.innerHTML = `
        <div class="admin-forbidden-box">
          <div class="admin-forbidden-icon">${ICONS.shield}</div>
          <h2 style="font-size:1.5rem;font-weight:700;margin-bottom:0.75rem;color:var(--admin-danger);">403 Access Forbidden</h2>
          <p style="font-size:0.9375rem;color:var(--admin-text-secondary);margin-bottom:1.5rem;line-height:1.6;">
            Your account does not have permission to access <strong>${this._escape(item.label)}</strong>.
          </p>
          <div class="admin-required-perms" style="margin:0 auto 1.5rem auto;max-width:400px;">
            <span><strong>Target Module:</strong> <code>${this._escape(item.id)}</code></span>
            <span><strong>Required Permission:</strong> <code style="color:var(--admin-danger);">${this._escape(item.permission)}</code></span>
          </div>
          <div>
            <a href="#dashboard" class="admin-btn admin-btn-primary admin-btn-sm" style="display:inline-flex;">
              Return to Operations Dashboard
            </a>
          </div>
        </div>
      `;
    }

    /* =========================================================================
       7. REUSABLE UI HELPERS (Modals, Drawers, Badges, Pagination, Toasts)
       ========================================================================= */
    _renderStatusBadge(status) {
      if (!status) return `<span class="admin-badge admin-badge-neutral">UNKNOWN</span>`;
      const s = String(status).toUpperCase();

      if (s === 'ACTIVE' || s === 'ONLINE' || s === 'RUNNING' || s === 'CONNECTED') {
        return `<span class="admin-badge admin-badge-success"><span class="admin-status-dot"></span> ${this._escape(s)}</span>`;
      }
      if (s === 'STARTING' || s === 'CONNECTING' || s === 'RECONNECTING' || s === 'MAINTENANCE') {
        return `<span class="admin-badge admin-badge-warning"><span class="admin-status-dot"></span> ${this._escape(s)}</span>`;
      }
      if (s === 'SUSPENDED' || s === 'OFFLINE' || s === 'STOPPED' || s === 'ERROR' || s === 'FAILED' || s === 'INACTIVE') {
        return `<span class="admin-badge admin-badge-danger"><span class="admin-status-dot"></span> ${this._escape(s)}</span>`;
      }
      return `<span class="admin-badge admin-badge-neutral">${this._escape(s)}</span>`;
    }

    _renderPagination(containerId, state, onPageChange) {
      const el = document.getElementById(containerId);
      if (!el) return;

      const totalPages = Math.ceil(state.total / state.pageSize) || 1;
      const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
      const end = Math.min(state.page * state.pageSize, state.total);

      el.innerHTML = `
        <div>Showing <strong>${start}–${end}</strong> of <strong>${state.total}</strong> results</div>
        <div class="admin-pagination-controls">
          <button class="admin-pagination-btn" ${state.page <= 1 ? 'disabled' : ''} id="${containerId}_prev">Prev</button>
          <span style="padding:0 0.5rem;font-weight:600;">Page ${state.page} of ${totalPages}</span>
          <button class="admin-pagination-btn" ${state.page >= totalPages ? 'disabled' : ''} id="${containerId}_next">Next</button>
        </div>
      `;

      const prevBtn = document.getElementById(`${containerId}_prev`);
      const nextBtn = document.getElementById(`${containerId}_next`);

      if (prevBtn && state.page > 1) {
        prevBtn.addEventListener('click', () => onPageChange(state.page - 1));
      }
      if (nextBtn && state.page < totalPages) {
        nextBtn.addEventListener('click', () => onPageChange(state.page + 1));
      }
    }

    _showDrawer(title, htmlContent) {
      this._closeDrawer();

      const backdrop = document.getElementById('adminDrawerBackdrop');
      const drawer = document.createElement('div');
      drawer.id = 'adminDetailDrawer';
      drawer.className = 'admin-drawer-container';

      drawer.innerHTML = `
        <div class="admin-drawer-header">
          <h2 style="font-size:1.125rem;font-weight:700;color:var(--admin-text-primary);margin:0;">${this._escape(title)}</h2>
          <button class="admin-btn-icon" onclick="AdminShell._closeDrawer()" aria-label="Close drawer">
            ${ICONS.x}
          </button>
        </div>
        <div class="admin-drawer-body">
          ${htmlContent}
        </div>
      `;

      document.body.appendChild(drawer);

      if (backdrop) {
        backdrop.classList.add('active');
        backdrop.onclick = () => this._closeDrawer();
      }

      requestAnimationFrame(() => {
        drawer.classList.add('open');
      });
    }

    _closeDrawer() {
      const drawer = document.getElementById('adminDetailDrawer');
      const backdrop = document.getElementById('adminDrawerBackdrop');
      if (drawer) {
        drawer.classList.remove('open');
        setTimeout(() => drawer.remove(), 200);
      }
      if (backdrop) {
        backdrop.classList.remove('active');
      }
    }

    showConfirmModal({ title, message, warningText, confirmLabel = 'Confirm', confirmType = 'primary', requireReason = false, onConfirm }) {
      const existing = document.getElementById('adminConfirmModalBackdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'adminConfirmModalBackdrop';
      backdrop.className = 'admin-modal-backdrop';

      backdrop.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true">
          <div class="admin-modal-header">
            <h3 class="admin-modal-title">${this._escape(title)}</h3>
            <button class="admin-btn-icon" id="adminModalCloseBtn" aria-label="Close modal">
              ${ICONS.x}
            </button>
          </div>
          <div class="admin-modal-body">
            <p style="margin-bottom:1rem;">${message}</p>
            ${warningText ? `
              <div style="background:var(--admin-warning-subtle);border-left:3px solid var(--admin-warning);padding:0.75rem 1rem;border-radius:var(--radius-xs);margin-bottom:1rem;font-size:0.8125rem;color:var(--admin-warning);">
                <strong>Notice:</strong> ${this._escape(warningText)}
              </div>
            ` : ''}
            ${requireReason ? `
              <div style="margin-top:1rem;">
                <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.375rem;color:var(--admin-text-secondary);">
                  Administrative Reason (Optional):
                </label>
                <input type="text" id="adminModalReasonInput" class="admin-search-input" maxlength="255" placeholder="e.g. Scheduled maintenance, policy compliance..." style="padding-left:0.875rem;">
              </div>
            ` : ''}
          </div>
          <div class="admin-modal-footer">
            <button type="button" class="admin-btn admin-btn-secondary" id="adminModalCancelBtn">Cancel</button>
            <button type="button" class="admin-btn admin-btn-${confirmType}" id="adminModalConfirmBtn">${this._escape(confirmLabel)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const closeBtn = document.getElementById('adminModalCloseBtn');
      const cancelBtn = document.getElementById('adminModalCancelBtn');
      const confirmBtn = document.getElementById('adminModalConfirmBtn');
      const reasonInput = document.getElementById('adminModalReasonInput');

      const closeModal = () => backdrop.remove();

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Processing...';
          const reason = reasonInput ? reasonInput.value.trim() : '';
          try {
            await onConfirm(reason);
            closeModal();
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = confirmLabel;
            this.toast(err.message || 'Operation failed', 'danger');
          }
        });
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });

      window.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
          closeModal();
          window.removeEventListener('keydown', escHandler);
        }
      });
    }

    toast(message, type = 'info', duration = 4000) {
      let container = document.getElementById('adminToastContainer');
      if (!container) {
        container = document.createElement('div');
        container.id = 'adminToastContainer';
        container.className = 'admin-toast-container';
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'System notifications');
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `admin-toast toast-${type}`;
      toast.setAttribute('role', type === 'danger' ? 'alert' : 'status');
      toast.setAttribute('aria-live', type === 'danger' ? 'assertive' : 'polite');
      toast.innerHTML = `<div style="flex:1;">${this._escape(message)}</div>`;

      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        setTimeout(() => toast.remove(), 250);
      }, duration);
    }

    _escape(str) {
      if (!str) return '';
      const p = document.createElement('p');
      p.appendChild(document.createTextNode(String(str)));
      return p.innerHTML;
    }
  }

  window.AdminShell = new AdminShellManager();
})(window);
