/**
 * RemoteNode File Manager — Multi-View Storage Product Controller
 */

const StorageUtils = {
  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  },

  getFileIcon(category, isDir) {
    if (isDir) {
      return '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-brand-primary);"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
    }
    switch (category) {
      case 'photos':
        return '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #10B981;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
      case 'videos':
        return '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #F59E0B;"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>';
      case 'documents':
        return '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #2563EB;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
      case 'audio':
        return '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #EC4899;"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';
      case 'archives':
        return '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #8B5CF6;"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>';
      default:
        return '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-text-secondary);"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
    }
  }
};

// =============================================================================
// ROUTER & VIEW ORCHESTRATION
// =============================================================================
const AppRouter = {
  currentView: 'home',

  init() {
    this.bindNavigation();
    this.navigate('home');
  },

  bindNavigation() {
    document.querySelectorAll('[data-view]').forEach((el) => {
      el.addEventListener('click', () => {
        const view = el.getAttribute('data-view');
        if (view) this.navigate(view);
      });
    });
  },

  navigate(viewName) {
    this.currentView = viewName;

    // Toggle active classes on sidebar and mobile bottom nav
    document.querySelectorAll('[data-view]').forEach((el) => {
      if (el.getAttribute('data-view') === viewName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Toggle active view sections
    document.querySelectorAll('.view-section').forEach((section) => {
      if (section.id === `view-${viewName}`) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    });

    // Load data for the targeted view
    switch (viewName) {
      case 'home':
        HomeController.load();
        break;
      case 'files':
        MyFilesController.load();
        break;
      case 'photos':
        PhotosController.load();
        break;
      case 'videos':
        VideosController.load();
        break;
      case 'storage':
        StorageController.load();
        break;
    }
  }
};

// =============================================================================
// 1. HOME VIEW CONTROLLER
// =============================================================================
const HomeController = {
  async load() {
    await Promise.all([this.loadStorageStats(), this.loadRecentFiles()]);
  },

  async loadStorageStats() {
    const res = await ApiService.getStorageStats();
    if (!res.success || !res.data) return;

    const data = res.data;
    const total = data.totalBytes || (64 * 1024 * 1024 * 1024);
    const used = data.usedBytes || 0;
    const free = data.freeBytes || (total - used);
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

    // Home numbers
    document.getElementById('home-storage-used-gb').textContent = StorageUtils.formatBytes(used);
    document.getElementById('home-storage-total-gb').textContent = `used of ${StorageUtils.formatBytes(total)}`;
    document.getElementById('home-storage-free-badge').textContent = `${StorageUtils.formatBytes(free)} Free (${100 - pct}%)`;

    // Sidebar mini widget
    document.getElementById('sidebar-storage-pct').textContent = `${pct}%`;
    document.getElementById('sidebar-storage-bar').style.width = `${pct}%`;
    document.getElementById('sidebar-storage-used').textContent = StorageUtils.formatBytes(used);
    document.getElementById('sidebar-storage-total').textContent = StorageUtils.formatBytes(total);

    // Multi-segment storage bar on home
    const cats = data.categories || {};
    const counts = data.counts || {};

    const calcBarWidth = (bytes) => (total > 0 ? `${Math.max(1, ((bytes || 0) / total) * 100)}%` : '0%');
    if (cats.photos) document.getElementById('bar-photos').style.width = calcBarWidth(cats.photos);
    if (cats.videos) document.getElementById('bar-videos').style.width = calcBarWidth(cats.videos);
    if (cats.documents) document.getElementById('bar-docs').style.width = calcBarWidth(cats.documents);
    if (cats.audio) document.getElementById('bar-audio').style.width = calcBarWidth(cats.audio);
    if (cats.archives) document.getElementById('bar-archives').style.width = calcBarWidth(cats.archives);
    if (cats.other) document.getElementById('bar-other').style.width = calcBarWidth(cats.other);

    // Category cards counts & sizes
    document.getElementById('cat-count-photos').textContent = `${counts.photos || 0} files`;
    document.getElementById('cat-size-photos').textContent = StorageUtils.formatBytes(cats.photos || 0);

    document.getElementById('cat-count-videos').textContent = `${counts.videos || 0} files`;
    document.getElementById('cat-size-videos').textContent = StorageUtils.formatBytes(cats.videos || 0);

    document.getElementById('cat-count-docs').textContent = `${counts.documents || 0} files`;
    document.getElementById('cat-size-docs').textContent = StorageUtils.formatBytes(cats.documents || 0);

    document.getElementById('cat-count-audio').textContent = `${counts.audio || 0} files`;
    document.getElementById('cat-size-audio').textContent = StorageUtils.formatBytes(cats.audio || 0);

    document.getElementById('cat-count-archives').textContent = `${counts.archives || 0} files`;
    document.getElementById('cat-size-archives').textContent = StorageUtils.formatBytes(cats.archives || 0);

    document.getElementById('cat-count-total').textContent = `${counts.total || 0} items`;
  },

  async loadRecentFiles() {
    const container = document.getElementById('home-recent-files-container');
    if (!container) return;

    container.innerHTML = `
      <div class="empty-state" style="padding: 24px;">
        <div class="empty-icon" style="font-size: 1.8rem;"><span class="spinner" style="width: 24px; height: 24px;"></span></div>
        <div class="empty-title" style="font-size: 1rem;">Loading recent files...</div>
      </div>
    `;

    const res = await ApiService.getRecentFiles();
    if (!res.success || !Array.isArray(res.data?.items) || res.data.items.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 32px;">
          <div class="empty-icon"><svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div>
          <div class="empty-title">No recent files yet</div>
          <div class="empty-desc">Uploaded files and media will appear here automatically.</div>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('file-picker').click()">Upload First File</button>
        </div>
      `;
      return;
    }

    const items = res.data.items;
    let html = '<div class="file-table-wrap"><table class="file-table"><thead><tr><th>Name</th><th>Size</th><th>Date Modified</th><th>Actions</th></tr></thead><tbody>';
    
    items.forEach((item) => {
      const icon = StorageUtils.getFileIcon(item.category, false);
      const downloadUrl = ApiService.getDownloadUrl(item.path);
      const safePath = item.path.replace(/'/g, "\\'");
      const safeName = item.name.replace(/'/g, "\\'");

      html += `
        <tr>
          <td>
            <div class="file-cell-name" onclick="FileManagerHelper.openItem('${safePath}', '${safeName}', '${item.category}')">
              <span>${icon}</span>
              <span>${item.name}</span>
            </div>
          </td>
          <td>${StorageUtils.formatBytes(item.sizeBytes)}</td>
          <td>${StorageUtils.formatDate(item.modifiedAt)}</td>
          <td>
            <div style="display: flex; gap: 4px;">
              <a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download" aria-label="Download file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>
              <button class="btn btn-secondary btn-sm" onclick="FileManagerHelper.promptRename('${safePath}', '${safeName}')" title="Rename" aria-label="Rename file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
              <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}')" title="Delete" aria-label="Delete file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }
};

// =============================================================================
// 2. MY FILES VIEW CONTROLLER
// =============================================================================
const MyFilesController = {
  currentPath: '/',
  files: [],
  viewMode: 'list', // 'list' | 'grid'
  sortMode: 'name_asc',

  init() {
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('btn-files-refresh')?.addEventListener('click', () => this.loadDirectory(this.currentPath));
    document.getElementById('btn-files-new-folder')?.addEventListener('click', () => UIManager.showModal('modal-new-folder'));
    document.getElementById('btn-files-upload')?.addEventListener('click', () => document.getElementById('file-picker')?.click());

    document.getElementById('btn-view-list')?.addEventListener('click', () => {
      this.viewMode = 'list';
      this.renderFiles(this.getSortedFiles());
    });

    document.getElementById('btn-view-grid')?.addEventListener('click', () => {
      this.viewMode = 'grid';
      this.renderFiles(this.getSortedFiles());
    });

    document.getElementById('sort-select')?.addEventListener('change', (e) => {
      this.sortMode = e.target.value;
      this.renderFiles(this.getSortedFiles());
    });

    document.getElementById('global-search-input')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        this.renderFiles(this.getSortedFiles());
        return;
      }
      const filtered = this.files.filter(f => f.name.toLowerCase().includes(q));
      this.renderFiles(filtered);
    });
  },

  async load() {
    await this.loadDirectory(this.currentPath);
  },

  async loadDirectory(path) {
    this.currentPath = path;
    this.renderBreadcrumbs(path);
    this.renderLoading();

    const res = await ApiService.listFiles(path);
    if (res.success && Array.isArray(res.data?.items)) {
      this.files = res.data.items;
      this.renderFiles(this.getSortedFiles());
    } else {
      this.renderError(res.error?.message || 'Failed to load directory contents.');
    }
  },

  getSortedFiles() {
    const list = [...this.files];
    const [field, direction] = this.sortMode.split('_');

    return list.sort((a, b) => {
      // Keep folders first always
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;

      let cmp = 0;
      if (field === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (field === 'size') {
        cmp = (a.sizeBytes || 0) - (b.sizeBytes || 0);
      } else if (field === 'date') {
        const da = new Date(a.modifiedAt || 0).getTime();
        const db = new Date(b.modifiedAt || 0).getTime();
        cmp = da - db;
      }
      return direction === 'desc' ? -cmp : cmp;
    });
  },

  renderBreadcrumbs(path) {
    const container = document.getElementById('breadcrumb-container');
    if (!container) return;

    const parts = path.split('/').filter(Boolean);
    let html = `<span class="breadcrumb-item" onclick="MyFilesController.loadDirectory('/')">Root</span>`;
    let accum = '';

    parts.forEach((p) => {
      accum += '/' + p;
      const target = accum;
      html += `
        <span class="breadcrumb-separator">/</span>
        <span class="breadcrumb-item" onclick="MyFilesController.loadDirectory('${target}')">${p}</span>
      `;
    });

    container.innerHTML = html;
    renderLoading() {
    const container = document.getElementById('file-list-container');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><span class="spinner" style="width: 24px; height: 24px;"></span></div>
          <div class="empty-title">Loading files...</div>
          <div class="empty-desc">Accessing Android storage host...</div>
        </div>
      `;
    }
  },

  renderError(msg) {
    const container = document.getElementById('file-list-container');
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="border-color: var(--color-status-error);">
          <div class="empty-icon"><svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #DC2626;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>
          <div class="empty-title">Error Loading Directory</div>
          <div class="empty-desc">${msg}</div>
          <button class="btn btn-primary btn-sm" onclick="MyFilesController.loadDirectory('${this.currentPath}')">Retry</button>
        </div>
      `;
    }
  },

  renderFiles(items) {
    const container = document.getElementById('file-list-container');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div>
          <div class="empty-title">This folder is empty</div>
          <div class="empty-desc">Upload files or create folders to get started.</div>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" onclick="UIManager.showModal('modal-new-folder')">New Folder</button>
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('file-picker').click()">Upload File</button>
          </div>
        </div>
      `;
      return;
    }

    if (this.viewMode === 'grid') {
      let html = '<div class="file-grid">';
      items.forEach((item) => {
        const isDir = item.isDir;
        const icon = StorageUtils.getFileIcon(item.category, isDir);
        const downloadUrl = ApiService.getDownloadUrl(item.path);
        const isImage = item.category === 'photos';
        const safePath = item.path.replace(/'/g, "\\'");
        const safeName = item.name.replace(/'/g, "\\'");

        html += `
          <div class="file-grid-card">
            <div class="grid-card-preview" onclick="${isDir ? `MyFilesController.loadDirectory('${safePath}')` : `FileManagerHelper.openItem('${safePath}', '${safeName}', '${item.category}')`}">
              ${isImage ? `<img src="${downloadUrl}" alt="${item.name}" loading="lazy" onerror="this.parentElement.innerHTML='<svg class=\\'icon icon-md\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg>'">` : icon}
            </div>
            <div class="grid-card-info" onclick="${isDir ? `MyFilesController.loadDirectory('${safePath}')` : `FileManagerHelper.openItem('${safePath}', '${safeName}', '${item.category}')`}">
              <div class="grid-card-name" title="${item.name}">${item.name}</div>
              <div class="grid-card-meta">${isDir ? 'Folder' : StorageUtils.formatBytes(item.sizeBytes)} • ${StorageUtils.formatDate(item.modifiedAt)}</div>
            </div>
            <div class="grid-card-actions">
              ${!isDir ? `<a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download" aria-label="Download file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>` : ''}
              <button class="btn btn-secondary btn-sm" onclick="FileManagerHelper.promptRename('${safePath}', '${safeName}')" title="Rename" aria-label="Rename file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
              <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}')" title="Delete" aria-label="Delete file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
          </div>
        `;
      });
      html += '</div>';
      container.innerHTML = html;
    } else {
      let html = '<div class="file-table-wrap"><table class="file-table"><thead><tr><th>Name</th><th>Size</th><th>Date Modified</th><th>Actions</th></tr></thead><tbody>';
      items.forEach((item) => {
        const isDir = item.isDir;
        const icon = StorageUtils.getFileIcon(item.category, isDir);
        const downloadUrl = ApiService.getDownloadUrl(item.path);
        const safePath = item.path.replace(/'/g, "\\'");
        const safeName = item.name.replace(/'/g, "\\'");

        html += `
          <tr>
            <td>
              <div class="file-cell-name" onclick="${isDir ? `MyFilesController.loadDirectory('${safePath}')` : `FileManagerHelper.openItem('${safePath}', '${safeName}', '${item.category}')`}">
                <span>${icon}</span>
                <span>${item.name}</span>
              </div>
            </td>
            <td>${isDir ? '—' : StorageUtils.formatBytes(item.sizeBytes)}</td>
            <td>${StorageUtils.formatDate(item.modifiedAt)}</td>
            <td>
              <div style="display: flex; gap: 4px;">
                ${!isDir ? `<a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download" aria-label="Download file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>` : ''}
                <button class="btn btn-secondary btn-sm" onclick="FileManagerHelper.promptRename('${safePath}', '${safeName}')" title="Rename" aria-label="Rename file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}')" title="Delete" aria-label="Delete file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
              </div>
            </td>
          </tr>
        `;
      });
      html += '</tbody></table></div>';
      container.innerHTML = html;
    }
  }
};

// =============================================================================
// 3. PHOTOS VIEW CONTROLLER
// =============================================================================
const PhotosController = {
  photos: [],

  async load() {
    const container = document.getElementById('photos-container');
    if (!container) return;

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><span class="spinner" style="width: 24px; height: 24px;"></span></div>
        <div class="empty-title">Discovering photos...</div>
      </div>
    `;

    const res = await ApiService.getPhotos();
    if (!res.success || !Array.isArray(res.data?.items) || res.data.items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div>
          <div class="empty-title">No photos found</div>
          <div class="empty-desc">Images (.jpg, .png, .webp, .gif) in your storage sandbox will be displayed here.</div>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('file-picker').click()">Upload Photos</button>
        </div>
      `;
      return;
    }

    this.photos = res.data.items;
    let html = '<div class="photos-gallery-grid">';
    
    this.photos.forEach((photo) => {
      const downloadUrl = ApiService.getDownloadUrl(photo.path);
      const safePath = photo.path.replace(/'/g, "\\'");
      const safeName = photo.name.replace(/'/g, "\\'");

      html += `
        <div class="photo-tile">
          <div class="photo-thumb-wrap" onclick="UIManager.showLightbox('${safeName}', '${downloadUrl}', '${downloadUrl}')">
            <img src="${downloadUrl}" alt="${photo.name}" loading="lazy" onerror="this.parentElement.innerHTML='<svg class=\\'icon icon-md\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg>'">
          </div>
          <div class="photo-meta-bar">
            <span class="photo-name" title="${photo.name}">${photo.name}</span>
            <span class="photo-size">${StorageUtils.formatBytes(photo.sizeBytes)} • ${StorageUtils.formatDate(photo.modifiedAt)}</span>
            <div style="display: flex; gap: 4px; margin-top: 6px; justify-content: flex-end;">
              <a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download" aria-label="Download file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>
              <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}', () => PhotosController.load())" title="Delete" aria-label="Delete file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
          </div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }
};

// =============================================================================
// 4. VIDEOS VIEW CONTROLLER
// =============================================================================
const VideosController = {
  videos: [],

  async load() {
    const container = document.getElementById('videos-container');
    if (!container) return;

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><span class="spinner" style="width: 24px; height: 24px;"></span></div>
        <div class="empty-title">Discovering videos...</div>
      </div>
    `;

    const res = await ApiService.getVideos();
    if (!res.success || !Array.isArray(res.data?.items) || res.data.items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg></div>
          <div class="empty-title">No videos found</div>
          <div class="empty-desc">Videos (.mp4, .mkv, .webm, .mov) stored on your Android server will appear here.</div>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('file-picker').click()">Upload Videos</button>
        </div>
      `;
      return;
    }

    this.videos = res.data.items;
    let html = '<div class="videos-gallery-grid">';

    this.videos.forEach((video) => {
      const downloadUrl = ApiService.getDownloadUrl(video.path);
      const safePath = video.path.replace(/'/g, "\\'");
      const safeName = video.name.replace(/'/g, "\\'");

      html += `
        <div class="video-card">
          <div class="video-poster-wrap" onclick="UIManager.showVideoModal('${safeName}', '${downloadUrl}', '${downloadUrl}')">
            <div class="video-play-btn"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>
          </div>
          <div style="padding: 12px;">
            <div style="font-weight: 700; font-size: var(--font-size-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${video.name}">${video.name}</div>
            <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 4px;">${StorageUtils.formatBytes(video.sizeBytes)} • ${StorageUtils.formatDate(video.modifiedAt)}</div>
            <div style="display: flex; gap: 4px; margin-top: 8px; justify-content: flex-end;">
              <a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download" aria-label="Download file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>
              <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}', () => VideosController.load())" title="Delete" aria-label="Delete file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
          </div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }
};

// =============================================================================
// 5. STORAGE VIEW CONTROLLER
// =============================================================================
const StorageController = {
  async load() {
    const res = await ApiService.getStorageStats();
    if (!res.success || !res.data) return;

    const data = res.data;
    const total = data.totalBytes || (64 * 1024 * 1024 * 1024);
    const used = data.usedBytes || 0;
    const free = data.freeBytes || (total - used);
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

    document.getElementById('storage-page-used').textContent = StorageUtils.formatBytes(used);
    document.getElementById('storage-page-total').textContent = `of ${StorageUtils.formatBytes(total)}`;
    document.getElementById('storage-page-free').textContent = StorageUtils.formatBytes(free);
    document.getElementById('storage-page-pct').textContent = `${pct}%`;
    document.getElementById('storage-page-file-count').textContent = (data.counts?.total || 0).toLocaleString();

    // Bar segments
    const cats = data.categories || {};
    const counts = data.counts || {};
    const calcWidth = (b) => (total > 0 ? `${Math.max(1, ((b || 0) / total) * 100)}%` : '0%');

    if (cats.photos) document.getElementById('storage-page-bar-photos').style.width = calcWidth(cats.photos);
    if (cats.videos) document.getElementById('storage-page-bar-videos').style.width = calcWidth(cats.videos);
    if (cats.documents) document.getElementById('storage-page-bar-docs').style.width = calcWidth(cats.documents);
    if (cats.audio) document.getElementById('storage-page-bar-audio').style.width = calcWidth(cats.audio);
    if (cats.archives) document.getElementById('storage-page-bar-archives').style.width = calcWidth(cats.archives);
    if (cats.other) document.getElementById('storage-page-bar-other').style.width = calcWidth(cats.other);

    // Legend Grid
    const legendGrid = document.getElementById('storage-category-legend-grid');
    if (legendGrid) {
      legendGrid.innerHTML = `
        <div class="category-pill">
          <div class="category-dot" style="background-color: var(--color-cat-photos);"></div>
          <div class="category-info">
            <span class="category-name">Photos (${counts.photos || 0})</span>
            <span class="category-size">${StorageUtils.formatBytes(cats.photos || 0)}</span>
          </div>
        </div>
        <div class="category-pill">
          <div class="category-dot" style="background-color: var(--color-cat-videos);"></div>
          <div class="category-info">
            <span class="category-name">Videos (${counts.videos || 0})</span>
            <span class="category-size">${StorageUtils.formatBytes(cats.videos || 0)}</span>
          </div>
        </div>
        <div class="category-pill">
          <div class="category-dot" style="background-color: var(--color-cat-docs);"></div>
          <div class="category-info">
            <span class="category-name">Documents (${counts.documents || 0})</span>
            <span class="category-size">${StorageUtils.formatBytes(cats.documents || 0)}</span>
          </div>
        </div>
        <div class="category-pill">
          <div class="category-dot" style="background-color: var(--color-cat-audio);"></div>
          <div class="category-info">
            <span class="category-name">Audio (${counts.audio || 0})</span>
            <span class="category-size">${StorageUtils.formatBytes(cats.audio || 0)}</span>
          </div>
        </div>
        <div class="category-pill">
          <div class="category-dot" style="background-color: var(--color-cat-archives);"></div>
          <div class="category-info">
            <span class="category-name">Archives (${counts.archives || 0})</span>
            <span class="category-size">${StorageUtils.formatBytes(cats.archives || 0)}</span>
          </div>
        </div>
        <div class="category-pill">
          <div class="category-dot" style="background-color: var(--color-cat-other);"></div>
          <div class="category-info">
            <span class="category-name">Other (${counts.other || 0})</span>
            <span class="category-size">${StorageUtils.formatBytes(cats.other || 0)}</span>
          </div>
        </div>
      `;
    }

    // Top Largest Files Table
    const tbody = document.getElementById('largest-files-tbody');
    if (tbody) {
      const largest = data.largestFiles || [];
      if (largest.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 24px;">No files indexed yet.</td></tr>';
      } else {
        let rows = '';
        largest.forEach((f) => {
          const cat = StorageUtils.getFileIcon(f.category || 'other', false);
          const downloadUrl = ApiService.getDownloadUrl(f.path);
          const safePath = f.path.replace(/'/g, "\\'");
          const safeName = f.name.replace(/'/g, "\\'");

          rows += `
            <tr>
              <td>
                <div class="file-cell-name" onclick="FileManagerHelper.openItem('${safePath}', '${safeName}', '${f.category || 'other'}')">
                  <span>${cat}</span>
                  <span>${f.name}</span>
                </div>
              </td>
              <td style="text-transform: capitalize;">${f.category || 'File'}</td>
              <td><strong>${StorageUtils.formatBytes(f.sizeBytes)}</strong></td>
              <td>${StorageUtils.formatDate(f.modifiedAt)}</td>
              <td>
                <div style="display: flex; gap: 4px;">
                  <a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download" aria-label="Download file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>
                  <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}', () => StorageController.load())" title="Delete" aria-label="Delete file"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
              </td>
            </tr>
          `;
        });
        tbody.innerHTML = rows;
      }
    }
  }
};     </td>
            </tr>
          `;
        });
        tbody.innerHTML = rows;
      }
    }
  }
};

