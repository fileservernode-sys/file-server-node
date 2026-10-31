# ZDEXCLOUD PHASE 10.4 REPORT: AUTHENTICATION AND PASSWORD HASHING CONSISTENCY

## 1. Executive Summary

Phase 10.4 completes Phase 10 by establishing unified consistency across registration, login, authenticated password change, and forgot-password recovery. This phase reconciles password hashing, password validation rules, OTP operation isolation, account status restrictions, session management, and paired Android device credential revocation without introducing unnecessary abstractions or breaking existing conventions.

---

## 2. Actual Password-Hashing and Verification Implementation

### 2.1 Single Authoritative Hashing Architecture
Source inspection of [`main website/Backend/src/utils/crypto.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/utils/crypto.ts) and all callers across the backend confirmed that ZdexCloud uses native Node.js `crypto.scryptSync` as the authoritative password hashing and verification standard:
- **Hashing Function (`hashPassword`):**
  - Generates a cryptographically secure 16-byte random salt (`crypto.randomBytes(16).toString('hex')`).
  - Derives a 64-byte key using `crypto.scryptSync(password, salt, 64)`.
  - Persists hashes strictly in the format `${salt}:${hash}` (32-character hex salt + `:` + 128-character hex hash).
- **Verification Function (`verifyPassword`):**
  - Extracts `salt` and `originalHash` from the stored `${salt}:${hash}` string.
  - Re-computes the candidate hash using `crypto.scryptSync(password, salt, 64).toString('hex')`.
  - Converts candidate and stored hashes to `Buffer` instances, validates that buffer byte lengths are identical to guard against uncaught length exceptions, and performs constant-time comparison via `crypto.timingSafeEqual` to eliminate timing side-channel leakage.
- **Safe Legacy Compatibility:**
  - `verifyPassword` includes an explicit fallback for legacy 64-character SHA-256 hexadecimal hashes (if any un-salted records exist in historical datasets or testing fixtures). Verification computes the SHA-256 digest of the candidate password and performs a timing-safe buffer comparison against the stored hash, guaranteeing that existing users are never silently locked out while all new passwords, changed passwords, and reset passwords are stored exclusively via scrypt.
- **Sensitive Data Minimization:**
  - Password hashes, salts, plaintext passwords, and OTP codes are never exposed in API responses, server error envelopes, customer activity logs, or administrative audit metadata.

---

## 3. Password Policy Consistency Across All Relevant Flows

### 3.1 Unified Authoritative Policy
A unified policy constant `AUTH_PASSWORD_POLICY` (aliased to `PASSWORD_CHANGE_POLICY` for backwards compatibility) is defined in [`main website/Backend/src/routes/auth.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/routes/auth.ts):
```typescript
export const AUTH_PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true
} as const;
```

### 3.2 Backend Validation Alignment
- **Registration (`registerSchema` & `POST /api/v1/auth/register`):**
  - Updated to enforce `AUTH_PASSWORD_POLICY` (`8..128` characters, at least 1 uppercase letter `/[A-Z]/`, at least 1 lowercase letter `/[a-z]/`, at least 1 number `/[0-9]/`).
  - Accepts optional `confirmPassword`. If provided, it is validated to match `password` before database insertion or OTP generation (`400 CONFIRMATION_MISMATCH`).
- **Authenticated Password Change (`changePasswordRequestOtpSchema`, `changePasswordConfirmSchema`):**
  - Enforces `AUTH_PASSWORD_POLICY` on `newPassword`.
  - Rejects `confirmPassword` mismatch with `400 CONFIRMATION_MISMATCH` before issuing OTP or mutating credentials.
  - Rejects new passwords identical to current password (`400 PASSWORD_UNCHANGED`) via both plaintext string comparison and hash verification (`verifyPassword(newPassword, user.passwordHash)`).
- **Forgot Password Recovery (`resetPasswordSchema` & `POST /api/v1/auth/reset-password`):**
  - Enforces `AUTH_PASSWORD_POLICY` on `newPassword`.
  - Rejects `confirmPassword` mismatch with `400 CONFIRMATION_MISMATCH` before querying or incrementing OTP attempts.
  - Rejects new passwords identical to current password (`user.passwordHash && verifyPassword(newPassword, user.passwordHash)`) with `400 PASSWORD_UNCHANGED` prior to OTP consumption.

### 3.3 Frontend Policy Indicators
- [`main website/Frontend/pages/get-started.html`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/pages/get-started.html) was upgraded to include the identical live 4-rule password checklist (`#reg-policy-length`, `#reg-policy-upper`, `#reg-policy-lower`, `#reg-policy-number`) featured on [`settings.html`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/pages/settings.html) and [`forgot-password.html`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/pages/forgot-password.html).
- Client-side validation in `get-started.html` validates all 4 rules and confirms password matching before invoking `AuthService.registerUser(email, password, fullName, confirmPassword)`.
- [`main website/Frontend/js/auth.js`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/js/auth.js) was updated so `registerUser` forwards `confirmPassword` in the JSON request payload.

