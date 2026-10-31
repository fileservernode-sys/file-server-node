# ZDEXCLOUD PHASE 10.2: AUTHENTICATED PASSWORD CHANGE REPORT

**Date:** 2026-10-11  
**Phase:** 10.2 — Authenticated Password Change Implementation  
**Execution Mode:** Focused Implementation (Strictly Non-Executing)

---

## 1. Files Created and Modified

### Modified Backend Files
| File Path | Summary of Changes |
|---|---|
| `main website/Backend/src/utils/crypto.ts` | Added `hashPasswordChangeOtp(userId, otp)` and `verifyPasswordChangeOtpCode(userId, candidateOtp, storedRepresentation)` using `pwdchg:<userId>:<salt>:<hmac>` format; updated `verifyOtpCode` to reject `pwdchg:`-prefixed representations so password-change OTPs and registration/login/forgot-password OTPs cannot cross-verify. |
| `main website/Backend/src/utils/otp.ts` | Added `issuePasswordChangeOtp(userId, email)` and `verifyPasswordChangeOtp(userId, email, code, options)`; isolated standard `issueEmailOtp` and `verifyEmailOtp` queries with `NOT: { otpCode: { startsWith: 'pwdchg:' } }`. |
| `main website/Backend/src/services/email_templates.ts` | Added `getPasswordChangeOtpTemplate(otpCode, expiryMinutes)` responsive HTML and plain-text OTP email template for authenticated password change confirmation. |
| `main website/Backend/src/services/email.ts` | Added `sendPasswordChangeOtp(email, otpCode, options)` to `EmailService`, `BrevoEmailService`, and `MockEmailService` with `emailTrackingService.recordDirectOtpEmail` integration. |
| `main website/Backend/src/routes/auth.ts` | Added `PASSWORD_CHANGE_POLICY`, `changePasswordRequestOtpSchema`, `changePasswordConfirmSchema`, `POST /api/v1/auth/change-password/request-otp`, and `POST /api/v1/auth/change-password/confirm`. |
| `main website/Backend/src/services/activity/customer_activity_taxonomy.ts` | Promoted `SECURITY.PASSWORD_CHANGED` (`CustomerActivityEventType.SECURITY_PASSWORD_CHANGED`) from `PROPOSED_FUTURE` to `CONFIRMED_RECORDED` and linked it to `src/routes/auth.ts (POST /api/v1/auth/change-password/confirm)`. |
| `main website/Backend/src/app.ts` | Extended Fastify logger redaction array to redact `body.currentPassword`, `body.newPassword`, `body.confirmPassword`, `body.otp`, `body.code`, and `body.otpCode`. |

### Modified Frontend Files
| File Path | Summary of Changes |
|---|---|
| `main website/Frontend/js/auth.js` | Added `requestPasswordChangeOtp(currentPassword, newPassword, confirmPassword)`, `confirmPasswordChange(currentPassword, newPassword, confirmPassword, otp)`, `apiRequest`, and `apiFetch` to `window.AuthService`. |
| `main website/Frontend/pages/settings.html` | Connected `#security-password-section` and `#form-change-password` to the two-step authenticated password-change API with live complexity checklist, 6-digit OTP verification step (`#password-step-otp`), resend cooldown timer, and post-change re-authentication state (`#password-change-success-card`). |
| `main website/Frontend/pages/login.html` | Added `?passwordChanged=true` banner handling so customers redirected after changing their password see a clear confirmation banner prompting them to sign in with their new password. |

### Created Test & Documentation Files
| File Path | Summary |
|---|---|
| `main website/Backend/tests/password_change.test.ts` | Unit and integration test suite covering the Phase 10.2 authenticated password-change workflow (not executed per policy). |
| `PHASE-10.2-REPORT.md` | Phase 10.2 completion report. |
| `main website/Backend/PHASE-10.2-REPORT.md` | Phase 10.2 completion report copy in Backend directory. |

---

## 2. Backend Endpoints, Schemas, and Service Methods

### Endpoints (`main website/Backend/src/routes/auth.ts`)
1. **`POST /api/v1/auth/change-password/request-otp`**
   - **Middleware & Rate Limit:** `preHandler: [customerAuthenticate]`, global `csrfProtectionHook` (enforces `X-CSRF-Token` for cookie-authenticated sessions), and `authResendOtpRateLimitConfig` (`3 requests / minute`).
   - **Validation (`changePasswordRequestOtpSchema`):**
     - `currentPassword`: non-empty string (`1..128` chars)
     - `newPassword`: `8..128` chars, at least 1 uppercase (`/[A-Z]/`), 1 lowercase (`/[a-z]/`), and 1 digit (`/[0-9]/`)
     - `confirmPassword`: must match `newPassword` (`CONFIRMATION_MISMATCH` if not equal)
     - `newPassword !== currentPassword` and `!verifyPassword(newPassword, user.passwordHash)` (`PASSWORD_UNCHANGED` if equal)
   - **Credential Verification:** Verifies `currentPassword` against `user.passwordHash` via `verifyPassword(currentPassword, user.passwordHash)` (`crypto.scryptSync` + `crypto.timingSafeEqual`). Rejects invalid current password with `400 INVALID_CURRENT_PASSWORD` without issuing an OTP.
   - **Action:** Calls `issuePasswordChangeOtp(user.id, user.email)` and records an internal `AuditEvent` (`OTP_SENT`, `metadata: { purpose: 'PASSWORD_CHANGE' }`).

