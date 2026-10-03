# PHASE 14.10 — BROWSER SESSION CREDENTIAL REMEDIATION ARCHITECTURE & THREAT MODEL REPORT

**Project**: ZdexCloud Platform & Personal File Server  
**Phase**: Phase 14.10 — Browser Session Credential Remediation Architecture & Threat Model  
**Mode**: ARCHITECTURE, THREAT MODEL & MIGRATION DESIGN ONLY  
**Status**: **ARCHITECTURE DESIGN COMPLETE — PROCEED TO IMPLEMENTATION**  
**Files Modified**: NONE (Design Phase Only)  
**Database Changes**: NONE  
**Migrations**: NONE  
**Production Changes**: NONE  
**Tests Executed**: NONE  

---

## 1. EXECUTIVE SUMMARY

Phase 14.10 establishes the target security architecture, threat model, and phased migration roadmap to remediate browser credential storage findings identified in Phase 14.9 and Phase 14.9-R1:
- **`SEC-14.9-01` (MEDIUM)**: Raw authentication tokens stored in `localStorage` exposed to same-origin JavaScript execution (DOM XSS).
- **`SEC-14.9-02` (LOW)**: Redundant customer token storage keys (`zdexcloud_token` and `rn_auth_token`).
- **`SEC-14.9-04` (LOW)**: Raw session bearer token appended to URL query parameter in local file-manager downloads (`/api/download?path=...&token=...`).

### Architecture Target Summary:
1. **Customer Web Session**: Transition from `localStorage` bearer tokens to a **Dual-Mode Backend Authentication Architecture**:
   - **Browser Clients**: `HttpOnly; Secure; SameSite=Lax; Path=/` session cookie (`__Host-zdex_session`) paired with a cryptographically bound Anti-CSRF token header (`x-zdex-csrf-token`).
   - **Non-Browser Clients (Android App & Tunnel Manager)**: Preserves native `Authorization: Bearer <token>` header authentication without modification or regression.
2. **Admin Portal Session**: Transition to a dedicated, partitioned `__Host-zdex_admin_session` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/admin`) while retaining the existing 15-minute idle timeout and 24-hour absolute lifetime.
3. **File Download Capability Remediation**: Replace raw token URL query parameters with ambient cookie-authenticated streaming endpoints or ephemeral, HMAC-signed single-use download tokens (`dt`) expiring in $\le 60$ seconds.
4. **Android & Gateway Invariants**: Android persistent device authentication (`DeviceAuthCredential`), session renewal, and Gateway WebSocket tunneling remain completely decoupled and unchanged.

---

## 2. CURRENT ARCHITECTURE BASELINE

| Dimension | Customer Web Application | Administrative Portal | Android Client & Gateway |
| :--- | :--- | :--- | :--- |
| **Credential Storage** | `localStorage.getItem('zdexcloud_token')` | `localStorage.getItem('zdex_admin_session_token')` | Android Keystore / EncryptedSharedPreferences |
| **Transmission Mechanism** | `Authorization: Bearer <token>` | `x-admin-session-token: <token>` | `Authorization: Bearer <token>` / Ephemeral Gateway Tokens |
| **Server-Side Model** | `UserSession.tokenHash = SHA256(rawToken)` | `AdminSession.tokenHash = SHA256(rawToken)` | `DeviceAuthCredential.credentialHash = SHA256(...)` |
| **Session Lifetime** | 24 Hours Absolute | 15 Min Idle + 24 Hours Absolute | 30-Day Device Credential $\rightarrow$ 24h Refreshed Session |
| **File Download Auth** | Query Parameter: `?token=<rawToken>` | N/A | Correlated Gateway Streaming Frames |
| **CSRF Defense** | Custom Header Requirement (Ambient cookies absent) | Custom Header Requirement | Native Mobile App (Non-Ambient) |

---

## 3. CURRENT SESSION CREDENTIAL FLOW

```text
[ Browser / Client ]                         [ ZdexCloud Backend ]                    [ MySQL Database ]
       │                                              │                                        │
       │── 1. POST /api/v1/auth/verify-otp ──────────>│                                        │
       │                                              │── 2. Validate OTP Hash ───────────────>│
       │                                              │<─ 3. OTP Valid ────────────────────────│
       │                                              │── 4. Generate 256-bit CSPRNG Token     │
       │                                              │── 5. Store SHA-256 Token Hash ────────>│
       │<─ 6. Return JSON { token: "<raw-64-hex>" } ──│                                        │
       │                                              │                                        │
 [ Store in localStorage ]                            │                                        │
       │                                              │                                        │
       │── 7. GET /api/v1/profile ───────────────────>│                                        │
       │      Header: Authorization: Bearer <raw>     │── 8. Query by SHA256(raw) ────────────>│
       │                                              │<─ 9. Session Active & Not Revoked ─────│
       │<─ 10. HTTP 200 OK + Payload ─────────────────│                                        │
