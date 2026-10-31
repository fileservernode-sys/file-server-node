# ZDEXCLOUD — PHASE ZD-GROWTH-1 / BATCH ZD-GROWTH-1.1
# AUTHENTICATION & SESSION ARCHITECTURE AUDIT REPORT
# Document Identifier: ZD-GROWTH-1.1-AUTH-SESSION-AUDIT.md
# Product: ZdexCloud — Personal File Server
# Canonical Web: https://zdexcloud.com
# Canonical API: https://api.zdexcloud.com/api/v1
# Canonical Gateway: wss://gateway.zdexcloud.com
# Android Package: net.remotenode.fileserver
# Audit Timestamp: 2026-09-09
# Status: COMPLETE FORENSIC AUDIT

---

## 1. EXECUTIVE SUMMARY

This audit establishes the forensic baseline of the authentication and session lifecycle across the three tiers of the ZdexCloud platform:
1. **Control Plane Backend API** (`main website/Backend`)
2. **Main Website Client** (`main website/Frontend`)
3. **Android Flutter Application** (`Android app/Android app code`)

### Primary Forensic Discovery:
- **Discrepancy in Backend Session Duration**: The backend currently creates user sessions with a **30-day TTL** (`Date.now() + 30 * 24 * 60 * 60 * 1000`) in `main website/Backend/src/routes/auth.ts` (line 158).
- **Client Fallback Discrepancy**: The Android application entity `AuthSession.fromJson` in `auth_session.dart` (line 48) falls back to `DateTime.now().add(const Duration(days: 30))`.
- **Website Client Expiration Blindness**: The Main Website's `auth.js` stores `rn_auth_token` and `zdexcloud_token` in `localStorage` indefinitely without recording the issuance timestamp or expiration date, and without proactive near-expiration warnings or client-side guards against expired tokens.
- **Server Process Decoupling**: The Android background foreground service and local file server operate independently from the platform account session. As required by Section 11 of the product specification, platform account session expiry does not abruptly terminate the device's local file server process or gateway connection, preserving storage host stability.

---

## 2. BACKEND AUTHENTICATION & SESSION LIFECYCLE

### 2.1 Technology & Architecture
- **Framework**: Fastify 4.26.1 with TypeScript 5.3.3.
- **ORM & Database**: Prisma 5.10.2 connected to MySQL schema (`remotenode-3530333528a3`).
- **Token Model**: Opaque high-entropy cryptographic session tokens (`crypto.randomBytes(32).toString('hex')`) persisted in the `UserSession` table.
- **2FA Enforcement**: Mandatory 6-digit email OTP (hashed via HMAC-SHA256 with salt) issued via SMTP for all registrations and logins.

### 2.2 Token Issuance Points
1. **`POST /api/v1/auth/verify-otp` & `POST /api/v1/auth/verify-email`**:
   - File: `main website/Backend/src/routes/auth.ts` (lines 157–166)
   - Current Code:
     ```typescript
     const token = generateSessionToken();
     const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30-day TTL

     await prisma.userSession.create({
       data: {
         userId: updatedUser.id,
         token,
         expiresAt
       }
     });
     ```
   - Response Payload:
     ```json
     {
       "success": true,
       "data": {
         "user": { ... },
         "session": {
           "accessToken": "<token>",
           "refreshToken": "<token>",
           "expiresAt": "2026-10-09T..."
         },
         "token": "<token>"
       }
     }
     ```
2. **`POST /api/v1/auth/reset-password`**:
   - Invalids all existing sessions for the user:
     ```typescript
     await prisma.userSession.deleteMany({ where: { userId: user.id } });
     ```
3. **`POST /api/v1/auth/logout`**:
   - Extracts Bearer token and deletes session record:
     ```typescript
     await prisma.userSession.deleteMany({ where: { token } });
     ```

### 2.3 Backend Authorization Middleware
- Implemented via `getAuthUser(request)` in route controllers (`device.ts`, `server.ts`, `connection.ts`, `endpoint.ts`, `notification_routes.ts`):
  ```typescript
  const session = await prisma.userSession.findFirst({
    where: { token, expiresAt: { gt: new Date() } },
    include: { user: true }
  });
  if (!session || !session.user) {
    throw new UnauthorizedError('Session expired or invalid token');
  }
  ```
