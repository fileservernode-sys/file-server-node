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

    // =========================================================================
    // System Management API Methods (Phase 17 Batch 17.1)
    // =========================================================================
    getSystemOverview() {
      return this.get('/admin/system/overview');
    }

    // =========================================================================
    // User & Account Administration API Methods (Phase 17 Batch 17.2)
    // =========================================================================
    getUserMetrics() {
      return this.get('/admin/users/metrics');
    }

    listUsers(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/users${qs ? `?${qs}` : ''}`);
    }

    getUser(userId) {
      return this.get(`/admin/users/${encodeURIComponent(userId)}`);
    }

    suspendUser(userId, reason = '') {
      return this.post(`/admin/users/${encodeURIComponent(userId)}/suspend`, { reason });
    }

    restoreUser(userId, reason = '') {
      return this.post(`/admin/users/${encodeURIComponent(userId)}/restore`, { reason });
    }

    revokeUserSessions(userId, reason = '') {
      return this.post(`/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, { reason });
    }

    // =========================================================================
    // Device & Server Management API Methods (Phase 17 Batch 17.3)
    // =========================================================================
    getDeviceMetrics() {
      return this.get('/admin/devices/metrics');
    }

    listDevices(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/devices${qs ? `?${qs}` : ''}`);
    }

    getDevice(deviceId) {
      return this.get(`/admin/devices/${encodeURIComponent(deviceId)}`);
    }

    disconnectDevice(deviceId, reason = '') {
      return this.post(`/admin/devices/${encodeURIComponent(deviceId)}/disconnect`, { reason });
    }

    getServerMetrics() {
      return this.get('/admin/servers/metrics');
    }

    listServers(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/servers${qs ? `?${qs}` : ''}`);
    }

    getServer(serverId) {
      return this.get(`/admin/servers/${encodeURIComponent(serverId)}`);
    }

    startServer(serverId, reason = '') {
      return this.post(`/admin/servers/${encodeURIComponent(serverId)}/start`, { reason });
    }

    stopServer(serverId, reason = '') {
      return this.post(`/admin/servers/${encodeURIComponent(serverId)}/stop`, { reason });
    }

    restartServer(serverId, reason = '') {
      return this.post(`/admin/servers/${encodeURIComponent(serverId)}/restart`, { reason });
    }

    // =========================================================================
    // Notifications & Communication Management API Methods (Phase 17 Batch 17.4)
    // =========================================================================
    getNotificationMetrics() {
      return this.get('/admin/notifications/metrics');
    }

    listNotifications(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/notifications${qs ? `?${qs}` : ''}`);
    }

    getNotification(notificationId) {
      return this.get(`/admin/notifications/${encodeURIComponent(notificationId)}`);
    }

    listFailedDeliveries(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/notifications/deliveries/failures${qs ? `?${qs}` : ''}`);
    }

    listPushTokens(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/notifications/tokens${qs ? `?${qs}` : ''}`);
    }

    retryNotificationDelivery(deliveryId, reason = '') {
      return this.post(`/admin/notifications/deliveries/${encodeURIComponent(deliveryId)}/retry`, { reason });
    }

    revokePushToken(tokenId, reason = '') {
      return this.post(`/admin/notifications/tokens/${encodeURIComponent(tokenId)}/revoke`, { reason });
    }

    /* =========================================================================
       Phase 17 Batch 17.5: System Logs & Diagnostics API Methods
       ========================================================================= */

    getSystemLogsMetrics() {
      return this.get('/admin/system/logs/metrics');
    }

    listSystemErrors(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/logs/errors${qs ? `?${qs}` : ''}`);
    }

    getSystemErrorDetail(errorId) {
      return this.get(`/admin/system/logs/errors/${encodeURIComponent(errorId)}`);
    }

    listSystemEvents(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/logs/events${qs ? `?${qs}` : ''}`);
    }

    getGatewayDiagnostics(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/logs/gateway${qs ? `?${qs}` : ''}`);
    }

    listSystemIncidents(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/logs/incidents${qs ? `?${qs}` : ''}`);
    }

    async exportSystemLogs(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      const token = window.AdminAuth?.sessionToken || '';
      const response = await fetch(`/api/v1/admin/system/logs/export${qs ? `?${qs}` : ''}`, {
        method: 'GET',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': params.format === 'json' ? 'application/json' : 'text/csv'
        }
      });
      if (!response.ok) {
        throw new Error(`Export failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      let filename = `zdexcloud_system_logs_${params.category || 'errors'}_export.${params.format || 'csv'}`;
      const match = disposition.match(/filename="?([^";]+)"?/i);
      if (match && match[1]) filename = match[1];
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      return { success: true, filename };
    }

    // =========================================================================
    // PHASE 17 BATCH 17.6 — BACKGROUND JOBS & OPERATIONS API
    // =========================================================================

    getBackgroundJobsMetrics() {
      return this.get('/admin/system/jobs/metrics');
    }

    listBackgroundQueues() {
      return this.get('/admin/system/jobs/queues');
    }

    listBackgroundWorkers() {
      return this.get('/admin/system/jobs/workers');
    }

    listBackgroundJobs(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/jobs${qs ? `?${qs}` : ''}`);
    }

    getBackgroundJobDetail(jobId) {
      return this.get(`/admin/system/jobs/${encodeURIComponent(jobId)}`);
    }

    listFailedBackgroundJobs(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/jobs/failed${qs ? `?${qs}` : ''}`);
    }

    retryBackgroundJob(jobId) {
      return this.post(`/admin/system/jobs/${encodeURIComponent(jobId)}/retry`, {});
    }

    async exportBackgroundJobs(params = {}) {
      const token = window.AdminAuth?.sessionToken || '';
      const response = await fetch('/api/v1/admin/system/jobs/export', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
          'Accept': params.format === 'json' ? 'application/json' : 'text/csv'
        },
        body: JSON.stringify(params)
      });
      if (!response.ok) {
        throw new Error(`Export failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      let filename = `zdexcloud_background_jobs_export.${params.format || 'csv'}`;
      const match = disposition.match(/filename="?([^";]+)"?/i);
      if (match && match[1]) filename = match[1];

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      return { success: true, filename };
    }

    // =========================================================================
    // PHASE 17 BATCH 17.7 — SYSTEM CONFIGURATION & FEATURE FLAGS API
    // =========================================================================

    getSystemConfigOverview() {
      return this.get('/admin/system/config');
    }

    listSystemSettings(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/config/settings${qs ? `?${qs}` : ''}`);
    }

    getSystemSettingDetail(key) {
      return this.get(`/admin/system/config/settings/${encodeURIComponent(key)}`);
    }

    updateSystemSetting(key, payload) {
      return this.put(`/admin/system/config/settings/${encodeURIComponent(key)}`, payload);
    }

    listFeatureFlags() {
      return this.get('/admin/system/config/flags');
    }

    updateFeatureFlag(key, payload) {
      return this.put(`/admin/system/config/flags/${encodeURIComponent(key)}`, payload);
    }

    getEnvironmentInventory() {
      return this.get('/admin/system/config/environment');
    }

    // =========================================================================
    // PHASE 17 BATCH 17.8 — SYSTEM SECURITY CONTROLS API
    // =========================================================================

    getSecurityOverview() {
      return this.get('/admin/system/security/overview');
    }

    listAdminSessions(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/security/sessions${qs ? `?${qs}` : ''}`);
    }

    revokeAdminSession(sessionId, reason = 'ADMINISTRATIVE_REVOCATION') {
      return this.post(`/admin/system/security/sessions/${encodeURIComponent(sessionId)}/revoke`, { reason });
    }

    revokeAllAdminSessions(adminId, reason = 'ADMINISTRATIVE_BULK_REVOCATION') {
      return this.post(`/admin/system/security/sessions/admins/${encodeURIComponent(adminId)}/revoke-all`, { reason });
    }

    listAdminLockouts() {
      return this.get('/admin/system/security/lockouts');
    }

    unlockAdminLockout(payload) {
      return this.post('/admin/system/security/lockouts/unlock', payload);
    }

    listSecurityEvents(params = {}) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      return this.get(`/admin/system/security/events${qs ? `?${qs}` : ''}`);
    }

    getSecurityEventDetail(eventId) {
      return this.get(`/admin/system/security/events/${encodeURIComponent(eventId)}`);
    }

    getRbacInventory() {
      return this.get('/admin/system/security/rbac');
    }

    getAdminCredentialPosture() {
      return this.get('/admin/system/security/credentials');
    }
  }

  window.AdminApi = new AdminApiClient();
  window.AdminStorageKeys = STORAGE_KEYS;

})(window);
