/**
 * RemoteNode File Manager — Multi-View Storage Product Controller
 */

const AppIcons = {
  folder: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
  photo: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`,
  video: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>`,
  document: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>`,
  download: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
  home: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`,
  storage: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 6H5V5h14v4zm0 4H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2zm0 6H5v-4h14v4z"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`
};

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
    let iconSvg = AppIcons.document;
    if (isDir) iconSvg = AppIcons.folder;
    else {
      switch (category) {
        case 'photos': iconSvg = AppIcons.photo; break;
        case 'videos': iconSvg = AppIcons.video; break;
        case 'documents': iconSvg = AppIcons.document; break;
        case 'audio': iconSvg = AppIcons.audio; break;
        case 'archives': iconSvg = AppIcons.archive; break;
        default: iconSvg = AppIcons.document; break;
      }
    }
    return `<span class="file-icon-badge">${iconSvg}</span>`;
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
        <div class="empty-icon">${AppIcons.refresh}</div>
        <div class="empty-title" style="font-size: 1rem;">Loading recent files...</div>
      </div>
    `;

    const res = await ApiService.getRecentFiles();
    if (!res.success || !Array.isArray(res.data?.items) || res.data.items.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 32px;">
          <div class="empty-icon">${AppIcons.folder}</div>
          <div class="empty-title">No recent files yet</div>
          <div class="empty-desc">Uploaded files and media will appear here automatically.</div>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('file-picker').click()">${AppIcons.upload} Upload First File</button>
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
              <a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download">${AppIcons.download}</a>
              <button class="btn btn-secondary btn-sm" onclick="FileManagerHelper.promptRename('${safePath}', '${safeName}')" title="Rename">${AppIcons.edit}</button>
              <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}')" title="Delete">${AppIcons.trash}</button>
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
    let html = `<span class="breadcrumb-item" onclick="MyFilesController.loadDirectory('/')">${AppIcons.home} <span>Root</span></span>`;
    let accum = '';

    parts.forEach((p) => {
      accum += '/' + p;
      const target = accum;
      html += `
        <span class="breadcrumb-separator">${AppIcons.chevronRight}</span>
        <span class="breadcrumb-item" onclick="MyFilesController.loadDirectory('${target}')">${p}</span>
      `;
    });

    container.innerHTML = html;
  },

  renderLoading() {
    const container = document.getElementById('file-list-container');
    if (container) {
      container.innerHTML = `
        <div style="padding: 16px; background-color: var(--color-bg-surface); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md);">
          <div class="skeleton skeleton-row" style="height: 48px; margin-bottom: 8px;"></div>
          <div class="skeleton skeleton-row" style="height: 48px; margin-bottom: 8px;"></div>
          <div class="skeleton skeleton-row" style="height: 48px; margin-bottom: 8px;"></div>
          <div class="skeleton skeleton-row" style="height: 48px;"></div>
        </div>
      `;
    }
  },

  renderError(msg) {
    const container = document.getElementById('file-list-container');
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="border-color: var(--color-status-error);">
          <div class="empty-icon" style="color: var(--color-status-error);">${AppIcons.close}</div>
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

    // Update view mode toggle active classes
    const btnList = document.getElementById('btn-view-list');
    const btnGrid = document.getElementById('btn-view-grid');
    if (btnList && btnGrid) {
      if (this.viewMode === 'grid') {
        btnGrid.classList.add('active');
        btnList.classList.remove('active');
      } else {
        btnList.classList.add('active');
        btnGrid.classList.remove('active');
      }
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${AppIcons.folder}</div>
          <div class="empty-title">This folder is empty</div>
          <div class="empty-desc">Upload files or create folders to get started.</div>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" onclick="UIManager.showModal('modal-new-folder')">${AppIcons.plus} New Folder</button>
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('file-picker').click()">${AppIcons.upload} Upload File</button>
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
          <div class="file-grid-card" id="grid-item-${safePath}">
            <div class="grid-card-preview" onclick="${isDir ? `MyFilesController.loadDirectory('${safePath}')` : `FileManagerHelper.openItem('${safePath}', '${safeName}', '${item.category}')`}">
              ${isImage ? `<img src="${downloadUrl}" alt="${item.name}" loading="lazy" onerror="this.parentElement.innerHTML='${AppIcons.photo.replace(/'/g, "\\'")}'">` : icon}
            </div>
            <div class="grid-card-info" onclick="${isDir ? `MyFilesController.loadDirectory('${safePath}')` : `FileManagerHelper.openItem('${safePath}', '${safeName}', '${item.category}')`}">
              <div class="grid-card-name" title="${item.name}">${item.name}</div>
              <div class="grid-card-meta">${isDir ? 'Folder' : StorageUtils.formatBytes(item.sizeBytes)} • ${StorageUtils.formatDate(item.modifiedAt)}</div>
            </div>
            <div class="grid-card-actions">
              ${!isDir ? `<a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download">${AppIcons.download}</a>` : ''}
              <button class="btn btn-secondary btn-sm" onclick="FileManagerHelper.promptRename('${safePath}', '${safeName}')" title="Rename">${AppIcons.edit}</button>
              <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}')" title="Delete">${AppIcons.trash}</button>
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
          <tr id="row-item-${safePath}">
            <td>
              <div class="file-cell-name" onclick="${isDir ? `MyFilesController.loadDirectory('${safePath}')` : `FileManagerHelper.openItem('${safePath}', '${safeName}', '${item.category}')`}">
                ${icon}
                <span>${item.name}</span>
              </div>
            </td>
            <td>${isDir ? '—' : StorageUtils.formatBytes(item.sizeBytes)}</td>
            <td>${StorageUtils.formatDate(item.modifiedAt)}</td>
            <td>
              <div style="display: flex; gap: 4px;">
                ${!isDir ? `<a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download">${AppIcons.download}</a>` : ''}
                <button class="btn btn-secondary btn-sm" onclick="FileManagerHelper.promptRename('${safePath}', '${safeName}')" title="Rename">${AppIcons.edit}</button>
                <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}')" title="Delete">${AppIcons.trash}</button>
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
        <div class="empty-icon">${AppIcons.refresh}</div>
        <div class="empty-title">Discovering photos...</div>
      </div>
    `;

    const res = await ApiService.getPhotos();
    if (!res.success || !Array.isArray(res.data?.items) || res.data.items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${AppIcons.photo}</div>
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
            <img src="${downloadUrl}" alt="${photo.name}" loading="lazy" onerror="this.parentElement.innerHTML='<span style=\\'display:flex;align-items:center;justify-content:center;\\'>${AppIcons.photo.replace(/'/g, "\\'")}</span>'">
          </div>
          <div class="photo-meta-bar">
            <span class="photo-name" title="${photo.name}">${photo.name}</span>
            <span class="photo-size">${StorageUtils.formatBytes(photo.sizeBytes)} • ${StorageUtils.formatDate(photo.modifiedAt)}</span>
            <div style="display: flex; gap: 4px; margin-top: 6px; justify-content: flex-end;">
              <a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download">${AppIcons.download}</a>
              <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}', () => PhotosController.load())" title="Delete">${AppIcons.trash}</button>
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
        <div class="empty-icon">${AppIcons.refresh}</div>
        <div class="empty-title">Discovering videos...</div>
      </div>
    `;

    const res = await ApiService.getVideos();
    if (!res.success || !Array.isArray(res.data?.items) || res.data.items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${AppIcons.video}</div>
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
            <div class="video-play-btn"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
          </div>
          <div style="padding: 12px;">
            <div style="font-weight: 700; font-size: var(--font-size-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${video.name}">${video.name}</div>
            <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 4px;">${StorageUtils.formatBytes(video.sizeBytes)} • ${StorageUtils.formatDate(video.modifiedAt)}</div>
            <div style="display: flex; gap: 4px; margin-top: 8px; justify-content: flex-end;">
              <a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download">${AppIcons.download}</a>
              <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}', () => VideosController.load())" title="Delete">${AppIcons.trash}</button>
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
                  <a href="${downloadUrl}" class="btn btn-secondary btn-sm" download title="Download">${AppIcons.download}</a>
                  <button class="btn btn-danger btn-sm" onclick="FileManagerHelper.promptDelete('${safePath}', '${safeName}', () => StorageController.load())" title="Delete">${AppIcons.trash}</button>
                </div>
              </td>
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
  openItem(path, name, category, itemDetails = {}) {
    const downloadUrl = ApiService.getDownloadUrl(path);
    if (category === 'photos' || category === 'images' || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name)) {
      UIManager.showLightbox(name, downloadUrl, downloadUrl);
    } else if (category === 'videos' || /\.(mp4|webm|mkv|mov|avi)$/i.test(name)) {
      UIManager.showVideoModal(name, downloadUrl, downloadUrl);
    } else if (category === 'audio' || /\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) {
      UIManager.showAudioModal(name, downloadUrl, downloadUrl);
    } else {
      UIManager.showFileInfoModal({
        name: name,
        path: path,
        category: category || 'Document',
        sizeBytes: itemDetails.sizeBytes,
        modifiedAt: itemDetails.modifiedAt
      });
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

    UIManager.showModal('modal-upload');
    const queueContainer = document.getElementById('modal-upload-queue');
    if (queueContainer) {
      let queueHtml = '';
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        queueHtml += `
          <div class="upload-queue-card" id="upload-item-${i}">
            <div class="upload-file-icon">${AppIcons.document}</div>
            <div class="upload-file-meta">
              <div class="upload-file-name">${file.name}</div>
              <div class="upload-file-size">${StorageUtils.formatBytes(file.size)} • <span id="upload-status-${i}">Queued</span></div>
              <div class="upload-progress-bar-wrap">
                <div class="upload-progress-bar-fill" id="upload-progress-${i}" style="width: 0%;"></div>
              </div>
            </div>
          </div>
        `;
      }
      queueContainer.innerHTML = queueHtml;
    }

    let successCount = 0;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const statusEl = document.getElementById(`upload-status-${i}`);
      const progressEl = document.getElementById(`upload-progress-${i}`);

      if (statusEl) statusEl.textContent = 'Uploading...';
      if (progressEl) progressEl.style.width = '50%';

      const res = await ApiService.uploadFile(targetPath, file);

      if (res.success) {
        successCount++;
        if (statusEl) {
          statusEl.textContent = 'Completed';
          statusEl.style.color = 'var(--color-status-online)';
        }
        if (progressEl) {
          progressEl.style.width = '100%';
          progressEl.style.backgroundColor = 'var(--color-status-online)';
        }
      } else {
        if (statusEl) {
          statusEl.textContent = res.error?.message || 'Failed';
          statusEl.style.color = 'var(--color-status-error)';
        }
        if (progressEl) {
          progressEl.style.width = '100%';
          progressEl.style.backgroundColor = 'var(--color-status-error)';
        }
      }
    }

    if (successCount > 0) {
      UIManager.showToast(`${successCount} file(s) uploaded successfully`, 'online');
      MyFilesController.load();
      HomeController.load();
    }
    setTimeout(() => {
      UIManager.hideModal('modal-upload');
    }, 1200);
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
