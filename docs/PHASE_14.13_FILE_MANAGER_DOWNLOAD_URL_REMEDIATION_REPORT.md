# PHASE 14.13 — FILE MANAGER DOWNLOAD URL REMEDIATION REPORT

**Audit Date**: October 2, 2026  
**Status**: `IMPLEMENTATION COMPLETE — READY FOR PHASE 14.14`  
**Scope**: File Manager Download URL Security, Ambient Cookie Authentication, and In-URL Credential Elimination  
**Policy Compliance**: Strict Static Verification Only (`Tests Executed: NONE`)  
**Database Changes**: `NONE` (Zero schema modifications, zero migrations)

---

## 1. Executive Summary

Phase 14.13 resolves the remaining low-severity browser credential exposure finding identified during the Phase 14.9 web session audit:

```text
SEC-14.9-04 LOW
LocalApiAdapter / EmbeddedApiAdapter appends raw customer session token as ?token=<rawToken> in file download URLs
```

By leveraging the dual-mode authentication architecture established in Phase 14.11 (`__Host-zdex_session` HttpOnly session cookies for browser clients and `Authorization: Bearer <token>` headers for native clients), Phase 14.13 eliminates raw customer session tokens from all file-download and media-streaming URLs.

Browser downloads now authenticate seamlessly using ambient HttpOnly cookies transmitted on same-origin top-level navigations, anchor downloads, image tags, and video/audio streaming elements. The backend file-manager router has been updated to import the canonical `getAuthUser` middleware, strictly rejecting query-parameter authentication tokens.

---

## 2. Pre-Implementation Audit Findings

A thorough codebase audit identified the exact locations where raw customer session tokens entered URLs:

| Location | Component | Prior Vulnerable Pattern | Remediated Status |
| :--- | :--- | :--- | :--- |
| `main website/Frontend/js/file-manager-embedded.js` | `ApiService.getDownloadUrl` | `${base}/file-manager/${sid}/download?path=${path}&token=${token}` | **REMEDIATED** (`${base}/file-manager/${sid}/download?path=${path}`) |
| `main website/Frontend/file-manager-assets/js/api.js` | `LocalApiAdapter.getDownloadUrl` | `${this.baseUrl}/download?path=${path}&token=${token}` | **REMEDIATED** (`${this.baseUrl}/download?path=${path}`) |
| `main website/Backend/src/gateway/web/js/api.js` | `LocalApiAdapter.getDownloadUrl` | `${this.baseUrl}/download?path=${path}&token=${token}` | **REMEDIATED** (`${this.baseUrl}/download?path=${path}`) |
| `main website/Backend/src/routes/file-manager.ts` | Route Helper `getAuthUser` | `if (query?.token) token = query.token.trim();` | **REMOVED** (Imports canonical `getAuthUser` from `middleware/customer-auth.ts`) |

### Complete Query-Token Elimination

Repository-wide pattern scanning (`git grep -n -E "(\?|&)token=" "main website"`) confirmed that **zero** active download routes or client adapters construct or parse `?token=` query parameters for customer authentication.

---

## 3. Existing Download Architecture vs. Remediated Architecture

### Legacy Vulnerable Flow (Phase 14.9 Baseline)

```text
Browser File Manager (file-manager-embedded.js)
    ↓
Reads localStorage.getItem('zdexcloud_token')
    ↓
Constructs GET /api/v1/file-manager/:serverId/download?path=/doc.pdf&token=<rawToken>
    ↓
Token logged in Fastify/Proxy access logs, browser history, Referer headers
    ↓
Fastify router extracts query.token
    ↓
Session validated
```

### Remediated Architecture (Phase 14.13 Production)

```text
Browser File Manager (file-manager-embedded.js)
    ↓
Constructs GET /api/v1/file-manager/:serverId/download?path=/doc.pdf (NO URL TOKENS)
    ↓
Browser automatically transmits HttpOnly cookie:
Cookie: __Host-zdex_session=<sessionToken>
    ↓
Fastify Routing & Middleware (customer-auth.ts)
    ↓
extractCustomerToken() -> identifies source: 'cookie'
    ↓
resolveCustomerSession() -> checks UserSession.tokenHash in MySQL
    ↓
resolveAuthorisedServer(serverId, user.id) -> enforces tenant ownership (device.userId === user.id)
    ↓
Gateway Proxy -> tunnels FILE_REQUEST { operation: 'DOWNLOAD' } over WSS to Android
    ↓
LocalServerEngine / Android flash storage streams binary chunks
    ↓
Fastify streams response with X-Content-Type-Options: nosniff & Accept-Ranges: bytes
```

---

## 4. Architectural Option Decision

### Primary Option Adopted: Ambient Cookie-Authenticated Streaming

The pre-implementation audit proved that all browser-mediated file downloads, image lightbox views, audio playback, and video streaming within ZdexCloud occur within the same domain scope (`zdexcloud.com` or local testing hosts).

- **No secondary signed ephemeral token mechanism was required.**
- **No additional database tables or stateful replay trackers were required.**
- Ambient `__Host-zdex_session` cookies provide full session isolation, automatic revocation on logout/password reset, and zero credential leakage in URLs.

---

## 5. Security & Invariant Analysis

