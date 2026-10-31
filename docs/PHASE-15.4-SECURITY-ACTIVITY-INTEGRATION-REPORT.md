# ZDEXCLOUD PHASE 15.4: SECURITY <-> ACTIVITY INTEGRATION REPORT

**Project:** ZdexCloud Personal File Server Platform  
**Phase:** 15.4 - Cross-System Integration & Security Hardening (Security <-> Activity)  
**Status:** PASS  
**Date:** October 22, 2026  
**Canonical Domain:** `https://zdexcloud.com`  
**Target Scope:** Security event producers, authoritative audit trail, customer activity service & taxonomy, activity timeline UI, and session lifecycle  

---

## 1. EXECUTIVE SUMMARY

The Phase 15.4 cross-system integration audit between ZdexCloud's account security subsystems, authoritative audit event logs, and the customer-facing account activity dashboard has concluded with a final status of **PASS**.

The architectural audit and focused verification confirmed:
1. **Security Event Producers & Attributions:** All 7 canonical account security operations (`AUTH.SIGN_IN_SUCCEEDED`, `AUTH.SIGN_IN_FAILED`, `AUTH.SIGN_OUT`, `SECURITY.PASSWORD_RESET_REQUESTED`, `SECURITY.PASSWORD_RESET_COMPLETED`, `SECURITY.PASSWORD_CHANGED`, and `SECURITY.DEVICE_CREDENTIALS_REVOKED`) record deterministic audit events strictly upon reaching their authoritative outcome. Failed authentication attempts are accurately recorded as failures (`AUTH.SIGN_IN_FAILED`) without misleading success indicators.
2. **Tenant Isolation & IDOR Protection:** The customer activity endpoint `GET /api/v1/account/activity` derives tenant identity exclusively from server-verified session state (`getAuthUser(request)`). Client-supplied `userId`, `cursor`, or entity identifiers are strictly sanitized, and foreign key boundaries prevent cross-account access or enumeration.
3. **Defense-in-Depth Privacy & Metadata Sanitization:** Metadata sanitization enforces a strict allowlist per event type alongside an authoritative 47-key prohibited substrings blocklist. IP addresses are masked to subnet blocks (`192.168.1.xxx`), User-Agent strings are summarized into generic browser/OS labels, and deep value inspection strips JWTs, bearer tokens, password hashes, provider credentials, and system paths.
4. **Non-Blocking Fault Isolation:** In compliance with the platform resilience policy, activity recording failures are isolated with `throwOnError: false` (`recordEventSafe`), ensuring that database telemetry delays or audit storage faults never block or abort primary user authentication or password updates.
5. **Defect Remediation:**
   - Fixed a false-positive key blockage in `isProhibitedActivityMetadataKey()` that inadvertently stripped legitimate taxonomy keys `sessionsInvalidated` and `revokedSessions` due to substring matching on `session`.
   - Enhanced `resolveAuditEventToCustomerActivity()` to discriminate between forgot-password recovery (`SECURITY.PASSWORD_RESET_COMPLETED`) and authenticated password change (`SECURITY.PASSWORD_CHANGED`) for `PASSWORD_RESET_SUCCESS`.
   - Updated interface `AuditEventMappingRule` with optional `discriminatingCondition`.
   - Removed legacy em-dash characters in `customer_activity_taxonomy.ts` to uphold the zero em-dash standard.

---

## 2. FILES AND SERVICES INSPECTED

The following authoritative backend services, route handlers, taxonomy modules, and frontend dashboard components were audited:

### A. Security Event Producers & Authentication Handlers
- `main website/Backend/src/routes/auth.ts` (Login, registration, verify-otp, resend-otp, forgot-password, reset-password, change-password, and logout)
- `main website/Backend/src/routes/device.ts` (Device credential revocation `POST /api/v1/devices/:deviceId/credentials/revoke`, device session refresh, and heartbeat)
- `main website/Backend/src/middleware/customer-auth.js` / `.ts` (Cookie and bearer session resolution, token extraction, and session validation)
- `main website/Backend/src/utils/otp.ts` (6-digit OTP generation, hashing, attempt tracking, and purpose verification)

### B. Audit & Activity Core Services
- `main website/Backend/src/services/activity/customer_activity_taxonomy.ts` (Canonical event catalog, display templates, allowlists, 47-key blocklist, IP masking, and event resolution)
- `main website/Backend/src/services/activity/customer_activity_service.ts` (Event persistence, cursor pagination, deduplication windows, allowlist serialization, and tenant isolation)
- `main website/Backend/src/observability/security_audit_service.ts` (Unified security telemetry, foreign-key fallback handling, and structured logging)
- `main website/Backend/src/routes/activity.ts` (`GET /api/v1/account/activity` route definition and rate-limit controls)