```

---

## 4. THREAT MODEL

### 4.1 Threat Actors & Assets
- **Actors**:
  - `T1`: Authenticated Customer
  - `T2`: Unauthenticated Internet Attacker
  - `T3`: Cross-Origin Attacker (Malicious Website)
  - `T4`: Same-Origin DOM XSS Attacker
  - `T5`: Malicious Browser Extension
  - `T6`: Compromised Customer Client Device
  - `T7`: Compromised Backend Infrastructure
  - `T8`: Malicious / Compromised Network Relay Operator
  - `T9`: Accidental URL Sharing by Customer
- **Assets**:
  - `A1`: Customer `UserSession` (24h)
  - `A2`: Administrative `AdminSession` (15m idle / 24h abs)
  - `A3`: Persistent `DeviceAuthCredential` (Android)
  - `A4`: File Access Authorization
  - `A5`: Server / Node Hardware Identifiers
  - `A6`: Customer File Content & Metadata
  - `A7`: Customer Account Identity
  - `A8`: Administrative Control & System Configuration

### 4.2 Threat Matrix

| Actor / Asset | Attack Vector & Prerequisites | Impact & Privilege | Existing Mitigation | Target Architecture Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **T4 on A1** (XSS on Customer Token) | Injected script in `zdexcloud.com` origin reads `localStorage`. | Immediate token exfiltration; attacker uses raw bearer token off-site for up to 24 hours. | 24h hard TTL, SHA-256 DB hashing. | **`HttpOnly` Session Cookie**. Same-origin script cannot read the cookie string. |
| **T4 on A2** (XSS on Admin Token) | Injected script in `/admin` reads `localStorage`. | Immediate exfiltration of admin token; full control over control plane. | Strict Admin CSP, 15m idle timeout, SHA-256 DB hashing. | **`__Host-zdex_admin_session` HttpOnly Cookie** scoped strictly to `/admin`. |
| **T3 on A1** (Cross-Origin CSRF) | Malicious third-party website submits cross-origin requests. | State manipulation if ambient credentials exist. | Explicit header required; `localStorage` not sent cross-origin. | **`SameSite=Lax` + Anti-CSRF Token Header (`x-zdex-csrf-token`)**. |
| **T9 on A4 / A6** (URL Token Leakage) | Customer copies/shares download URL containing `?token=...`. | Third party gains customer session bearer token and full account access. | `Referrer-Policy: strict-origin-when-cross-origin`. | **Ambient Cookie Auth or Ephemeral 60s Signed Download Capability**. No session token in URL. |
| **T5 on A1** (Browser Extension) | Malicious extension with `<all_urls>` permission. | Access to DOM and cookies. | Sandboxed web pages. | Defense in depth: session binding, IP/UA anomaly detection, short session life. |
| **T8 on A6** (Relay Inspection) | Malicious relay snoops file streams. | Unauthorized access to file payload. | End-to-end TLS tunnels; ephemeral single-session gateway tokens. | Preserved. Gateway never handles raw `UserSession` or `DeviceAuthCredential`. |

---

## 5. OPTION A — CURRENT WEB STORAGE ARCHITECTURE (BASELINE)

### Advantages:
1. **Clean Decoupling**: Frontend and backend communicate via pure JSON REST APIs with explicit headers.
2. **CSRF Immunity by Architecture**: Absence of ambient cookies prevents conventional ambient-credential CSRF.
3. **Unified API Contract**: Android, CLI, and Web clients consume the exact same `Authorization: Bearer <token>` header schema.
4. **Zero Domain Boundary Issues**: Works across distinct subdomains without complex cookie scoping or CORS cookie configurations.

### Inherent Risks:
1. **XSS Exfiltration**: Any XSS execution gives the attacker full possession of the 24-hour bearer token (`SEC-14.9-01`).
2. **URL Parameter Exposure**: Local file manager passes the bearer token via `?token=` (`SEC-14.9-04`).
3. **Redundant Keys**: Multiple keys in storage create maintenance overhead (`SEC-14.9-02`).

---

## 6. OPTION B — HTTPONLY COOKIE SESSION ARCHITECTURE (RECOMMENDED TARGET)

### 6.1 Cookie Specifications

```text
Set-Cookie: __Host-zdex_session=<raw_token>;
            Path=/;
            Secure;
            HttpOnly;
            SameSite=Lax;
            Max-Age=86400
