/**
 * ZDEXCLOUD ADMIN CONTROL PLANE — HTTP API CLIENT
 * Phase 7.4: Admin Layout & UI Foundation
 */

(function (window) {
  'use strict';

  const STORAGE_KEYS = {
    ADMIN_USER: 'zdex_admin_user',
    ROLES: 'zdex_admin_roles',
    PERMISSIONS: 'zdex_admin_permissions'
  };

  const LEGACY_ADMIN_STORAGE_KEYS = [
    'zdex_admin_session_token',
    'zdex_admin_token',
    'admin_session_token',
    'admin_token',
    'adminToken',
    'sessionToken',
    'token',
    'accessToken',
    'x-admin-session-token'
  ];

  // Clean up legacy client-side admin credential keys immediately on script evaluation
  function cleanupLegacyAdminStorage() {
    if (typeof localStorage !== 'undefined') {
      for (const key of LEGACY_ADMIN_STORAGE_KEYS) {
        try {
          localStorage.removeItem(key);
        } catch (_) {}
      }
    }
    if (typeof sessionStorage !== 'undefined') {
      for (const key of LEGACY_ADMIN_STORAGE_KEYS) {
        try {
          sessionStorage.removeItem(key);
        } catch (_) {}
      }
    }
  }
  cleanupLegacyAdminStorage();

  let _inMemoryCsrfToken = null;

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

    getCsrfToken() {
      return _inMemoryCsrfToken;
    }

    setCsrfToken(token) {
      _inMemoryCsrfToken = token || null;
    }

    // Legacy compatibility no-op stubs to prevent third-party crashes
    getToken() {
      return null;
    }

    setToken(token, persistLongTerm = true) {
      cleanupLegacyAdminStorage();
    }

    clearSession() {
      _inMemoryCsrfToken = null;
      cleanupLegacyAdminStorage();
      try {
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

      // Attach In-Memory Anti-CSRF Token for state-changing browser mutations
      const method = (options.method || 'GET').toUpperCase();
      const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      if (isStateChanging && _inMemoryCsrfToken && !headers.has('x-zdex-csrf-token')) {
        headers.set('x-zdex-csrf-token', _inMemoryCsrfToken);
      }

      const config = {
        ...options,
        headers,
        credentials: 'include' // Enforce HttpOnly __Host-zdex_admin_session cookie transmission
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

    // =========================================================================
    // Email Operations & Analytics API Methods (Phase 13.3, 13.4, 13.11)
    // =========================================================================
    getEmailAnalytics(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/emails/analytics${qs ? `?${qs}` : ''}`);
    }

    listEmails(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/emails${qs ? `?${qs}` : ''}`);
    }

    getEmail(emailId) {
      return this.get(`/admin/emails/${encodeURIComponent(emailId)}`);
    }

    getEmailAttempts(emailId) {
      return this.get(`/admin/emails/${encodeURIComponent(emailId)}/attempts`);
    }

    getUserEmailHistory(userId, params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/users/${encodeURIComponent(userId)}/emails${qs ? `?${qs}` : ''}`);
    }

    getEmailRetentionMetrics() {
      return this.get('/admin/emails/retention');
    }

    // =========================================================================
    // SQL Query Runner API Methods (Phase 15.1, 15.6 & 15.7)
    // =========================================================================
    executeSqlQuery(sql) {
      return this.post('/admin/sql/query', { sql });
    }

    executeControlledWriteQuery(sql, confirmed = true) {
      return this.post('/admin/sql/write', { sql, confirmed });
    }

    executeDestructiveQuery(sql, confirmed = true) {
      return this.post('/admin/sql/destructive', { sql, confirmed });
    }

    // =========================================================================
    // Database Management API Methods (Phase 15 Batch 15.1)
    // =========================================================================
    getDatabaseOverview() {
      return this.get('/admin/database/overview');
    }

    getDatabaseTables() {
      return this.get('/admin/database/tables');
    }

    getTableDetails(tableName) {
      return this.get(`/admin/database/tables/${encodeURIComponent(tableName)}`);
    }

    getTablePreview(tableName, params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/database/tables/${encodeURIComponent(tableName)}/preview${qs ? `?${qs}` : ''}`);
    }

    getTableRows(tableName, params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          if (key === 'filters' && Array.isArray(value)) {
            searchParams.append('filters', JSON.stringify(value));
          } else {
            searchParams.append(key, String(value));
          }
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/database/tables/${encodeURIComponent(tableName)}/rows${qs ? `?${qs}` : ''}`);
    }

    insertTableRow(tableName, values = {}) {
      return this.post(`/admin/database/tables/${encodeURIComponent(tableName)}/rows`, { values });
    }

    updateTableRow(tableName, payload = {}) {
      return this.put(`/admin/database/tables/${encodeURIComponent(tableName)}/rows`, payload);
    }

    deleteTableRow(tableName, primaryKey = {}) {
      return this.request(`/admin/database/tables/${encodeURIComponent(tableName)}/rows`, {
        method: 'DELETE',
        body: JSON.stringify({ primaryKey })
      });
    }

    bulkDeleteTableRows(tableName, rows = []) {
      return this.request(`/admin/database/tables/${encodeURIComponent(tableName)}/bulk-rows`, {
        method: 'DELETE',
        body: JSON.stringify({ rows })
      });
    }

    bulkEditTableRows(tableName, { rows = [], values = {} } = {}) {
      return this.post(`/admin/database/tables/${encodeURIComponent(tableName)}/rows/bulk-edit`, { rows, values });
    }

    duplicateTableRow(tableName, { primaryKey = {}, overrides = {} } = {}) {
      return this.post(`/admin/database/tables/${encodeURIComponent(tableName)}/rows/duplicate`, { primaryKey, overrides });
    }
  }

  window.AdminApi = new AdminApiClient();
  window.AdminStorageKeys = STORAGE_KEYS;

})(window);