---

## 4. OTP Operation Isolation and Lifecycle Behavior

Source inspection of [`main website/Backend/src/utils/otp.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/utils/otp.ts) and [`routes/auth.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/routes/auth.ts) verified the following cryptographic and operational boundaries:

| Flow | OTP Purpose | Representation in DB | User Binding | Pre-Verification / Consumption |
| :--- | :--- | :--- | :--- | :--- |
| **Registration Verification** | `REGISTRATION_VERIFICATION` | HMAC-SHA256 `${salt}:${hash}` | Bound to `user.id` | Atomic single-use consumed on `/auth/verify-otp` |
| **Login 2FA** | `LOGIN_2FA` | HMAC-SHA256 `${salt}:${hash}` | Bound to `user.id` | Atomic single-use consumed on `/auth/verify-otp` |
| **Forgot Password Recovery** | `PASSWORD_RESET` | HMAC-SHA256 `${salt}:${hash}` (excludes `pwdchg:`) | Bound to `user.id` | Non-consuming pre-check in Step 2; conditional atomic consumption in Step 3 transaction (`consumed.count === 1`) |
| **Authenticated Password Change** | `PASSWORD_RESET` | `pwdchg:<userId>:<salt>:<hmac>` | Strictly bound to `userId` | Non-consuming pre-check; conditional atomic consumption in transaction (`consumed.count === 1`) |

- **Cross-Operation Protection:**
  - `REGISTRATION_VERIFICATION` and `LOGIN_2FA` OTPs cannot be used for password recovery or password change because recovery queries strictly match `purpose: 'PASSWORD_RESET'`, and password change queries require `startsWith('pwdchg:<userId>:')`.
  - Recovery OTPs cannot be used for password change because `verifyPasswordChangeOtp` strictly filters for representations starting with `pwdchg:<userId>:`.
  - Password-change OTPs cannot be used for recovery because `verifyEmailOtp` explicitly enforces `NOT: { otpCode: { startsWith: 'pwdchg:' } }`.
  - Neither recovery nor password-change OTPs can verify registration or login because `handleVerifyOtp` only queries `REGISTRATION_VERIFICATION` and `LOGIN_2FA`.
- **Brute-Force & Replay Defenses:**
  - Expiry is strictly enforced (10 minutes for recovery/change; 15 minutes for registration/login).
  - Maximum 5 failed attempts locks out the OTP record (`attempts: 5, used: true`).
  - Resend cooldown enforces a 60-second window between OTP requests (`429 RESEND_COOLDOWN_ACTIVE`).

---

## 5. Session and Device Credential Revocation Behavior

### 5.1 Established Revocation Semantics
- **Interactive Browser Sessions (`UserSession`):**
  - Both `POST /api/v1/auth/change-password/confirm` and `POST /api/v1/auth/reset-password` execute `tx.userSession.deleteMany({ where: { userId: user.id } })` within the atomic transaction.
  - Subsequent requests with previously issued tokens fail `resolveCustomerSession(token)` in [`customer-auth.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/middleware/customer-auth.ts) and receive `401 Unauthorized`.
  - The server explicitly clears the browser cookie via `reply.clearCookie(CUSTOMER_SESSION_COOKIE_NAME, ...)`.
  - In the frontend, `resetPassword` and `confirmPasswordChange` in `auth.js` call `clearSession()` and broadcast `CUSTOMER_LOGGED_OUT` via `BroadcastChannel`, evicting in-memory tokens across all open browser tabs and redirecting users to the login screen.
- **Paired Edge Hardware (`DeviceAuthCredential`):**
  - Both password change and password recovery execute `tx.deviceAuthCredential.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } })`.
  - In [`main website/Backend/src/routes/device.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/routes/device.ts) (`POST /devices/:deviceId/session/refresh`), the endpoint verifies `if (cred.revokedAt)` and rejects requests with `401 CREDENTIAL_REVOKED`, preventing revoked devices from minting new sessions.
  - Server registration records (`Device`), server configuration (`Server`), and customer server ownership are preserved and never deleted during credential revocation.

---

## 6. Account Status and Verification Rules Preserved

- **Suspended Account Restrictions (`UserStatus.SUSPENDED`):**
  - **Login:** Updated `POST /api/v1/auth/login` to check `if (user.status === 'SUSPENDED')` immediately after credential verification, recording a security audit log and returning `403 ACCOUNT_SUSPENDED`. Suspended users are prevented from receiving 2FA OTPs or establishing sessions.
  - **OTP Verification:** Updated `handleVerifyOtp` to check `if (user.status === 'SUSPENDED')` and return `403 ACCOUNT_SUSPENDED`, preventing suspended users from activating accounts or minting sessions.
  - **Forgot Password:** `POST /api/v1/auth/forgot-password` only dispatches OTPs when `user.status === 'ACTIVE' && user.emailVerified`, while returning the identical generic 200 message to prevent account enumeration.
  - **Password Reset:** `POST /api/v1/auth/reset-password` rejects suspended users with identical `400 INVALID_OTP` ('Invalid or expired password reset code'), preventing account status enumeration and blocking unauthorized password resets.
