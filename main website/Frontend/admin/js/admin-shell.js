/**
 * ZDEXCLOUD ADMIN CONTROL PLANE — SPA SHELL & UI MANAGER
 * Phase 7.4: Admin Layout & UI Foundation
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
          permission: null // Available to all authenticated admins
        }
      ]
    },
    {
      group: 'Users & Nodes',
      items: [
        {
          id: 'customers',
          label: 'Customer Directory',
          icon: 'users',
          permission: 'users.read',
          stage: 'Phase 8+'
        },
        {
          id: 'devices',
          label: 'Devices & Nodes',
          icon: 'server',
          permission: 'devices.read',
          stage: 'Phase 9+'
        },
        {
          id: 'storage',
          label: 'Storage Quotas',
          icon: 'hard-drive',
          permission: 'storage.read',
          stage: 'Phase 10+'
        }
      ]
    },
    {
      group: 'Billing & Revenue',
      items: [
        {
          id: 'subscriptions',
          label: 'Subscriptions',
          icon: 'credit-card',
          permission: 'billing.read',
          stage: 'Phase 11+'
        },
        {
          id: 'transactions',
          label: 'Transactions & Invoices',
          icon: 'receipt',
          permission: 'billing.read',
          stage: 'Phase 11+'
        },
        {
          id: 'reconciliation',
          label: 'Reconciliation Center',
          icon: 'refresh-cw',
          permission: 'billing.reconcile',
          stage: 'Phase 7.2G'
        },
        {
          id: 'plans',
          label: 'Plan Catalog',
          icon: 'package',
          permission: 'plans.read',
          stage: 'Phase 12+'
        }
      ]
    },
    {
      group: 'Operations & Systems',
      items: [
        {
          id: 'gateway',
          label: 'Gateway & Relays',
          icon: 'radio',
          permission: 'gateway.read',
          stage: 'Phase 13+'
        },
        {
          id: 'webhooks',
          label: 'Webhooks Explorer',
          icon: 'webhook',
          permission: 'webhooks.read',
          stage: 'Phase 14+'
        },
        {
          id: 'jobs',
          label: 'Background Jobs',
          icon: 'cpu',
          permission: 'jobs.read',
          stage: 'Phase 15+'
        },
        {
          id: 'metrics',
          label: 'Health & Metrics',
          icon: 'activity',
          permission: 'metrics.read',
          stage: 'Phase 15+'
        }
      ]
    },
    {
      group: 'Security & Access',
      items: [
        {
          id: 'admin-users',
          label: 'Admin Directory',
          icon: 'user-check',
          permission: 'admin_users.read',
          stage: 'Phase 16+'
        },
        {
          id: 'admin-roles',
          label: 'Roles & RBAC Matrix',
          icon: 'shield',
          permission: 'admin_roles.read',
          stage: 'Phase 7.3'
        },
        {
          id: 'audit-logs',
          label: 'Security Audit Logs',
          icon: 'file-text',
          permission: 'audit.read',
          stage: 'Phase 7.5'
        },
        {
          id: 'settings',
          label: 'System Settings',
          icon: 'settings',
          permission: 'settings.read',
          stage: 'Phase 16+'
        }
      ]
    }
  ];

  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>',
    'hard-drive': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>',
    'credit-card': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/></svg>',
    'refresh-cw': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
    radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>',
    webhook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c0-2.21 1.79-4 4-4h1a6 6 0 0 1 6-6h1"/><circle cx="6" cy="17" r="1"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/></svg>',
    cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    'user-check': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.8 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    'file-text': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="admin-nav-icon" style="width:14px;height:14px;"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
  };

  class AdminShellManager {
    constructor() {
      this.currentSection = 'dashboard';
      this.idleSecondsRemaining = 900; // 15 mins default
      this.idleTimerInterval = null;
    }

    async init() {
      // 1. Guard check
      const authed = await window.AdminAuth.requireAuthGuard();
      if (!authed) return;

      // 2. Setup UI
      this._renderHeaderProfile();
      this._renderSidebar();
      this._bindEventListeners();
      this._startIdleCountdown();

      // 3. Handle Initial Route
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

      const primaryRole = roles[0]?.name || (window.AdminAuth.isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN');
      const sidebarRoleEl = document.getElementById('adminSidebarRole');
      if (sidebarRoleEl) sidebarRoleEl.textContent = primaryRole;

      const dropdownNameEl = document.getElementById('adminDropdownName');
      if (dropdownNameEl) dropdownNameEl.textContent = user.fullName || 'Admin User';

      const dropdownEmailEl = document.getElementById('adminDropdownEmail');
      if (dropdownEmailEl) dropdownEmailEl.textContent = user.email;

      const rolesContainer = document.getElementById('adminDropdownRoles');
      if (rolesContainer) {
        rolesContainer.innerHTML = roles.map(r => `
          <span class="admin-role-badge ${r.name === 'SUPER_ADMIN' ? 'super-admin' : ''}">
            ${this._escape(r.name)}
          </span>
        `).join('') || '<span class="admin-role-badge">ADMIN</span>';
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
                ${item.stage ? `<span class="admin-nav-badge">${item.stage}</span>` : ''}
              </a>
            `;
          } else {
            // Render restricted item with lock
            html += `
              <div class="admin-nav-item restricted" title="Requires permission: ${item.permission}" data-restricted-perm="${item.permission}">
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
      // Hash change listener
      window.addEventListener('hashchange', () => this._handleHashRoute());

      // Profile menu toggle
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

      // Logout buttons
      const logoutBtns = document.querySelectorAll('[data-action="logout"]');
      logoutBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          btn.disabled = true;
          this.toast('Signing out of ZdexCloud Operations...', 'info');
          await window.AdminAuth.logout();
        });
      });

      // Mobile Drawer Toggle
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

      // User interaction resets idle timer
      const resetActivity = () => {
        this.idleSecondsRemaining = 900; // Reset to 15m
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
      const hash = window.location.hash.replace('#', '').trim() || 'dashboard';
      this.currentSection = hash;

      // 1. Update active sidebar item
      const navItems = document.querySelectorAll('.admin-nav-item[data-id]');
      navItems.forEach(el => {
        if (el.getAttribute('data-id') === hash) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });

      // 2. Find matching schema item
      let currentItem = null;
      let currentGroup = null;

      for (const group of NAV_SCHEMA) {
        for (const item of group.items) {
          if (item.id === hash) {
            currentItem = item;
            currentGroup = group;
            break;
          }
        }
        if (currentItem) break;
      }

      // Update Breadcrumbs
      const breadcrumbGroup = document.getElementById('adminBreadcrumbGroup');
      const breadcrumbItem = document.getElementById('adminBreadcrumbCurrent');
      if (breadcrumbGroup && breadcrumbItem) {
        breadcrumbGroup.textContent = currentGroup ? currentGroup.group : 'Overview';
        breadcrumbItem.textContent = currentItem ? currentItem.label : 'Dashboard';
      }

      // 3. Permission Check
      if (currentItem && currentItem.permission && !window.AdminAuth.hasPermission(currentItem.permission)) {
        this._renderForbiddenView(currentItem);
        return;
      }

      // 4. Render Active View
      this._renderView(hash, currentItem);
    }

    _renderView(sectionId, item) {
      const contentContainer = document.getElementById('adminViewContainer');
      if (!contentContainer) return;

      if (sectionId === 'dashboard') {
        this._renderDashboardView(contentContainer);
      } else if (sectionId === 'admin-roles') {
        this._renderRolesView(contentContainer);
      } else if (sectionId === 'reconciliation') {
        this._renderReconciliationPlaceholder(contentContainer);
      } else {
        this._renderModulePlaceholder(contentContainer, item || { id: sectionId, label: sectionId, stage: 'Under Construction' });
      }
    }

    _renderDashboardView(container) {
      const user = window.AdminAuth.currentUser || {};
      const roles = window.AdminAuth.roles || [];
      const permissions = window.AdminAuth.permissions || [];
      const isSuper = window.AdminAuth.isSuperAdmin;

      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Operations Overview</h1>
            <p>Real-time health, operational control plane, and administrative governance.</p>
          </div>
          <div class="admin-header-actions">
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="AdminShell.refreshDashboard()">
              ${ICONS['refresh-cw']} Refresh State
            </button>
          </div>
        </div>

        <div class="admin-grid-4">
          <div class="admin-card">
            <div class="admin-stat-label">
              <span>Admin Identity</span>
              <span class="admin-env-dot" style="color:var(--admin-success)"></span>
            </div>
            <div class="admin-stat-value" style="font-size:1.15rem;font-weight:600;">${this._escape(user.email || 'Authenticated')}</div>
            <div class="admin-stat-subtext">Status: <strong style="color:var(--admin-success)">${this._escape(user.status || 'ACTIVE')}</strong></div>
          </div>

          <div class="admin-card">
            <div class="admin-stat-label">
              <span>Authorization Level</span>
              <span class="admin-role-badge ${isSuper ? 'super-admin' : ''}">${isSuper ? 'SUPER_ADMIN' : 'ROLE_BASED'}</span>
            </div>
            <div class="admin-stat-value">${roles.length} Active Role${roles.length === 1 ? '' : 's'}</div>
            <div class="admin-stat-subtext">${roles.map(r => r.name).join(', ') || 'Direct Admin'}</div>
          </div>

          <div class="admin-card">
            <div class="admin-stat-label">
              <span>Resolved Permissions</span>
              <span style="color:var(--admin-primary)">${permissions.length} Grants</span>
            </div>
            <div class="admin-stat-value">${isSuper ? 'Wildcard (*)' : permissions.length}</div>
            <div class="admin-stat-subtext">Enforced via RBAC Middleware</div>
          </div>

          <div class="admin-card">
            <div class="admin-stat-label">
              <span>Session Isolation</span>
              <span class="admin-env-dot" style="color:var(--admin-primary)"></span>
            </div>
            <div class="admin-stat-value" style="font-size:1.15rem;color:var(--admin-primary)">100% Isolated</div>
            <div class="admin-stat-subtext">Customer/Admin Separation Active</div>
          </div>
        </div>

        <div class="admin-grid-2">
          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:0.75rem;">Your Effective Permissions</h3>
            <p style="font-size:0.8125rem;color:var(--admin-text-secondary);margin-bottom:1rem;">
              These permissions govern your access across API endpoints and control plane modules.
            </p>
            <div class="admin-permission-grid">
              ${isSuper 
                ? '<span class="admin-perm-tag wildcard">★ SuperAdmin Wildcard (*) — Full Operational Authority</span>' 
                : permissions.map(p => `<span class="admin-perm-tag granted">✓ ${this._escape(p)}</span>`).join('')
              }
            </div>
          </div>

          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:0.75rem;">Phase 7 Implementation Status</h3>
            <p style="font-size:0.8125rem;color:var(--admin-text-secondary);margin-bottom:1rem;">
              Admin Operations Architecture Certification Roadmap:
            </p>
            <ul style="list-style:none;font-size:0.8125rem;line-height:2;">
              <li><strong style="color:var(--admin-success)">✓ Phase 7.1:</strong> Admin Architecture Audit (Passed)</li>
              <li><strong style="color:var(--admin-success)">✓ Phase 7.2:</strong> Admin Auth & Session Foundation (Passed)</li>
              <li><strong style="color:var(--admin-success)">✓ Phase 7.3:</strong> Admin Role-Based Access Control / RBAC (Passed)</li>
              <li><strong style="color:var(--admin-primary)">● Phase 7.4:</strong> Admin Layout & UI Foundation (Active)</li>
              <li><strong style="color:var(--admin-text-muted)">○ Phase 7.5:</strong> Admin Security Foundation (Next)</li>
            </ul>
          </div>
        </div>
      `;
    }

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
              ${roles.map(r => `
                <div style="background:var(--admin-bg-base);padding:0.875rem 1rem;border:1px solid var(--admin-border);border-radius:var(--border-radius-md);">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
                    <strong style="font-size:0.9375rem;color:var(--admin-text-primary);">${this._escape(r.name)}</strong>
                    <span class="admin-role-badge ${r.name === 'SUPER_ADMIN' ? 'super-admin' : ''}">${this._escape(r.code || r.name)}</span>
                  </div>
                  <p style="font-size:0.8125rem;color:var(--admin-text-secondary);">${this._escape(r.description || 'System administrative role')}</p>
                </div>
              `).join('') || '<p style="color:var(--admin-text-muted);font-size:0.875rem;">No explicit roles assigned.</p>'}
            </div>
          </div>

          <div class="admin-card">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Effective Permission Catalog</h3>
            <p style="font-size:0.8125rem;color:var(--admin-text-secondary);margin-bottom:1rem;">
              Total Permissions Granted: <strong>${isSuper ? 'ALL (Wildcard)' : permissions.length}</strong>
            </p>
            <div class="admin-permission-grid">
              ${isSuper
                ? '<span class="admin-perm-tag wildcard">★ Wildcard All (*) — Unlimited System Capabilities</span>'
                : permissions.map(p => `<span class="admin-perm-tag granted">${this._escape(p)}</span>`).join('')
              }
            </div>
          </div>
        </div>
      `;
    }

    _renderReconciliationPlaceholder(container) {
      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>Reconciliation Center</h1>
            <p>Phase 7.2G Production Billing Operations & Discrepancy Control Plane.</p>
          </div>
        </div>

        <div class="admin-placeholder-box">
          <div class="admin-placeholder-icon">
            ${ICONS['refresh-cw']}
          </div>
          <h2 class="admin-placeholder-title">Reconciliation Operations Control Plane</h2>
          <p class="admin-placeholder-desc">
            The underlying reconciliation services, webhook replays, discrepancy resolvers, and audit logging are fully certified in Phase 7.2F & 7.2G.
            The dedicated interactive operator workspace is mapped directly into this UI shell.
          </p>
          <div class="admin-required-perms">
            <span><strong>Required Authority:</strong> <code>billing.reconcile</code></span>
            <span><strong>Service Bridge:</strong> <code>/api/v1/admin/reconciliation/*</code></span>
          </div>
        </div>
      `;
    }

    _renderModulePlaceholder(container, item) {
      const iconSvg = ICONS[item.icon] || ICONS.dashboard;

      container.innerHTML = `
        <div class="admin-view-header">
          <div class="admin-view-title-wrap">
            <h1>${this._escape(item.label)}</h1>
            <p>Control plane module scheduled in the ZdexCloud Admin roadmap (${this._escape(item.stage || 'Future Phase')}).</p>
          </div>
        </div>

        <div class="admin-placeholder-box">
          <div class="admin-placeholder-icon">
            ${iconSvg}
          </div>
          <h2 class="admin-placeholder-title">${this._escape(item.label)} Module</h2>
          <p class="admin-placeholder-desc">
            This operational module is part of the scheduled Admin Control Plane roadmap (${this._escape(item.stage || 'Future Phase')}).
            The foundational UI shell, navigation framework, authorization guards, and theme tokens are certified and active.
          </p>
          <div class="admin-required-perms">
            <span><strong>Module Identifier:</strong> <code>${this._escape(item.id)}</code></span>
            <span><strong>Required Permission:</strong> <code>${this._escape(item.permission || 'Authenticated')}</code></span>
            <span><strong>Security Isolation:</strong> Enforced by Phase 7.3 RBAC Kernel</span>
          </div>
        </div>
      `;
    }

    _renderForbiddenView(item) {
      const contentContainer = document.getElementById('adminViewContainer');
      if (!contentContainer) return;

      contentContainer.innerHTML = `
        <div class="admin-forbidden-box">
          <div class="admin-forbidden-icon">
            ${ICONS.shield}
          </div>
          <h2 style="font-size:1.5rem;font-weight:700;margin-bottom:0.75rem;color:var(--admin-danger);">403 Access Forbidden</h2>
          <p style="font-size:0.9375rem;color:var(--admin-text-secondary);margin-bottom:1.5rem;line-height:1.6;">
            Your current administrative account does not have sufficient privileges to access <strong>${this._escape(item.label)}</strong>.
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

    refreshDashboard() {
      this.toast('Refreshing admin identity and operational status...', 'info');
      window.AdminAuth.fetchMe()
        .then(() => {
          this._renderHeaderProfile();
          this._renderSidebar();
          this._renderDashboardView(document.getElementById('adminViewContainer'));
          this.toast('Admin operational status refreshed.', 'success');
        })
        .catch(err => {
          this.toast(err.message || 'Failed to refresh admin status', 'danger');
        });
    }

    toast(message, type = 'info', duration = 4000) {
      let container = document.getElementById('adminToastContainer');
      if (!container) {
        container = document.createElement('div');
        container.id = 'adminToastContainer';
        container.className = 'admin-toast-container';
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `admin-toast toast-${type}`;
      toast.innerHTML = `
        <div style="flex:1;">${this._escape(message)}</div>
      `;

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
