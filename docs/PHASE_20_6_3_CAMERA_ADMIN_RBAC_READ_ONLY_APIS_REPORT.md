# ZDEXCLOUD — PHASE 20.6.3 IMPLEMENTATION REPORT
## Camera Admin RBAC & Read-Only Administration APIs

**Roadmap:** Phase 20 — Camera Backend & Infrastructure  
**Parent Batch:** Phase 20.6.2 — Camera Observability Instrumentation & Privacy Redaction Hardening (Accepted)  
**Execution Batch:** Phase 20.6.3 — Camera Admin RBAC & Read-Only Administration APIs  
**Next Batch:** Phase 20.6.4 — Camera Admin Action Controls & Diagnostic Workflows  
**Testing Policy:** Create/update tests only. ZERO tests executed (`NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`).  
**Database Policy:** Zero database mutations, zero schema changes, zero migrations executed.

---

## 1. Pre-Implementation Audit Findings

Before introducing the Camera administrative control plane, a thorough pre-implementation audit was conducted across the existing ZdexCloud administration, authentication, RBAC, and routing architecture:

### 1.1 Existing Admin Authentication (`src/middleware/admin-auth.ts`)
- **Session Resolution**: Authentication is verified via `adminAuthenticate`, which inspects either the HTTP-only `admin_session` cookie or the standard `Authorization: Bearer <sessionToken>` header.
- **Session Verification**: The session token is hashed using SHA-256 (`hashSessionToken`) and matched against the `AdminSession` table.
- **Expiry & Status Enforcement**: Inactive admin accounts (`status !== AdminStatus.ACTIVE`) are immediately rejected with a 403 `ForbiddenError` ("Account is not active"). Expired sessions (`expiresAt <= now`) or missing records are rejected with a 401 `UnauthorizedError`.
- **Request Context**: Upon validation, the authenticated admin identity (`AdminUser`) is attached to `request.adminUser`.

### 1.2 Existing Admin RBAC Enforcement (`src/middleware/admin-rbac.ts` & `src/services/admin/admin_rbac_service.ts`)
- **SuperAdmin Bypass**: If `request.adminUser.isSuperAdmin === true`, authorization passes unconditionally.
- **Permission Checking**: For standard administrators, `requirePermission(permissionSlug)` queries `AdminRbacService.hasPermission(adminUser.id, permissionSlug)`.
- **Automated Audit on Denial**: If permission is denied, the middleware automatically logs an `AdminAuditLog` record with action `ADMIN_AUTHZ_DENIED`, capturing the attempted path, method, and required permission, and immediately throws a 403 `ForbiddenError`.

### 1.3 Existing Operations API Architecture & Pagination Standards
- All administrative operations follow a uniform modular directory structure under `src/routes/admin/operations/`.
- Standardized query schema (`paginationQuerySchema`) provides `page` (default 1) and `pageSize` (default 20, max 100).
- Standardized response builder `createPaginatedResponse()` wraps items into a uniform `{ items, pagination: { page, pageSize, total, totalPages } }` envelope.
- Rate limiting is uniformly applied to administrative operations via `adminOperationsRateLimitConfig` (120 requests/minute per identity/IP).

### 1.4 Camera Database Foundation & Relationships
- The Prisma schema already contains complete models for Camera operations:
  - `CameraInstance`: Primary record containing `userId`, `deviceId`, `cameraName`, `status`, `lastSeenAt`, `metadata`.
  - `CameraEndpoint`: Connection topology and endpoints (`WEBRTC`, `HLS`, `RTSP`). Contains sensitive credentials: `connectionToken`, `tokenHash`, and internal `signalingUrl`.
  - `CameraStreamSession`: Real-time and historical viewer sessions. Contains sensitive `sessionTokenHash`.
  - `CameraSubscription`: Camera tier (`FREE`, `BASIC`, `PRO_CLOUD`), recording features, and billing status.
  - `CameraAccessAuditEvent`: Security and access audit event trail.
  - `CameraUsageRecord`: Streaming duration and commercial usage records.
- **Zero Schema Mutation Invariant**: All Phase 20.6.3 requirements are satisfied using the existing tables, relationships, and enums.

---

## 2. Existing Admin Authentication & RBAC Architecture Reused