### A. Authentication & Query Parameter Rejection

- `main website/Backend/src/routes/file-manager.ts` now exclusively imports `getAuthUser` from `../middleware/customer-auth.js`.
- If an old client sends `?token=<staleToken>` without a valid Bearer header or `__Host-zdex_session` cookie, the backend rejects the request with `401 Unauthorized` (`Missing or invalid authentication credential`).

### B. Authorization & Tenant Isolation

Tenant isolation remains strictly enforced via `resolveAuthorisedServer(serverId, userId)`:
1. Resolves `ServerInstance` and associated `Device`.
2. Asserts `device.userId === user.id`. Requests targeting unauthorized servers fail immediately with `403 Forbidden`.
3. Verifies active gateway WebSocket connection to the authoritative Android device before dispatching proxy operations.

### C. Path Traversal Defense (Phase 14.3 Invariants)

All path traversal protections remain intact:
- Prohibits `..` parent directory traversal.
- Prohibits `\0` null-byte injections.
- Validates file paths prior to gateway tunneling and enforces sandbox root boundaries on the Android `LocalServerEngine`.

### D. CSRF & State-Mutation Semantics

- File download requests are HTTP `GET` operations and are idempotent and safe.
- They remain exempt from CSRF token checks while requiring authenticated customer identity.
- State-changing file operations (`POST /folders`, `POST /rename`, `POST /upload`, `DELETE /files`, `POST /auth/login`) continue enforcing `x-zdex-csrf-token` verification for cookie-authenticated browser requests via `customerAuthenticate` and `getAuthUser`.

### E. Range Requests & Response Headers

The download streaming pipeline preserves full HTTP range functionality:
- Supports `Range: bytes=start-end` header.
- Returns `206 Partial Content` with `Content-Range` and `Content-Length`.
- Returns `416 Range Not Satisfiable` for out-of-bounds byte ranges.
- Hardened security headers: `X-Content-Type-Options: nosniff`, `Accept-Ranges: bytes`, sanitized `Content-Disposition`.

### F. CORS & Observability Hardening

- Removed legacy hardcoded `Access-Control-Allow-Origin: *` from `file-manager.ts` to prevent conflicts with credentialed cookie requests.
- Updated centralized CORS configuration in `src/middleware/security.ts` to allow `Range` / `range` headers and expose `Content-Range`, `Accept-Ranges`, `Content-Length` headers.
- Enhanced `sanitizeLogMetadata` in `src/observability/logger.ts` with regex redaction for URL query tokens (`([?&](?:token|accessToken|sessionToken|authToken|connectionToken)=)[^&\s]+`).

---

## 6. Compatibility Verification

| Component | Invariant Preserved | Impact |
| :--- | :--- | :--- |
| **Android Host App** | `DeviceAuthCredential`, `RemoteNodeTunnelManager`, `LocalServerEngine` | **No Changes** — 100% Intact |
| **Gateway Tunneling** | WebSocket `connectionToken`, `sessionEpoch`, correlated `FILE_REQUEST` | **No Changes** — 100% Intact |
| **Android Native / CLI Clients** | `Authorization: Bearer <token>` authentication | **No Changes** — 100% Intact |
| **Database Schema** | Prisma schema, MySQL tables, migrations | **Zero DB Changes / Zero Migrations** |

---

## 7. Modified Files Summary

1. `main website/Backend/src/routes/file-manager.ts`
   - Replaced local `getAuthUser` helper (which accepted `query.token`) with canonical import from `../middleware/customer-auth.js`.
   - Removed legacy manual `Access-Control-Allow-Origin: *` from download response handler.
2. `main website/Backend/src/middleware/security.ts`
   - Added `Range`, `range` to CORS `allowedHeaders`.
   - Added `Content-Range`, `Accept-Ranges`, `Content-Length` to CORS `exposedHeaders`.
3. `main website/Backend/src/observability/logger.ts`
   - Added regex pattern for automatic URL token redaction in telemetry and structured logs.
4. `main website/Frontend/js/file-manager-embedded.js`
   - Updated `getDownloadUrl` to return clean URL without `&token=...`.
   - Configured `credentials: 'include'` on all fetch requests and `withCredentials: true` on XHR uploads.
5. `main website/Frontend/file-manager-assets/js/api.js`
   - Updated `LocalApiAdapter.getDownloadUrl` to return clean `/api/download?path=...`.
6. `main website/Backend/src/gateway/web/js/api.js`
   - Updated `LocalApiAdapter.getDownloadUrl` to return clean `/api/download?path=...`.

---

## 8. Static Verification Results

- **TypeScript Compilation (`tsc --noEmit`)**:
  ```text
  Exit Code: 0 (0 errors)
  ```
- **Backend Build (`npm run build`)**:
  ```text
  ✔ Generated Prisma Client (v5.22.0)
  ✔ TypeScript compilation successful
  ✔ Web assets mirrored to dist/
  Exit Code: 0
  ```
- **Tests Executed**:
  ```text
  NONE (Strict project policy compliance: static verification only)
  ```

---

## 9. Final Certification & Status

```text
FINAL STATUS: IMPLEMENTATION COMPLETE — READY FOR PHASE 14.14
```