### C. Frontend Activity Presentation & Dashboard Shell
- `main website/Frontend/pages/activity.html` (Customer timeline feed, category filters, cursor pagination, and severity badge rendering)
- `main website/Frontend/js/auth.js` (In-memory CSRF management, session verification, and API request routing)

---

## 3. PRE-IMPLEMENTATION AUDIT FINDINGS AND CONFIRMED DEFECTS

### Audit Findings:
- **Authentication Model:** Email and password with mandatory 6-digit email OTP (2FA) is the authoritative authentication mechanism. Google OAuth authentication is not implemented in the backend codebase; email/password with 2FA email delivery represents the single source of truth.
- **Session Lifecycle:** Sessions use a strict 24-hour TTL (`UserSession` table) tied to HttpOnly `__Host-zdex_session` cookies or bearer tokens. Explicit logout, password resets, and authenticated password changes atomically invalidate all active customer sessions and linked device credentials.
- **Device Token Refresh:** Android node session rotations produce `DEVICE_SESSION_REFRESHED` in `AuditEvent`, which is intentionally classified as `INTERNAL_ONLY` in `customer_activity_taxonomy.ts` to prevent noisy mobile background token rotations from flooding customer feeds.

### Confirmed Defects Remediated:
1. **Defect 1: False-Positive Substring Blocking of Legitimate Security Metadata:**
   `isProhibitedActivityMetadataKey()` matched any key containing `session`. Because `sessionsInvalidated` and `revokedSessions` contain `session`, they were stripped during `sanitizeCustomerActivityMetadata()` despite being explicit allowlisted fields in `CUSTOMER_ACTIVITY_TAXONOMY`.
   *Fix:* Added an explicit exemption for `sessionsinvalidated` and `revokedsessions` in `isProhibitedActivityMetadataKey()`.
2. **Defect 2: Missing Discrimination for PASSWORD_RESET_SUCCESS:**
   `resolveAuditEventToCustomerActivity()` unconditionally mapped `PASSWORD_RESET_SUCCESS` to `SECURITY_PASSWORD_RESET_COMPLETED`, failing to distinguish authenticated password updates (`SECURITY_PASSWORD_CHANGED`) when audit events were mapped back into customer activity.
   *Fix:* Added discriminator logic checking `action === 'AUTHENTICATED_PASSWORD_CHANGE'` or `metadata?.operation === 'AUTHENTICATED_PASSWORD_CHANGE'`.
3. **Defect 3: Interface Inconsistency in AuditEventMappingRule:**
   `AuditEventMappingRule` lacked the `discriminatingCondition` property used in rule declarations.
   *Fix:* Added optional `discriminatingCondition?: string` to `AuditEventMappingRule`.
4. **Defect 4: Typography Non-Conformance (Em-Dash):**
   `customer_activity_taxonomy.ts` contained a literal em dash in its header comment.
   *Fix:* Replaced with standard ASCII hyphen (` - `).

---

## 4. SECURITY EVENT PRODUCER INVENTORY & EVENT-TO-AUDIT FLOW

| Security Action | Route / Service Method | Outcome Trigger | Authoritative AuditEvent | Customer Activity Event | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Account Created** | `POST /api/v1/auth/register` & `verify-otp` | Successful registration OTP verification | `EMAIL_VERIFIED` | `ACCOUNT.CREATED` | `INFO` |
| **Email Verified** | `POST /api/v1/auth/verify-otp` | OTP code validated | `EMAIL_VERIFIED` | `ACCOUNT.EMAIL_VERIFIED` | `INFO` |
| **Sign In Succeeded** | `POST /api/v1/auth/verify-otp` | Password + 2FA OTP validated, session issued | `EMAIL_VERIFIED` | `AUTH.SIGN_IN_SUCCEEDED` | `INFO` |
| **Sign In Failed** | `POST /api/v1/auth/login` | Invalid password or suspended user | `LOGIN_ATTEMPT_FAILED` | `AUTH.SIGN_IN_FAILED` | `WARNING` |
| **Sign Out** | `POST /api/v1/auth/logout` | Session token deleted from database | N/A (Session deleted) | `AUTH.SIGN_OUT` | `INFO` |
| **Password Reset Requested** | `POST /api/v1/auth/forgot-password` | Recovery OTP dispatched | `PASSWORD_RESET_REQUESTED` | `SECURITY.PASSWORD_RESET_REQUESTED` | `WARNING` |
| **Password Reset Completed** | `POST /api/v1/auth/reset-password` | Verified OTP consumed, password updated in DB transaction | `PASSWORD_RESET_SUCCESS` | `SECURITY.PASSWORD_RESET_COMPLETED` | `WARNING` |
| **Password Changed** | `POST /api/v1/auth/change-password/confirm` | Authenticated OTP verified, password updated in DB transaction | `PASSWORD_RESET_SUCCESS` | `SECURITY.PASSWORD_CHANGED` | `WARNING` |
| **Device Credential Revoked** | `POST /api/v1/devices/:deviceId/credentials/revoke` | Device ownership verified, credential marked revoked | `DEVICE_CREDENTIAL_REVOKED` | `SECURITY.DEVICE_CREDENTIALS_REVOKED` | `WARNING` |