The implementation leverages existing, production-hardened admin infrastructure without duplicating authorization mechanisms or creating divergent security gates:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Incoming Request                               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │         adminAuthenticate         │
                     │  (Cookie / Bearer Token Check)    │
                     └─────────────────┬─────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     │ Admin Active & Session Valid?     │
                     └─┬───────────────────────────────┬─┘
                    NO │                           YES │
                       ▼                               ▼
                 [401 / 403]              ┌───────────────────────────┐
                                          │     requirePermission     │
                                          │ (cameras.view / sessions) │
                                          └─────────────┬─────────────┘
                                                        │
                                          ┌─────────────┴─────────────┐
                                          │ SuperAdmin OR Permitted?  │
                                          └─┬───────────────────────┬─┘
                                         NO │                   YES │
                                            ▼                       ▼
                                ┌──────────────────────┐  ┌───────────────────┐
                                │ Log AUTHZ_DENIED     │  │ AdminCameraService│
                                │ Throw ForbiddenError │  │ Safe Read Handler │
                                └──────────────────────┘  └───────────────────┘
```

1. **Authentication Middleware**: `adminAuthenticate` from `src/middleware/admin-auth.ts`.
2. **Authorization Middleware**: `requirePermission` from `src/middleware/admin-rbac.ts`.
3. **Rate Limiting**: `adminOperationsRateLimitConfig` from `src/middleware/rate-limit.ts`.
4. **Metrics Tracking**: `metricsCollector.recordAdminOperation('cameras', 200)` instrumented across all endpoints.
5. **Data Sanitization**: `AdminAuditSanitizer.sanitizeMetadata()` from `src/services/admin/admin_audit_sanitizer.ts`.

---

## 3. New Permissions and Role Assignments

Four narrowly scoped, principle-of-least-privilege permissions were added to the system permission catalog in `src/services/admin/admin_rbac_seed.ts`:

### 3.1 Permission Definitions
| Permission Slug | Name | Resource | Action | Description |
| :--- | :--- | :--- | :--- | :--- |
| `cameras.view` | View Cameras | `cameras` | `view` | View registered camera instances, connection states, and safe operational topology |
| `cameras.sessions.view` | View Camera Sessions | `cameras` | `view_sessions` | Inspect real-time viewer WebRTC stream sessions and session lifecycles |
| `cameras.audit.view` | View Camera Audit | `cameras` | `view_audit` | Inspect camera access and security audit event trails |
| `cameras.usage.view` | View Camera Usage | `cameras` | `view_usage` | Inspect camera streaming seconds and aggregate usage records |

### 3.2 Role Assignment Matrix
Permissions were mapped to existing system roles based on strict functional isolation:

| Role | `cameras.view` | `cameras.sessions.view` | `cameras.audit.view` | `cameras.usage.view` | Architectural Justification |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`SUPER_ADMIN`** | **YES** | **YES** | **YES** | **YES** | Unrestricted system-wide control plane visibility. |
| **`ADMIN`** | **YES** | **YES** | **YES** | **YES** | Full operational administration across technical, security, and billing domains. |
| **`SUPPORT`** | **YES** | **NO** | **NO** | **YES** | Customer-facing support triage. Needs camera presence and usage to resolve customer tickets. Strictly forbidden from viewing real-time viewer sessions or security audit trails to protect customer privacy. |
| **`OPERATIONS`** | **YES** | **YES** | **YES** | **NO** | Edge infrastructure, signaling, and reliability engineering. Needs session metrics and audit logs to diagnose connectivity failures. Forbidden from commercial usage records. |

---

## 4. Exact Routes and HTTP Methods Implemented

All 6 endpoints are mounted under the standard admin API prefix `/api/v1/admin/cameras`:

| HTTP Method | Route | Required Permission | Service Method | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/admin/cameras/metrics` | `cameras.view` | `getCameraSummaryMetrics()` | Aggregated camera status counts from database, process-local signaling stats, and reconciliation worker health |
| `GET` | `/api/v1/admin/cameras` | `cameras.view` | `listCameras()` | Paginated listing of camera instances with filtering, searching, and deterministic sorting |
| `GET` | `/api/v1/admin/cameras/:cameraId` | `cameras.view` | `getCameraDetail()` | Detailed camera record including owner user, edge device, safe endpoints, subscription, and session counts |
| `GET` | `/api/v1/admin/cameras/:cameraId/sessions` | `cameras.sessions.view` | `listCameraStreamSessions()` | Paginated list of active and historical WebRTC viewer stream sessions |
| `GET` | `/api/v1/admin/cameras/:cameraId/audit-events` | `cameras.audit.view` | `listCameraAuditEvents()` | Paginated camera access and security audit events with sanitized metadata |
| `GET` | `/api/v1/admin/cameras/:cameraId/usage` | `cameras.usage.view` | `getCameraUsage()` | Paginated usage records and category summary aggregates |

