/**
 * Frontend Authentication State & API Client — RemoteNode Control Plane
 * STRICT RULE: OTP Only. No verification links. No reset links.
 */

// Base API configuration: Automatically switches between local dev and live staging/production backend
const API_BASE_URL = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' || !window.location.hostname)) 
  ? 'http://localhost:4000/api/v1' 
  : (window.location.hostname === 'gateway.viewduration.com' 
      ? '/api/v1' 
      : 'https://gateway.viewduration.com/api/v1');

if (typeof window !== 'undefined') {
  window.API_BASE_URL = API_BASE_URL;
}

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
    let json = {};
    try {
      json = await res.json();
    } catch {
      json = { success: res.ok };
    }
    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    return { 
      ok: false, 
      status: 0, 
      data: { 
        success: false, 
        error: { 
          code: 'NETWORK_ERROR', 
          message: 'Unable to connect to platform backend API server' 
        } 
      } 
    };
  }
}

// -----------------------------------------------------------------------------
// AUTH ACTIONS
// -----------------------------------------------------------------------------

// 1. Email + Password Registration -> Dispatches Email OTP
async function registerUser(email, password, fullName) {
  const result = await apiRequest('/auth/register', 'POST', { email, password, fullName });
  if (result.ok && result.data && result.data.success && result.data.data && result.data.data.requiresOtp) {
    window.location.href = `verify-otp.html?email=${encodeURIComponent(email)}&action=registration`;
    return { success: true };
  }
  return { success: false, error: result.data?.error?.message || 'Registration failed' };
}

// 2. Email + Password Login -> Dispatches 2FA Email OTP
async function loginUser(email, password) {
  const result = await apiRequest('/auth/login', 'POST', { email, password });
  if (result.ok && result.data && result.data.success && result.data.data && result.data.data.requiresOtp) {
    window.location.href = `verify-otp.html?email=${encodeURIComponent(email)}&action=login`;
    return { success: true };
  }
  return { success: false, error: result.data?.error?.message || 'Invalid email or password' };
}

// 3. Verify 6-Digit Email OTP (Registration / Login)
async function verifyOtp(email, code) {
  const result = await apiRequest('/auth/verify-otp', 'POST', { email, otp: code, code });
  if (result.ok && result.data && result.data.success) {
    const token = result.data.data?.token || result.data.data?.session?.accessToken;
    const user = result.data.data?.user;
    if (token) {
      saveSession(token, user);
    }
    window.location.href = 'dashboard.html';
    return { success: true };
  }
  return { success: false, error: result.data?.error?.message || 'Invalid 6-digit OTP code' };
}

// 4. Request Password Reset -> Dispatches 6-Digit Reset OTP
async function forgotPassword(email) {
  const result = await apiRequest('/auth/forgot-password', 'POST', { email });
  if (result.ok && result.data && result.data.success) {
    return { success: true, message: result.data.data?.message };
  }
  return { success: false, error: result.data?.error?.message || 'Failed to request password reset' };
}

// 5. Verify Password Reset OTP
async function verifyPasswordResetOtp(email, otp) {
  const result = await apiRequest('/auth/verify-password-reset-otp', 'POST', { email, otp, code: otp });
  if (result.ok && result.data && result.data.success) {
    return { success: true, message: result.data.data?.message };
  }
  return { success: false, error: result.data?.error?.message || 'Invalid or expired password reset code' };
}

// 6. Reset Password with OTP & New Password
async function resetPassword(email, otp, newPassword) {
  const result = await apiRequest('/auth/reset-password', 'POST', { email, otp, code: otp, newPassword });
  if (result.ok && result.data && result.data.success) {
    return { success: true, message: result.data.data?.message };
  }
  return { success: false, error: result.data?.error?.message || 'Password reset failed' };
}

// 7. Resend OTP
async function resendOtp(email) {
  const result = await apiRequest('/auth/resend-otp', 'POST', { email });
  if (result.ok && result.data && result.data.success) {
    return { success: true, message: result.data.data?.message };
  }
  return { success: false, error: result.data?.error?.message || 'Failed to resend verification code' };
}

// 8. Sign Out
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
  forgotPassword,
  verifyPasswordResetOtp,
  resetPassword,
  resendOtp,
  logoutUser
};