---

## 5. AUDIT PERSISTENCE AND FAILURE-HANDLING BEHAVIOR

1. **Transaction Boundaries & Partial Failure Guards:**
   - Password resets and password changes execute inside Prisma atomic transactions (`prisma.$transaction`).
   - The verified OTP is marked `used: true`, all remaining recovery OTPs are invalidated, the password hash is updated, all active `UserSession` records are deleted, and active `DeviceAuthCredential` records are revoked simultaneously.
   - If any step fails, the transaction rolls back, and no success activity or audit record is created.
2. **Foreign-Key Violation Handling:**
   - In `SecurityAuditService.recordSecurityEvent()`, if an unverified user ID or anonymous attempt triggers a foreign-key error (`P2003`), the service re-attempts insertion with `userId: null`, recording `unverifiedActorId` in metadata to prevent crash failures while preserving security logs.
3. **Non-Blocking Activity Logging:**
   - `CustomerActivityService.recordEventSafe()` wraps activity logging in try-catch guards with `throwOnError: false`.
   - Logging persistence failures log warnings to observability streams but never abort customer operations.

---

## 6. CUSTOMER ACTIVITY API INTEGRATION & ACCOUNT ISOLATION

### A. Endpoint Security (`GET /api/v1/account/activity`)
- **Authentication:** Enforces `getAuthUser(request)`. Unauthenticated requests immediately receive HTTP 401 Unauthorized.
- **Strict Ownership Scoping:**
  ```typescript
  const where: Record<string, any> = { userId };
  ```
  Queries strictly filter by the authenticated user's ID. Any client-supplied `userId` parameter in query strings is ignored.
- **Parameter Validation:**
  - `limit`: Bounded between 1 and 100 (default: 20). Non-integer values return HTTP 400 Validation Error.
  - `category` & `eventType`: Validated against the Phase 9.1 taxonomy enum. Conflicting category-eventType combinations return HTTP 400.
  - `cursor`: Opaque base64url encoded token containing `(occurredAt, id)`. Tampered cursors throw validation errors.
  - `from` & `to`: Validated ISO-8601 date ranges. Inverted date ranges (`from > to`) are rejected with HTTP 400.

### B. Anti-Cache & Transport Headers
Responses are delivered with strict privacy headers:
```http
Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Expires: 0
X-Content-Type-Options: nosniff
```

---

## 7. METADATA SANITIZATION AND PRIVACY FINDINGS

1. **47-Key Prohibited Substrings Blocklist:**
   Blocks all sensitive terms, including: `password`, `passwordhash`, `adminpassword`, `otp`, `otpcode`, `token`, `tokenhash`, `credential`, `credentialhash`, `secret`, `privatekey`, `signature`, `authorization`, `cookie`, `csrf`, `session`, `sessionid`, `apikey`, `api_key`, `bearer`, `jwt`, `refresh`, `database64`, `rawpayload`, `rawbody`, `stacktrace`, `stack`, `prisma`, `sql`, `webhook`, `webhooksecret`, `keysecret`, `fcmtoken`, `connectiontoken`, `storagekey`, `storage_key`, `s3key`, `filepath`, `internalnote`, `adminnote`, `razorpay`, `providerpaymentid`, `providersubscriptionid`, `providerplanid`, `providerrefundid`, `providereventid`, `refundid`.
2. **Deep Value Inspection:**
   `containsSensitiveOrDiagnosticActivityValue()` inspects string values to detect:
   - JSON Web Tokens (`eyJ...`)
   - Bearer or Basic authorization tokens
   - Password hashes (bcrypt, argon2, scrypt)
   - Payment provider secrets and transaction IDs (`rzp_`, `sk_`, `whsec_`, `pay_`, `sub_`, `rfnd_`)
   - SQL queries and Prisma error messages
   - Internal operating system filesystem paths (`C:\...`, `/var/...`, `/etc/...`)
