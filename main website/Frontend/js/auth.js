/**
 * Frontend Authentication State & API Client — ZdexCloud Control Plane
 * COOKIE-AUTHENTICATED BROWSER SESSION ARCHITECTURE (PHASE 14.14)
 *
 * POLICY INVARIANTS:
 * - Browser authentication exclusively uses HttpOnly __Host-zdex_session cookie.
 * - Zero session tokens stored in localStorage, sessionStorage, or Web Storage.
 * - In-memory CSRF token management (x-zdex-csrf-token) for state-changing operations.
 * - Automatic credentials: 'include' across all API requests.
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

// Storage Keys (Only safe, non-sensitive UI cache)
const USER_STORAGE_KEY = 'rn_user_data';

// Legacy keys to purge for migration security
const LEGACY_STORAGE_KEYS = [
  'zdexcloud_token',
  'rn_auth_token',
  'token',
  'accessToken',
  'sessionToken',
  'zdexcloud_session_issued_at',
  'zdexcloud_session_expires_at',
  'rn_session_expires_at'
];

// Strict Session Timing Constants
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 Hours
const SESSION_WARNING_THRESHOLD_MS = 15 * 60 * 1000; // 15 Minutes before expiry

// -----------------------------------------------------------------------------
// IN-MEMORY AUTHENTICATION STATE (Zero credentials in Web Storage)
// -----------------------------------------------------------------------------
let _inMemoryCsrfToken = null;
let _currentUser = null;
let _sessionExpiresAt = null;
let _sessionIssuedAt = null;
let _isAuthenticated = false;
let _initSessionPromise = null;
let _authBroadcastChannel = null;

// Clean up legacy credential keys immediately on script evaluation
function cleanupLegacyStorage() {
  if (typeof localStorage !== 'undefined') {
    for (const key of LEGACY_STORAGE_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    for (const key of LEGACY_STORAGE_KEYS) {
      try {
        sessionStorage.removeItem(key);
      } catch (_) {}
    }
  }
}
cleanupLegacyStorage();

// Multi-Tab Session Synchronization via BroadcastChannel
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    _authBroadcastChannel = new BroadcastChannel('zdexcloud_auth_channel');
    _authBroadcastChannel.onmessage = (event) => {
      if (event.data?.type === 'CUSTOMER_LOGGED_OUT') {
        _currentUser = null;
        _isAuthenticated = false;
        _inMemoryCsrfToken = null;
        _sessionExpiresAt = null;
        _sessionIssuedAt = null;
        cleanupLegacyStorage();
        try { localStorage.removeItem(USER_STORAGE_KEY); } catch (_) {}
        const currentPath = window.location.pathname;
        const isProtectedPage = currentPath.includes('dashboard') ||
                                currentPath.includes('server-access') ||
                                currentPath.includes('notifications') ||
                                currentPath.includes('file-manager');
        if (isProtectedPage) {
          const isPagesDir = currentPath.includes('/pages/');
          window.location.href = isPagesDir ? 'login.html?logout=true' : 'pages/login.html?logout=true';
        }
      } else if (event.data?.type === 'CUSTOMER_LOGGED_IN') {
        initSession(true);
      }
    };
  } catch (_) {}
}

function broadcastAuthEvent(type) {
  if (_authBroadcastChannel) {
    try {
      _authBroadcastChannel.postMessage({ type, timestamp: Date.now() });
    } catch (_) {}
  }
}

// -----------------------------------------------------------------------------
// SESSION STATE HELPERS
// -----------------------------------------------------------------------------

// Helper: Check if Current In-Memory Session is Valid
function isSessionValid() {
  if (!_isAuthenticated || !_currentUser) {
    return false;
  }

  const now = Date.now();
  if (_sessionExpiresAt && now >= _sessionExpiresAt) {
    return false;
  }
  if (_sessionIssuedAt && (now - _sessionIssuedAt >= SESSION_MAX_AGE_MS)) {
    return false;
  }

  return true;
}

// Helper: Get Milliseconds Remaining in Session
function getSessionTimeRemaining() {
  if (!_sessionExpiresAt) return 0;
  const remaining = _sessionExpiresAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

// Helper: Get Saved Auth Token (In Phase 14.14, browser relies on HttpOnly cookie; returns null)
function getAuthToken() {
  return null;
}

// Helper: Get In-Memory CSRF Token
function getCsrfToken() {
  return _inMemoryCsrfToken;
}

// Helper: Set In-Memory CSRF Token
function setCsrfToken(token) {
  _inMemoryCsrfToken = token || null;
}

// Helper: Get Saved User Object (In-memory or safe cached profile)
function getSavedUser() {
  if (_currentUser) return _currentUser;
  if (typeof localStorage !== 'undefined') {
    const data = localStorage.getItem(USER_STORAGE_KEY);
    try {
      return data ? JSON.parse(data) : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

// Helper: Save Session In Memory (No Token Stored in Web Storage)
function saveSession(token, user, expiresAtIso = null) {
  if (user) {
    _currentUser = user;
    _isAuthenticated = true;
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        plan: user.plan
      }));
    } catch (_) {}
  }

  const now = Date.now();
  if (!_sessionIssuedAt) {
    _sessionIssuedAt = now;
  }

  if (expiresAtIso) {
    const serverExp = new Date(expiresAtIso).getTime();
    if (!isNaN(serverExp) && serverExp > now) {
      _sessionExpiresAt = Math.min(serverExp, _sessionIssuedAt + SESSION_MAX_AGE_MS);
    } else {
      _sessionExpiresAt = _sessionIssuedAt + SESSION_MAX_AGE_MS;
    }
  } else if (!_sessionExpiresAt) {
    _sessionExpiresAt = _sessionIssuedAt + SESSION_MAX_AGE_MS;
  }
}

// Helper: Clear In-Memory and Storage Session
function clearSession() {
  _currentUser = null;
  _isAuthenticated = false;
  _inMemoryCsrfToken = null;
  _sessionExpiresAt = null;
  _sessionIssuedAt = null;
  cleanupLegacyStorage();
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch (_) {}
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
}

// Helper: Handle Session Expiration with Clean Redirect and Safe Return URL
function handleSessionExpired(reason = 'Your session has expired. Please sign in again.') {
  if (typeof window === 'undefined') return;
  if (window._isHandlingSessionExpired) return;
  window._isHandlingSessionExpired = true;

  clearSession();
  broadcastAuthEvent('CUSTOMER_LOGGED_OUT');

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

// -----------------------------------------------------------------------------
// SESSION INITIALIZATION & RESTORATION (GET /auth/me via HttpOnly Cookie)
// -----------------------------------------------------------------------------
async function initSession(forceRefresh = false) {
  if (_initSessionPromise && !forceRefresh) {
    return _initSessionPromise;
  }

  _initSessionPromise = (async () => {
    try {
      const res = await apiRequestInternal('/auth/me', 'GET');
      if (res.ok && res.data && res.data.success && res.data.data?.user) {
        _currentUser = res.data.data.user;
        _isAuthenticated = true;
        if (res.data.data.csrfToken) {
          _inMemoryCsrfToken = res.data.data.csrfToken;
        }
        if (res.data.data.session?.expiresAt) {
          _sessionExpiresAt = new Date(res.data.data.session.expiresAt).getTime();
        } else {
          _sessionExpiresAt = Date.now() + SESSION_MAX_AGE_MS;
        }
        if (res.data.data.session?.issuedAt) {
          _sessionIssuedAt = new Date(res.data.data.session.issuedAt).getTime();
        } else {
          _sessionIssuedAt = Date.now();
        }

        try {
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
            id: _currentUser.id,
            email: _currentUser.email,
            fullName: _currentUser.fullName,
            plan: _currentUser.plan
          }));
        } catch (_) {}

        return { authenticated: true, user: _currentUser, csrfToken: _inMemoryCsrfToken };
      } else {
        _currentUser = null;
        _isAuthenticated = false;
        _inMemoryCsrfToken = null;
        _sessionExpiresAt = null;
        _sessionIssuedAt = null;
        try { localStorage.removeItem(USER_STORAGE_KEY); } catch (_) {}
        return { authenticated: false, user: null };
      }
    } catch (err) {
      _currentUser = null;
      _isAuthenticated = false;
      _inMemoryCsrfToken = null;
      _sessionExpiresAt = null;
      _sessionIssuedAt = null;
      return { authenticated: false, user: null };
    } finally {
      _initSessionPromise = null;
    }
  })();

  return _initSessionPromise;
}

// -----------------------------------------------------------------------------
// CENTRAL API CLIENT WRAPPER (HttpOnly Cookies + CSRF Header + 401 Interception)
// -----------------------------------------------------------------------------

async function apiRequestInternal(endpoint, method = 'GET', body = null, isRetry = false) {
  const headers = { 'Content-Type': 'application/json' };
  const upperMethod = method.toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod);

  // Attach CSRF synchronizer token for cookie-authenticated mutations
  if (isStateChanging && _inMemoryCsrfToken) {
    headers['x-zdex-csrf-token'] = _inMemoryCsrfToken;
  }

  const options = {
    method: upperMethod,
    headers,
    credentials: 'include' // Transmits HttpOnly __Host-zdex_session cookie
  };

  if (body) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const candidates = [
    window.API_BASE_URL,
    getCalculatedApiBase(),
    'https://api.zdexcloud.com/api/v1',
    '/api/v1',
    'http://localhost:4000/api/v1'
  ].filter((url, index, self) => url && self.indexOf(url) === index);

  for (let i = 0; i < candidates.length; i++) {
    const base = candidates[i];
    try {
      const res = await fetch(`${base}${endpoint}`, options);
      if (res.status === 404 && i < candidates.length - 1) {
        continue;
      }

      let json = {};
      try {
        json = await res.json();
      } catch {
        json = { success: res.ok };
      }

      // Capture fresh CSRF token if returned by server
      if (json?.data?.csrfToken) {
        _inMemoryCsrfToken = json.data.csrfToken;
      } else if (json?.csrfToken) {
        _inMemoryCsrfToken = json.csrfToken;
      }

      // CSRF Failure Recovery: Retry once after refreshing CSRF token via /auth/me
      if (res.status === 403 && isStateChanging && !isRetry && endpoint !== '/auth/login' && endpoint !== '/auth/register') {
        const errCode = json?.error?.code;
        if (errCode === 'FORBIDDEN' || errCode === 'CSRF_TOKEN_MISSING' || errCode === 'CSRF_TOKEN_INVALID') {
          const authCheck = await initSession(true);
          if (authCheck.authenticated && _inMemoryCsrfToken) {
            return apiRequestInternal(endpoint, method, body, true);
          }
        }
      }

      // Authoritative 401 Interception: If server declares session invalid/expired, purge client
      if (res.status === 401 && _isAuthenticated && endpoint !== '/auth/login' && endpoint !== '/auth/register' && endpoint !== '/auth/verify-otp') {
        handleSessionExpired('Your session has expired or is invalid. Please sign in again.');
      }

      return { ok: res.ok, status: res.status, data: json };
    } catch (err) {
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

// Public API Request Wrapper
async function apiRequest(endpoint, method = 'GET', body = null) {
  return apiRequestInternal(endpoint, method, body, false);
}

if (typeof window !== 'undefined') {
  window.apiRequest = apiRequest;
}

// -----------------------------------------------------------------------------
// AUTH ACTIONS
// -----------------------------------------------------------------------------

// 1. Email + Password Registration -> Dispatches Email OTP
async function registerUser(email, password, fullName) {
  const result = await apiRequest('/auth/register', 'POST', { email, password, fullName });
  if (result.ok && result.data && result.data.success && result.data.data && result.data.data.requiresOtp) {
    const urlParams = new URLSearchParams(window.location.search);
    const plan = urlParams.get('plan');
    const redirect = urlParams.get('redirect');
    let target = `verify-otp.html?email=${encodeURIComponent(email)}&action=registration`;
    if (plan) target += `&plan=${encodeURIComponent(plan)}`;
    if (redirect) target += `&redirect=${encodeURIComponent(redirect)}`;
    window.location.href = target;
    return { success: true };
  }
  return { success: false, error: result.data?.error?.message || 'Registration failed' };
}

// 2. Email + Password Login -> Dispatches 2FA Email OTP
async function loginUser(email, password) {
  const result = await apiRequest('/auth/login', 'POST', { email, password });
  if (result.ok && result.data && result.data.success && result.data.data && result.data.data.requiresOtp) {
    const urlParams = new URLSearchParams(window.location.search);
    const plan = urlParams.get('plan');
    const redirect = urlParams.get('redirect');
    let target = `verify-otp.html?email=${encodeURIComponent(email)}&action=login`;
    if (plan) target += `&plan=${encodeURIComponent(plan)}`;
    if (redirect) target += `&redirect=${encodeURIComponent(redirect)}`;
    window.location.href = target;
    return { success: true };
  }
  return { success: false, error: result.data?.error?.message || 'Invalid email or password' };
}

// 3. Verify 6-Digit Email OTP (Registration / Login) -> Establishes Strict 24h Session Cookie
async function verifyOtp(email, code) {
  const result = await apiRequest('/auth/verify-otp', 'POST', { email, otp: code, code });
  if (result.ok && result.data && result.data.success) {
    const user = result.data.data?.user;
    const expiresAt = result.data.data?.session?.expiresAt;
    const csrfToken = result.data.data?.csrfToken;

    if (csrfToken) {
      _inMemoryCsrfToken = csrfToken;
    }

    // Save session in memory (No token stored in Web Storage)
    saveSession(null, user, expiresAt);
    broadcastAuthEvent('CUSTOMER_LOGGED_IN');

    // Return to redirect target or plan if present
    const urlParams = new URLSearchParams(window.location.search);
    const redirectUrl = urlParams.get('redirect');
    const planParam = urlParams.get('plan');
    if (redirectUrl && !redirectUrl.startsWith('http') && !redirectUrl.startsWith('//')) {
      window.location.href = redirectUrl;
    } else if (planParam) {
      window.location.href = `pricing.html?plan=${encodeURIComponent(planParam)}`;
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

// 8. Sign Out (Clears Backend Cookie & In-Memory State)
async function logoutUser() {
  try {
    await apiRequest('/auth/logout', 'POST');
  } catch (_) {}
  clearSession();
  broadcastAuthEvent('CUSTOMER_LOGGED_OUT');
  const isInnerPage = window.location.pathname.includes('/pages/');
  window.location.href = isInnerPage ? 'login.html?logout=true' : 'pages/login.html?logout=true';
}

// Expose globally
window.AuthService = {
  getAuthToken,
  getCsrfToken,
  setCsrfToken,
  getSavedUser,
  saveSession,
  clearSession,
  isSessionValid,
  initSession,
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