```

- **`__Host-` Prefix**: Enforces that the cookie is `Secure`, sent only from the exact host (no domain attribute, preventing subdomain hijacking), and restricted to `Path=/`.
- **`HttpOnly`**: Prevents `document.cookie` from reading the session token, neutralizing JavaScript exfiltration via DOM XSS.
- **`Secure`**: Enforces HTTPS-only transmission.
- **`SameSite=Lax`**: Provides protection against cross-site POST / PUT / DELETE requests while permitting seamless top-level navigation (e.g. clicking a link in an email notification).
- **`Max-Age=86400`**: Matches the strict 24-hour server-side `UserSession` TTL.

### 6.2 Admin Cookie Specification

```text
Set-Cookie: __Host-zdex_admin_session=<raw_token>;
            Path=/admin;
            Secure;
            HttpOnly;
            SameSite=Strict;
            Max-Age=86400
```

- Restricted to `Path=/admin` with `SameSite=Strict` to provide maximum isolation from main marketing/customer pages.

---

## 7. COOKIE DOMAIN ANALYSIS

| Domain / Subdomain | Primary Role | Cookie Scoping Recommendation | Rationale |
| :--- | :--- | :--- | :--- |
| `zdexcloud.com` / `www.zdexcloud.com` | Landing, Marketing, Dashboard | `__Host-zdex_session` (Host-Only) | Eliminates subdomain manipulation risks. |
| `api.zdexcloud.com` | Central Control Plane REST API | Same Origin or Host-Only Cookie | Reverse proxy routes `/api/v1` on main domain or accepts credentialed CORS. |
| `gateway.zdexcloud.com` | WebSocket Relay Gateway | No Browser Session Cookie | Uses ephemeral connection tokens generated by API. |
| `node-*.zdexcloud.com` | Phone Node Personal Subdomains | Ephemeral Node Tokens | Never shares central control plane session cookies. |

---

## 8. COOKIE CSRF PROTECTION DESIGN

Because browsers automatically attach ambient cookies to cross-origin requests matching domain/path, robust CSRF protection is mandatory upon cookie adoption.

### Cryptographically Bound Anti-CSRF Token Pattern:
1. **CSRF Token Generation**: Upon login/OTP verification, backend generates a random 128-bit cryptographic token `csrfToken`.
2. **Delivery**:
   - Sent to frontend in the login JSON response payload `{ csrfToken: "..." }`.
   - Optionally set as a readable cookie `zdex_csrf_token=<token>; Path=/; Secure; SameSite=Lax` (Double-Submit Pattern).
3. **Transmission on State Changes**: For every non-idempotent HTTP method (`POST`, `PUT`, `DELETE`, `PATCH`), the frontend attaches the header:
   ```http
   x-zdex-csrf-token: <csrfToken>
   ```
4. **Backend Validation Middleware**:
   ```typescript
   if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
     const csrfHeader = request.headers['x-zdex-csrf-token'];
     const sessionCsrf = request.session?.csrfToken;
     if (!csrfHeader || !crypto.timingSafeEqual(Buffer.from(csrfHeader), Buffer.from(sessionCsrf))) {
       throw new ForbiddenError('Invalid or missing CSRF token');
     }
   }
   ```
5. **Idempotent Requests (`GET`, `HEAD`, `OPTIONS`)**: Excluded from CSRF header requirement to allow normal page loads and asset fetching.

---

## 9. BACKEND-FOR-FRONTEND (BFF) ARCHITECTURE EVALUATION

```text
[ Browser ] ──(HttpOnly Session)──> [ BFF Proxy Server ] ──(mTLS / Bearer)──> [ Fastify Backend API ]
```

### Analysis for ZdexCloud:
- **Security Benefit**: Isolates microservice bearer tokens completely inside server-side infrastructure.
- **Operational Assessment**: In ZdexCloud, the Fastify backend *already* acts as a consolidated monolithic control plane and API gateway. Introducing an additional dedicated BFF layer would introduce:
  - Redundant network hops and latency for file streaming.
  - Duplication of authentication and routing middleware.
  - Increased maintenance overhead without tangible security improvements over direct Fastify HttpOnly cookies.
- **Conclusion**: **A dedicated BFF is NOT RECOMMENDED**. Fastify serves as the optimal direct termination point for HttpOnly session cookies.

---

## 10. CUSTOMER VS ADMIN SESSION SEPARATION

```text
                   ┌─────────────────────────────────────────┐
                   │           ZdexCloud Backend             │
                   └────────────────────┬────────────────────┘
                                        │
            ┌───────────────────────────┴───────────────────────────┐
            ▼                                                       ▼
  [ Customer Context ]                                     [ Admin Context ]
  Cookie: __Host-zdex_session                              Cookie: __Host-zdex_admin_session
  Path: /                                                  Path: /admin
  SameSite: Lax                                            SameSite: Strict
  Table: UserSession                                       Table: AdminSession
  Lifecycle: 24h Absolute                                  Lifecycle: 15m Idle + 24h Absolute
  Attached To: request.user                                Attached To: request.admin
