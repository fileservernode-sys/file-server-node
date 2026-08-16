/**
 * RemoteNode File Manager Application Initialization
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
  filePicker?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      FileManagerHelper.handleUpload(e.target.files);
      filePicker.value = '';
    }
  });

  // 3. Quick Upload Button Triggers
  document.getElementById('btn-quick-upload')?.addEventListener('click', () => filePicker?.click());
  document.getElementById('btn-home-upload')?.addEventListener('click', () => filePicker?.click());

  // 4. Quick New Folder Button Triggers
  document.getElementById('btn-home-new-folder')?.addEventListener('click', () => {
    UIManager.showModal('modal-new-folder');
  });

  // 5. New Folder Form Submission
  document.getElementById('form-new-folder')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('input-folder-name');
    const folderName = input.value.trim();
    if (folderName) {
      FileManagerHelper.handleCreateFolder(folderName);
      input.value = '';
      UIManager.hideModal('modal-new-folder');
    }
  });

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
