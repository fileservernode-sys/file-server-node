# ZDEXCLOUD PHASE 10.3 REPORT: FORGOT PASSWORD AND ACCOUNT RECOVERY

## 1. Executive Summary

Phase 10.3 completes and hardens the unauthenticated **Forgot Password and Account Recovery** workflow across the ZdexCloud backend (`POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/verify-password-reset-otp`, `POST /api/v1/auth/reset-password`) and frontend (`main website/Frontend/pages/forgot-password.html`, `main website/Frontend/pages/login.html`, `main website/Frontend/js/auth.js`).

### Key Defect Resolved: Premature OTP Consumption Between Step 2 and Step 3
During source inspection of the existing recovery flow, a critical multi-step OTP lifecycle defect was identified and fixed:
- Previously, `POST /api/v1/auth/verify-password-reset-otp` (Step 2) called `verifyEmailOtp(email, code, 'PASSWORD_RESET')`, which immediately marked the `EmailOtp` row as `used: true`. When the user then submitted their new password on `POST /api/v1/auth/reset-password` (Step 3), `verifyEmailOtp` queried `used: false` and always rejected the request with `400 INVALID_OTP` (`NO_ACTIVE_OTP`).
- **Fix Implemented:** `verifyEmailOtp` in [`main website/Backend/src/utils/otp.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/utils/otp.ts) now supports `{ consume?: boolean; expectedUserId?: string }`. Step 2 (`POST /api/v1/auth/verify-password-reset-otp`) verifies the code with `{ consume: false }` (while still enforcing expiry, 5-attempt lockout, and wrong-attempt increments), and Step 3 (`POST /api/v1/auth/reset-password`) atomically consumes the verified OTP inside a `prisma.$transaction` via a conditional `updateMany({ where: { id: otpRecordId, userId: user.id, purpose: 'PASSWORD_RESET', used: false, NOT: { otpCode: { startsWith: 'pwdchg:' } } }, data: { used: true } })` check (`consumed.count === 1`).

---

## 2. Backend Recovery Endpoints & Contracts

### 2.1 `POST /api/v1/auth/forgot-password`
- **Route File:** [`main website/Backend/src/routes/auth.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/routes/auth.ts)
- **Authentication:** Public (unauthenticated), rate-limited (`max: 5`, `timeWindow: '15 minutes'`).
- **Request Schema (`forgotPasswordSchema`):**
  - `email`: normalized (`trim().toLowerCase()`) valid email address (`max: 254`).
- **Enumeration-Safe Behavior:**
  - Returns identical `200 OK` response payload whether the email belongs to an active user, an unknown address, or a `SUSPENDED` account:
    ```json
    {
      "success": true,
      "data": {
        "message": "If an account exists for this email, a password reset code has been sent.",
        "expiresInSeconds": 600,
        "cooldownSeconds": 60
      }
    }
    ```
  - Only issues a 6-digit recovery OTP (`purpose: 'PASSWORD_RESET'`, 10-minute expiry, 60-second resend cooldown), sends the recovery email (`emailService.sendPasswordResetOtp`), and records `SECURITY.PASSWORD_RESET_REQUESTED` when `user && user.status !== 'SUSPENDED'`.

### 2.2 `POST /api/v1/auth/verify-password-reset-otp`
- **Route File:** [`main website/Backend/src/routes/auth.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/routes/auth.ts)
- **Authentication:** Public (unauthenticated), rate-limited (`max: 5`, `timeWindow: '15 minutes'`).
- **Request Schema (`verifyPasswordResetOtpSchema`):**
  - `email`: normalized email address.
  - `code`: 6-digit numeric OTP (`/^\d{6}$/`).
- **Behavior:**
  - Calls `verifyEmailOtp(email, code, 'PASSWORD_RESET', { consume: false })`.
  - Enforces expiry (`400 EXPIRED_OTP`), 5-attempt lockout (`429 TOO_MANY_ATTEMPTS`), and wrong-code attempt increment (`400 INVALID_OTP`) without marking `used: true` prematurely before Step 3.
  - Excludes `pwdchg:` authenticated password-change OTPs (`NOT: { otpCode: { startsWith: 'pwdchg:' } }`).

### 2.3 `POST /api/v1/auth/reset-password`
- **Route File:** [`main website/Backend/src/routes/auth.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/routes/auth.ts)
- **Authentication:** Public (unauthenticated), rate-limited (`max: 5`, `timeWindow: '15 minutes'`).
- **Request Schema (`resetPasswordSchema`):**
  - `email`: normalized email address.
  - `code`: 6-digit numeric OTP (`/^\d{6}$/`).
  - `newPassword`: 8–128 characters, requiring at least one uppercase letter (`/[A-Z]/`), one lowercase letter (`/[a-z]/`), and one number (`/[0-9]/`).
  - `confirmPassword`: optional confirmation field validated to match `newPassword` (`400 CONFIRMATION_MISMATCH`).
