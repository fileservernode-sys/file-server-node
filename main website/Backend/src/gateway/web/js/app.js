/**
 * ZdexCloud File Manager Application Initialization
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Check File Server Authentication
  if (!FileServerAuth.isAuthenticated()) {
    const overlay = document.getElementById('file-server-login-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
    }
  } else {
    AppRouter.init();
    MyFilesController.init();
  }

  // 2. Global File Picker Binding
  const filePicker = document.getElementById('file-picker');
  if (filePicker && !filePicker.dataset.bound) {
    filePicker.dataset.bound = 'true';
    filePicker.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        filePicker.value = '';
        FileManagerHelper.handleUpload(files);
      }
    });
  }

  // 3. Quick Upload Button Triggers
  document.getElementById('btn-quick-upload')?.addEventListener('click', () => {
    UIManager.showModal('modal-upload');
  });
  document.getElementById('btn-home-upload')?.addEventListener('click', () => {
    UIManager.showModal('modal-upload');
  });

  // 3b. Drag & Drop Upload Zone Bindings
  const dropZone = document.getElementById('upload-drop-zone');
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      FileManagerHelper.handleUpload(files);
    }
  });

  if (dropZone && !dropZone.dataset.bound) {
    dropZone.dataset.bound = 'true';
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        FileManagerHelper.handleUpload(files);
      }
    });
  }

  // 4. Quick New Folder Button Triggers
  document.getElementById('btn-home-new-folder')?.addEventListener('click', () => {
    UIManager.showModal('modal-new-folder');
  });

  // 5. New Folder Form Submission
  const newFolderForm = document.getElementById('form-new-folder');
  if (newFolderForm && !newFolderForm.dataset.appBound) {
    newFolderForm.dataset.appBound = 'true';
    newFolderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('input-folder-name');
      const submitBtn = newFolderForm.querySelector('button[type="submit"]');
      const folderName = input ? input.value.trim() : '';
      if (!folderName) {
        UIManager.showToast('Please enter a valid folder name', 'warning');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
      }

      try {
        const success = await FileManagerHelper.handleCreateFolder(folderName);
        if (success) {
          if (input) input.value = '';
          UIManager.hideModal('modal-new-folder');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Folder';
        }
      }
    });
  }

  // 6. Refresh Button Handlers
  document.getElementById('btn-photos-refresh')?.addEventListener('click', () => PhotosController.load());
  document.getElementById('btn-videos-refresh')?.addEventListener('click', () => VideosController.load());
  document.getElementById('btn-storage-refresh')?.addEventListener('click', () => StorageController.load());

  // 7. Dynamic Mode & Status Setup
  const isRemote = ApiService.isRemoteMode();
  const statusBadge = document.getElementById('connection-status-badge');
  const statusText = document.getElementById('connection-status-text');

  if (isRemote) {
    if (statusBadge) statusBadge.className = 'badge badge-online';
    if (statusText) statusText.textContent = 'REMOTE WSS GATEWAY';

    ApiService.onStatusChange((status, details) => {
      if (status === 'connected') {
        if (statusBadge) statusBadge.className = 'badge badge-online';
        if (statusText) statusText.textContent = 'REMOTE WSS ONLINE';
      } else if (status === 'disconnected' || status === 'error') {
        if (statusBadge) statusBadge.className = 'badge badge-error';
        if (statusText) statusText.textContent = 'GATEWAY RECONNECTING...';
        UIManager.showToast('Remote gateway disconnected. Reconnecting in background...', 'error');
      } else if (status === 'rate_limited') {
        if (statusBadge) statusBadge.className = 'badge badge-warning';
        if (statusText) statusText.textContent = 'RATE LIMITED';
        UIManager.showToast(details.message || 'Request rate limit reached. Throttling...', 'warning');
      }
    });
  } else {
    if (statusBadge) statusBadge.className = 'badge badge-online';
    if (statusText) statusText.textContent = 'LOCAL SERVER ONLINE';
  }
});
