/**
 * RemoteNode File Manager API Client — Dual LOCAL & REMOTE Mode Adapter Architecture
 * 
 * LOCAL Mode: Communicates directly via HTTP fetch to http://127.0.0.1:8080/api/*
 * REMOTE Mode: Communicates via Gateway WebSocket transport proxy using correlated FILE_REQUEST / FILE_RESPONSE messages.
 */

// Local HTTP API Adapter
const LocalApiAdapter = {
  baseUrl: '/api',

  getHeaders(extra = {}) {
    const headers = { ...extra };
    const token = typeof FileServerAuth !== 'undefined' ? FileServerAuth.getToken() : null;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return await res.json();
    } catch (e) {
      return { status: 'error', message: 'Local server unreachable' };
    }
  },

  async getStorageStats() {
    try {
      const res = await fetch(`${this.baseUrl}/storage`, {
        headers: this.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async getRecentFiles() {
    try {
      const res = await fetch(`${this.baseUrl}/files/recent`, {
        headers: this.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async getPhotos() {
    try {
      const res = await fetch(`${this.baseUrl}/files?type=photos`, {
        headers: this.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async getVideos() {
    try {
      const res = await fetch(`${this.baseUrl}/files?type=videos`, {
        headers: this.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async listFiles(path = '/', typeFilter = null) {
    try {
      const encodedPath = encodeURIComponent(path);
      const query = typeFilter ? `path=${encodedPath}&type=${encodeURIComponent(typeFilter)}` : `path=${encodedPath}`;
      const res = await fetch(`${this.baseUrl}/files?${query}`, {
        headers: this.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async createFolder(parentPath, folderName) {
    try {
      const res = await fetch(`${this.baseUrl}/folders`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: parentPath, name: folderName })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async renameItem(oldPath, newName) {
    try {
      const res = await fetch(`${this.baseUrl}/rename`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ oldPath, newName })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async deleteItem(itemPath) {
    try {
      const res = await fetch(`${this.baseUrl}/files`, {
        method: 'DELETE',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: itemPath })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async uploadFile(targetPath, fileObject) {
    try {
      const encodedPath = encodeURIComponent(targetPath);
      const encodedFilename = encodeURIComponent(fileObject.name);
      const res = await fetch(`${this.baseUrl}/upload?path=${encodedPath}&filename=${encodedFilename}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: fileObject
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  getDownloadUrl(filePath) {
    const token = typeof FileServerAuth !== 'undefined' ? FileServerAuth.getToken() : '';
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    return `${this.baseUrl}/download?path=${encodeURIComponent(filePath)}${tokenParam}`;
  }
};

// Remote Gateway Transport API Adapter
const RemoteApiAdapter = {
  socket: null,
  pendingPromises: new Map(),
  statusListeners: [],
  connectionId: 'demo-remote-conn',

  onStatusChange(callback) {
    this.statusListeners.push(callback);
  },

  notifyStatus(status, details = {}) {
    this.statusListeners.forEach(cb => {
      try { cb(status, details); } catch {}
    });
  },

  async ensureConnected() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;

    return new Promise((resolve) => {
      const isSecure = window.location.protocol === 'https:';
      const wsProtocol = isSecure ? 'wss:' : 'ws:';
      const wsHost = window.location.hostname || 'localhost';
      const wsPort = isSecure ? (window.location.port || '') : ':4001';
      const wsUrl = `${wsProtocol}//${wsHost}${wsPort ? wsPort : ''}`;

      try {
        this.socket = new WebSocket(wsUrl);

        this.socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'FILE_RESPONSE' && msg.requestId) {
              const resolver = this.pendingPromises.get(msg.requestId);
              if (resolver) {
                resolver(msg);
                this.pendingPromises.delete(msg.requestId);
              }
            } else if (msg.type === 'ERROR' && msg.code === 'RATE_LIMIT_EXCEEDED') {
              this.notifyStatus('rate_limited', { message: msg.message });
            }
          } catch (e) {
            // Ignore malformed payloads
          }
        };

        this.socket.onopen = () => {
          this.notifyStatus('connected');
          resolve();
        };

        this.socket.onerror = () => {
          this.notifyStatus('error');
          resolve();
        };

        this.socket.onclose = () => {
          this.socket = null;
          this.notifyStatus('disconnected');
        };
      } catch (e) {
        this.notifyStatus('error');
        resolve();
      }
    });
  },

  async sendRequest(operation, payload = {}) {
    await this.ensureConnected();
    const requestId = 'req_' + Math.random().toString(36).substring(2, 10);

    return new Promise((resolve) => {
      this.pendingPromises.set(requestId, resolve);

      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        // Fallback to local HTTP adapter if remote gateway socket is unavailable
        if (operation === 'STORAGE') {
          resolve(LocalApiAdapter.getStorageStats());
        } else if (operation === 'RECENT') {
          resolve(LocalApiAdapter.getRecentFiles());
        } else if (operation === 'PHOTOS') {
          resolve(LocalApiAdapter.getPhotos());
        } else if (operation === 'VIDEOS') {
          resolve(LocalApiAdapter.getVideos());
        } else if (operation === 'LIST') {
          resolve(LocalApiAdapter.listFiles(payload.path, payload.type_filter));
        } else {
          resolve(LocalApiAdapter.checkHealth());
        }
        return;
      }

      this.socket.send(JSON.stringify({
        type: 'FILE_REQUEST',
        requestId,
        connectionId: this.connectionId,
        operation,
        ...payload
      }));

      // Timeout safety after 10s
      setTimeout(() => {
        if (this.pendingPromises.has(requestId)) {
          this.pendingPromises.delete(requestId);
          resolve({ success: false, error: { message: 'Remote request timeout. File server host might be busy or offline.' } });
        }
      }, 10000);
    });
  },

  async checkHealth() {
    return await this.sendRequest('HEALTH');
  },

  async getStorageStats() {
    return await this.sendRequest('STORAGE');
  },

  async getRecentFiles() {
    return await this.sendRequest('RECENT');
  },

  async getPhotos() {
    return await this.sendRequest('PHOTOS');
  },

  async getVideos() {
    return await this.sendRequest('VIDEOS');
  },

  async listFiles(path = '/', typeFilter = null) {
    return await this.sendRequest('LIST', { path, type_filter: typeFilter });
  },

  async createFolder(parentPath, folderName) {
    return await this.sendRequest('CREATE_FOLDER', { path: parentPath, name: folderName });
  },

  async renameItem(oldPath, newName) {
    return await this.sendRequest('RENAME', { oldPath, newName });
  },

  async deleteItem(itemPath) {
    return await this.sendRequest('DELETE', { path: itemPath });
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
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(fileObject);
      });

      if (typeof onProgress === 'function') onProgress(50);
      const res = await this.sendRequest('UPLOAD', {
        path: targetPath,
        name: fileObject.name,
        dataBase64: dataBase64
      });
      if (typeof onProgress === 'function') onProgress(100);
      return res;
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async cancelTransfer(transferId, reason = 'Cancelled by user') {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'FILE_STREAM_CANCEL',
        transferId,
        reason
      }));
    }
  },

  getDownloadUrl(filePath) {
    return `/api/download?path=${encodeURIComponent(filePath)}`;
  }
};

// Unified ApiService routing automatically based on URL or environment
const ApiService = {
  isRemoteMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'remote' || !!params.get('connectionId');
  },

  getAdapter() {
    return this.isRemoteMode() ? RemoteApiAdapter : LocalApiAdapter;
  },

  onStatusChange(callback) {
    if (this.isRemoteMode()) {
      RemoteApiAdapter.onStatusChange(callback);
    }
  },

  checkHealth() {
    return this.getAdapter().checkHealth();
  },

  getStorageStats() {
    return this.getAdapter().getStorageStats();
  },

  getRecentFiles() {
    return this.getAdapter().getRecentFiles();
  },

  getPhotos() {
    return this.getAdapter().getPhotos();
  },

  getVideos() {
    return this.getAdapter().getVideos();
  },

  listFiles(path = '/', typeFilter = null) {
    return this.getAdapter().listFiles(path, typeFilter);
  },

  createFolder(parentPath, folderName) {
    return this.getAdapter().createFolder(parentPath, folderName);
  },

  renameItem(oldPath, newName) {
    return this.getAdapter().renameItem(oldPath, newName);
  },

  deleteItem(itemPath) {
    return this.getAdapter().deleteItem(itemPath);
  },

  uploadFile(targetPath, fileObject) {
    return this.getAdapter().uploadFile(targetPath, fileObject);
  },

  cancelTransfer(transferId, reason) {
    if (this.isRemoteMode()) {
      RemoteApiAdapter.cancelTransfer(transferId, reason);
    }
  },

  getDownloadUrl(filePath) {
    return this.getAdapter().getDownloadUrl(filePath);
  }
};
