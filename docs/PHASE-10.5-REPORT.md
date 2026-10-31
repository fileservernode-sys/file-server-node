# ZDEXCLOUD PHASE 10.5: SECURITY ACTIVITY AND ACCOUNT SECURITY HISTORY

## Executive Summary

Phase 10.5 completes the customer-facing Security Activity experience by seamlessly integrating ZdexCloud's account security events with the existing `CustomerActivityEvent` data model, `CustomerActivityService`, `/api/v1/account/activity` endpoint, Account Settings page (`settings.html`), and Activity feed (`activity.html`).

All customer-visible security actions—including authenticated password changes, forgot-password recovery completions, recovery OTP requests, sign-in successes, sign-in failures, sign-outs, and paired device credential revocations—are now recorded with strict data minimization (zero raw passwords, OTPs, tokens, or raw IPs) and non-blocking failure isolation. The Account Settings page now features a dedicated **Recent Security Activity** preview with status severity pills, loading skeletons, error retry, and direct deep-linking into the filtered Activity page (`activity.html?category=ACCOUNT_SECURITY`).

---

## 1. Security Event Taxonomy & Allowlists

The `ACCOUNT_SECURITY` activity category unites all customer-visible authentication and credential events into a coherent, tamper-resistant history.

| Taxonomy Event Type | Category | Severity | Allowed Metadata Keys | Description / Trigger |
| :--- | :--- | :--- | :--- | :--- |
| `SECURITY.PASSWORD_CHANGED` | `ACCOUNT_SECURITY` | `WARNING` | `sessionsInvalidated`, `revokedSessions`, `maskedIp`, `userAgentSummary` | Customer changes password from Account Settings. Revokes all active sessions & device credentials. |
| `SECURITY.PASSWORD_RESET_COMPLETED` | `ACCOUNT_SECURITY` | `WARNING` | `sessionsInvalidated`, `revokedSessions`, `maskedIp`, `userAgentSummary` | Customer completes forgot-password reset via email OTP recovery. |
| `SECURITY.PASSWORD_RESET_REQUESTED` | `ACCOUNT_SECURITY` | `WARNING` | `maskedIp`, `userAgentSummary` | Password reset 6-digit verification code requested. Coalesced in 60s cooldown window. |
| `AUTH.SIGN_IN_SUCCEEDED` | `ACCOUNT_SECURITY` | `INFO` | `authMethod`, `maskedIp`, `userAgentSummary` | Successful login with password and verified 2FA email OTP. |
| `AUTH.SIGN_IN_FAILED` | `ACCOUNT_SECURITY` | `WARNING` | `reasonLabel`, `reasonSummary`, `maskedIp`, `userAgentSummary` | Unsuccessful login attempt (invalid password or suspended account). Coalesced in 60s cooldown window. |
| `AUTH.SIGN_OUT` | `ACCOUNT_SECURITY` | `INFO` | `maskedIp`, `userAgentSummary` | User explicitly logs out and invalidates session token. |
| `SECURITY.DEVICE_CREDENTIALS_REVOKED` | `ACCOUNT_SECURITY` | `WARNING` | `deviceName`, `reasonLabel`, `revokedAt` | Long-lived node credential revoked manually or automatically during password reset/change. |

---

## 2. Security & Privacy Hardening (Data Minimization)

To safeguard customer privacy and prevent internal secret leakage:

1. **Strict Key-Level Allowlists:**
   - Only explicitly declared metadata keys per taxonomy event specification are accepted.
   - Any sensitive keys matching `isProhibitedActivityMetadataKey` (such as `password`, `passwordHash`, `token`, `otp`, `csrf`, `secret`, `rawHeaders`, `req`) are discarded on ingestion and on read.
2. **IP Address Masking:**
   - Client IP addresses are never persisted in raw form.
   - IPv4 addresses are masked to subnet format (`192.168.1.xxx`).
   - IPv6 addresses are masked to prefix format (`2001:db8:85a3:****`).
3. **User-Agent Summarization:**
   - Long raw browser `User-Agent` strings are summarized into concise, human-friendly client labels (e.g. `Chrome on Windows`, `Safari on macOS`, `Android`).
4. **Defense-in-Depth Serialization:**
   - `serializeCustomerActivityEvent` runs metadata allowlisting, IP masking, and text sanitization a second time upon read.
   - Database internal columns (`idempotencyKey`, `createdAt`, `userId`) are never exposed to the client.

---

## 3. Failure Isolation & Business Continuity

Customer activity recording and security notifications are non-blocking and auxiliary to core account security operations:

- **Safe Recording (`CustomerActivityService.recordEventSafe`):**
  Catches all database, constraint, or network errors, logs a non-blocking warning, and returns `{ recorded: false, reason: 'PERSISTENCE_ERROR' }`.