- **Authoritative Enforcement**: The database query strictly asserts `expiresAt: { gt: new Date() }`. Once `expiresAt` is reached, the backend immediately rejects requests with HTTP 401 Unauthorized (`UNAUTHORIZED`).

---

## 3. MAIN WEBSITE AUTHENTICATION & SESSION FINDINGS

### 3.1 Existing Storage & Token Handling
- Located in `main website/Frontend/js/auth.js`:
  - `AUTH_STORAGE_KEY = 'rn_auth_token'`
  - `TOKEN_PRIMARY_KEY = 'zdexcloud_token'`
  - `USER_STORAGE_KEY = 'rn_user_data'`
- Stored exclusively in browser `localStorage`.

### 3.2 Identified Deficiencies in Website Session Handling
1. **Missing Expiration Timestamp**: `saveSession(token, user)` does not save `expiresAt` or `issuedAt`.
2. **Missing Client Expiration Check**: `getAuthToken()` returns the token without validating whether it has exceeded 24 hours.
3. **Missing Expiration Warning**: No warning banner or toast appears prior to session termination.
4. **Missing 401 Interception**: In `apiRequest()`, HTTP 401 responses do not automatically purge storage or trigger a redirect to `login.html`.
5. **No Safe Return URL Preservation**: When redirected to login due to expiration, the user's prior destination (e.g. `dashboard.html` or `server-access.html`) is lost.

---

## 4. ANDROID APPLICATION AUTHENTICATION & SESSION FINDINGS

### 4.1 Architecture & State Model
- **Language & Framework**: Dart / Flutter API 21+ with Riverpod 2.6.1.
- **Session Entity**: `AuthSession` in `features/auth/domain/entities/auth_session.dart`.
- **State Notifier**: `AuthStateNotifier` in `features/auth/application/auth_state.dart`.
- **Storage Layer**: `SecureStorageService` abstraction with `FileSecureStorageService` and `InMemorySecureStorageService`.

### 4.2 Identified Deficiencies in Android Session Handling
1. **Fallback TTL in `AuthSession.fromJson`**:
   - Defaults to `DateTime.now().add(const Duration(days: 30))` if `expiresAt` is missing from the API response.
2. **No Maximum Lifetime Boundary (`issuedAt`)**:
   - `AuthSession` checks `DateTime.now().isAfter(expiresAt)`, but does not explicitly track `issuedAt` to guard against modified or sliding expiration times.
3. **Expired Session Cleanup on Boot**:
   - In `AuthStateNotifier.restoreSession()`, if a session is expired, it returns `false`, but does not invoke `_repository.logout()` or purge the storage file, leaving stale JSON on disk.
4. **Decoupling from Native Server Process**:
   - The native foreground service (`RemoteNodeServerService`) and `LocalHttpServer` maintain their own operating system lifecycle. This decoupling is architecturally sound and must be strictly preserved so background storage hosting is not interrupted by UI session expiry.

---

## 5. SECURITY RISKS & THREAT MODEL

1. **Stale Token Reuse**: Tokens valid for 30 days increase the attack window in shared or public browser environments.
2. **Desynchronized Client/Server Experience**: If client thinks session is valid (because local check is missing) while server rejected it, UI enters degraded/broken states with silent API failures instead of a clean, helpful re-authentication prompt.
3. **Accidental Sliding Expiration**: Any system that extends expiration upon activity violates the strict 24-hour compliance requirement.
4. **Timezone Manipulation Risk**: Calendar-date-based calculations risk errors across timezones. All comparisons must use absolute UTC / Epoch millisecond timestamps.

---

## 6. IMPLEMENTATION SPECIFICATION — STRICT 24-HOUR POLICY

### 6.1 Backend Changes (`main website/Backend`)
- Modify `main website/Backend/src/routes/auth.ts`:
  - Change session TTL constant to exactly 24 hours:
    ```typescript
    const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // Strict 24 hours (1 day)
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    ```
  - Apply this to `handleVerifyOtp` during session generation.
  - Ensure `/auth/me` and `/auth/session/verify` maintain `expiresAt: { gt: new Date() }`.
  - Ensure audit events record `SESSION_ISSUED` with 24-hour expiration metadata.

