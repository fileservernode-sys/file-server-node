/**
 * File Server Local Credential Session Management
 * Isolated completely from Platform Account credentials.
 */
const FileServerAuth = {
  TOKEN_KEY: 'rn_file_server_token',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  setToken(token) {
    localStorage.setItem(this.TOKEN_KEY, token);
  },

  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    window.location.reload();
  },

  isAuthenticated() {
    const token = this.getToken();
    return !!token && token.length > 5;
  },

  async login(email, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username: email, password })
      });
      const data = await res.json();
      if (res.ok && data.success && data.data?.token) {
        this.setToken(data.data.token);
        return { success: true };
      }
      return {
        success: false,
        error: data.error?.message || 'Invalid email address or password'
      };
    } catch (e) {
      return { success: false, error: e.message || 'Connection error to file server' };
    }
  }
};

async function handleFileServerLogin() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorAlert = document.getElementById('login-error-alert');
  const submitBtn = document.getElementById('btn-login-submit');

  if (!usernameInput || !passwordInput) return;

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Authenticating...';
  }
  if (errorAlert) {
    errorAlert.style.display = 'none';
  }

  const result = await FileServerAuth.login(username, password);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In to Storage';
  }

  if (result.success) {
    const overlay = document.getElementById('file-server-login-overlay');
    if (overlay) overlay.style.display = 'none';
    AppRouter.init();
    MyFilesController.init();
  } else {
    if (errorAlert) {
      errorAlert.textContent = result.error;
      errorAlert.style.display = 'block';
    }
  }
}
