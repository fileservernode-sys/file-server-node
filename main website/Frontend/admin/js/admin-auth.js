/**
 * ZDEXCLOUD ADMIN CONTROL PLANE — AUTH & PERMISSION SERVICE
 * Phase 7.4: Admin Layout & UI Foundation
 */

(function (window) {
  'use strict';

  class AdminAuthService {
    constructor() {
      this.api = window.AdminApi;
      this.currentUser = null;
      this.roles = [];
      this.permissions = [];
      this.isSuperAdmin = false;
      this.isInitialized = false;
      this._subscribers = [];
      this._initPromise = null;
      this._broadcastChannel = null;

      this._setupMultiTabSync();
      this._loadCachedState();
    }

    _setupMultiTabSync() {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        try {
          this._broadcastChannel = new BroadcastChannel('zdexcloud_admin_auth_channel');
          this._broadcastChannel.onmessage = (event) => {
            if (event.data?.type === 'ADMIN_LOGGED_OUT') {
              this.currentUser = null;
              this.roles = [];
              this.permissions = [];
              this.isSuperAdmin = false;
              if (this.api) this.api.clearSession();
              this._notify();
              if (!window.location.pathname.includes('/admin/login')) {
                window.location.href = '/admin/login.html?reason=session_expired';
              }
            } else if (event.data?.type === 'ADMIN_LOGGED_IN') {
              this.initSession(true).catch(() => {});
            }
          };
        } catch (_) {}
      }
    }

    _broadcastEvent(type) {
      if (this._broadcastChannel) {
        try {
          this._broadcastChannel.postMessage({ type, timestamp: Date.now() });
        } catch (_) {}
      }
    }

    _loadCachedState() {
      try {
        const storedUser = localStorage.getItem(window.AdminStorageKeys.ADMIN_USER);
        const storedRoles = localStorage.getItem(window.AdminStorageKeys.ROLES);
        const storedPerms = localStorage.getItem(window.AdminStorageKeys.PERMISSIONS);

        if (storedUser) this.currentUser = JSON.parse(storedUser);
        if (storedRoles) this.roles = JSON.parse(storedRoles);
        if (storedPerms) this.permissions = JSON.parse(storedPerms);

        this.isSuperAdmin = Boolean(this.currentUser?.isSuperAdmin) ||
          this.permissions.includes('*') ||
          this.roles.some(r => r === 'SUPER_ADMIN' || r?.name === 'SUPER_ADMIN' || r?.slug === 'SUPER_ADMIN' || r?.code === 'SUPER_ADMIN');
      } catch (err) {
        console.warn('[AdminAuth] Error loading cached state:', err);
      }
    }

    _saveState(user, roles, permissions) {
      this.currentUser = user;
      this.roles = roles || [];
      this.permissions = permissions || [];
      this.isSuperAdmin = Boolean(user?.isSuperAdmin) ||
        this.permissions.includes('*') ||
        this.roles.some(r => r === 'SUPER_ADMIN' || r?.name === 'SUPER_ADMIN' || r?.slug === 'SUPER_ADMIN' || r?.code === 'SUPER_ADMIN');

      try {
        localStorage.setItem(window.AdminStorageKeys.ADMIN_USER, JSON.stringify(this.currentUser));
        localStorage.setItem(window.AdminStorageKeys.ROLES, JSON.stringify(this.roles));
        localStorage.setItem(window.AdminStorageKeys.PERMISSIONS, JSON.stringify(this.permissions));
      } catch (err) {
        console.warn('[AdminAuth] Error saving state to storage:', err);
      }

      this._notify();
    }

    subscribe(callback) {
      this._subscribers.push(callback);
      return () => {
        this._subscribers = this._subscribers.filter(cb => cb !== callback);
      };
    }

    _notify() {
      for (const cb of this._subscribers) {
        try {
          cb({
            user: this.currentUser,
            roles: this.roles,
            permissions: this.permissions,
            isSuperAdmin: this.isSuperAdmin
          });
        } catch (e) {
          console.error('[AdminAuth] Subscriber callback error:', e);
        }
      }
    }

    isAuthenticated() {
      return Boolean(this.currentUser);
    }

    async initSession(forceRefresh = false) {
      if (this._initPromise && !forceRefresh) {
        return this._initPromise;
      }

      this._initPromise = (async () => {
        try {
          const rawAdmin = await this.fetchMe();
          this.isInitialized = true;
          return {
            authenticated: true,
            user: this.currentUser,
            roles: this.roles,
            permissions: this.permissions
          };
        } catch (err) {
          this.currentUser = null;
          this.roles = [];
          this.permissions = [];
          this.isSuperAdmin = false;
          this.isInitialized = true;
          if (this.api) this.api.clearSession();
          return {
            authenticated: false,
            user: null,
            roles: [],
            permissions: []
          };
        } finally {
          this._initPromise = null;
        }
      })();

      return this._initPromise;
    }

    async login(email, password) {
      const response = await this.api.post('/admin/auth/login', { email, password });
      const data = response.data || response;
      
      // If 2FA OTP is required by the backend
      if (data.requiresOtp || response.requiresOtp) {
        return {
          requiresOtp: true,
          challengeToken: data.challengeToken || response.challengeToken,
          email: data.email || response.email || email,
          message: data.message || response.message || '2FA OTP challenge required.'
        };
      }

      // Store in-memory CSRF token if returned
      const csrfToken = data.csrfToken || response.csrfToken;
      if (csrfToken && this.api) {
        this.api.setCsrfToken(csrfToken);
      }

      await this.fetchMe();
      this._broadcastEvent('ADMIN_LOGGED_IN');

      return data;
    }

    async verifyOtp(challengeTokenOrEmail, otpCode, challengeTokenOverride) {
      const challengeToken = challengeTokenOverride || challengeTokenOrEmail;
      const response = await this.api.post('/admin/auth/verify-otp', {
        challengeToken: challengeToken,
        otp: otpCode
      });
      const data = response.data || response;

      // Store in-memory CSRF token if returned
      const csrfToken = data.csrfToken || response.csrfToken;
      if (csrfToken && this.api) {
        this.api.setCsrfToken(csrfToken);
      }

      await this.fetchMe();
      this._broadcastEvent('ADMIN_LOGGED_IN');

      return data;
    }

    async fetchMe() {
      try {
        const response = await this.api.get('/admin/auth/me');
        const rootData = response.data || response;
        const rawAdmin = rootData.admin || rootData;

        // Capture in-memory CSRF token from /admin/auth/me response
        const csrfToken = rootData.csrfToken || response.csrfToken;
        if (csrfToken && this.api) {
          this.api.setCsrfToken(csrfToken);
        }

        const user = {
          id: rawAdmin.id,
          email: rawAdmin.email,
          name: rawAdmin.name || rawAdmin.fullName,
          fullName: rawAdmin.name || rawAdmin.fullName,
          status: rawAdmin.status,
          isSuperAdmin: Boolean(rawAdmin.isSuperAdmin),
          createdAt: rawAdmin.createdAt
        };

        const roles = rawAdmin.roles || [];
        const permissions = rawAdmin.permissions || [];

        this._saveState(user, roles, permissions);
        this.isInitialized = true;
        return rawAdmin;
      } catch (err) {
        this.isInitialized = true;
        throw err;
      }
    }

    async logout() {
      try {
        await this.api.post('/admin/auth/logout', {});
      } catch (err) {
        console.warn('[AdminAuth] Logout request completed with error:', err);
      } finally {
        if (this.api) this.api.clearSession();
        this.currentUser = null;
        this.roles = [];
        this.permissions = [];
        this.isSuperAdmin = false;
        this._broadcastEvent('ADMIN_LOGGED_OUT');
        this._notify();
        window.location.href = '/admin/login.html';
      }
    }

    async fetchWithAuth(url, options = {}) {
      return this.api.request(url, options);
    }

    hasPermission(permission) {
      if (this.isSuperAdmin || this.permissions.includes('*')) {
        return true;
      }
      return this.permissions.includes(permission);
    }

    hasAnyPermission(permissions = []) {
      if (this.isSuperAdmin || this.permissions.includes('*')) {
        return true;
      }
      if (!Array.isArray(permissions) || permissions.length === 0) return true;
      return permissions.some(perm => this.permissions.includes(perm));
    }

    hasAllPermissions(permissions = []) {
      if (this.isSuperAdmin || this.permissions.includes('*')) {
        return true;
      }
      if (!Array.isArray(permissions) || permissions.length === 0) return true;
      return permissions.every(perm => this.permissions.includes(perm));
    }

    getSafeRedirect(rawTarget, fallback = '/admin/') {
      if (!rawTarget || typeof rawTarget !== 'string') return fallback;
      let target = rawTarget.trim();
      if (!target || target.length > 2048) return fallback;

      for (let i = 0; i < 2; i++) {
        try {
          if (target.includes('%')) {
            target = decodeURIComponent(target);
          }
        } catch (e) {
          return fallback;
        }
      }

      target = target.trim();

      // Disallow external schemes, javascript, data, vbscript
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return fallback;
      // Disallow protocol-relative and backslash variants
      if (target.startsWith('//') || target.startsWith('\\') || target.startsWith('/\\') || target.startsWith('\\/')) return fallback;
      if (target.includes('\\') || target.includes('@') || /[\r\n\t\0]/.test(target)) return fallback;

      // Allow approved internal admin routes
      if (/^\/admin(\/([a-zA-Z0-9_.-]+)?)?([?#].*)?$/.test(target)) {
        return target;
      }
      if (/^#([a-zA-Z0-9_\-\/]+)$/.test(target)) {
        return '/admin/' + target;
      }
      if (/^index\.html(#.*)?$/.test(target)) {
        return '/admin/' + target;
      }

      return fallback;
    }

    async requireAuthGuard() {
      const authResult = await this.initSession();
      if (!authResult.authenticated) {
        const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        window.location.href = `/admin/login.html?redirect=${redirectUrl}`;
        return false;
      }
      return true;
    }
  }

  window.AdminAuth = new AdminAuthService();
})(window);


