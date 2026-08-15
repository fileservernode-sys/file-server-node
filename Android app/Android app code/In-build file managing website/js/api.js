/**
 * RemoteNode File Manager API Client — Dual LOCAL & REMOTE Mode Adapter Architecture
 * 
 * LOCAL Mode: Communicates directly via HTTP fetch to http://127.0.0.1:8080/api/*
 * REMOTE Mode: Communicates via Gateway WebSocket transport proxy using correlated FILE_REQUEST / FILE_RESPONSE messages.
 */

// Local HTTP API Adapter
const LocalApiAdapter = {
  baseUrl: '/api',

  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return await res.json();
    } catch (e) {
      return { status: 'error', message: 'Local server unreachable' };
    }
  },

  async listFiles(path = '/') {
    try {
      const encodedPath = encodeURIComponent(path);
      const res = await fetch(`${this.baseUrl}/files?path=${encodedPath}`);
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async createFolder(parentPath, folderName) {
    try {
      const res = await fetch(`${this.baseUrl}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  async uploadFile(targetPath, fileObject) {
    try {
      const formData = new FormData();
      formData.append('path', targetPath);
      formData.append('file', fileObject);

      const res = await fetch(`${this.baseUrl}/upload`, {
        method: 'POST',
        body: formData
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: { message: e.message } };
    }
  },

  getDownloadUrl(filePath) {
    return `${this.baseUrl}/download?path=${encodeURIComponent(filePath)}`;
  }
};

// Remote Gateway Transport API Adapter
const RemoteApiAdapter = {
  socket: null,
  pendingPromises: new Map(),
  connectionId: 'demo-remote-conn',

  async ensureConnected() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;

    return new Promise((resolve) => {
      const wsUrl = `ws://${window.location.hostname || 'localhost'}:4001`;
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
          }
        } catch (e) {
          // Ignore malformed payloads
        }
      };

      this.socket.onopen = () => resolve();
      this.socket.onerror = () => resolve();
    });
  },

  async sendRequest(operation, payload = {}) {
    await this.ensureConnected();
    const requestId = 'req_' + Math.random().toString(36).substring(2, 10);

    return new Promise((resolve) => {
      this.pendingPromises.set(requestId, resolve);

      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        // Fallback to local HTTP adapter if remote gateway socket cannot connect
        resolve(LocalApiAdapter[operation === 'LIST' ? 'listFiles' : 'checkHealth'](payload.path));
        return;
      }

      this.socket.send(JSON.stringify({
        type: 'FILE_REQUEST',
        requestId,
        connectionId: this.connectionId,
        operation,
        ...payload
      }));

      // Timeout safety after 5s
      setTimeout(() => {
        if (this.pendingPromises.has(requestId)) {
          this.pendingPromises.delete(requestId);
          resolve({ success: false, error: { message: 'Remote request timeout.' } });
        }
      }, 5000);
    });
  },

  async checkHealth() {
    return await this.sendRequest('HEALTH');
  },

  async listFiles(path = '/') {
    return await this.sendRequest('LIST', { path });
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

  async uploadFile(targetPath, fileObject) {
    return await this.sendRequest('UPLOAD', { path: targetPath, name: fileObject.name });
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

  checkHealth() {
    return this.getAdapter().checkHealth();
  },

  listFiles(path = '/') {
    return this.getAdapter().listFiles(path);
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

  getDownloadUrl(filePath) {
    return this.getAdapter().getDownloadUrl(filePath);
  }
};