> [!NOTE]
> Route registration order in `src/routes/admin/cameras.ts` explicitly registers `/metrics` before `/:cameraId` to prevent Fastify route parameter shadowing.
> Every route is strictly read-only (`GET`). Zero mutation endpoints exist.

---

## 5. Request Validation, Pagination, Filtering, and Sorting Rules

All route schemas are defined in `src/routes/admin/operations/cameras/schemas.ts` using Zod:

### 5.1 Route Parameter Validation
- `cameraId`: Validated via `resourceIdSchema` (`z.string().min(1).max(128)`). Rejects empty or oversized parameters.

### 5.2 Pagination Standards
- Default `page`: 1
- Default `pageSize`: 20
- Maximum `pageSize`: 100 (enforced via `.max(100)` in Zod schema)
- Response format: Uses standard `createPaginatedResponse()` yielding:
  ```json
  {
    "success": true,
    "items": [...],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 45,
      "totalPages": 3
    }
  }
  ```

### 5.3 Filtering and Sorting Matrix
| Endpoint | Supported Filters | Allowed Sort Fields | Sort Ordering |
| :--- | :--- | :--- | :--- |
| `GET /cameras` | `status` (CameraStatus enum)<br>`userId` (resource ID)<br>`deviceId` (resource ID)<br>`search` (name, serial number, model) | `createdAt`, `updatedAt`, `cameraName`, `status`, `lastSeenAt` | `asc` / `desc` (default: `createdAt desc`). Secondary deterministic sort: `id: 'desc'`. |
| `GET /:cameraId/sessions` | `status` (CameraStreamSessionStatus enum)<br>`viewerUserId` (resource ID) | `createdAt`, `startedAt`, `endedAt`, `expiresAt`, `status`, `durationSeconds` | `asc` / `desc` (default: `createdAt desc`). Secondary deterministic sort: `id: 'desc'`. |
| `GET /:cameraId/audit-events` | `eventType` (string)<br>`action` (string)<br>`result` (CameraAuditResult enum)<br>`actorType` (CameraAuditActorType enum) | `createdAt` | `asc` / `desc` (default: `createdAt desc`). Secondary deterministic sort: `id: 'desc'`. |
| `GET /:cameraId/usage` | `category` (string, e.g. `STREAMING_SECONDS`) | `periodStart`, `periodEnd`, `createdAt`, `quantity` | `asc` / `desc` (default: `periodStart desc`). Secondary deterministic sort: `id: 'desc'`. |

---

## 6. Safe DTO Fields for Every Endpoint

Every endpoint projects explicit, safe DTOs to ensure that sensitive internal structures and tokens are never leaked to admin clients:

### 6.1 `GET /metrics` DTO
```json
{
  "success": true,
  "data": {
    "byStatus": {
      "OFFLINE": 12,
      "CONNECTING": 1,
      "ONLINE": 24,
      "STREAMING": 6,
      "RECONNECTING": 0,
      "ERROR": 2
    },
    "totalCameras": 45,
    "signaling": {
      "scope": "LOCAL_PROCESS",
      "activeCameras": 24,
      "activeViewers": 6,
      "activeSessions": 6,
      "uptimeSeconds": 86400
    },
    "worker": {
      "status": "RUNNING",
      "totalCycles": 1440,
      "failedCycles": 0,
      "lastRunAt": "2026-11-13T10:00:00.000Z"
    },
    "timestamp": "2026-11-13T10:00:05.000Z"
  }
}
```

### 6.2 `GET /cameras` (List) DTO Item
```json
{
  "id": "cam_abc123",
  "userId": "usr_xyz789",
  "deviceId": "dev_456",
  "cameraName": "Front Porch",
  "serialNumber": "SN-12345678",
  "model": "PixelCam Pro",
  "firmwareVersion": "v2.4.1",
  "status": "ONLINE",
  "lastSeenAt": "2026-11-13T09:59:50.000Z",
  "createdAt": "2026-11-01T12:00:00.000Z",
  "updatedAt": "2026-11-13T09:59:50.000Z",
  "user": { "id": "usr_xyz789", "email": "customer@example.com", "name": "Jane Doe" },
  "device": { "id": "dev_456", "deviceName": "Pixel 8 Edge", "deviceModel": "Pixel 8", "status": "ONLINE" },
  "subscriptionTier": "PRO_CLOUD",
  "activeSessionsCount": 1
}
```

