/**
 * ViewDuration Embedded File Manager API Adapter
 *
 * This replaces the original api.js for the embedded file manager context.
 * Instead of calling local 127.0.0.1:8080 or raw gateway WebSocket,
 * all requests go through the authenticated ViewDuration backend:
 *   /api/v1/file-manager/<serverId>/<operation>
 *
 * The ViewDuration Bearer token is automatically included.
 * The serverId is read from the URL query param ?server=<serverId>.
 */

// ---------------------------------------------------------------------------
// Configuration — resolved once on page load
// ---------------------------------------------------------------------------
const EmbeddedFileManager = {
  serverId: null,
  viewDurationToken: null,
  fileServerToken: null,
  serverName: null,
  adminUsername: null,
  online: false,

  // Resolve the API base URL: same-origin in production, localhost in dev
  getApiBase() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:4000/api/v1';
    }
    return '/api/v1';
  },

  init() {
    // Read serverId from URL
    const params = new URLSearchParams(window.location.search);
    this.serverId = params.get('server');

    // Read ViewDuration auth token from localStorage (same key as auth.js)
    this.viewDurationToken = localStorage.getItem('rn_auth_token');

    return !!this.serverId && !!this.viewDurationToken;
  },

  // Build request headers with ViewDuration Bearer token
  getHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (this.viewDurationToken) {
      headers['Authorization'] = `Bearer ${this.viewDurationToken}`;
    }
    return headers;
  },

  // Build file-manager API URL for a given sub-path
  url(subPath) {
    return `${this.getApiBase()}/file-manager/${this.serverId}/${subPath}`;
  }
};

// ---------------------------------------------------------------------------
// EmbeddedApiAdapter — drop-in replacement for ApiService / LocalApiAdapter
// ---------------------------------------------------------------------------
const ApiService = {

  // Always false — we never use the raw remote WebSocket in embedded mode
  isRemoteMode() {
    return false;
  },

  onStatusChange(callback) {
    // No-op in embedded mode (status shown via ViewDuration UI)
  },

  async checkHealth() {
    try {
      const res = await fetch(EmbeddedFileManager.url('access'), {
        headers: EmbeddedFileManager.getHeaders()
      });
      const data = await res.json();
      return { status: data?.data?.online ? 'ok' : 'offline', ...data };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  },

  async getStorageStats() {
    try {
      const res = await fetch(EmbeddedFileManager.url('storage'), {
        headers: EmbeddedFileManager.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async getRecentFiles() {
    try {
      const res = await fetch(EmbeddedFileManager.url('files/recent'), {
        headers: EmbeddedFileManager.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async getPhotos() {
    try {
      const res = await fetch(`${EmbeddedFileManager.url('files')}?type=photos`, {
        headers: EmbeddedFileManager.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async getVideos() {
    try {
      const res = await fetch(`${EmbeddedFileManager.url('files')}?type=videos`, {
        headers: EmbeddedFileManager.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async listFiles(path = '/', typeFilter = null) {
    try {
      const encodedPath = encodeURIComponent(path);
      const query = typeFilter
        ? `path=${encodedPath}&type=${encodeURIComponent(typeFilter)}`
        : `path=${encodedPath}`;
      const res = await fetch(`${EmbeddedFileManager.url('files')}?${query}`, {
        headers: EmbeddedFileManager.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async createFolder(parentPath, folderName) {
    try {
      const res = await fetch(EmbeddedFileManager.url('folders'), {
        method: 'POST',
        headers: EmbeddedFileManager.getHeaders(),
        body: JSON.stringify({ path: parentPath, name: folderName })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async renameItem(oldPath, newName) {
    try {
      const res = await fetch(EmbeddedFileManager.url('rename'), {
        method: 'POST',
        headers: EmbeddedFileManager.getHeaders(),
        body: JSON.stringify({ oldPath, newName })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async deleteItem(itemPath) {
    try {
      const res = await fetch(EmbeddedFileManager.url('files'), {
        method: 'DELETE',
        headers: EmbeddedFileManager.getHeaders(),
        body: JSON.stringify({ path: itemPath })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async uploadFile(targetPath, fileObject) {
    // Initiate upload through authenticated backend proxy
    // The backend proxies the upload command to the Android device via gateway
    try {
      const res = await fetch(EmbeddedFileManager.url('upload'), {
        method: 'POST',
        headers: EmbeddedFileManager.getHeaders(),
        body: JSON.stringify({ path: targetPath, name: fileObject.name })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  cancelTransfer(transferId, reason) {
    // No-op in embedded HTTP mode — streaming handled by gateway
  },

  getDownloadUrl(filePath) {
    // Build the authenticated download URL via the ViewDuration backend proxy
    const token = EmbeddedFileManager.viewDurationToken || '';
    const base = EmbeddedFileManager.getApiBase();
    const sid = EmbeddedFileManager.serverId;
    return `${base}/file-manager/${sid}/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  }
};

// ---------------------------------------------------------------------------
// File Server Auth — adapted for embedded mode
// Credentials are for the Android file server, NOT the ViewDuration account.
// The login request is proxied through ViewDuration to Android.
// ---------------------------------------------------------------------------
const FileServerAuth = {
  TOKEN_KEY: 'rn_file_server_token',

  getToken() {
    return sessionStorage.getItem(this.TOKEN_KEY);
  },

  setToken(token) {
    // Use sessionStorage (not localStorage) — token is per-session only
    sessionStorage.setItem(this.TOKEN_KEY, token);
  },

  logout() {
    sessionStorage.removeItem(this.TOKEN_KEY);
    window.location.reload();
  },

  isAuthenticated() {
    const token = this.getToken();
    return !!token && token.length > 5;
  },

  async login(username, password) {
    try {
      const base = EmbeddedFileManager.getApiBase();
      const sid = EmbeddedFileManager.serverId;
      const viewDurationToken = EmbeddedFileManager.viewDurationToken;

      // POST to ViewDuration backend — NOT directly to 127.0.0.1:8080
      const res = await fetch(`${base}/file-manager/${sid}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${viewDurationToken}`
        },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if ((res.ok || data.success) && data.data?.token) {
        this.setToken(data.data.token);
        return { success: true };
      }
      return {
        success: false,
        error: data.error?.message || data.data?.error?.message || 'Invalid file-server credentials'
      };
    } catch (e) {
      return { success: false, error: e.message || 'Connection error' };
    }
  }
};

// ---------------------------------------------------------------------------
// Override handleFileServerLogin to use embedded context
// ---------------------------------------------------------------------------
async function handleFileServerLogin() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorAlert = document.getElementById('login-error-alert');
  const submitBtn = document.getElementById('btn-login-submit');

  if (!usernameInput || !passwordInput) return;

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Authenticating...';
  }
  if (errorAlert) errorAlert.style.display = 'none';

  const result = await FileServerAuth.login(username, password);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In to Storage';
  }

  if (result.success) {
    const overlay = document.getElementById('file-server-login-overlay');
    if (overlay) overlay.style.display = 'none';
    AppRouter.init();
    MyFilesController.init();
  } else {
    if (errorAlert) {
      errorAlert.textContent = result.error;
      errorAlert.style.display = 'block';
    }
  }
}