### 6.2 Website Frontend Changes (`main website/Frontend`)
- In `main website/Frontend/js/auth.js`:
  - Define `SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000` (86,400,000 ms).
  - Define `SESSION_WARNING_THRESHOLD_MS = 15 * 60 * 1000` (15 minutes).
  - Storage Keys:
    - `zdexcloud_token` / `rn_auth_token`
    - `zdexcloud_session_issued_at`
    - `zdexcloud_session_expires_at`
  - Update `saveSession(token, user, expiresAt)`:
    - Compute `issuedAt = Date.now()`.
    - If `expiresAt` is provided by backend (ISO string), parse epoch time; otherwise default to `issuedAt + SESSION_MAX_AGE_MS`.
    - Enforce ceiling: `expiresAt = Math.min(parsedExpiresAt, issuedAt + SESSION_MAX_AGE_MS)`.
  - Update `getAuthToken()`:
    - Inspect session validity. If expired, automatically trigger `handleSessionExpired()`.
  - Implement `isSessionValid()`:
    - Returns `false` if no token, if `Date.now() >= expiresAt`, or if `(Date.now() - issuedAt) >= SESSION_MAX_AGE_MS`.
  - Implement `handleSessionExpired()`:
    - Clear all session keys.
    - If on a protected page (`dashboard.html`, `server-access.html`, `notifications.html`, `file-manager.html`), capture return path and redirect:
      `login.html?expired=true&redirect=${encodeURIComponent(currentPath)}`.
  - Implement non-intrusive warning modal/banner when `getTimeRemaining() <= SESSION_WARNING_THRESHOLD_MS`:
    - "Your session will expire in [X] minutes. Please save your work or sign in again."
  - Update `apiRequest()`:
    - On HTTP 401 response from backend, trigger `handleSessionExpired()`.
- In `main website/Frontend/js/main.js`:
  - Run session guard on DOMContentLoaded for protected pages.
  - Setup a 30-second interval ticker `initSessionLifecycleMonitor()` to check expiration in background tabs.

### 6.3 Android Application Changes (`Android app/Android app code`)
- In `features/auth/domain/entities/auth_session.dart`:
  - Add `final DateTime issuedAt;`
  - Set `static const Duration maxSessionDuration = Duration(hours: 24);`
  - In `isExpired`:
    ```dart
    bool get isExpired {
      final now = DateTime.now();
      if (now.isAfter(expiresAt)) return true;
      if (now.difference(issuedAt) > maxSessionDuration) return true;
      return false;
    }
    ```
  - In `AuthSession.fromJson`:
    - Parse `issuedAt` if present, else default to `expiresAt.subtract(const Duration(hours: 24))`.
    - Fallback expiration default changed from 30 days to `Duration(hours: 24)`.
- In `features/auth/application/auth_state.dart`:
  - In `restoreSession()`:
    - If `session != null && session.isExpired`, execute `await _repository.logout()` to scrub expired storage and set `status = AuthStatus.unauthenticated` with message `'Your session has expired. Please sign in again.'`.
  - Add `checkSessionExpired()` helper to allow UI/screens to trigger re-authentication if 24 hours have elapsed.
- In `features/auth/data/repositories/auth_repository_impl.dart`:
  - Ensure `logout()` scrubs both remote session and local secure storage.

---

## 7. VERIFICATION MATRIX

| Scenario | Expected Website Behavior | Expected Android Behavior |
| :--- | :--- | :--- |
| Fresh Login / OTP | Session valid for 24 hours; `expiresAt` recorded | Session valid for 24 hours; `expiresAt` recorded |
| Active Usage at 23h 50m | Non-intrusive warning displayed; no sliding extension | Session warning state available; no sliding extension |
| Active Usage at 24h 00m | Immediate invalidation; redirect to login with return path | State transitions to unauthenticated; redirect to login |
| Page Reload at 24h 01m | Invalidation; redirects to login | Startup detects expired session, clears storage, opens login |
| Backend 401 Unauthorized | Invalidation; redirects to login | Storage purged, transitions to unauthenticated |
| Background Server Host | Not applicable | Foreground service & local HTTP server continue operating |

---

*Report certified by Antigravity Engineering System.*