```

- Strict namespace separation guarantees that a compromised customer cookie cannot authenticate against administrative endpoints, and vice versa.

---

## 11. ANDROID CLIENT COMPATIBILITY & ISOLATION

### Core Invariant:
**The browser session migration has ZERO impact on Android clients.**

```text
[ Android App (Kotlin Engine) ] ──(Authorization: Bearer <token>)──> [ Fastify API ]
                                                                             │
[ Web Browser ] ──────────────────(Cookie: __Host-zdex_session)─────> [ Fastify API ]
```

### Dual-Mode Authentication Fastify Hook:
```typescript
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  // 1. Check Bearer Header (Android App, CLI, Headless Clients)
  let rawToken = extractBearerToken(request);
  
  // 2. Fallback to HttpOnly Cookie (Web Browser)
  if (!rawToken && request.cookies?.__Host_zdex_session) {
    rawToken = request.cookies.__Host_zdex_session;
  }
  
  if (!rawToken) {
    throw new UnauthorizedError('Authentication required');
  }
  
  // 3. Authoritative SHA-256 Hash Resolution
  const user = await AuthService.validateSession(rawToken);
  request.user = user;
}
```

- Android `DeviceAuthCredential` and session refresh cycles continue operating via native HTTP headers without any breaking changes.

---

## 12. GATEWAY COMPATIBILITY

- The ZdexCloud Gateway (`src/gateway/gateway_service.ts`) communicates via WebSocket using ephemeral, single-connection `connectionToken` credentials.
- Browser session cookies terminate strictly at the Fastify control plane. When a browser initiates a remote file session, the Fastify control plane authenticates the cookie and issues a short-lived, single-use Gateway connection token.
- Raw `UserSession` tokens and `DeviceAuthCredential` keys are **never forwarded to the Gateway or phone nodes**.

---

## 13. FILE-MANAGER DOWNLOAD REMEDIATION (`SEC-14.9-04`)

### Proposed Remediation Options:

#### Option 1: Ambient Cookie-Authenticated Download Endpoint (Recommended)
- **Mechanism**: The download link `<a href="/api/download?path=...">` sends a standard `GET` request. The browser automatically attaches `__Host-zdex_session`.
- **Advantages**: Completely eliminates tokens from URLs; fully supports browser native download managers, `Range` headers, and streaming.
- **Security**: No token leakage via history, bookmarks, logs, or `Referer`.

#### Option 2: Ephemeral Signed Download Capability Token (`dt`)
- **Mechanism**: For cross-origin or detached media downloads:
  ```http
  GET /api/download?path=docs/report.pdf&dt=<HMAC_SHA256_TOKEN>
  ```
- **Capability Format**: `HMAC-SHA256(userId + filePath + expiresAt + nonce, SECRET)`
- **Constraints**:
  - Maximum Lifetime: 60 seconds.
  - Bound strictly to specific `filePath` and `userId`.
  - Single-use nonce invalidation.
  - Zero raw session credentials in URL.

---

## 14. LARGE FILE, RANGE REQUESTS & MEDIA STREAMING

- **HTTP Range Support**: Both Option 1 (Ambient Cookie) and Option 2 (Signed Capability) are fully compatible with:
  - `Range: bytes=0-1048575`
  - `HTTP 206 Partial Content`
  - `HTTP 416 Range Not Satisfiable`
- Video seeking, audio streaming, and resumable multi-part file downloads function seamlessly because session validation occurs on each chunk request without requiring stateful token mutation.

---

## 15. UPLOAD ARCHITECTURE COMPATIBILITY

- **Multipart Form Uploads**: `POST /api/upload` is authenticated via session cookie + `x-zdex-csrf-token` header.
- **Fastify Multipart Parser**: Operates with configured 100 MB payload limits and streaming file pipes directly to local storage or Gateway WebSocket chunks.
- **Cancellation & Progress**: Unaffected; JavaScript `AbortController` and `fetch` progress listeners operate identically.

---

## 16. CORS RE-EVALUATION

When switching to credentialed browser requests, CORS must adhere to strict security constraints:

| CORS Attribute | Target Configuration | Security Requirement |
| :--- | :--- | :--- |
| `Access-Control-Allow-Origin` | Exact Whitelist (e.g. `https://zdexcloud.com`) | **Never `*`** (Fails closed) |
| `Access-Control-Allow-Credentials` | `true` | Required for browser cookie transmission |
| `Access-Control-Allow-Headers` | `Content-Type, Authorization, x-zdex-csrf-token, x-request-id` | Explicit custom headers only |
| `Access-Control-Expose-Headers` | `x-request-id, content-disposition` | Scoped response headers |

