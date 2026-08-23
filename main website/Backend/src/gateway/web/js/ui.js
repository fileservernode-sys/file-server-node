/**
 * RemoteNode UI State & Modal Dialog Manager
 */
const UIManager = {
  activeModalId: null,

  hideAllModals() {
    const modalIds = [
      'modal-new-folder',
      'modal-rename',
      'modal-delete',
      'modal-upload',
      'modal-lightbox',
      'modal-video-player',
      'modal-audio-player',
      'modal-file-info'
    ];
    modalIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
        el.classList.remove('is-open', 'active');
        el.setAttribute('aria-hidden', 'true');
      }
    });

    const videoEl = document.getElementById('video-player-el');
    if (videoEl && !videoEl.paused) {
      videoEl.pause();
      videoEl.src = '';
    }
    const audioEl = document.getElementById('audio-player-el');
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
      audioEl.src = '';
    }

    this.activeModalId = null;
    document.body.style.overflow = '';
  },

  showModal(modalId) {
    this.hideAllModals();
    const el = document.getElementById(modalId);
    if (el) {
      el.style.display = 'flex';
      el.classList.add('is-open', 'active');
      el.setAttribute('aria-hidden', 'false');
      this.activeModalId = modalId;
      document.body.style.overflow = 'hidden';

      const focusable = el.querySelector('input:not([type="hidden"]), button:not([disabled]), a[href]');
      if (focusable) {
        setTimeout(() => focusable.focus(), 50);
      }
    }
  },

  hideModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.style.display = 'none';
      el.classList.remove('is-open', 'active');
      el.setAttribute('aria-hidden', 'true');
    }
    if (this.activeModalId === modalId) {
      this.activeModalId = null;
    }
    const openModals = document.querySelectorAll('.modal.is-open, .modal-overlay.is-open, .modal[style*="display: flex"], .modal[style*="display:flex"], .modal-overlay[style*="display: flex"], .modal-overlay[style*="display:flex"]');
    if (openModals.length === 0) {
      document.body.style.overflow = '';
    }
  },

  closeActiveModal() {
    if (this.activeModalId) {
      if (this.activeModalId === 'modal-video-player') {
        this.hideVideoModal();
      } else if (this.activeModalId === 'modal-audio-player') {
        this.hideAudioModal();
      } else {
        this.hideModal(this.activeModalId);
      }
    } else {
      this.hideAllModals();
    }
  },

  showToast(message, type = 'online') {
    const container = document.getElementById('toast-container') || document.body;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type === 'error' ? 'error' : (type === 'warning' ? 'warning' : 'online')}`;
    toast.textContent = message;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 3500);
  },

  showLightbox(title, imgUrl, downloadUrl) {
    const titleEl = document.getElementById('lightbox-title');
    const imgEl = document.getElementById('lightbox-img');
    const downloadEl = document.getElementById('lightbox-download-link');

    if (titleEl) titleEl.textContent = title;
    if (imgEl) imgEl.src = imgUrl;
    if (downloadEl) {
      downloadEl.href = downloadUrl;
      downloadEl.setAttribute('download', title);
    }

    this.showModal('modal-lightbox');
  },

  showVideoModal(title, videoUrl, downloadUrl) {
    const titleEl = document.getElementById('video-player-title');
    const videoEl = document.getElementById('video-player-el');
    const downloadEl = document.getElementById('video-download-link');

    if (titleEl) titleEl.textContent = title;
    if (videoEl) {
      videoEl.src = videoUrl;
      videoEl.load();
      videoEl.play().catch(() => {});
    }
    if (downloadEl) {
      downloadEl.href = downloadUrl;
      downloadEl.setAttribute('download', title);
    }

    this.showModal('modal-video-player');
  },

  hideVideoModal() {
    const videoEl = document.getElementById('video-player-el');
    if (videoEl) {
      videoEl.pause();
      videoEl.src = '';
    }
    this.hideModal('modal-video-player');
  },

  showAudioModal(title, audioUrl, downloadUrl) {
    const titleEl = document.getElementById('audio-player-title');
    const audioEl = document.getElementById('audio-player-el');
    const downloadEl = document.getElementById('audio-download-link');

    if (titleEl) titleEl.textContent = title;
    if (audioEl) {
      audioEl.src = audioUrl;
      audioEl.load();
      audioEl.play().catch(() => {});
    }
    if (downloadEl) {
      downloadEl.href = downloadUrl;
      downloadEl.setAttribute('download', title);
    }

    this.showModal('modal-audio-player');
  },

  hideAudioModal() {
    const audioEl = document.getElementById('audio-player-el');
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
    this.hideModal('modal-audio-player');
  },

  showFileInfoModal(item) {
    const nameEl = document.getElementById('file-info-name');
    const categoryEl = document.getElementById('file-info-category');
    const sizeEl = document.getElementById('file-info-size');
    const modifiedEl = document.getElementById('file-info-modified');
    const pathEl = document.getElementById('file-info-path');
    const iconContainer = document.getElementById('file-info-icon-container');
    const downloadEl = document.getElementById('file-info-download-link');

    if (nameEl) nameEl.textContent = item.name || 'File Details';
    if (categoryEl) categoryEl.textContent = (item.category || 'File').toUpperCase();
    if (sizeEl) sizeEl.textContent = item.sizeBytes ? StorageUtils.formatBytes(item.sizeBytes) : '—';
    if (modifiedEl) modifiedEl.textContent = item.modifiedAt ? StorageUtils.formatDate(item.modifiedAt) : '—';
    if (pathEl) pathEl.textContent = item.path || '/';

    if (iconContainer) {
      iconContainer.innerHTML = StorageUtils.getFileIcon(item.name, item.isDir);
    }

    if (downloadEl) {
      const downloadUrl = item.path ? ApiService.getDownloadUrl(item.path) : '#';
      downloadEl.href = downloadUrl;
      downloadEl.setAttribute('download', item.name || 'file');
    }

    this.showModal('modal-file-info');
  },

  showRenameDialog(itemPath, currentName, onSaveCallback) {
    document.getElementById('rename-old-path').value = itemPath;
    const inputEl = document.getElementById('input-rename-name');
    inputEl.value = currentName;
    
    const form = document.getElementById('form-rename');
    form.onsubmit = (e) => {
      e.preventDefault();
      const newName = inputEl.value.trim();
      if (newName && newName !== currentName) {
        onSaveCallback(newName);
      }
      this.hideModal('modal-rename');
    };

    this.showModal('modal-rename');
    setTimeout(() => inputEl.focus(), 50);
  },

  showDeleteDialog(itemPath, itemName, onConfirmCallback) {
    document.getElementById('delete-item-name').textContent = `"${itemName}"`;
    const btn = document.getElementById('btn-confirm-delete');
    btn.onclick = () => {
      onConfirmCallback();
      this.hideModal('modal-delete');
    };
    this.showModal('modal-delete');
  }
};

// Global ESC key event listener to close active modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Esc') {
    UIManager.closeActiveModal();
  }
});