- **Safe Notifications (`accountEventProducer.emitSecurityEvent`):**
  Dispatched asynchronously with `.catch(() => {})` handlers.
- **Guarantee:**
  A failure in logging an activity row or delivering an email alert **NEVER** fails, aborts, or rolls back an authenticated password change, password reset, or customer login.

---

## 4. Account Settings Page Integration (`settings.html`)

In `main website/Frontend/pages/settings.html`:

1. **Recent Security Activity Section:**
   - Header updated to **Recent Security Activity** with a direct link: `activity.html?category=ACCOUNT_SECURITY`.
   - Footer note action updated to **Explore All Security Activity** (`activity.html?category=ACCOUNT_SECURITY`).
2. **API Integration (`loadRecentActivityPreview`):**
   - Queries `GET /api/v1/account/activity?category=ACCOUNT_SECURITY&limit=5` via authenticated `AuthService.apiFetch`.
   - Resolves timestamps via `item.occurredAt || item.createdAt` with fallback formatting.
   - Renders visual severity pills:
     - `CRITICAL` -> `.settings-pill--danger` ("Critical")
     - `WARNING` -> `.settings-pill--warning` ("Important")
     - `INFO` -> `.settings-pill--info` ("Info")
3. **Resilient UI States:**
   - **Loading:** Animated skeleton cards displayed while the API request is in flight.
   - **Empty:** Displays "No security events recorded yet" with explanatory text describing the actions tracked.
   - **Error:** Displays "Unable to load security activity preview" with a functional **Retry** button and deep-link to the full Activity page.
4. **XSS Prevention:**
   - All dynamic text is injected via safe DOM properties (`textContent`) and element creation (`document.createElement`). No `innerHTML` string interpolation of untrusted values.

---

## 5. Activity Page Integration (`activity.html`)

In `main website/Frontend/pages/activity.html`:

1. **URL Parameter Handling:**
   - `initActivityPage()` checks `window.location.search` for `?category=ACCOUNT_SECURITY` (or any valid taxonomy category).
   - Automatically preselects and highlights the corresponding category filter button upon page load.
2. **URL State Synchronization:**
   - Selecting a category updates the browser URL via `window.history.replaceState` (e.g. adding `?category=ACCOUNT_SECURITY` or clearing for `ALL`), enabling bookmarking, browser back/forward, and direct link sharing.
3. **Consistent Presentation:**
   - Security events display their shield icon (`activity-event-icon--security`), contextual metadata pills (`sessionsInvalidated`, `maskedIp`, `reasonLabel`), and severity badges.

---

## 6. Test Suite (`security_activity.test.ts`)

A dedicated test suite has been created at `main website/Backend/tests/security_activity.test.ts` marked `// NOTE: These tests are NOT EXECUTED as per policy.`

The suite validates:
1. **Taxonomy & Specs:** All 7 required security events registered under `CustomerActivityCategory.ACCOUNT_SECURITY` with correct severity levels and metadata allowlists.
2. **Data Minimization & IP Masking:** Strict key exclusion for passwords, OTPs, session tokens, CSRF tokens, and verified IPv4/IPv6 masking.
3. **Failure Isolation:** Non-blocking behavior of `recordEventSafe` and `emitSecurityEvent` under database or network failures.
4. **API Route Security:** Session-scoped user authorization on `GET /api/v1/account/activity`, IDOR protection against query-level `userId` injection, category filtering, and cache-control headers.
5. **Frontend Integration:** Verification of DOM structure, category-filtered API calls, error retry, and URL search parameter handling across `settings.html` and `activity.html`.

---

## 7. Artifacts and Modified Files

- `main website/Backend/src/services/activity/customer_activity_taxonomy.ts`: Added `reasonLabel` to `allowedMetadataKeys` for `AUTH.SIGN_IN_FAILED`.
- `main website/Backend/src/routes/auth.ts`: Added non-blocking `AUTH.SIGN_IN_FAILED` activity recording for suspended account login attempts.
- `main website/Frontend/pages/settings.html`: Enhanced Recent Security Activity preview, added `.settings-pill--danger`, wired `?category=ACCOUNT_SECURITY` filter, loading skeletons, error retry, and safe DOM rendering.
- `main website/Frontend/pages/activity.html`: Added URL query parameter parsing and `window.history.replaceState` synchronization on category selection.
- `main website/Backend/tests/security_activity.test.ts`: Created comprehensive unit and integration test suite (marked `NOT EXECUTED`).
- Reports: `PHASE-10.5-REPORT.md` written to repository root, `main website/Backend/`, and artifact directory.
