/**
 * Frontend Authentication State & API Client — RemoteNode Control Plane
 */

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://localhost:4000/api/v1' 
  : '/api/v1';

const AUTH_STORAGE_KEY = 'rn_auth_token';
const USER_STORAGE_KEY = 'rn_user_data';

// Helper: Get Saved Auth Token
function getAuthToken() {
  return localStorage.getItem(AUTH_STORAGE_KEY);
}

// Helper: Get Saved User Object
function getSavedUser() {
  const data = localStorage.getItem(USER_STORAGE_KEY);
  try {
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

// Helper: Save Session
function saveSession(token, user) {
  localStorage.setItem(AUTH_STORAGE_KEY, token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

// Helper: Clear Session
function clearSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
}

// API Call Wrapper
async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  const authToken = token || getAuthToken();
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, options);
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    return { ok: false, status: 0, data: { success: false, error: { code: 'NETWORK_ERROR', message: 'Unable to connect to platform backend API server' } } };
  }
}

// -----------------------------------------------------------------------------
// AUTH ACTIONS
// -----------------------------------------------------------------------------

// 1. Email + Password Registration
async function registerUser(email, password, fullName) {
  const result = await apiRequest('/auth/register', 'POST', { email, password, fullName });
  if (result.ok && result.data.success && result.data.data.requiresOtp) {
    window.location.href = `verify-otp.html?email=${encodeURIComponent(email)}&action=registration`;
    return { success: true };
  }
  return { success: false, error: result.data.error?.message || 'Registration failed' };
}

// 2. Email + Password Login
async function loginUser(email, password) {
  const result = await apiRequest('/auth/login', 'POST', { email, password });
  if (result.ok && result.data.success && result.data.data.requiresOtp) {
    window.location.href = `verify-otp.html?email=${encodeURIComponent(email)}&action=login`;
    return { success: true };
  }
  return { success: false, error: result.data.error?.message || 'Invalid email or password' };
}

// 3. Verify 6-Digit Email OTP
async function verifyOtp(email, code) {
  const result = await apiRequest('/auth/verify-otp', 'POST', { email, otp: code, code });
  if (result.ok && result.data.success) {
    const token = result.data.data.token || result.data.data.session?.accessToken;
    const user = result.data.data.user;
    saveSession(token, user);
    window.location.href = 'dashboard.html';
    return { success: true };
  }
  return { success: false, error: result.data.error?.message || 'Invalid 6-digit OTP code' };
}

// 4. Sign Out
async function logoutUser() {
  await apiRequest('/auth/logout', 'POST');
  clearSession();
  window.location.href = 'login.html';
}

// Expose globally
window.AuthService = {
  getAuthToken,
  getSavedUser,
  registerUser,
  loginUser,
  verifyOtp,
  logoutUser
};