2. **`POST /api/v1/auth/change-password/confirm`**
   - **Middleware & Rate Limit:** `preHandler: [customerAuthenticate]`, global `csrfProtectionHook`, and `authStrictRateLimitConfig` (`5 requests / minute`).
   - **Validation (`changePasswordConfirmSchema`):** Re-validates `currentPassword`, `newPassword`, `confirmPassword`, and requires a 6-digit numeric OTP (`otp` / `code` / `otpCode` matching `/^\d{6}$/`).
   - **Credential & OTP Verification:**
     - Re-verifies `currentPassword` against `user.passwordHash` and ensures `newPassword` differs from `user.passwordHash`.
     - Verifies the 6-digit OTP via `verifyPasswordChangeOtp(user.id, user.email, code, { consume: false })`.
   - **Atomic Mutation (`prisma.$transaction`):**
     1. Atomically marks the verified OTP record `used: true` via `tx.emailOtp.updateMany({ where: { id: otpRecordId, userId: user.id, used: false }, data: { used: true } })`, throwing `OTP_ALREADY_USED` if `count !== 1`.
     2. Invalidates any remaining unconsumed password-change OTPs for the user.
     3. Hashes `newPassword` via `hashPassword(newPassword)` and updates `User.passwordHash`.
     4. Deletes all active `UserSession` records for the user.
     5. Revokes all active `DeviceAuthCredential` records (`revokedAt: now`).
     6. Creates `AuditEvent` records (`PASSWORD_RESET_SUCCESS` with `metadata: { operation: 'AUTHENTICATED_PASSWORD_CHANGE' }`, and `DEVICE_CREDENTIAL_REVOKED` with `metadata: { reason: 'PASSWORD_CHANGE' }`).

---

## 3. OTP Generation, Expiry, Attempt-Limit, and Single-Use Details

- **Cryptographic Generation:** `generateOtpCode()` (`crypto.randomInt(100000, 1000000)` -> 6-digit numeric string).
- **Operation & User Binding (`hashPasswordChangeOtp` / `verifyPasswordChangeOtpCode`):**
  - Stored in `EmailOtp.otpCode` as `pwdchg:<userId>:<salt>:<hmac>` where `hmac = HMAC_SHA256(salt, "PASSWORD_CHANGE:<userId>:<otp>")`.
  - Standard OTP flows (`issueEmailOtp`, `verifyEmailOtp`, `verifyOtpCode`) explicitly filter out and reject `pwdchg:` hashes, preventing any cross-flow use between authenticated password change and unauthenticated forgot-password reset, registration, or login 2FA.
- **Expiry:** `config.PASSWORD_RESET_OTP_EXPIRY_SECONDS` (`600` seconds / 10 minutes). Expired codes are marked `used: true` and rejected with `400 EXPIRED_OTP`.
- **Resend Cooldown:** `config.OTP_RESEND_COOLDOWN_SECONDS` (`60` seconds). Requests within the active cooldown window return `429 RESEND_COOLDOWN_ACTIVE`.
- **Attempt Limit & Brute-Force Lockout:** `config.OTP_MAX_ATTEMPTS` (`5` attempts). Each failed verification increments `attempts`; reaching 5 failed attempts marks `used: true` and returns `429 TOO_MANY_ATTEMPTS`.
- **Single-Use Guarantee:** Issuing a new password-change OTP invalidates all prior unused password-change OTPs for that user, and `POST /api/v1/auth/change-password/confirm` consumes the OTP atomically inside the Prisma transaction with a conditional `updateMany({ where: { id, userId, used: false } })` check.

---

## 4. Session/Token Revocation and Post-Change Re-Authentication Behavior

- **Web Session Revocation:** All `UserSession` rows for `userId` are deleted inside the password-change transaction (`tx.userSession.deleteMany({ where: { userId: user.id } })`).
- **Paired Device Token Revocation:** All active `DeviceAuthCredential` rows for `userId` are revoked (`tx.deviceAuthCredential.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } })`).
- **Browser Cookie & Client Memory Cleanup:**
  - The backend clears the `zdex_session` HttpOnly cookie (`reply.clearCookie(CUSTOMER_SESSION_COOKIE_NAME, ...)`).
  - The frontend `AuthService.confirmPasswordChange` calls `clearSession()` and broadcasts `CUSTOMER_LOGGED_OUT` across open tabs.
  - `settings.html` transitions to the success card (`#password-change-success-card`) and redirects the customer to `login.html?passwordChanged=true` to sign in again with their new password.

