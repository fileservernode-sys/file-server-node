/**
 * Frontend Authentication State & API Client — ZdexCloud Control Plane
 * STRICT 24-HOUR AUTHENTICATED SESSION POLICY (PHASE ZD-GROWTH-1.1)
 *
 * POLICY INVARIANTS:
 * - Authenticated session maximum age = exactly 24 hours (86,400,000 ms).
 * - No sliding expiration: active navigation does not extend session lifespan.
 * - Server authority preserved: backend 401 triggers instant local invalidation.
 * - Absolute Epoch timestamps (UTC) used for timezone independence.
 */

function getCalculatedApiBase() {
  if (typeof window === 'undefined') return '/api/v1';
  const host = window.location.hostname;
  const protocol = window.location.protocol;

  if (host === 'localhost' || host === '127.0.0.1' || protocol === 'file:' || !host) {
    return 'http://localhost:4000/api/v1';
  }
  if (host === 'gateway.zdexcloud.com' || host === 'api.zdexcloud.com') {
    return '/api/v1';
  }
  return 'https://api.zdexcloud.com/api/v1';
}

const API_BASE_URL = getCalculatedApiBase();

if (typeof window !== 'undefined') {
  window.API_BASE_URL = API_BASE_URL;
}

// Storage Keys
const AUTH_STORAGE_KEY = 'rn_auth_token';
const TOKEN_PRIMARY_KEY = 'zdexcloud_token';
const USER_STORAGE_KEY = 'rn_user_data';
const SESSION_ISSUED_KEY = 'zdexcloud_session_issued_at';
const SESSION_EXPIRES_KEY = 'zdexcloud_session_expires_at';
const SESSION_LEGACY_EXPIRES_KEY = 'rn_session_expires_at';

// Strict Session Timing Constants
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 Hours
const SESSION_WARNING_THRESHOLD_MS = 15 * 60 * 1000; // 15 Minutes before expiry