---

## 17. SESSION ROTATION & LIFECYCLE

| Lifecycle Event | Browser Session Action | Server-Side State Action |
| :--- | :--- | :--- |
| **Login / OTP Verify** | Issues fresh `__Host-zdex_session` cookie + fresh `csrfToken`. | Creates new `UserSession` record; SHA-256 hashed. |
| **Logout** | Clears `__Host-zdex_session` (`Max-Age=0`) and purges local storage. | Sets `UserSession.revokedAt = NOW()`. |
| **Password Reset** | Clears active cookie; redirects to login. | Bulk revokes all active `UserSession` and `DeviceAuthCredential` records. |
| **Account Disabled** | Middleware rejects request with 401; clears cookie. | Account status check fails closed in `authenticate` hook. |

---

## 18. XSS THREAT MODEL AFTER COOKIE MIGRATION

```text
[ Current Web Storage ]                          [ Target HttpOnly Cookie ]
       XSS Attack                                        XSS Attack
           │                                                 │
           ▼                                                 ▼
Reads localStorage.getItem(token)                document.cookie returns "" (Empty)
           │                                                 │
           ▼                                                 ▼
Attacker exfiltrates raw token off-site          Attacker CANNOT steal raw token
Attacker accesses account for 24 hours           Attacker restricted to in-page actions
```

- **Accurate OWASP Distinction**: HttpOnly cookies prevent *credential exfiltration*. They do not prevent an active in-page script from issuing HTTP requests while executing inside the victim's live tab. Additional defenses (CSP, input sanitization) remain essential.

---

## 19. CSRF THREAT MODEL AFTER COOKIE MIGRATION

```text
[ Current Web Storage ]                          [ Target HttpOnly Cookie ]
  Cross-Origin Attacker                            Cross-Origin Attacker
           │                                                 │
           ▼                                                 ▼
Browser sends NO token in headers                Browser attaches ambient cookie
Request fails 401 Unauthorized                               │
                                                             ▼
                                                 Backend checks x-zdex-csrf-token
                                                 Header missing / mismatched
                                                 Request fails 403 Forbidden
```

- Anti-CSRF header validation completely mitigates cross-site ambient credential abuse.

---

## 20. SUBDOMAIN & ORIGIN ISOLATION

- Using host-only cookies (`__Host-` prefix) prevents malicious subdomains from reading or overwriting cookies set by the apex domain.
- Customer nodes (`node-*.zdexcloud.com`) run in an isolated origin boundary and cannot access central control plane session cookies.

---

