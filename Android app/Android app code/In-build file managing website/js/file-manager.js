/**
 * Directory Navigation & File Operations Controller
 */
const FileManager = {
  currentPath: '/',
  files: [],

  init() {
    this.bindEvents();
    this.loadDirectory(this.currentPath);
  },

  bindEvents() {
    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      this.loadDirectory(this.currentPath);
    });

    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.filterFiles(e.target.value);
    });

    document.getElementById('btn-new-folder')?.addEventListener('click', () => {
      UIManager.showModal('modal-new-folder');
    });

    document.getElementById('btn-upload')?.addEventListener('click', () => {
      document.getElementById('file-picker')?.click();
    });

    document.getElementById('file-picker')?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleUpload(e.target.files[0]);
      }
    });

    document.getElementById('form-new-folder')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const folderName = document.getElementById('input-folder-name').value.trim();
      if (folderName) {
        this.handleCreateFolder(folderName);
      }
    });
  },

  async loadDirectory(path) {
    this.currentPath = path;
    this.renderBreadcrumb(path);
    this.renderLoading();

    const res = await ApiService.listFiles(path);
    if (res.success && Array.isArray(res.data?.items)) {
      this.files = res.data.items;
      this.renderFiles(this.files);
    } else {
      this.renderError(res.error?.message || 'Failed to load directory files.');
    }
  },

  renderLoading() {
    const container = document.getElementById('file-list-container');
    if (!container) return;
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔄</div>
        <div class="empty-title">Loading files...</div>
        <div class="empty-desc">Accessing local Android storage sandbox...</div>
      </div>
    `;
  },

  renderError(msg) {
    const container = document.getElementById('file-list-container');
    if (!container) return;
    container.innerHTML = `
      <div class="empty-state" style="border-color: var(--color-status-error);">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Error Loading Directory</div>
        <div class="empty-desc">${msg}</div>
        <button class="btn btn-primary btn-sm" onclick="FileManager.loadDirectory('${this.currentPath}')">Retry</button>
      </div>
    `;
  },

  renderBreadcrumb(path) {
    const container = document.getElementById('breadcrumb-container');
    if (!container) return;

    const parts = path.split('/').filter(Boolean);
    let html = `<span class="breadcrumb-item" onclick="FileManager.loadDirectory('/')">Home</span>`;

    let accumulated = '';
    parts.forEach((part) => {
      accumulated += '/' + part;
      const targetPath = accumulated;
      html += `
        <span class="breadcrumb-separator">/</span>
        <span class="breadcrumb-item" onclick="FileManager.loadDirectory('${targetPath}')">${part}</span>
      `;
    });

    container.innerHTML = html;
  },

  renderFiles(items) {
    const container = document.getElementById('file-list-container');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📁</div>
          <div class="empty-title">This folder is empty</div>
          <div class="empty-desc">Upload files or create new folders to get started.</div>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button class="btn btn-primary btn-sm" onclick="UIManager.showModal('modal-new-folder')">New Folder</button>
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('file-picker').click()">Upload File</button>
          </div>
        </div>
      `;
      return;
    }

    let html = '<div class="file-grid">';
    items.forEach((item) => {
      const isDir = item.isDir;
      const icon = isDir ? '📁' : '📄';
      const sizeStr = isDir ? 'Folder' : this.formatSize(item.sizeBytes || 0);

      html += `
        <div class="file-card">
          <div class="file-icon-info" onclick="${isDir ? `FileManager.loadDirectory('${item.path}')` : ''}">
            <div class="file-icon">${icon}</div>
            <div class="file-meta">
              <span class="file-name">${item.name}</span>
              <span class="file-subtext">${sizeStr}</span>
            </div>
          </div>
          <div class="file-actions">
            ${!isDir ? `<a href="${ApiService.getDownloadUrl(item.path)}" class="btn btn-secondary btn-sm" download>⬇️</a>` : ''}
            <button class="btn btn-secondary btn-sm" onclick="FileManager.promptRename('${item.path}', '${item.name}')">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="FileManager.promptDelete('${item.path}', '${item.name}')">🗑️</button>
          </div>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  },

  filterFiles(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      this.renderFiles(this.files);
      return;
    }
    const filtered = this.files.filter(f => f.name.toLowerCase().includes(q));
    this.renderFiles(filtered);
  },

  async handleCreateFolder(name) {
    UIManager.hideModal('modal-new-folder');
    const res = await ApiService.createFolder(this.currentPath, name);
    if (res.success) {
      UIManager.showToast('Folder created successfully', 'online');
      this.loadDirectory(this.currentPath);
    } else {
      UIManager.showToast(res.error?.message || 'Failed to create folder', 'error');
    }
  },

  async handleUpload(file) {
    UIManager.showToast(`Uploading ${file.name}...`, 'info');
    const res = await ApiService.uploadFile(this.currentPath, file);
    if (res.success) {
      UIManager.showToast('File uploaded successfully', 'online');
      this.loadDirectory(this.currentPath);
    } else {
      UIManager.showToast(res.error?.message || 'Upload failed', 'error');
    }
  },

  async promptRename(itemPath, currentName) {
    const newName = prompt('Enter new name:', currentName);
    if (newName && newName !== currentName) {
      const res = await ApiService.renameItem(itemPath, newName);
      if (res.success) {
        UIManager.showToast('Item renamed', 'online');
        this.loadDirectory(this.currentPath);
      } else {
        UIManager.showToast(res.error?.message || 'Rename failed', 'error');
      }
    }
  },

  async promptDelete(itemPath, itemName) {
    if (confirm(`Are you sure you want to delete "${itemName}"?`)) {
      const res = await ApiService.deleteItem(itemPath);
      if (res.success) {
        UIManager.showToast('Item deleted', 'online');
        this.loadDirectory(this.currentPath);
      } else {
        UIManager.showToast(res.error?.message || 'Delete failed', 'error');
      }
    }
  },

  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
};
