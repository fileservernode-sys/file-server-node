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

      this._loadCachedState();
    }

    _loadCachedState() {
      try {
        const storedUser = localStorage.getItem(window.AdminStorageKeys.ADMIN_USER);
        const storedRoles = localStorage.getItem(window.AdminStorageKeys.ROLES);
        const storedPerms = localStorage.getItem(window.AdminStorageKeys.PERMISSIONS);

        if (storedUser) this.currentUser = JSON.parse(storedUser);
        if (storedRoles) this.roles = JSON.parse(storedRoles);
        if (storedPerms) this.permissions = JSON.parse(storedPerms);

        this.isSuperAdmin = this.permissions.includes('*') || this.roles.some(r => r.name === 'SUPER_ADMIN' || r.code === 'SUPER_ADMIN');
      } catch (err) {
        console.warn('[AdminAuth] Error loading cached state:', err);
      }
    }

    _saveState(user, roles, permissions) {
      this.currentUser = user;
      this.roles = roles || [];
      this.permissions = permissions || [];
      this.isSuperAdmin = this.permissions.includes('*') || this.roles.some(r => r.name === 'SUPER_ADMIN' || r.code === 'SUPER_ADMIN');

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
      return Boolean(this.api.getToken());
    }

    async login(email, password) {
      const response = await this.api.post('/admin/auth/login', { email, password });
      
      // If 2FA OTP is required by the backend
      if (response.requiresOtp || response.data?.requiresOtp) {
        return {
          requiresOtp: true,
          email: response.email || response.data?.email || email,
          message: response.message || response.data?.message || '2FA OTP challenge required.'
        };
      }

      // If token is returned directly
      const token = response.token || response.data?.token;
      if (token) {
        this.api.setToken(token);
        await this.fetchMe();
      }

      return response;
    }

    async verifyOtp(email, otpCode) {
      const response = await this.api.post('/admin/auth/verify-otp', { email, otpCode });
      const token = response.token || response.data?.token;
      
      if (!token) {
        throw {
          status: 400,
          code: 'INVALID_RESPONSE',
          message: 'Server did not return a valid admin session token.'
        };
      }

      this.api.setToken(token);
      await this.fetchMe();
      return response;
    }

    async fetchMe() {
      try {
        const response = await this.api.get('/admin/auth/me');
        const adminData = response.data || response;

        const user = {
          id: adminData.id,
          email: adminData.email,
          fullName: adminData.fullName,
          status: adminData.status,
          createdAt: adminData.createdAt
        };

        const roles = adminData.roles || [];
        const permissions = adminData.permissions || [];

        this._saveState(user, roles, permissions);
        this.isInitialized = true;
        return adminData;
      } catch (err) {
        this.isInitialized = true;
        throw err;
      }
    }

    async logout() {
      try {
        if (this.isAuthenticated()) {
          await this.api.post('/admin/auth/logout', {});
        }
      } catch (err) {
        console.warn('[AdminAuth] Logout request completed with error:', err);
      } finally {
        this.api.clearSession();
        this.currentUser = null;
        this.roles = [];
        this.permissions = [];
        this.isSuperAdmin = false;
        this._notify();
        window.location.href = '/admin/login.html';
      }
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
      if (!this.isAuthenticated()) {
        const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        window.location.href = `/admin/login.html?redirect=${redirectUrl}`;
        return false;
      }

      try {
        await this.fetchMe();
        return true;
      } catch (err) {
        console.error('[AdminAuth] Auth guard verification failed:', err);
        return false;
      }
    }
  }

  window.AdminAuth = new AdminAuthService();
})(window);