## 21. BROWSER STORAGE MIGRATION DESIGN

```text
Phase 1: Backend Dual Acceptance (Accepts Bearer Header OR Cookie)
           │
           ▼
Phase 2: Frontend Bootstrap Migration:
         If localStorage.getItem('zdexcloud_token') exists:
           Dispatch POST /api/v1/auth/migrate-session with Bearer token
           Backend sets __Host-zdex_session cookie
           Frontend removes localStorage keys ('zdexcloud_token', 'rn_auth_token')
           │
           ▼
Phase 3: Frontend Exclusively Uses Cookie + CSRF Header
           │
           ▼
Phase 4: Backend Deprecates Browser Bearer Auth (Retaining Bearer strictly for Android / API keys)
```

---

## 22. BACKWARD COMPATIBILITY & ROLLBACK MATRIX

| Client / Server Version Mix | Authentication Behavior | Compatibility Status |
| :--- | :--- | :--- |
| **Old Frontend + New Backend** | Frontend sends `Authorization: Bearer`; backend accepts dual-mode. | Fully Compatible |
| **New Frontend + Old Backend** | Frontend falls back to Bearer header if `Set-Cookie` is unsupported. | Fully Compatible |
| **Old Android App + New Backend**| Android sends `Authorization: Bearer`; native auth intact. | Fully Compatible |
| **Multiple Open Tabs** | Session migration in Tab A sets cookie; Tab B automatically uses cookie. | Fully Compatible |

---

## 23. URL TOKEN ELIMINATION DESIGN (`SEC-14.9-04`)

1. **Frontend File Manager (`api.js`) Update**:
   ```javascript
   // Old (Vulnerable to URL leakage):
   getDownloadUrl(filePath) {
     return `/api/download?path=${encodeURIComponent(filePath)}&token=${token}`;
   }
   
   // Target (Clean Ambient Cookie):
   getDownloadUrl(filePath) {
     return `/api/download?path=${encodeURIComponent(filePath)}`;
   }
   ```
2. **Backend Fastify Handler**:
   - `GET /api/download` extracts session from `request.cookies.__Host_zdex_session` or `request.headers.authorization`.
   - Validates session and streams file via `Range` chunking.
   - Zero tokens in URLs, browser history, bookmarks, or web server logs.

---

## 24. LOGGING & OBSERVABILITY

- **Redaction Rules**: Logger (`observability/logger.ts`) and audit sanitizer (`admin_audit_sanitizer.ts`) must enforce masking of:
  - `cookie: __Host-zdex_session=[REDACTED]`
  - `x-zdex-csrf-token: [REDACTED]`
  - `x-admin-session-token: [REDACTED]`
- **Audit Events**: Session migration events logged with non-sensitive identifiers (`userId`, `sessionId`, `ipAddress`, `userAgent`).

---

## 25. THREAT-MODEL COMPARISON TABLE

| Security & Operational Dimension | Current Web Storage | Target HttpOnly Cookie | Dedicated BFF Proxy |
| :--- | :--- | :--- | :--- |
| **XSS Token Exfiltration** | Vulnerable (`SEC-14.9-01`) | **Protected** (`HttpOnly`) | **Protected** (`HttpOnly`) |
| **XSS In-Page Action Execution** | Vulnerable | Vulnerable | Vulnerable |
| **Conventional Ambient CSRF** | Immune (No ambient cookies) | **Protected** (Lax + CSRF Header) | **Protected** (Lax + CSRF Header) |
| **Session Token in URLs** | Exposed in local downloads (`SEC-14.9-04`) | **Eliminated** (Cookie-based streaming) | **Eliminated** |
| **Token Disclosure in Access Logs**| Risk in download query params | **Zero URL Token Exposure** | **Zero URL Token Exposure** |
| **Session Fixation** | Protected (Server CSPRNG) | **Protected** (Server CSPRNG) | **Protected** (Server CSPRNG) |
| **Implementation Complexity** | Low | **Moderate** | High (New proxy infrastructure) |
| **High-Throughput File Streaming** | Direct | **Direct (Zero overhead)** | High overhead (Extra proxy hop) |
| **Android Client Compatibility** | Native Bearer | **Native Bearer (Unchanged)** | Requires dual routing |
| **Gateway Proxy Compatibility** | Decoupled | **Decoupled (Unchanged)** | Complex tunnel proxying |