- **Validation & Atomic Execution Order:**
  1. Validates `resetPasswordSchema` and `confirmPassword` match **before** querying or incrementing the OTP record so password formatting mistakes do not burn the user's verified OTP.
  2. Checks user existence and status (`!user || user.status === 'SUSPENDED'`) and returns the identical `400 INVALID_OTP` (`'Invalid or expired password reset code'`) to prevent account enumeration and block suspended accounts from self-reactivating via password recovery.
  3. Verifies the OTP via `verifyEmailOtp(email, code, 'PASSWORD_RESET', { consume: false, expectedUserId: user.id })`.
  4. Executes an atomic `prisma.$transaction`:
     - Conditionally consumes the specific OTP record (`updateMany` where `id: otpRecordId, userId: user.id, purpose: 'PASSWORD_RESET', used: false`, asserting `consumed.count === 1` to prevent concurrent replay).
     - Invalidates any remaining unused recovery OTPs for the user.
     - Hashes `newPassword` via `hashPassword` (`scrypt`, `N=16384, r=8, p=1`, 16-byte random salt, 64-byte key) and updates `User.passwordHash` (`emailVerified: true`, transitioning `PENDING_VERIFICATION` to `ACTIVE` while preserving existing `ACTIVE` status).
     - Revokes all active customer sessions (`tx.userSession.deleteMany({ where: { userId: user.id } })`).
     - Revokes all active device credentials (`tx.deviceAuthCredential.updateMany({ where: { userId: user.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'USER_PASSWORD_RESET' } })`).
     - Writes `AuditEvent` records (`PASSWORD_RESET_SUCCESS` with `metadata: { operation: 'FORGOT_PASSWORD_RECOVERY' }`, and `DEVICE_CREDENTIAL_REVOKED`).
  5. Records customer activity events via `CustomerActivityService.recordEventSafe`:
     - `SECURITY.PASSWORD_RESET_COMPLETED` (`metadata: { sessionsInvalidated: true }`)
     - `SECURITY.DEVICE_CREDENTIALS_REVOKED` (`metadata: { revokedCount }`, if active device credentials were revoked)
  6. Dispatches security notification via `accountEventProducer.emitSecurityEvent(user.id, 'Your ZdexCloud account password was reset via email recovery and all active sessions were signed out.')`.
  7. Clears any active `CUSTOMER_SESSION_COOKIE_NAME` cookie on the response.

---

## 3. Frontend Customer Recovery Journey

### 3.1 `main website/Frontend/pages/forgot-password.html`
- **4-Stage Recovery Flow:**
  1. **Step 1 (`#step1-form` — Request Reset):** Email input with client-side validation and submission to `window.Auth.forgotPassword(email)`.
  2. **Step 2 (`#step2-form` — Verify OTP):** 6-digit numeric OTP input (`inputmode="numeric"`, `maxlength="6"`, `autocomplete="one-time-code"`), enumeration-safe notice (`"If an account exists for <email>, we sent a 6-digit verification code..."`), 60-second resend cooldown timer (`#btn-resend-otp`), and `"Use a Different Email"` action (`#btn-change-email`).
  3. **Step 3 (`#step3-form` — Set New Password):** New password and confirm password inputs with visibility toggles, live 4-rule password complexity checklist (`#reset-policy-length`, `#reset-policy-upper`, `#reset-policy-lower`, `#reset-policy-number`), automatic fallback to Step 2 if the OTP expires before Step 3 submission, and submission to `window.Auth.resetPassword(email, otp, newPassword, confirmPassword)`.
  4. **Step 4 (`#step4-complete` — Completion):** Clear confirmation state with DOM scrubbing of OTP/password fields, a direct `"Sign In with New Password"` CTA linking to `login.html?reset=true`, and an automatic 3-second redirect countdown (`#redirect-countdown`).

### 3.2 `main website/Frontend/pages/login.html` & `main website/Frontend/js/auth.js`
- [`main website/Frontend/pages/login.html`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/pages/login.html) links to `forgot-password.html` (`"Forgot password?"`) and detects `?reset=true` on arrival to display a confirmation banner (`"Your password has been reset. Please sign in with your new password."`) while cleaning up the query parameter via `window.history.replaceState`.
- [`main website/Frontend/js/auth.js`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/js/auth.js) normalizes email/OTP payloads across `forgotPassword`, `verifyPasswordResetOtp`, and `resetPassword`, forwards `confirmPassword`, clears any stale local session state (`clearSession()`, `broadcastAuthEvent('CUSTOMER_LOGGED_OUT')`) upon password reset completion, and returns structured `{ success, data, message, status, code, error }` envelopes.

---

## 4. Files Created & Modified

| File | Action | Purpose |
| :--- | :--- | :--- |
| [`main website/Backend/src/utils/otp.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/utils/otp.ts) | Modified | Enhanced `verifyEmailOtp` with `{ consume?: boolean; expectedUserId?: string }`, `otpRecordId` return value, and exclusion of `pwdchg:` password-change OTPs. |
| [`main website/Backend/src/routes/auth.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/routes/auth.ts) | Modified | Updated `resetPasswordSchema` to enforce authoritative password policy + `confirmPassword`; updated `verify-password-reset-otp` to pre-verify with `{ consume: false }`; hardened `reset-password` with atomic OTP consumption, enumeration-safe error responses, suspended-account protection, session/device revocation, audit logging, and activity recording. |
| [`main website/Frontend/js/auth.js`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/js/auth.js) | Modified | Updated `forgotPassword`, `verifyPasswordResetOtp`, and `resetPassword` helpers with normalized inputs, `confirmPassword` support, structured error codes, and local session cleanup on reset. |
| [`main website/Frontend/pages/forgot-password.html`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/pages/forgot-password.html) | Modified | Completed 4-step customer recovery UI (`#step1-form` to `#step4-complete`), step badge, enumeration-safe messaging, live password policy checklist, `"Use a Different Email"` action, and `login.html?reset=true` completion flow. |
| [`main website/Frontend/pages/login.html`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/pages/login.html) | Modified | Added `?reset=true` query parameter detection and confirmation banner on the sign-in screen. |
| [`main website/Backend/tests/password_recovery.test.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/password_recovery.test.ts) | Created | Written unit/integration test suite covering all Phase 10.3 recovery security, OTP lifecycle, enumeration resistance, session revocation, audit/activity, and frontend integration scenarios (not executed per policy). |
