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

  function getCalculatedApiBase() {
    if (typeof window === 'undefined') return '/api/v1';
    const host = window.location.hostname;
    const port = window.location.port;
    const protocol = window.location.protocol;

    // 1. Direct local backend on port 4000
    if (port === '4000') {
      return '/api/v1';
    }

    // 2. Local development (Live Server, port 8080, 5500, 3000, file://, etc.)
    if (host === 'localhost' || host === '127.0.0.1' || protocol === 'file:' || !host) {
      return 'http://localhost:4000/api/v1';
    }

    // 3. Subdomains that serve the API directly
    if (host === 'api.zdexcloud.com' || host === 'gateway.zdexcloud.com') {
      return '/api/v1';
    }

    // 4. Production web frontend on zdexcloud.com / www.zdexcloud.com
    return 'https://api.zdexcloud.com/api/v1';
  }

  const API_BASE = getCalculatedApiBase();

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
          const reqId = data?.error?.requestId || response.headers.get('x-request-id') || null;
          const errCode = data?.error?.code || data?.code || 'API_ERROR';
          const errMsg = data?.error?.message || data?.message || `Request failed with status ${response.status}`;

          // Handle 401 Unauthorized -> Force redirect to login
          if (response.status === 401) {
            this.clearSession();
            if (!window.location.pathname.includes('/admin/login')) {
              window.location.href = `/admin/login.html?reason=session_expired&redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`;
            }
            throw {
              status: 401,
              code: errCode || 'UNAUTHORIZED',
              message: errMsg || 'Admin session expired or invalid. Please sign in again.',
              requestId: reqId
            };
          }

          // Handle 403 Forbidden
          if (response.status === 403) {
            throw {
              status: 403,
              code: errCode || 'FORBIDDEN',
              message: errMsg || 'You do not possess the required admin permissions for this operation.',
              requiredPermission: data?.requiredPermission || null,
              requestId: reqId
            };
          }

          // Handle other HTTP errors
          throw {
            status: response.status,
            code: errCode,
            message: errMsg,
            requestId: reqId,
            data
          };
        }

        return data;
      } catch (err) {
        if (err.status !== undefined) {
          throw err;
        }
        // Network or fetch crash
        console.error('[AdminApi] Network/CORS error:', err);
        throw {
          status: 0,
          code: 'NETWORK_ERROR',
          message: 'Unable to connect to ZdexCloud Admin server. Please verify your connection.',
          requestId: null
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

    // =========================================================================
    // Error Center API Methods (Phase 12.5 & Phase 12.6)
    // =========================================================================
    listErrorIncidents(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/errors/incidents${qs ? `?${qs}` : ''}`);
    }

    getErrorIncident(incidentId) {
      return this.get(`/admin/errors/incidents/${encodeURIComponent(incidentId)}`);
    }

    getErrorOccurrence(occurrenceId) {
      return this.get(`/admin/errors/occurrences/${encodeURIComponent(occurrenceId)}`);
    }

    getErrorFingerprint(fingerprintId) {
      return this.get(`/admin/errors/fingerprints/${encodeURIComponent(fingerprintId)}`);
    }

    acknowledgeErrorIncident(incidentId) {
      return this.post(`/admin/errors/incidents/${encodeURIComponent(incidentId)}/acknowledge`, {});
    }

    resolveErrorIncident(incidentId, body = {}) {
      return this.post(`/admin/errors/incidents/${encodeURIComponent(incidentId)}/resolve`, body);
    }

    muteErrorIncident(incidentId, body = {}) {
      return this.post(`/admin/errors/incidents/${encodeURIComponent(incidentId)}/mute`, body);
    }

    unmuteErrorIncident(incidentId) {
      return this.post(`/admin/errors/incidents/${encodeURIComponent(incidentId)}/unmute`, {});
    }
  }

  window.AdminApi = new AdminApiClient();
  window.AdminStorageKeys = STORAGE_KEYS;
})(window);