### 6.3 `GET /cameras/:cameraId` (Detail) DTO
```json
{
  "success": true,
  "data": {
    "id": "cam_abc123",
    "userId": "usr_xyz789",
    "deviceId": "dev_456",
    "cameraName": "Front Porch",
    "serialNumber": "SN-12345678",
    "model": "PixelCam Pro",
    "firmwareVersion": "v2.4.1",
    "status": "ONLINE",
    "lastSeenAt": "2026-11-13T09:59:50.000Z",
    "createdAt": "2026-11-01T12:00:00.000Z",
    "updatedAt": "2026-11-13T09:59:50.000Z",
    "metadata": { "resolution": "1080p", "fps": 30 },
    "user": { "id": "usr_xyz789", "email": "customer@example.com", "name": "Jane Doe" },
    "device": { "id": "dev_456", "deviceName": "Pixel 8 Edge", "deviceModel": "Pixel 8", "status": "ONLINE", "lastSeenAt": "2026-11-13T09:59:50.000Z" },
    "endpoints": [
      {
        "id": "end_001",
        "endpointType": "WEBRTC",
        "isActive": true,
        "createdAt": "2026-11-01T12:00:00.000Z",
        "updatedAt": "2026-11-01T12:00:00.000Z"
      }
    ],
    "subscription": {
      "tier": "PRO_CLOUD",
      "status": "ACTIVE",
      "maxResolution": "1080p",
      "maxFps": 30,
      "cloudRecordingEnabled": true,
      "aiDetectionEnabled": false
    },
    "sessionCounts": {
      "active": 1,
      "total": 42
    }
  }
}
```

### 6.4 `GET /cameras/:cameraId/sessions` DTO Item
```json
{
  "id": "sess_001",
  "cameraId": "cam_abc123",
  "viewerUserId": "usr_viewer456",
  "status": "ACTIVE",
  "startedAt": "2026-11-13T09:45:00.000Z",
  "endedAt": null,
  "expiresAt": "2026-11-13T10:45:00.000Z",
  "durationSeconds": 905,
  "bytesTransferred": 47185920,
  "createdAt": "2026-11-13T09:45:00.000Z",
  "viewerUser": { "id": "usr_viewer456", "email": "viewer@example.com", "name": "Family Member" }
}
```

### 6.5 `GET /cameras/:cameraId/audit-events` DTO Item
```json
{
  "id": "aud_001",
  "cameraId": "cam_abc123",
  "userId": "usr_viewer456",
  "actorType": "USER",
  "eventType": "VIEWER_SESSION_STARTED",
  "action": "STREAM_VIEW",
  "result": "SUCCESS",
  "failureReason": null,
  "metadata": { "clientIp": "192.168.1.50" },
  "createdAt": "2026-11-13T09:45:00.000Z",
  "user": { "id": "usr_viewer456", "email": "viewer@example.com", "name": "Family Member" }
}
```