// Helper: Check if Current Session is Valid under Strict 24h Policy
function isSessionValid() {
  const token = localStorage.getItem(TOKEN_PRIMARY_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
  if (!token) return false;

  const issuedAtRaw = localStorage.getItem(SESSION_ISSUED_KEY);
  const expiresAtRaw = localStorage.getItem(SESSION_EXPIRES_KEY) || localStorage.getItem(SESSION_LEGACY_EXPIRES_KEY);

  // If token exists without timestamps (legacy session), treat as expired to enforce strict 24h policy
  if (!issuedAtRaw || !expiresAtRaw) {
    return false;
  }

  const issuedAt = parseInt(issuedAtRaw, 10);
  const expiresAt = parseInt(expiresAtRaw, 10);
  const now = Date.now();

  if (isNaN(issuedAt) || isNaN(expiresAt)) return false;

  // Strict check: current time must be before expiresAt AND within 24h of issuance
  if (now >= expiresAt) return false;
  if (now - issuedAt >= SESSION_MAX_AGE_MS) return false;

  return true;
}

// Helper: Get Milliseconds Remaining in Session
function getSessionTimeRemaining() {
  const expiresAtRaw = localStorage.getItem(SESSION_EXPIRES_KEY) || localStorage.getItem(SESSION_LEGACY_EXPIRES_KEY);
  if (!expiresAtRaw) return 0;
  const expiresAt = parseInt(expiresAtRaw, 10);
  if (isNaN(expiresAt)) return 0;
  const remaining = expiresAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

// Helper: Get Saved Auth Token (Enforces Strict 24h Expiry)
function getAuthToken() {
  const token = localStorage.getItem(TOKEN_PRIMARY_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
  if (!token) return null;

  if (!isSessionValid()) {
    handleSessionExpired('Your session has expired. Please sign in again.');
    return null;
  }

  return token;
}

// Helper: Get Saved User Object
function getSavedUser() {
  if (!isSessionValid()) return null;
  const data = localStorage.getItem(USER_STORAGE_KEY);
  try {
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

// Helper: Save Session (Records Absolute 24h Issued & Expiry Epoch Timestamps; No Sliding Expiration)
function saveSession(token, user, expiresAtIso = null) {
  const existingToken = localStorage.getItem(TOKEN_PRIMARY_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
  const existingIssuedAt = localStorage.getItem(SESSION_ISSUED_KEY);
  const existingExpiresAt = localStorage.getItem(SESSION_EXPIRES_KEY);
  const isSameSession = existingToken === token && existingIssuedAt && existingExpiresAt;

  localStorage.setItem(TOKEN_PRIMARY_KEY, token);
  localStorage.setItem(AUTH_STORAGE_KEY, token);

  // Only establish new timestamps on fresh login/token or when explicit server expiresAt is supplied
  if (!isSameSession || expiresAtIso) {
    const now = Date.now();
    const issuedAt = isSameSession ? parseInt(existingIssuedAt, 10) : now;
    localStorage.setItem(SESSION_ISSUED_KEY, issuedAt.toString());

    let calculatedExpiresAt = issuedAt + SESSION_MAX_AGE_MS;
    if (expiresAtIso) {
      const serverExp = new Date(expiresAtIso).getTime();
      if (!isNaN(serverExp) && serverExp > now) {
        calculatedExpiresAt = Math.min(serverExp, issuedAt + SESSION_MAX_AGE_MS);
      }
    }

    localStorage.setItem(SESSION_EXPIRES_KEY, calculatedExpiresAt.toString());
    localStorage.setItem(SESSION_LEGACY_EXPIRES_KEY, calculatedExpiresAt.toString());
  }

  if (user) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  }
}

// Helper: Clear Session Storage
function clearSession() {
  localStorage.removeItem(TOKEN_PRIMARY_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  localStorage.removeItem(SESSION_ISSUED_KEY);
  localStorage.removeItem(SESSION_EXPIRES_KEY);
  localStorage.removeItem(SESSION_LEGACY_EXPIRES_KEY);
}

// Helper: Handle Session Expiration with Clean Redirect and Safe Return URL
function handleSessionExpired(reason = 'Your session has expired. Please sign in again.') {
  if (typeof window === 'undefined') return;
  if (window._isHandlingSessionExpired) return;
  window._isHandlingSessionExpired = true;

  clearSession();

  const currentPath = window.location.pathname;
  const isProtectedPage = currentPath.includes('dashboard') ||
                          currentPath.includes('server-access') ||
                          currentPath.includes('notifications') ||
                          currentPath.includes('file-manager');

  const isPagesDir = currentPath.includes('/pages/');
  const loginUrl = isPagesDir ? 'login.html' : 'pages/login.html';

  if (isProtectedPage) {
    const returnTarget = currentPath.split('/').pop() + window.location.search;
    window.location.href = `${loginUrl}?expired=true&redirect=${encodeURIComponent(returnTarget)}`;
  }
}

// Helper: Display Non-Intrusive Expiration Warning when near 24h limit
function checkSessionWarning() {
  if (typeof document === 'undefined') return;
  if (!isSessionValid()) return;

  const remainingMs = getSessionTimeRemaining();
  if (remainingMs > 0 && remainingMs <= SESSION_WARNING_THRESHOLD_MS) {
    const remainingMins = Math.ceil(remainingMs / (60 * 1000));
    let banner = document.getElementById('zdex-session-warning-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'zdex-session-warning-banner';
      banner.setAttribute('role', 'alert');
      banner.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        max-width: 380px;
        background: #0F172A;
        color: #F8FAFC;
        border: 1px solid #D97706;
        border-left: 4px solid #D97706;
        border-radius: 8px;
        padding: 14px 18px;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
        z-index: 9999;
        font-family: var(--font-family-sans, sans-serif);
        font-size: 13px;
        line-height: 1.4;
        display: flex;
        gap: 12px;
        align-items: flex-start;
      `;
      document.body.appendChild(banner);
    }
    banner.innerHTML = `
      <div style="flex: 1;">
        <div style="font-weight: 600; color: #F59E0B; margin-bottom: 2px;">Session Notice</div>
        <div>Your session will expire in ${remainingMins} minute${remainingMins > 1 ? 's' : ''}. Please save your work or sign in again.</div>
      </div>
      <button type="button" onclick="this.parentElement.remove()" style="background: none; border: none; color: #94A3B8; cursor: pointer; padding: 2px;" aria-label="Dismiss warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;
  }
}

// API Call Wrapper with Automatic Multi-Base Fallback & 401 Interception
async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  const rawToken = token || localStorage.getItem(TOKEN_PRIMARY_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
  
  if (rawToken) {
    // If token exists but has expired by client clock, intercept immediately
    if (!isSessionValid()) {
      handleSessionExpired('Your session has expired. Please sign in again.');
      return {
        ok: false,
        status: 401,
        data: {
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Please sign in again.' }
        }
      };
    }
    headers['Authorization'] = `Bearer ${rawToken}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const candidates = [
    window.API_BASE_URL,
    getCalculatedApiBase(),
    'https://api.zdexcloud.com/api/v1',
    '/api/v1',
    'http://localhost:4000/api/v1'
  ].filter((url, index, self) => url && self.indexOf(url) === index);

  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const base = candidates[i];
    try {
      const res = await fetch(`${base}${endpoint}`, options);
      if (res.status === 404 && i < candidates.length - 1) {
        continue;
      }

      // Authoritative 401 Interception: If server declares session invalid/expired, purge client
      if (res.status === 401 && rawToken && endpoint !== '/auth/login' && endpoint !== '/auth/register') {
        handleSessionExpired('Your session has expired or is invalid. Please sign in again.');
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

// 3. Verify 6-Digit Email OTP (Registration / Login) -> Establishes Strict 24h Session
async function verifyOtp(email, code) {
  const result = await apiRequest('/auth/verify-otp', 'POST', { email, otp: code, code });
  if (result.ok && result.data && result.data.success) {
    const token = result.data.data?.token || result.data.data?.session?.accessToken;
    const user = result.data.data?.user;
    const expiresAt = result.data.data?.session?.expiresAt;
    if (token) {
      saveSession(token, user, expiresAt);
    }

    // Return to redirect target if present
    const urlParams = new URLSearchParams(window.location.search);
    const redirectUrl = urlParams.get('redirect');
    if (redirectUrl && !redirectUrl.startsWith('http') && !redirectUrl.startsWith('//')) {
      window.location.href = redirectUrl;
    } else {
      window.location.href = 'dashboard.html';
    }
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
  try {
    await apiRequest('/auth/logout', 'POST');
  } catch (_) {}
  clearSession();
  const isInnerPage = window.location.pathname.includes('/pages/');
  window.location.href = isInnerPage ? 'login.html' : 'pages/login.html';
}

// Expose globally
window.AuthService = {
  getAuthToken,
  getSavedUser,
  saveSession,
  clearSession,
  isSessionValid,
  getSessionTimeRemaining,
  handleSessionExpired,
  checkSessionWarning,
  registerUser,
  loginUser,
  verifyOtp,
  forgotPassword,
  verifyPasswordResetOtp,
  resetPassword,
  resendOtp,
  logoutUser,
  SESSION_MAX_AGE_MS
};