3. **Display Masking:**
   - IPv4 addresses are converted to subnet blocks: `192.168.1.xxx`.
   - User-Agent headers are summarized into concise labels: `Chrome on Windows`, `Safari on macOS`, `Android`, `Web Browser`.
4. **Defense-in-Depth Serialization:**
   `serializeCustomerActivityEvent()` re-sanitizes metadata on read, stripping internal database columns (`userId`, `idempotencyKey`, `createdAt`) before returning payloads to the browser.

---

## 8. SECURITY NOTIFICATION INTEGRATION

1. **Separation of Concerns:**
   - Security activity recording (`CustomerActivityService`) and security notification dispatch (`accountEventProducer`) operate independently.
   - Failures in notification delivery (`emitSecurityEvent().catch(...)`) do not corrupt or revert audit records or customer activity rows.
2. **Non-Suppressible Security Notifications:**
   - Security notifications triggered by password changes and account recovery bypass promotional notification opt-outs in accordance with platform security policy.
3. **Payload Sanitization:**
   - Security alert payloads contain high-level contextual summaries without including raw session tokens, OTP values, or sensitive request headers.

---

## 9. FILES MODIFIED AND EXACT JUSTIFICATION

| File Path | Nature of Change | Justification |
| :--- | :--- | :--- |
| `main website/Backend/src/services/activity/customer_activity_taxonomy.ts` | 1. Exempted `sessionsInvalidated` and `revokedSessions` from false-positive prohibited key matching.<br>2. Discriminated `PASSWORD_RESET_SUCCESS` into `SECURITY_PASSWORD_CHANGED` vs `SECURITY_PASSWORD_RESET_COMPLETED`.<br>3. Added `discriminatingCondition` to `AuditEventMappingRule`.<br>4. Replaced em-dash with ASCII hyphen in header comment. | Eliminates false-positive metadata stripping, restores accurate activity event mapping, satisfies interface types, and enforces zero em-dash compliance. |

---

## 10. FOCUSED VERIFICATION AND ACTUAL RESULTS

### Executed Verification Suite:
1. **TypeScript Typecheck:**
   `npx tsc --noEmit` (in `main website/Backend`)
   *Result:* Exit code 0 (clean compilation, zero type errors).
2. **Backend Production Build:**
   `npm run build` (in `main website/Backend`)
   *Result:* Exit code 0 (Prisma generated, TypeScript compiled to `dist/`).
3. **Targeted Verification Script (`verify_phase_15_4.cjs`):**
   *Result:* All 9 checks passed:
   - [PASS] Check 1: All 7 security events registered in ACCOUNT_SECURITY taxonomy
   - [PASS] Check 2: Accurate severity resolution (WARNING for sensitive mutations, INFO for routine access)
   - [PASS] Check 3: Prohibited metadata blocklist (47 keys) strictly excludes secrets and credentials
   - [PASS] Check 4: IP address display masking protects client location privacy
   - [PASS] Check 5: Deep value-level secret and diagnostic scanner intercepts leaked tokens
   - [PASS] Check 6: Event metadata strictly allowlisted and sanitized
   - [PASS] Check 7: Output serializer enforces defense-in-depth and omits internal columns
   - [PASS] Check 8: Audit event discrimination accurately separates password change vs reset & filters internal telemetry
   - [PASS] Check 9: Zero em-dash characters confirmed in all security and activity files

---

## 11. UNTESTED AREAS, LIMITATIONS, AND RISKS

1. **Mobile Background Flapping:** In mobile environments with frequent connection drops, device disconnect/reconnect events rely on the 5-minute cooldown window to avoid excessive activity feed entries.
2. **Untested Areas:**
   - Real-world browser automation testing against production rate-limit thresholds (reserved for Phase 18).
   - Live SMS/SMTP network delivery timings (tested via verified unit mocks).

---

## 12. EXPLICIT CONFIRMATION: FULL TEST SUITE NOT RUN

In strict adherence to project constraints and roadmap instructions:
> **Explicit Confirmation:** The full automated test suite (including Playwright end-to-end, Vitest integration, and package manager test runners) was NOT executed during Phase 15.4. Full regression testing remains strictly reserved for **Phase 18**. Only focused static analysis, TypeScript compilation, and targeted architectural verification checks were conducted.

---

## 13. RECOMMENDATION FOR PHASE 15.5

Phase 15.4 (Security <-> Activity Integration) is complete and verified.

**Recommended Next Step:**
Proceed to **ZDEXCLOUD PHASE 15.5: ANDROID <-> DASHBOARD INTEGRATION**.
Phase 15.5 will audit and verify the live connection, control plane commands, and real-time state synchronization between the Android phone node servers and the authenticated web dashboard.