---

## 5. Audit, Customer Activity, and Notification Behavior

- **Internal Security Audit (`AuditEvent`):**
  - `OTP_SENT` (`metadata: { purpose: 'PASSWORD_CHANGE' }`) when Step 1 issues a password-change OTP.
  - `LOGIN_ATTEMPT_FAILED` (`metadata: { reason: 'INVALID_CURRENT_PASSWORD_ON_CHANGE' | 'INVALID_CURRENT_PASSWORD_ON_CHANGE_CONFIRM' }`) when an incorrect current password is submitted.
  - `PASSWORD_RESET_SUCCESS` (`metadata: { operation: 'AUTHENTICATED_PASSWORD_CHANGE' }`) and `DEVICE_CREDENTIAL_REVOKED` (`metadata: { reason: 'PASSWORD_CHANGE', revokedAt }`) upon password change completion.
- **Customer-Visible Activity (`CustomerActivityService.recordEventSafe`):**
  - `SECURITY.PASSWORD_CHANGED`: *"Your account password was updated from account settings and all active sessions were invalidated."*
  - `SECURITY.DEVICE_CREDENTIALS_REVOKED`: *"Persistent server authorization credential was revoked (Password changed)."*
- **Security Notification (`accountEventProducer.emitSecurityEvent`):**
  - Dispatches an `account.security_event` notification informing the customer that their account password was changed from Account Settings and all active sessions were signed out.

---

## 6. Frontend Settings UI States (`main website/Frontend/pages/settings.html`)

1. **Collapsed / Default State:** `#password-change-panel` is hidden (`hidden` attribute); `#btn-toggle-password-panel` has `aria-expanded="false"`.
2. **Password Entry State (Step 1):** Expanded panel showing Current Password, New Password, live 5-item complexity checklist, and Confirm New Password fields.
3. **Client-Side Validation State:** Displays immediate inline validation errors in `#password-change-status` for empty fields, confirmation mismatch, unchanged password, or unmet complexity rules.
4. **OTP Requested / Delivery Pending State:** Disables `#btn-submit-password-change` (`"Sending Verification Code..."`) while `POST /api/v1/auth/change-password/request-otp` is in flight.
5. **OTP Verification Entry State (Step 2):** Locks password inputs (`readOnly = true`), displays `#password-step-otp` with masked recipient email, 6-digit numeric code input (`#password-change-otp`), `"Edit Passwords"` button, and `"Resend Code"` button with a 60-second countdown timer.
6. **Submitting State:** Disables `#btn-confirm-password-change`, `#btn-resend-password-otp`, and `#btn-edit-password-inputs` (`"Verifying & Updating Password..."`) while `POST /api/v1/auth/change-password/confirm` is in flight.
7. **Success State:** Scrubs all password and OTP inputs from the DOM, hides the form, displays `#password-change-success-card` explaining session and device credential revocation, and provides a direct `"Sign In With New Password"` CTA plus automatic redirect to `login.html?passwordChanged=true`.
8. **Recoverable Error State:** Surfaces clear error messages for wrong current password (unlocking and focusing Step 1), invalid/expired OTP (focusing `#password-change-otp`), or rate-limit/cooldown responses.

---

## 7. Tests Added (Not Executed)

- **`main website/Backend/tests/password_change.test.ts`** (Marked **NOT EXECUTED** per execution constraint):
  1. Cryptographic operation-bound and user-bound OTP isolation (`pwdchg:<userId>:<salt>:<hmac>` vs. forgot-password/login/registration OTPs).
  2. Unauthenticated (`401`) and missing/invalid CSRF token (`403`) rejection on both password-change endpoints.
  3. Wrong current password (`400 INVALID_CURRENT_PASSWORD`), weak new password (`400 VALIDATION_ERROR`), confirmation mismatch (`400 CONFIRMATION_MISMATCH`), and unchanged password (`400 PASSWORD_UNCHANGED`) rejection.
  4. Resend cooldown (`429 RESEND_COOLDOWN_ACTIVE`), wrong OTP attempt counting (`400 INVALID_OTP`), max-attempt lockout (`429 TOO_MANY_ATTEMPTS`), expired OTP (`400 EXPIRED_OTP`), and concurrent/reused OTP rejection.
  5. End-to-end two-step password change success, `passwordHash` update verification, `UserSession` and `DeviceAuthCredential` revocation, `AuditEvent` and `CustomerActivityService` recording, `accountEventProducer.emitSecurityEvent` dispatch, and session cookie clearing.
  6. Frontend `js/auth.js` and `pages/settings.html` integration verification.

---

## 8. Remaining Blockers for Phase 10.3

- **None.** The existing unauthenticated Forgot Password recovery routes (`POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/verify-password-reset-otp`, `POST /api/v1/auth/reset-password`) remain isolated from the authenticated password-change flow and ready for Phase 10.3 inspection or refinement.
