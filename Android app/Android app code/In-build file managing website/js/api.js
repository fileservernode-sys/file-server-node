/**
 * Local File Server API Abstraction Client
 * Endpoints interact strictly with http://127.0.0.1:8080/api/*
 */
const ApiService = {
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
