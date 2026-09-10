/**
 * ZdexCloud Embedded File Manager API Adapter
 *
 * This replaces the original api.js for the embedded file manager context.
 * Instead of calling local 127.0.0.1:8080 or raw gateway WebSocket,
 * all requests go through the authenticated ZdexCloud backend:
 *   /api/v1/file-manager/<serverId>/<operation>
 *
 * The ZdexCloud Bearer token is automatically included.
 * The serverId is read from the URL query param ?server=<serverId>.
 */

// ---------------------------------------------------------------------------
// Configuration — resolved once on page load
// ---------------------------------------------------------------------------
const EmbeddedFileManager = {
  serverId: null,
  zdexCloudToken: null,
  fileServerToken: null,
  serverName: null,
  adminUsername: null,
  online: false,

  // Resolve the API base URL: canonical production endpoint or local dev
  getApiBase() {
    if (typeof window !== 'undefined' && window.API_BASE_URL) {
      return window.API_BASE_URL;
    }
    if (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.API_BASE_URL) {
      return window.CONFIG.API_BASE_URL;
    }
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    const protocol = typeof window !== 'undefined' ? window.location.protocol : '';
    if (host === 'localhost' || host === '127.0.0.1' || protocol === 'file:' || !host) {
      return 'http://localhost:4000/api/v1';
    }
    if (host === 'gateway.zdexcloud.com' || host === 'api.zdexcloud.com') {
      return '/api/v1';
    }
    return 'https://api.zdexcloud.com/api/v1';
  },

  init() {
    // Read serverId from URL (support ?server=, ?id=, ?serverId=)
    const params = new URLSearchParams(window.location.search);
    this.serverId = params.get('server') || params.get('id') || params.get('serverId');

    // Read ZdexCloud auth token from localStorage / AuthService
    this.zdexCloudToken = localStorage.getItem('zdexcloud_token') || 
                          localStorage.getItem('rn_auth_token') || 
                          (typeof AuthService !== 'undefined' ? AuthService.getAuthToken() : null) || 
                          localStorage.getItem('token');

    return !!this.serverId && !!this.zdexCloudToken;
  },

  // Build request headers with ZdexCloud Bearer token
  getHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = this.zdexCloudToken || 
                  (typeof AuthService !== 'undefined' ? AuthService.getAuthToken() : null) || 
                  localStorage.getItem('zdexcloud_token') || 
                  localStorage.getItem('rn_auth_token') || 
                  localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
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
    // No-op in embedded mode (status shown via ZdexCloud UI)
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
        body: JSON.stringify({ path: parentPath || '/', name: folderName })
      });
      const data = await res.json();
      if (!res.ok && data.success === undefined) {
        data.success = false;
      }
      return data;
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

  async uploadFile(targetPath, fileObject, onProgress) {
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result === 'string') {
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve(base64);
          } else {
            reject(new Error('Failed to read file buffer'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file from disk'));
        reader.readAsDataURL(fileObject);
      });

      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        const uploadUrl = EmbeddedFileManager.url('upload');
        xhr.open('POST', uploadUrl, true);
        xhr.withCredentials = true;

        const headers = EmbeddedFileManager.getHeaders();
        for (const [k, v] of Object.entries(headers)) {
          xhr.setRequestHeader(k, v);
        }

        if (xhr.upload && typeof onProgress === 'function') {
          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable && evt.total > 0) {
              const percent = Math.round((evt.loaded / evt.total) * 100);
              onProgress(percent);
            }
          };
        }

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(data);
            } else {
              resolve({
                success: false,
                error: {
                  code: data?.error?.code || `HTTP_${xhr.status}`,
                  message: data?.error?.message || `Server responded with status ${xhr.status}`
                }
              });
            }
          } catch (err) {
            resolve({
              success: false,
              error: {
                message: xhr.status === 404
                  ? 'Upload endpoint not found (404).'
                  : `Server communication error (${xhr.status || 'invalid response'}).`
              }
            });
          }
        };

        xhr.onerror = () => {
          resolve({ success: false, error: { message: 'Network connection error during upload.' } });
        };

        xhr.ontimeout = () => {
          resolve({ success: false, error: { message: 'Upload transfer timed out.' } });
        };

        xhr.timeout = 180000;

        const normalizedPath = (!targetPath || targetPath === '') ? '/' : targetPath;
        xhr.send(JSON.stringify({
          path: normalizedPath,
          name: fileObject.name,
          dataBase64: dataBase64
        }));
      });
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  cancelTransfer(transferId, reason) {
    // No-op in embedded HTTP mode — streaming handled by gateway
  },

  getDownloadUrl(filePath) {
    // Build the authenticated download URL via the ZdexCloud backend proxy
    const token = EmbeddedFileManager.zdexCloudToken || '';
    const base = EmbeddedFileManager.getApiBase();
    const sid = EmbeddedFileManager.serverId;
    return `${base}/file-manager/${sid}/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  }
};

// ---------------------------------------------------------------------------
// File Server Auth — integrated with ZdexCloud account authentication
// Single Sign-On: The authenticated ZdexCloud account is used directly.
// No secondary username/password prompt is presented to the user.
// ---------------------------------------------------------------------------
const FileServerAuth = {
  TOKEN_KEY: 'rn_auth_token',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY) || EmbeddedFileManager.zdexCloudToken;
  },

  setToken(token) {
    // Session managed via ZdexCloud auth
  },

  logout() {
    if (window.AuthService && window.AuthService.logoutUser) {
      window.AuthService.logoutUser();
    } else {
      localStorage.removeItem('rn_auth_token');
      localStorage.removeItem('rn_user_data');
      window.location.href = 'login.html';
    }
  },

  isAuthenticated() {
    const token = this.getToken();
    return !!token && token.length > 5;
  },

  async login(username, password) {
    return { success: true };
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

// Expose globally on window for embedded consumers
if (typeof window !== 'undefined') {
  window.EmbeddedFileManager = EmbeddedFileManager;
  window.ApiService = ApiService;
  window.FileServerAuth = FileServerAuth;
}