---

## 26. TARGET ARCHITECTURE DECISION

```text
PROPOSED TARGET ARCHITECTURE: OPTION B (HTTPONLY COOKIE + ANTI-CSRF HEADER)
```

**Justification**:
Option B completely resolves `SEC-14.9-01`, `SEC-14.9-02`, and `SEC-14.9-04` without the significant infrastructure overhead, latency penalty, and file streaming complexity of a dedicated BFF. It maintains 100% backward compatibility with Android mobile clients and WebSocket tunnels.

---

## 27. PROPOSED FUTURE IMPLEMENTATION SEQUENCING

```text
Phase 14.11 — Cookie Session Backend Foundation & Fastify Dual-Mode Middleware
Phase 14.12 — Anti-CSRF Token Generation, Header Validation & Middleware Hooks
Phase 14.13 — File Manager Download URL Remediation (URL Token Elimination)
Phase 14.14 — Customer Frontend Cookie Migration & Web Storage Cleanup
Phase 14.15 — Administrative Portal HttpOnly Cookie Partitioning
Phase 14.16 — Post-Remediation Security Verification & Final Certification
```

---

## 28. ROLLBACK STRATEGY

- **Feature Flag Controlled Rollout**: Dual-mode backend authentication accepts both Bearer headers and cookies throughout migration.
- **Instant Rollback**: If cookie issues arise in production, frontend can be toggled via `config.js` to resume sending `Authorization: Bearer <token>` without requiring database rollbacks or server downtime.

---

## 29. SECURITY ACCEPTANCE CRITERIA

1. Customer authentication tokens are stored strictly in `HttpOnly; Secure; SameSite=Lax; Path=/` cookies (`__Host-zdex_session`).
2. No authentication credentials exist in browser `localStorage` or `sessionStorage`.
3. All state-changing API requests enforce valid `x-zdex-csrf-token` header matching the active session.
4. File download URLs contain zero session tokens in query parameters (`/api/download?path=...`).
5. Android client authentication, session refresh, and tunnel connections operate without modification.
6. Admin sessions are partitioned in `__Host-zdex_admin_session` cookies with 15m idle and 24h absolute timeouts preserved.
7. CORS configuration strictly disallows wildcard origins on credentialed routes.

---

## 30. OUT-OF-SCOPE

- Android mobile cryptographic storage (Completed and Certified in Phase 14.5-R1).
- Gateway WebSocket tunneling protocols (Certified in Phase 14.3).
- Database encryption and password hashing algorithms (Certified in Phase 14.2 & 14.4).
- Stripe / LemonSqueezy billing reconciliation (Certified in Phase 14.2).

---

## 31. STATIC VERIFICATION

- Verification: `npx tsc -p tsconfig.json --noEmit` in `main website/Backend`
- Status: Clean (0 compiler errors).

---

## 32. TESTS

- **Tests Executed**: `NONE` (Design Phase Only).

---

## 33. FINAL ARCHITECTURE DECISION

```text
ARCHITECTURE DESIGN COMPLETE — PROCEED TO IMPLEMENTATION
```

---

## 34. HARD STOP SUMMARY

- **Report Path**: `PHASE_14.10_BROWSER_SESSION_CREDENTIAL_REMEDIATION_ARCHITECTURE_THREAT_MODEL.md`
- **Current Architecture**: Web Storage (`localStorage`) + Header-Based Bearer Tokens (`Authorization: Bearer`, `x-admin-session-token`) + Raw Token Download Query Parameter.
- **Proposed Target Architecture**: Dual-Mode Backend (HttpOnly `__Host-zdex_session` + `x-zdex-csrf-token` for browsers; Native Bearer Headers for Android) + Clean Ambient / Signed Capability File Downloads.
- **Major Security Trade-Offs**: Neutralizes DOM XSS token exfiltration; introduces ambient-credential CSRF defense requirements (resolved via Anti-CSRF token headers).
- **`SEC-14.9-01` Disposition**: Remediated via HttpOnly session cookies.
- **`SEC-14.9-02` Disposition**: Remediated via Web Storage key deprecation and cleanup.
- **`SEC-14.9-04` Disposition**: Remediated via ambient cookie streaming and URL token elimination.
- **Files Modified**: `NONE` (Design Phase Only).
