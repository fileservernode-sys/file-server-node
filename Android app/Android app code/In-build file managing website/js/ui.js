/**
 * UI State & Modal Dialog Manager
 */
const UIManager = {
  showModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
  },

  hideModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
  },

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `badge badge-${type === 'error' ? 'error' : 'online'}`;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.zIndex = '2000';
    toast.style.padding = '12px 20px';
    toast.style.boxShadow = 'var(--shadow-lg)';
    toast.textContent = message;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
};
