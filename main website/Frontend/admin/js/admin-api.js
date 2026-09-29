/**
 * ZDEXCLOUD ADMIN CONTROL PLANE — HTTP API CLIENT
 * Phase 7.4: Admin Layout & UI Foundation
 */

(function (window) {
  'use strict';

  const STORAGE_KEYS = {
    SESSION_TOKEN: 'zdex_admin_session_token',
    ADMIN_USER: 'zdex_admin_user',
    ROLES: 'zdex_admin_roles',
    PERMISSIONS: 'zdex_admin_permissions'
  };

  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const port = typeof window !== 'undefined' ? window.location.port : '';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : '';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || protocol === 'file:' || !host;

  const API_BASE = (isLocal && port !== '4000' && port !== '')
    ? 'http://localhost:4000/api/v1'
    : '/api/v1';

  class AdminApiClient {
    constructor() {
      this.apiBase = API_BASE;
    }

    getToken() {
      try {
        return localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN) || sessionStorage.getItem(STORAGE_KEYS.SESSION_TOKEN) || null;
      } catch {
        return null;
      }
    }

    setToken(token, persistLongTerm = true) {
      try {
        if (persistLongTerm) {
          localStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, token);
          sessionStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
        } else {
          sessionStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, token);
          localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
        }
      } catch (err) {
        console.warn('[AdminApi] Failed to write token to storage:', err);
      }
    }

    clearSession() {
      try {
        localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.ADMIN_USER);
        localStorage.removeItem(STORAGE_KEYS.ROLES);
        localStorage.removeItem(STORAGE_KEYS.PERMISSIONS);
        sessionStorage.clear();
      } catch (err) {
        console.warn('[AdminApi] Failed to clear storage:', err);
      }
    }

    async request(endpoint, options = {}) {
      const url = endpoint.startsWith('http') ? endpoint : `${this.apiBase}${endpoint}`;
      const headers = new Headers(options.headers || {});

      if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }

      const token = this.getToken();
      if (token) {
        headers.set('x-admin-session-token', token);
      }

      const config = {
        ...options,
        headers
      };

      try {
        const response = await fetch(url, config);
        let data = null;
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        if (!response.ok) {
          // Handle 401 Unauthorized -> Force redirect to login
          if (response.status === 401) {
            this.clearSession();
            if (!window.location.pathname.includes('/admin/login')) {
              window.location.href = `/admin/login.html?reason=session_expired&redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`;
            }
            throw {
              status: 401,
              code: data?.code || 'UNAUTHORIZED',
              message: data?.message || 'Admin session expired or invalid. Please sign in again.'
            };
          }

          // Handle 403 Forbidden
          if (response.status === 403) {
            throw {
              status: 403,
              code: data?.code || 'FORBIDDEN',
              message: data?.message || 'You do not possess the required admin permissions for this operation.',
              requiredPermission: data?.requiredPermission || null
            };
          }

          // Handle other HTTP errors
          throw {
            status: response.status,
            code: data?.code || 'API_ERROR',
            message: data?.message || `Request failed with status ${response.status}`,
            data
          };
        }

        return data;
      } catch (err) {
        if (err.status) {
          throw err;
        }
        // Network or fetch crash
        console.error('[AdminApi] Network/CORS error:', err);
        throw {
          status: 0,
          code: 'NETWORK_ERROR',
          message: 'Unable to connect to ZdexCloud Admin server. Please verify your connection.'
        };
      }
    }

    get(endpoint, options = {}) {
      return this.request(endpoint, { ...options, method: 'GET' });
    }

    post(endpoint, body = {}, options = {}) {
      return this.request(endpoint, {
        ...options,
        method: 'POST',
        body: JSON.stringify(body)
      });
    }

    put(endpoint, body = {}, options = {}) {
      return this.request(endpoint, {
        ...options,
        method: 'PUT',
        body: JSON.stringify(body)
      });
    }

    delete(endpoint, options = {}) {
      return this.request(endpoint, { ...options, method: 'DELETE' });
    }
  }

  window.AdminApi = new AdminApiClient();
  window.AdminStorageKeys = STORAGE_KEYS;
})(window);