// =============================================================================
// GLOBAL ACTION HELPERS
// =============================================================================
const FileManagerHelper = {
  openItem(path, name, category) {
    const downloadUrl = ApiService.getDownloadUrl(path);
    if (category === 'photos') {
      UIManager.showLightbox(name, downloadUrl, downloadUrl);
    } else if (category === 'videos') {
      UIManager.showVideoModal(name, downloadUrl, downloadUrl);
    } else {
      window.open(downloadUrl, '_blank');
    }
  },

  promptRename(itemPath, currentName, onDone) {
    UIManager.showRenameDialog(itemPath, currentName, async (newName) => {
      UIManager.showToast(`Renaming to "${newName}"...`, 'online');
      const res = await ApiService.renameItem(itemPath, newName);
      if (res.success) {
        UIManager.showToast('Item renamed successfully', 'online');
        if (onDone) onDone();
        else MyFilesController.load();
      } else {
        UIManager.showToast(res.error?.message || 'Failed to rename item', 'error');
      }
    });
  },

  promptDelete(itemPath, itemName, onDone) {
    UIManager.showDeleteDialog(itemPath, itemName, async () => {
      UIManager.showToast(`Deleting "${itemName}"...`, 'warning');
      const res = await ApiService.deleteItem(itemPath);
      if (res.success) {
        UIManager.showToast('Item deleted', 'online');
        if (onDone) onDone();
        else MyFilesController.load();
        HomeController.loadStorageStats();
      } else {
        UIManager.showToast(res.error?.message || 'Failed to delete item', 'error');
      }
    });
  },

  async handleUpload(fileList) {
    if (!fileList || fileList.length === 0) return;
    const targetPath = MyFilesController.currentPath || '/';

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      UIManager.showToast(`Uploading (${i + 1}/${fileList.length}) ${file.name}...`, 'online');
      const res = await ApiService.uploadFile(targetPath, file);
      if (!res.success) {
        UIManager.showToast(res.error?.message || `Failed to upload ${file.name}`, 'error');
      }
    }

    UIManager.showToast('Uploads completed', 'online');
    MyFilesController.load();
    HomeController.load();
  },

  async handleCreateFolder(name) {
    const parentPath = MyFilesController.currentPath || '/';
    UIManager.showToast(`Creating folder "${name}"...`, 'online');
    const res = await ApiService.createFolder(parentPath, name);
    if (res.success) {
      UIManager.showToast('Folder created', 'online');
      MyFilesController.load();
    } else {
      UIManager.showToast(res.error?.message || 'Failed to create folder', 'error');
    }
  }
};
