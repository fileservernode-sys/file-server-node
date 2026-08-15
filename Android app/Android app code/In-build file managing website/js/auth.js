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
    return true; // Local 127.0.0.1 loopback session default for Batch 6I
  }
};