### 6.6 `GET /cameras/:cameraId/usage` DTO
```json
{
  "success": true,
  "items": [
    {
      "id": "usg_001",
      "cameraId": "cam_abc123",
      "userId": "usr_xyz789",
      "category": "STREAMING_SECONDS",
      "quantity": 3600,
      "unit": "seconds",
      "periodStart": "2026-11-12T00:00:00.000Z",
      "periodEnd": "2026-11-13T00:00:00.000Z",
      "createdAt": "2026-11-13T00:05:00.000Z"
    }
  ],
  "summary": {
    "STREAMING_SECONDS": 3600
  },
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

---

## 7. Sensitive Fields Explicitly Excluded

A strict data exclusion policy is enforced at the database projection and serialization boundary:

| Model | Excluded Sensitive Fields | Scrubbing Mechanism | Risk Mitigated |
| :--- | :--- | :--- | :--- |
| **`CameraEndpoint`** | `connectionToken`, `tokenHash`, `signalingUrl` | Explicit `select` projection: only `id`, `endpointType`, `isActive`, `createdAt`, `updatedAt` are queried and returned. | Prevents exposure of edge pairing credentials and internal WebSocket cluster topology. |
| **`CameraStreamSession`** | `sessionTokenHash` | Explicit `select` projection excluding the session hash. | Prevents offline brute-force attacks against viewer session tokens. |
| **`WebRTC Media`** | SDP offer/answer, ICE candidates, ICE passwords | Not stored in database; scrubbed if found in any metadata. | Prevents eavesdropping and interception of WebRTC peer connections. |
| **`CameraInstance` (Metadata)** | Embedded tokens (`cvt_`, `dst_`, `pct_`, `zdc_`, `sess_`), secret keys | Passed through `AdminAuditSanitizer.sanitizeMetadata()`. | Strips arbitrary client-injected sensitive tokens and credentials from freeform JSON metadata. |
| **`CameraAccessAuditEvent` (Metadata)** | Viewing tokens, bearer auth tokens, CSRF tokens | Passed through `AdminAuditSanitizer.sanitizeMetadata()`. | Sanitizes historical audit payloads. |
| **`User` (Relations)** | `passwordHash`, `twoFactorSecret`, `recoveryCodes` | Explicit `select` projection: `{ id: true, email: true, name: true }`. | Ensures zero credential leakage from user relations. |
| **`Device` (Relations)** | Internal tokens, installation claims | Explicit `select` projection: `{ id: true, deviceName: true, deviceModel: true, status: true, lastSeenAt: true }`. | Hides edge hardware identifiers and installation secrets. |
| **Prisma `BigInt`** | Raw `BigInt` representations | Explicit conversion `Number(val ?? 0)`. | Eliminates `TypeError: Do not know how to serialize a BigInt` runtime exceptions during JSON response formatting. |

---

## 8. Read-Audit Behavior and Existing Limitations

### 8.1 Read Operation Audit Policy
- Standard read operations (`GET /metrics`, `GET /cameras`, `GET /:cameraId`, etc.) **do not write audit logs to `AdminAuditLog` on every successful read**.
- **Rationale**: Administrative list and polling operations are high-frequency. Logging an audit record for every read query would cause severe write amplification, database I/O contention, and log bloat, degrading backend performance.

### 8.2 Security Rejection Auditing
- Authorization denials are strictly audited: when an administrator attempts to access an endpoint for which they lack the required permission, `requirePermission` automatically creates an `AdminAuditLog` entry:
  - `action`: `AdminAuditAction.ADMIN_AUTHZ_DENIED`
  - `resource`: target URL path
  - `adminId`: identity of the offending administrator
  - `details`: `{ requiredPermission: string, method: string, url: string, ip: string }`

### 8.3 Limitations & Future Alignment
- The `AdminAuditAction` enum is a fixed MySQL enum in the database schema. Because Phase 20.6.3 strictly enforced the zero-migration policy, no new audit actions were added to the enum.
- In Phase 20.6.4 (Admin Action Controls & Diagnostic Workflows), write actions (such as disconnecting cameras or revoking stream sessions) will utilize dedicated audit action entries or structured JSON details within allowable schema parameters.

---

## 9. Error Handling and Rate-Limit Behavior

### 9.1 Uniform Error Responses
All errors are processed by the central Fastify error handler and emit consistent error responses:
- **400 Bad Request (`ValidationError`)**: Emitted when query parameters or route IDs violate Zod schemas (e.g. invalid status enum or page size > 100).
- **401 Unauthorized (`UnauthorizedError`)**: Emitted when admin authentication credentials (cookie/token) are missing, invalid, or expired.
- **403 Forbidden (`ForbiddenError`)**: Emitted when an admin account is not active, or lacks the required RBAC permission.
- **404 Not Found (`NotFoundError`)**: Emitted when `cameraId` does not exist in `CameraInstance`.
- **500 Internal Server Error (`AppError`)**: Emitted on unhandled system exceptions; logged via Pino with sensitive data scrubbed.

### 9.2 Rate Limiting
- Mounted with `adminOperationsRateLimitConfig`:
  - Maximum 120 requests per minute per IP/identity.
  - Automatically emits standard rate-limiting headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.
  - Exceeding the rate limit returns HTTP 429 Too Many Requests.

---

## 10. Tests Created and Scenarios Covered

A comprehensive test suite was written in `main website/Backend/tests/camera_admin_rbac_and_apis.test.ts`.

### Test Suites and Covered Scenarios:
1. **Domain 1: Admin Authentication & Session Guards**
   - Rejects unauthenticated requests with 401 across all 6 camera administration endpoints.
   - Rejects invalid or forged session tokens with 401.
   - Rejects expired admin sessions with 401.
   - Rejects suspended or inactive admin accounts with 403.
2. **Domain 2: RBAC Permission Enforcement & Least-Privilege Role Matrix**
   - Verifies system RBAC seed registers all 4 camera admin permissions.
   - `SUPER_ADMIN` has full access to all 6 endpoints.
   - `ADMIN` role has full read access to all 6 endpoints.
   - `SUPPORT` role can access cameras and usage, but is strictly FORBIDDEN (403) from stream sessions and audit trails.
   - `OPERATIONS` role can access cameras, sessions, and audit trails, but is strictly FORBIDDEN (403) from commercial usage records.
   - Admin with no assigned roles is rejected with 403 across all endpoints.
   - RBAC rejection persists an `ADMIN_AUTHZ_DENIED` audit log entry with target permission.
3. **Domain 3: Endpoint Contract, Validation, Pagination & Filtering**
   - `GET /metrics` returns status counts, process signaling stats, and worker telemetry.
   - `GET /cameras` paginates, bounds page size, searches by camera name, and filters by status.
   - `GET /cameras` rejects invalid filter values (e.g., non-existent enum) with 400.
   - `GET /:cameraId` returns full detail DTO and returns 404 for non-existent camera IDs.
   - `GET /:cameraId/sessions` paginates sessions and returns 404 for missing camera.
   - `GET /:cameraId/audit-events` paginates access audit records and returns 404 for missing camera.
   - `GET /:cameraId/usage` paginates usage records and returns aggregated category summaries.
4. **Domain 4: Data Sanitization & Secret Exclusion**
   - Camera detail endpoints never expose connection tokens, hashes, or signaling URLs.
   - Stream sessions endpoint never exposes `sessionTokenHash`, SDP, or ICE candidates.
   - Camera metadata and audit event metadata are scrubbed of token prefixes (`cvt_`, `dst_`, `pct_`, `zdc_`, `sess_`) and sensitive keys.
   - BigInt database fields are converted to numbers without serialization errors.
5. **Domain 5: Read-Only Invariance & Audit Safety**
   - Verifies that camera administration contains zero state-mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE` return 404).
   - Verifies that executing read queries produces zero database mutations in camera records (`updatedAt` and `status` invariant).

