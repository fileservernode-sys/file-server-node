/**
 * Frontend Authentication State & API Client — RemoteNode Control Plane
 * STRICT RULE: OTP Only. No verification links. No reset links.
 */

function getCalculatedApiBase() {
  if (typeof window === 'undefined') return '/api/v1';
  const host = window.location.hostname;
  const protocol = window.location.protocol;

  if (host === 'localhost' || host === '127.0.0.1' || protocol === 'file:' || !host) {
    return 'http://localhost:4000/api/v1';
  }
  if (host === 'gateway.viewduration.com') {
    return '/api/v1';
  }
  return 'https://gateway.viewduration.com/api/v1';
}

const API_BASE_URL = getCalculatedApiBase();

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

// API Call Wrapper with Automatic Multi-Base Fallback
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

  // Base URL candidates for maximum resilience across dev, local server, and production
  const candidates = [
    window.API_BASE_URL,
    getCalculatedApiBase(),
    'https://gateway.viewduration.com/api/v1',
    '/api/v1',
    'http://localhost:4000/api/v1'
  ].filter((url, index, self) => url && self.indexOf(url) === index);

  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const base = candidates[i];
    try {
      const res = await fetch(`${base}${endpoint}`, options);
      if (res.status === 404 && i < candidates.length - 1) {
        continue; // Try next candidate if endpoint route is 404 on current base URL
      }
      let json = {};
      try {
        json = await res.json();
      } catch {
        json = { success: res.ok };
      }
      return { ok: res.ok, status: res.status, data: json };
    } catch (err) {
      lastError = err;
      if (i < candidates.length - 1) {
        continue;
      }
    }
  }

  return { 
    ok: false, 
    status: 0, 
    data: { 
      success: false, 
      error: { 
        code: 'NETWORK_ERROR', 
        message: 'Could not connect to backend control plane.' 
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