- **Pending Verification Lifecycle (`UserStatus.PENDING_VERIFICATION`):**
  - `POST /api/v1/auth/reset-password` was hardened so that it only permits password resets for accounts where `user.status === 'ACTIVE' && user.emailVerified`.
  - If an unverified user attempts password recovery, `reset-password` returns `400 INVALID_OTP`.
  - In `tx.user.update`, only `passwordHash: newPasswordHash` is updated; `status: 'ACTIVE'` and `emailVerified: true` are NOT set on reset, ensuring an account is never activated solely because a password was reset.
  - The existing registration flow remains the sole authoritative path for transitioning `PENDING_VERIFICATION` to `ACTIVE` upon verifying the `REGISTRATION_VERIFICATION` email OTP.

---

## 7. Files Created & Modified

| File | Action | Purpose |
| :--- | :--- | :--- |
| [`main website/Backend/src/utils/crypto.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/utils/crypto.ts) | Modified | Added buffer length validation before `crypto.timingSafeEqual` and integrated safe legacy 64-char SHA-256 fallback compatibility in `verifyPassword`. |
| [`main website/Backend/src/routes/auth.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/routes/auth.ts) | Modified | Exported `AUTH_PASSWORD_POLICY`; updated `registerSchema` to enforce the authoritative policy and `confirmPassword` match; blocked suspended users in `login` and `handleVerifyOtp`; bound OTPs to `expectedUserId`; restricted `forgot-password` and `reset-password` to active verified users; rejected new passwords identical to current passwords in recovery; preserved user status on reset. |
| [`main website/Frontend/js/auth.js`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/js/auth.js) | Modified | Updated `registerUser` to accept and forward `confirmPassword` in registration payloads. |
| [`main website/Frontend/pages/get-started.html`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/pages/get-started.html) | Modified | Added the 4-rule password policy checklist under the registration password input, live validation indicators, and client-side confirmation checks. |
| [`main website/Backend/tests/password_recovery.test.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/password_recovery.test.ts) | Modified | Updated `DeviceAuthCredential.updateMany` expectation to match the actual Prisma schema (`where: { userId, revokedAt: null }, data: { revokedAt }`). |
| [`main website/Backend/tests/auth_consistency.test.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/auth_consistency.test.ts) | Created | Comprehensive unit and integration test suite covering hash compatibility, policy reconciliation, OTP isolation, account status restrictions, session and device revocation, and frontend alignment (marked NOT EXECUTED). |

---

## 8. Tests Created and Execution Status

A dedicated test suite was created in [`main website/Backend/tests/auth_consistency.test.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/auth_consistency.test.ts).

**STATUS: NOT EXECUTED.**

Per the explicit policy instructions of Phase 10.4:
- No test runners, test compilers, builds, browser automation, or package scripts were executed.
- No database operations or Prisma generation commands were run.
- All verifications documented in this phase are based strictly on static source inspection and semantic contract analysis.

The test file specifies comprehensive test cases covering:
1. Native scrypt password hashing, timing-safe buffer comparison, legacy SHA-256 fallback compatibility, and resistance to malformed hashes.
2. Uniform password policy enforcement (`8..128` chars, uppercase, lowercase, digit) across registration, password change, and recovery.
3. Confirmation mismatch rejection across registration, password change, and recovery (`400 CONFIRMATION_MISMATCH`).
4. Rejection of new passwords identical to current password in both password change and recovery (`400 PASSWORD_UNCHANGED`).
5. Cross-flow OTP operation isolation (registration, login, recovery, password change) and cross-user isolation (`expectedUserId`).
6. OTP brute-force lockout (5 attempts), expiry, and single-use conditional consumption.
7. Account status enforcement: suspended accounts blocked on login, verify-otp, forgot-password, and reset-password. Unverified accounts prevented from activating via reset-password.
8. Revocation of `UserSession` and active `DeviceAuthCredential` rows, cookie clearing, and broadcast logout notification.
9. Redaction of sensitive credentials, hashes, and OTP codes from API responses, audit events, and activity logs.
10. Alignment of frontend policy checklists across `get-started.html`, `settings.html`, `forgot-password.html`, and `auth.js`.

---

## 9. Migrations & Limitations

- **Database Migrations:** Zero schema migrations were required. The existing Prisma schema (`schema.prisma`) already provides `User.passwordHash`, `User.status`, `EmailOtp`, `UserSession`, `DeviceAuthCredential.revokedAt`, and `CustomerActivityEvent`. No unapplied migrations exist.
- **Explicit Distinction:** All findings, contract alignments, and security guarantees in this report reflect static source code inspection and strict adherence to established project invariants. Runtime verification was not performed due to the mandatory non-execution constraint.