---

## 11. Explicit Confirmation that Tests Were Not Executed

In strict compliance with the Phase 20.6.3 engineering policy:
- **ZERO TESTS WERE EXECUTED.**
- No test runners (`node --test`, `npm test`, `jest`, `vitest`) were invoked.
- No test compilation commands were run.
- The test suite is marked with:
  ```typescript
  // Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
  // Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
  ```

---

## 12. Explicit Confirmation of Zero Builds, Type-Checkers, Database Mutations, Schema Changes, Migrations, Deployments, and Service Restarts

I hereby certify and confirm that during Phase 20.6.3:
1. **Zero Database Migrations or Schema Changes**: No Prisma schema changes were made. No migration files were generated or applied. The database was not modified.
2. **Zero Database Mutations**: No test records or dummy migrations were committed or applied to development, staging, or production databases.
3. **Zero Build or Type-Check Commands**: Neither `tsc`, `npm run build`, nor any build scripts were executed.
4. **Zero Deployments or Service Restarts**: No servers were restarted, reloaded, or deployed.

---

## 13. Known Limitations and Phase 20.6.4 Dependencies

1. **Read-Only Scope**:
   - Phase 20.6.3 intentionally delivers read-only visibility APIs. Administrative intervention controls (such as remotely disconnecting an active streaming session, disabling camera endpoints, triggering forced lifecycle reconciliation, or rotating pairing credentials) are deferred to Phase 20.6.4.
2. **Signaling Telemetry Clustering Boundary**:
   - The signaling statistics returned in `GET /metrics` (`signaling` property) reflect process-local WebSocket connection metrics (`LOCAL_PROCESS`). In a horizontally scaled cluster, distributed aggregation across multiple gateway instances will require Redis/pub-sub synchronization, planned for Phase 20.7.
3. **Administrative Action Audit Enum Alignment**:
   - In Phase 20.6.4, when state-mutating camera actions are introduced, administrative audit events will be logged using the designated admin audit logging pipeline with sanitized detail payloads.
