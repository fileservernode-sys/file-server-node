# ZdexCloud — Phase 20.6.1 Audit Report
## Camera Observability & Admin Architecture Audit

- **Roadmap:** Phase 20 — Camera Backend & Infrastructure
- **Batch:** 20.6.1 — Observability & Admin Architecture Audit
- **Execution Mode:** AUDIT ONLY — NO IMPLEMENTATION
- **Scope:** Read-only inspection of existing Admin, RBAC, Observability, Logging, Worker, Storage Admin, and Camera (Phases 20.1–20.5.1.1) backend source code and Prisma schema.

---

## 1. Files Inspected

All findings in this audit were verified directly against the following repository files:

### Core App, Routing & Rate Limiting
- `main website/Backend/src/app.ts`
- `main website/Backend/src/routes/index.ts`
- `main website/Backend/src/routes/health.ts`
- `main website/Backend/src/routes/ready.ts`
- `main website/Backend/src/middleware/rate_limit_presets.ts`

### Admin Authentication, RBAC & Audit
- `main website/Backend/src/middleware/admin-auth.ts`
- `main website/Backend/src/middleware/admin-rbac.ts`
- `main website/Backend/src/services/admin/admin_rbac_seed.ts`
- `main website/Backend/src/services/admin/admin_rbac_service.ts`
- `main website/Backend/src/services/admin/admin_audit_service.ts`
- `main website/Backend/src/services/admin/admin_audit_sanitizer.ts`

### Admin APIs & Operations Framework
- `main website/Backend/src/routes/admin/audit.ts`
- `main website/Backend/src/routes/admin/errors.ts`
- `main website/Backend/src/routes/admin/system.ts`
- `main website/Backend/src/routes/admin/devices.ts`
- `main website/Backend/src/routes/admin/servers.ts`
- `main website/Backend/src/services/admin/system_overview_service.ts`
- `main website/Backend/src/routes/admin/operations/index.ts`
- `main website/Backend/src/routes/admin/operations/middleware/require_operation_permission.ts`
- `main website/Backend/src/routes/admin/operations/middleware/object_authorization.ts`
- `main website/Backend/src/routes/admin/operations/schemas/common.ts`
- `main website/Backend/src/routes/admin/operations/utils/pagination.ts`
- `main website/Backend/src/routes/admin/operations/utils/operation_executor.ts`
- `main website/Backend/src/routes/admin/operations/devices/index.ts`
- `main website/Backend/src/routes/admin/operations/devices/service.ts`
- `main website/Backend/src/routes/admin/operations/gateway/index.ts`
- `main website/Backend/src/routes/admin/operations/gateway/service.ts`
- `main website/Backend/src/routes/admin/operations/system/jobs/index.ts`
- `main website/Backend/src/routes/admin/operations/system/jobs/service.ts`
- `main website/Backend/src/routes/admin/operations/system/logs/schemas.ts`
- `main website/Backend/src/routes/admin/operations/system/logs/service.ts`
- `main website/Backend/src/routes/youm_panel.ts`
- `main website/Frontend/pages/youm-panel.html`

### Observability, Workers, Camera Domain & Schema
- `main website/Backend/src/observability/metrics.ts`
- `main website/Backend/src/observability/logger.ts`
- `main website/Backend/src/observability/connection_observability.ts`
- `main website/Backend/src/observability/security_audit_service.ts`
- `main website/Backend/src/observability/error_ingestion.ts`
- `main website/Backend/src/observability/error_retention_worker.ts`
- `main website/Backend/src/observability/state_reconciliation.ts`
- `main website/Backend/src/routes/camera.ts`
- `main website/Backend/src/services/camera_service.ts`
- `main website/Backend/src/services/camera_device_identity_service.ts`
- `main website/Backend/src/services/camera_lifecycle_service.ts`
- `main website/Backend/src/services/camera_reconciliation_worker.ts`
- `main website/Backend/src/services/camera_signaling_service.ts`
- `main website/Backend/prisma/schema.prisma`

---

## 2. Existing Capabilities Verified in Source

### 2.1 Admin Authentication & Session Security
- **Dedicated Admin Auth (`src/middleware/admin-auth.ts`)**: `adminAuthenticate` validates `AdminSession` (SHA-256 hashed tokens) independently of customer `UserSession` via `AdminAuthService.validateSession()`. It accepts either Bearer / `x-admin-session-token` headers or HttpOnly cookies (`__Host-zdex_admin_session` / `ADMIN_SESSION_COOKIE_NAME`), fails closed on conflicting header vs. cookie tokens, enforces `AdminStatus.ACTIVE`, attaches identity strictly to `request.admin` (never `request.user`), and enforces anti-CSRF headers (`x-zdex-csrf-token` / `x-admin-csrf-token`) on cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` requests.
- **Brute-force & 2FA**: Schema models `AdminUser`, `AdminSession`, `AdminEmailOtp` (`ADMIN_LOGIN_2FA`), and `AdminLockout` are backed by `adminAuthRateLimitConfig` (`5 req/min` per IP + email hash).
- **Separate Legacy Panel**: `src/routes/youm_panel.ts` and `Frontend/pages/youm-panel.html` implement a single-account (`fileservernode@gmail.com`) OTP panel (`/api/v1/youm-panel/*`) outside `AdminRbacService` and `AdminAuditService`. It does **not** participate in enterprise RBAC or tamper-evident admin audit chaining.

### 2.2 Admin RBAC Permission Model & Enforcement
- **Permissions (`src/services/admin/admin_rbac_seed.ts`)**: 41 canonical `resource.action` permissions are seeded across `users`, `devices`, `servers`, `billing`, `support`, `notifications`, `emails`, `gateway`, `errors`, `audit`, `admin_roles`, `system`, `sql`, and `database`.
- **Roles**: `SUPER_ADMIN` (all permissions + `isSuperAdmin` wildcard `*` in `AdminRbacService.resolveAdminPermissions`), `ADMIN`, `SUPPORT`, and `OPERATIONS`.
- **Enforcement (`src/middleware/admin-rbac.ts` & `operations/middleware/require_operation_permission.ts`)**: `requirePermission`, `requireAnyPermission`, `requireAllPermissions`, and `requireOperationPermission` check `request.admin` + `AdminStatus.ACTIVE` + `AdminRbacService.hasPermission()`. Denied attempts automatically write `AdminAuditAction.ADMIN_AUTHZ_DENIED` (`status: 'DENIED'`) into `AdminAuditLog` before throwing `ForbiddenError`.
- **Object Authorization Extension Point (`operations/middleware/object_authorization.ts`)**: `assertAdminCanOperateOnResource()` currently validates non-empty `resourceId` and active admin status, acting as an extension stub for per-resource checks.

### 2.3 Admin API, Pagination, Mutation & Rate-Limit Conventions
- **Versioning & Prefixes (`src/routes/index.ts`)**: All routes mount under `/api/v1`. Admin endpoints exist in two aligned groups:
  - Direct Admin routes: `/api/v1/admin/{auth,rbac,audit-logs,errors,emails,sql,database,system,users,devices,servers,notifications}`
  - Standardized Operations API (`src/routes/admin/operations/index.ts`): `/api/v1/admin/operations/{health,users,devices,servers,gateway,billing,support,notifications,system/logs,system/jobs,system/config,system/security}`
- **Response Envelope**: `createSuccessResponse(data)` and `createErrorResponse(code, message, requestId)` (`src/schemas/response.ts`), paired with `x-request-id` correlation via `RequestContextStore`.
- **Pagination & Filtering (`operations/schemas/common.ts` & `utils/pagination.ts`)**: `paginationQuerySchema` bounds `page >= 1`, `pageSize` 1–100 (default 25), `search` <= 128 chars, regex-validated `sortBy`, `sortOrder` (`asc`/`desc`), ISO/`YYYY-MM-DD` `startDate`/`endDate`; returns `{ items, pagination: { page, pageSize, total, totalPages }, ... }`.
- **Transactional Mutation + Fail-Closed Audit (`operations/utils/operation_executor.ts`)**: `executeAdminOperation()` executes mutations inside a `ReadCommitted` Prisma transaction and **fails closed** (`500 AUDIT_FAILURE`) if `AdminAuditService.logEvent()` fails. `AdminAuditService` uses an in-process mutex + MySQL `GET_LOCK('zdex_admin_audit_chain_lock', 15)` + `FOR UPDATE` row locking to maintain a SHA-256 hash-chained `AdminAuditLog` (`previousHash`, `integrityHash`, `sequence`).
- **Rate Limits (`src/middleware/rate_limit_presets.ts`)**:
  - `adminOperationsRateLimitConfig`: `120 req/min` per `adminId + IP`
  - `adminHeavyQueryRateLimitConfig`: `30 req/min` per `adminId + IP` (audit queries/exports)
  - Destructive/control mutations (e.g., `devices/:deviceId/disconnect`, `gateway/nodes/:gatewayNodeId/drain`, `servers/:serverId/start`): `20 req/min` per `adminId + IP`.

### 2.4 Existing Observability, Logging, Health & Workers
- **Health & Readiness (`src/routes/health.ts`, `src/routes/ready.ts`)**: Public liveness/readiness probes (`/health`, `/health/live`, `/health/ready`, `/health/db`, `/ready`, `/health/smtp`, `/health/email`) under `highCapacityHealthRateLimitConfig` (`600 req/min`).
- **System Overview (`src/services/admin/system_overview_service.ts`)**: `GET /api/v1/admin/system/overview` (`system.read`) aggregates process memory/uptime, MySQL latency/version, Storage `GatewayNode` + `DeviceConnection` + `defaultGatewayService` health, and Storage `Device` + `ServerInstance` counts.
- **In-Memory Metrics (`src/observability/metrics.ts`)**: `MetricsCollector` singleton tracks HTTP request counts by method and `2xx`/`3xx`/`4xx`/`5xx`, cumulative HTTP latency average, admin/customer auth counts, `adminOperations.byDomain` (`users`, `devices`, `servers`, `gateway`), DB failure counts, Storage gateway counters, and Storage `Device`/`ServerInstance` lifecycle counters.
- **Structured Logging (`src/observability/logger.ts` & `src/app.ts`)**: Fastify Pino uses `logger.redact` on selected auth/cookie/password/OTP fields; `StructuredLogger` (`appLogger`, `gatewayLogger`, `auditLogger`) sanitizes control characters/newlines (`sanitizeLogString`), redacts matching `SENSITIVE_KEY_PATTERNS`, caps depth at 5 and strings at 1024 chars, and attaches `requestId`.
- **Error Center (`src/services/error_ingestion_service.ts` & `src/routes/admin/errors.ts`)**: Deduplicates errors into `ErrorFingerprint`, `ErrorIncident` (`OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `MUTED`), and `ErrorOccurrence` with `ErrorRetentionWorker` pruning (30d occurrences, 90d resolved/muted incidents).
- **Camera Domain Instrumentation Already Present**:
  - Persistent models in `prisma/schema.prisma`: `CameraInstance` (status `OFFLINE | CONNECTING | ONLINE | STREAMING | RECONNECTING | ERROR`, `lastSeenAt`, `startedAt`, `stoppedAt`, `deviceId`, `userId`, `metadata`), `CameraEndpoint` (`status`, `lastHeartbeatAt`, `connectedAt`, `disconnectedAt`, `ipAddress`), `CameraStreamSession` (`status`, `transportType`, `startedAt`, `endedAt`, `expiresAt`, `bytesTransferred`, `durationSeconds`, `terminationReason`, `sessionTokenHash`), `CameraAccessAuditEvent` (12 `CameraAuditEventType` values), `CameraUsageRecord` (4 `CameraUsageCategory` values), and `CameraSubscription`.
  - Worker telemetry **already wired into Admin**: `defaultCameraReconciliationWorker.getMetrics()` (`src/services/camera_reconciliation_worker.ts`) tracks `enabled`, `isStarted`, `isExecuting`, `intervalMs`, `batchSize`, `startedAt`, `lastRunAt`, `lastDurationMs`, `lastSuccess`, `totalRuns`, `totalFailures`, `totalSkippedOverlap`, `totalExpiredSessionsTimedOut`, `totalStreamingReconciledToOnline`, `totalTransitionedToReconnecting`, `totalTransitionedToOffline`, `totalSkippedConcurrentOrFresh`, `lastErrorAt`, `lastErrorMessage`, and `lastResult`. It is **already exposed** inside `GET /api/v1/admin/operations/system/jobs/workers` via `AdminBackgroundJobsService.listWorkers()`.
  - Signaling runtime snapshot **already present on `CameraSignalingService`** (`getMetrics()` in `src/services/camera_signaling_service.ts`): returns process-local `listening`, `path`, `connectedCameras`, `activeViewerSockets`, `pendingUnauthenticatedSockets`, `trackedNegotiatingSessions`, `rejectedAuthAttempts`, `rejectedMessages`, and `evictedConnections`.

### 2.5 Storage Administration & Monitoring (Must Remain Unchanged)
The following existing Storage admin surfaces are verified and **must not be altered or broken**:
- `GET/POST` routes in `src/routes/admin/devices.ts` & `src/routes/admin/operations/devices/*` (`devices.read`, `devices.disconnect`) operating on `Device`, `ServerInstance`, `DeviceConnection`, and `defaultGatewayService`.
- `src/routes/admin/servers.ts` & `src/routes/admin/operations/servers/*` (`servers.read`, `servers.power`).
- `src/routes/admin/operations/gateway/*` (`gateway.read`, `gateway.write`, `gateway.drain`) & `StateReconciliationService` (`src/observability/state_reconciliation.ts`).
- `src/routes/admin/operations/system/logs/*`, `src/routes/admin/errors.ts`, `src/routes/admin/audit.ts`, and `src/services/admin/system_overview_service.ts` Storage sections.

---

## 3. Missing Capabilities & Gaps

### 3.1 Admin APIs, RBAC & Audit Integration Gaps
1. **Zero Camera Admin Endpoints**: No routes exist under `/api/v1/admin` or `/api/v1/admin/operations` for listing cameras, inspecting camera/device/session state, querying `CameraAccessAuditEvent` or `CameraUsageRecord`, viewing `CameraSignalingService.getMetrics()`, or performing safe admin disable/session-revoke operations.
2. **No Camera RBAC Permissions or Admin Audit Actions**:
   - `SYSTEM_PERMISSIONS` (`admin_rbac_seed.ts`) has no `cameras.*` permissions.
   - `AdminAuditAction` (`schema.prisma:1899`) has no Camera admin actions (e.g., camera viewed/disabled/revoked), forcing misuse of generic `ADMIN_STATUS_UPDATED` if omitted.
3. **`CameraAccessAuditEvent` Unqueried by Admin Logs**: `AdminSystemLogsService.listEvents()` queries only `AuditEvent` (`CUSTOMER_AUDIT`) and `AdminAuditLog` (`ADMIN_AUDIT`). Camera security events written to `CameraAccessAuditEvent` are invisible to Admin Logs & System Metrics.
4. **Object Authorization Stub**: `assertAdminCanOperateOnResource()` does not validate resource state or scoped access rules for cameras/sessions.

### 3.2 Camera Health, Signaling & Performance Observability Matrix

| Area | Metric / Signal | Current Status | Gap & Required Action |
| --- | --- | --- | --- |
| **Camera Health** | Total registered cameras & counts by status (`ONLINE`, `OFFLINE`, `CONNECTING`, `STREAMING`, `RECONNECTING`, `ERROR`) | Data exists in `CameraInstance` table (`@@index([status])`) | No admin aggregation query or endpoint exposes fleet counts; `SystemOverviewService` only counts Storage `Device`/`ServerInstance`. |
| **Camera Health** | Last heartbeat & `lastSeenAt` | Data exists (`CameraInstance.lastSeenAt`, `CameraEndpoint.lastHeartbeatAt`, `CameraSignalingService` in-memory `lastHeartbeatAt`) | No admin detail endpoint merges persisted timestamps with live signaling socket heartbeat state. |
| **Camera Health** | Stale-camera reconciliation results | **Existing**: `defaultCameraReconciliationWorker.getMetrics()` surfaced in `/system/jobs/workers` | Not correlated into a Camera health overview or `SystemOverviewService` subsystem signal. |
| **Camera Health** | Lifecycle transition failures | **Missing**: `CameraLifecycleService` throws `ValidationError` (400) with no counter, audit row, or error ingestion | Requires transition-failure counter (bounded dimensions: `fromStatus`, `toStatus`), structured log, and optional `ErrorIngestionService` capture for unexpected 5xx failures. |
| **Signaling Health** | Active signaling connections & viewer sessions | **Existing (process-local)**: `CameraSignalingService.getMetrics()` (`connectedCameras`, `activeViewerSockets`, `pendingUnauthenticatedSockets`, `trackedNegotiatingSessions`) | Not exposed on any admin endpoint; `CameraStreamSession` DB active counts (`NEGOTIATING`/`ACTIVE`) not cross-checked against signaling memory. |
| **Signaling Health** | Auth failures & rejection reasons | **Partial**: `rejectedAuthAttempts` single undifferentiated counter + `SIGNALING_AUTH_FAILED` `CameraAccessAuditEvent` | Requires categorized in-memory counters (invalid credential/token, auth timeout, unentitled, revoked session, camera mismatch) for zero-DB real-time rate inspection. |
| **Signaling Health** | Origin & TLS rejections | **Partial**: Increments `rejectedAuthAttempts` and returns HTTP `403` (`ORIGIN_NOT_ALLOWED`, `ORIGIN_REQUIRED`, `TLS_REQUIRED`) | Requires dedicated counters (`rejectedOriginCount`, `rejectedMissingOriginCount`, `rejectedTlsCount`) without logging raw origins beyond bounded domain/sanitized value or tokens. |
| **Signaling Health** | Viewer capacity rejections | **Partial**: Returns `VIEWER_CAPACITY_EXCEEDED` and increments `rejectedAuthAttempts` | Requires dedicated counter (`rejectedViewerCapacityCount`). |
| **Signaling Health** | Negotiation failures & timeouts | **Missing**: `rejectedMessages` lumps all message failures together; auth timeout only increments `rejectedAuthAttempts` | Requires categorized counters: `authTimeouts`, `negotiationErrors`, `staleConnectionRejections`, `rateLimitedMessages`, `payloadLimitRejections`. |
| **Signaling Health** | Session expiry, revocation & termination counts | **Partial**: Queryable in `CameraStreamSession` (`ENDED`, `FAILED`, `TIMED_OUT`, `REVOKED`) + `totalExpiredSessionsTimedOut` in reconciliation worker | No live signaling counters for forced revocations (`notifySessionRevoked`) or active timeout terminations, nor admin API aggregating `CameraStreamSession` terminal breakdown. |
| **Signaling Health** | Signaling service uptime & worker health | **Partial**: `CameraReconciliationWorker` has `startedAt`/status/metrics; `CameraSignalingService` only exposes `listening: boolean` | `CameraSignalingService` needs `startedAt` / `uptimeSeconds` tracking and degraded-state signaling signal in `SystemOverviewService`. |
| **Performance** | API error rates (Camera-specific) | **Partial**: `MetricsCollector` tracks global HTTP status classes only | Requires domain-scoped HTTP counter/latency tracking (`/api/v1/cameras*` & `/admin/operations/cameras*`) plus `'cameras'` added to `adminOperations.byDomain`. |
| **Performance** | Signaling handshake latency | **Missing** | Instrument `wsUpgradeTime` -> `SIGNALING_AUTH_OK` duration via bounded rolling histogram / bucketed summary (e.g., p50/p95/avg/count). |
| **Performance** | Session establishment latency | **Missing / Partial** | `CameraStreamSession` has `startedAt`, `endedAt`, `createdAt`, `updatedAt`; lacks `negotiatingStartedAt` / `activeAt` or signaling in-memory timestamp from `INITIATED` -> `ACTIVE` (`SESSION_READY` / first answer). Needs in-memory instrumentation (and optional schema timestamp if persisted reporting is desired). |
| **Performance** | Heartbeat processing latency | **Missing** | Instrument `CameraLifecycleService.recordHeartbeat()` and signaling `HEARTBEAT` handler duration into bounded summary stats. |
| **Performance** | Reconciliation duration & failures | **Existing**: `CameraReconciliationWorker` tracks `lastDurationMs`, `totalRuns`, `totalFailures` | Add rolling avg/max duration and ingest cycle-level fatal failures into `ErrorIngestionService` (currently only logged via `appLogger`). |
| **Performance** | Resource usage | **Existing**: `process.memoryUsage()`, `process.uptime()` in `MetricsCollector` & `SystemOverviewService` | Node heap/RSS/event-loop lag already exist at process level; per-subsystem memory estimation (e.g., `pendingSockets.size`, `sessionNegotiationState.size`) can stay in signaling snapshot. |

---

## 4. Security & Privacy Risks Identified

### 4.1 Log, Error & Audit Redaction Gaps
1. **SDP & ICE Candidate Leakage Risk**:
   - `SENSITIVE_KEY_PATTERNS` in `src/observability/logger.ts` (lines 27–45) includes `payload`, `token`, `auth`, etc., but **omits** `sdp`, `ice`, `candidate`, `iceCandidate`, `offer`, `answer`.
   - `AdminAuditSanitizer` (`src/services/admin/admin_audit_sanitizer.ts`, lines 6–17) **omits** `sdp`, `ice`, `candidate`, `iceCandidate`, `payload`, `email`, and `phone`.
   - Fastify Pino `logger.redact` (`src/app.ts`, lines 87–105) **omits** `req.headers['x-device-credential']`, `req.headers['x-admin-session-token']`, `req.headers['x-zdex-csrf-token']`, `req.headers['x-admin-csrf-token']`, `body.viewingToken`, `body.connectionToken`, `body.pairingChallengeToken`, `body.sdp`, and `body.candidate`.
   - `sanitizeLogString()` (`logger.ts:67`) redacts URL query parameters `token`, `accessToken`, `sessionToken`, `authToken`, `connectionToken`, `secret`, `key`, `apiKey`, **but omits** `viewingToken`, `pairingChallengeToken`, and ZdexCloud token prefixes (`dst_`, `cvt_`, `pct_`, `zdc_`). (Notably, `camera_reconciliation_worker.ts:120` scrubs `dst_|cvt_|zdc_|sess_`, showing inconsistent sanitization across modules.)
2. **Database Token & Metadata Exposure Risks**:
   - `CameraEndpoint.connectionToken` (`schema.prisma:724`) and `CameraStreamSession.sessionTokenHash` (`schema.prisma:744`) exist in the database. Any admin query using `include` or unrestricted `select` instead of explicit allowlisted projections would expose secrets/hashes.
   - `CameraInstance.metadata`, `CameraStreamSession.metadata`, and `CameraAccessAuditEvent.metadata` are free-form `Json?` columns. Returning them unredacted to admins risks exposing internal client attributes or unexpected fields. Admin APIs must run DTO-level key allowlisting / `sanitizeLogMetadata` before serialization.
3. **Device Credentials & Auth Materials**:
   - `DeviceAuthCredential.credentialHash` and `EmailOtp` / `UserSession` / `AdminSession` hashes must stay strictly excluded from all admin queries and `Device` joins.
4. **PII Minimization & Unscoped Support Access**:
   - Existing `AdminDeviceService` returns full `user.email`, `user.fullName`, `installationId`, and `remoteEndpoint` IP. For Camera operations, unbounded queries across sessions/events without date caps or role scoping increase tenant-data harvesting risk.
   - Customer `CameraStreamSession` contains behavioral viewing history (`startedAt`, `endedAt`, `viewerUserId`). Unaudited or overly broad session inspection violates least privilege.
5. **No Automated Retention Policy for Camera Telemetry**:
   - `ErrorRetentionWorker` and `EmailRetentionWorker` exist, but **`CameraAccessAuditEvent`, ended `CameraStreamSession` records, and expired signaling metadata have zero automated retention/cleanup**. Retaining raw IP addresses, user agents, and detailed viewing event logs indefinitely violates privacy minimization.
6. **Multi-Control-Plane Risk (`youm-panel`)**:
   - Exposing Camera controls on `/api/v1/youm-panel/*` would bypass RBAC, `AdminAuditService` hash chaining, and least-privilege role separation (`SUPPORT` vs `OPERATIONS` vs `ADMIN`).

---

## 5. Proposed Architecture (Phase 20.6 Blueprint)

> **Important Note:** All routes, permission slugs, metric structures, and enum additions below are **proposed specifications** for Phase 20.6 implementation. None of them currently exist in source code.

### 5.1 Proposed Admin API Routes & Versioning (`/api/v1`)
Follow the established Phase 8/17 Operations API convention under `/api/v1/admin/operations/cameras` (and optional top-level `/api/v1/admin/cameras` aliases only if UI consistency requires them, backed by one shared `AdminCameraService`):

#### Read-Only Endpoints
- `GET /api/v1/admin/operations/cameras/metrics`
  - Fleet status distribution (`total`, `OFFLINE`, `CONNECTING`, `ONLINE`, `STREAMING`, `RECONNECTING`, `ERROR`), active `CameraStreamSession` counts (`INITIATED`, `NEGOTIATING`, `ACTIVE`), 24h session termination breakdown (`ENDED`, `FAILED`, `TIMED_OUT`, `REVOKED`), `CameraReconciliationWorker` summary, and process-local `CameraSignalingService` metrics (explicitly tagged with instance scope).
- `GET /api/v1/admin/operations/cameras`
  - Paginated fleet listing (`page`, `pageSize` <= 100, `status`, `userId`, `deviceId`, `search` by camera ID/name/device ID, `startDate`/`endDate`, allowlisted `sortBy`). Projects masked/minimal owner info (`userId`, masked email or explicit owner summary for `ADMIN`/`SUPPORT`), linked `deviceId`/`deviceName`/`device.status`, lifecycle timestamps (`lastSeenAt`, `startedAt`, `stoppedAt`), active viewer count, and subscription allocation status.
- `GET /api/v1/admin/operations/cameras/:cameraId`
  - Redacted camera detail: camera config (no raw credentials/tokens), owner summary, linked `Device` summary (no `credentialHash`), sanitized `CameraEndpoint` summary (`status`, `lastHeartbeatAt`, `connectedAt`, `disconnectedAt`, masked/omitted `connectionToken`), active signaling state (`getCameraSignalingState(cameraId)`), and recent session/usage counts.
- `GET /api/v1/admin/operations/cameras/:cameraId/sessions`
  - Paginated, date-bounded `CameraStreamSession` inspection for a camera (`status`, `transportType`, `startDate`, `endDate`). **Never returns `sessionTokenHash`, SDP, ICE payloads, or cookies.**
- `GET /api/v1/admin/operations/cameras/sessions/:sessionId`
  - Redacted single-session investigation view (`id`, `cameraId`, `viewerUserId`, `status`, `transportType`, `protocol`, `startedAt`, `endedAt`, `expiresAt`, `durationSeconds`, `bytesTransferred`, `terminationReason`, allowlisted metadata summary).
- `GET /api/v1/admin/operations/cameras/events` (and `/cameras/:cameraId/events`)
  - Paginated query over `CameraAccessAuditEvent` (`eventType`, `result`, `cameraId`, `userId`, `actorType`, `startDate`, `endDate`), with metadata passed through an SDP/ICE/token-safe redaction filter.
- `GET /api/v1/admin/operations/cameras/usage`
  - Paginated/aggregated `CameraUsageRecord` summaries (`userId`, `cameraInstanceId`, `category`, `periodStart`, `periodEnd`).
- `GET /api/v1/admin/operations/cameras/signaling/diagnostics`
  - Live signaling process metrics, breakdown of auth/origin/TLS/capacity/negotiation rejections, latency summaries, config posture (e.g., `requireSecureTransport`, `maxViewersPerCamera`, `path`, **never** raw secrets), and `CameraReconciliationWorker` telemetry.

#### Privileged Management Endpoints (Mutations)
All mutations must require an explicit `reason` string (min length enforced, max 500 chars), run via `executeAdminOperation()`, update DB + trigger signaling eviction/termination synchronously/safely, and emit tamper-evident `AdminAuditLog` + `CameraAccessAuditEvent` records:
- `POST /api/v1/admin/operations/cameras/:cameraId/disable`
  - Administratively forces a camera to `OFFLINE` (or suspended administrative disable flag if added) + revokes all `INITIATED`/`NEGOTIATING`/`ACTIVE` sessions for that `cameraId` + severs the physical Camera signaling socket and active viewer sockets. **Does not** disable the underlying Storage `Device` or `ServerInstance`.
- `POST /api/v1/admin/operations/cameras/sessions/:sessionId/revoke`
  - Revokes a single viewer `CameraStreamSession` (`status = REVOKED`, `terminationReason = ADMIN_REVOKED`) and calls `defaultCameraSignalingService.notifySessionRevoked(sessionId, ...)` without disturbing other viewers or the Camera socket.
- `POST /api/v1/admin/operations/cameras/:cameraId/sessions/revoke-all`
  - Revokes all active/negotiating viewer sessions for a specific `cameraId` (incident containment) while recording exact revoked count in audit metadata.
- **Explicit Exclusion**: Admins must **never** be granted endpoints to issue viewing tokens, join live WebRTC streams, inject signaling SDP/ICE frames, retrieve device credentials, or bypass `CameraSubscription` entitlements.

### 5.2 Proposed RBAC Permission Taxonomy & Enforcement
Align with `SYSTEM_PERMISSIONS` (`resource.action`) and `requireOperationPermission(...)`:
- `cameras.read` — Read-only fleet inventory, metrics, signaling diagnostics, usage summaries, and `CameraAccessAuditEvent` stream.
- `cameras.sessions.read` — Read-only inspection of redacted `CameraStreamSession` records (separated so telemetry-only operators don't inspect per-user viewing histories unless granted).
- `cameras.manage` (or `cameras.revoke`) — Privileged operational containment: administratively disable/disconnect a camera stream and revoke active viewing sessions (`executeAdminOperation` + strict `20 req/min` rate limit).
- `cameras.export` (optional if CSV/JSON exports are added later; requires SHA-256 export audit logging like `errors.export`).

**Proposed Default Role Mapping:**
- `SUPER_ADMIN`: all `cameras.*` permissions.
- `ADMIN`: `cameras.read`, `cameras.sessions.read`, `cameras.manage`.
- `OPERATIONS`: `cameras.read`, `cameras.sessions.read`, `cameras.manage` (consistent with `devices.disconnect`, `servers.power`, `gateway.drain`).
- `SUPPORT`: `cameras.read`, `cameras.sessions.read` (**read-only**; no destructive disable/revoke unless elevated, or limited to viewing redacted diagnostic state).
- **Object-Level Authorization**: Implement real checks inside `assertAdminCanOperateOnResource()` for `'camera'` and `'camera_session'` (verifying resource existence, non-deleted state, and preventing cross-camera/session parameter tampering).

### 5.3 Metrics Collection, Latency Instrumentation & Multi-Instance Boundary
1. **Expand `MetricsCollector` (`src/observability/metrics.ts`)**:
   - Extend `adminOperations.byDomain` union to include `'cameras'`.
   - Add bounded `camera` & `cameraHttp` summaries: API request counts/status classes/average latency for `/api/v1/cameras*`, lifecycle transitions & transition failures (`PERMITTED_CAMERA_TRANSITIONS` rejections), and heartbeat handler latency summary (count, avg, max, p95 via bounded circular buffer e.g. last 512 samples).
2. **Expand `CameraSignalingService` Instrumentation (`src/services/camera_signaling_service.ts`)**:
   - Track `startedAt: Date | null` and `uptimeSeconds`.
   - Replace monolithic `rejectedAuthAttempts` / `rejectedMessages` counters with explicit low-cardinality breakdown maps/counters (keep aggregate totals for backward compatibility):
     - `authRejectionsByReason`: `TLS_REQUIRED`, `ORIGIN_NOT_ALLOWED`, `ORIGIN_REQUIRED`, `AUTH_TIMEOUT`, `INVALID_CREDENTIALS`, `VIEWER_CAPACITY_EXCEEDED`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `UNAUTHORIZED`, `RATE_LIMITED`.
     - `negotiationCounters`: `offersRelayed`, `answersRelayed`, `iceCandidatesRelayed` (counts ONLY, zero payload storage), `negotiationErrors`, `staleConnectionRejections`, `rateLimitedMessages`, `payloadLimitRejections`.
     - `sessionTerminationCounters`: `evictedCameras`, `evictedViewers`, `revocationsTriggered`, `expiredCleanups`.
   - Track rolling latency summaries (bounded ring buffer, e.g. 256 samples -> `count`, `avgMs`, `p95Ms`, `maxMs`) for WS Upgrade -> `SIGNALING_AUTH_OK` handshake latency and `HEARTBEAT` processing latency.
   - **Session Establishment Latency**: Measure `INITIATED` -> `ACTIVE` duration where `CameraStreamSession.startedAt` / `activeAt` is recorded (if `activeAt` timestamp is added on `ACTIVE` transition).
3. **Error Ingestion Integration**:
   - Route unexpected 5xx exceptions in `CameraLifecycleService`, `CameraReconciliationWorker` (cycle-level failures), and `CameraSignalingService` (internal DB/unexpected exceptions, **never** benign 4xx client/origin rejections) to `ErrorIngestionService` with sanitized component tags (`camera_lifecycle`, `camera_reconciliation`, `camera_signaling`).
4. **System Overview Integration (`SystemOverviewService`)**:
   - Add a `camera` subsystem summary (registered/online/streaming/error counts + signaling listening status + reconciliation worker health) as an additive property so existing `overall` / `gateway` / `devices` contracts remain backwards-compatible.
5. **Process-Local Multi-Instance Limitation (Explicit Architectural Boundary)**:
   - Just like `GatewayService`, `CameraSignalingService` metrics (`connectedCameras`, `activeViewerSockets`, rejection counters, latency buffers) and `CameraReconciliationWorker` metrics are **process-local in memory**.
   - In multi-replica deployments:
     - DB queries (`CameraInstance`, `CameraStreamSession`, `CameraAccessAuditEvent`) represent **cluster-wide** authoritative state.
     - In-memory signaling metrics represent **this process instance only** and MUST be explicitly tagged `scope: 'LOCAL_PROCESS'` alongside `processId`, `hostname`, and `instanceUptimeSeconds` (matching `AdminBackgroundJobsService.listWorkers()` Model A).
     - Cross-instance admin actions (`disable` / `session revoke`) update MySQL immediately, while local `CameraSignalingService` eviction only severs sockets connected to the receiving instance unless sticky routing by `cameraId` or a future Redis/pub-sub control bus is added in a later scaling phase.

### 5.4 Audit-Event Integration & Dual Audit Trail
- **Operational/User Security Events (`CameraAccessAuditEvent`)**: Already persisted atomically for registration, unlinking, config changes, start/stop, viewing requests, signaling auth success/failures, and session termination. Ensure admin read endpoints expose sanitized, date-bounded views of this table (`AdminAuditService.logEvent({ action: ADMIN_CAMERA_VIEWED / ... })` optional on sensitive detail/event reads or exports).
- **Admin Action Audit Trails (`AdminAuditLog`)**: Every privileged admin mutation (`disable`, `revoke`, export) executes inside `executeAdminOperation()` using dedicated `AdminAuditAction` enum values (e.g., `ADMIN_CAMERA_DISABLED`, `ADMIN_CAMERA_SESSION_REVOKED`, `ADMIN_CAMERA_AUDIT_EXPORTED`) with SHA-256 integrity chaining and `AdminAuditSanitizer` scrubbing.

### 5.5 Dashboard Information Architecture (Admin UI)
Recommended navigation & views for the RBAC-authenticated Admin Console (keeping Storage Devices/Servers/Gateway panels untouched):
1. **Camera Overview KPI Strip**: Registered vs. Active (`ONLINE` + `STREAMING`), `STREAMING` live count, `ERROR` / `RECONNECTING` alerts, 24h Auth/Origin/TLS/Capacity rejections, Signaling & Reconciliation Worker status badges.
2. **Camera Fleet Table**: Filter by `status`, `userId`, `deviceId`, `search`; show status pill, camera name, linked device status, owner summary (masked by default unless privileged detail), `lastSeenAt` relative age, active viewer count, and drill-down action.
3. **Camera Detail Drawer / Page**: Hardware/device binding, `CameraEndpoint` connection timestamps, live signaling socket state + process tag, recent sessions tab (redacted), and recent `CameraAccessAuditEvent` tab.
4. **Signaling & Worker Diagnostics Panel**: Process-local signaling gauges, categorized rejection breakdown chart, handshake/heartbeat latency metrics, and `CameraReconciliationWorker` cycle history (`lastDurationMs`, transitions, failures).
5. **Security & Audit Investigation View**: Filterable `CameraAccessAuditEvent` + `AdminAuditLog` (camera actions) with CSV/JSON sanitized export (`cameras.export` / `audit.read`).

### 5.6 Pagination, Filtering, Date Ranges, Rate Limits & Query Performance
- **Pagination & Date Windows**: Reuse `paginationQuerySchema` (`page`, `pageSize` max `100`, default `25`, regex `sortBy`, `sortOrder`). Enforce bounded date-range defaults on high-volume audit/session/usage queries (e.g., default last 7 days, maximum 90-day span per query) to avoid full-table scans on MySQL.
- **Rate Limits**:
  - Standard read/list/detail/metrics endpoints: `adminOperationsRateLimitConfig` (`120 req/min` per `adminId + IP`).
  - Audit event search, usage aggregations, and exports: `adminHeavyQueryRateLimitConfig` (`30 req/min` per `adminId + IP`).
  - Disable / revoke mutations: dedicated `20 req/min` per `adminId + IP` limit matching `device_disconnect` and `gateway_drain`.
- **Query Performance & Indexes**:
  - `CameraInstance` already indexes `userId`, `deviceId`, `status`, `lastSeenAt`, `createdAt`. Consider composite `(status, lastSeenAt)` for stale/fleet queries.
  - `CameraStreamSession` already indexes `cameraInstanceId`, `viewerUserId`, `sessionTokenHash`, `status`, `startedAt`, `expiresAt`. Consider composite `(cameraInstanceId, status, createdAt)` and `(status, createdAt)` for session lists and retention cleanup.
  - `CameraAccessAuditEvent` already indexes `cameraInstanceId`, `userId`, `eventType`, `createdAt`. Consider composite `(cameraInstanceId, createdAt)` and `(eventType, createdAt)` for admin audit queries and batched retention pruning.

### 5.7 Retention & Privacy Boundaries
- **Zero-Persistence Policy for WebRTC Media & Signaling Payloads**: SDP offers/answers, ICE candidates, raw viewing/device/session tokens, and cookies must **never** be persisted in `CameraAccessAuditEvent`, `CameraStreamSession.metadata`, `ErrorOccurrence`, or `AdminAuditLog`.
- **Hardening Existing Sanitizers**: Update `SENSITIVE_KEY_PATTERNS` in both `logger.ts` and `admin_audit_sanitizer.ts` (and Pino `logger.redact` in `app.ts`) to include `sdp`, `ice`, `iceCandidate`, `candidate`, `viewingToken`, `connectionToken`, `pairingChallengeToken`, `x-device-credential`, `x-admin-session-token`, and raw token prefix scrubbing (`dst_`, `cvt_`, `pct_`, `zdc_`).
- **Recommended Data Retention Schedule** (via a bounded `CameraRetentionWorker` following `ErrorRetentionWorker` patterns with `GET_LOCK` + batch size + dry-run):
  - `CameraAccessAuditEvent`: **90 days** default (configurable via env, e.g. `CAMERA_AUDIT_RETENTION_DAYS`), excluding rows needed for active security investigations if flagged.
  - Terminal `CameraStreamSession` rows (`ENDED`, `FAILED`, `TIMED_OUT`, `REVOKED`): **90 days** operational retention (aggregated usage metrics remain preserved independently in `CameraUsageRecord`). **Never** delete `INITIATED`, `NEGOTIATING`, or `ACTIVE` sessions.
  - `CameraUsageRecord`: Retain per billing/tax statutory requirements (e.g., **365+ days** or exempt from short-window operational purge).
  - Admin read projections must mask `ipAddress` / `user.email` for `SUPPORT`-level views unless full audit permission (`audit.read`) is held, or uniformly mask sensitive user fields when unnecessary for triage.

---

## 6. Recommended Implementation Batches for Phase 20.6

1. **Batch 20.6.2 — Observability Instrumentation & Privacy Redaction Hardening**
   - Harden `logger.ts`, `admin_audit_sanitizer.ts`, and `app.ts` Pino `redact` for SDP/ICE/Camera tokens/headers.
   - Expand `MetricsCollector` (`adminOperations.byDomain.cameras`, camera HTTP/lifecycle/heartbeat telemetry) and `CameraSignalingService` categorized counters, `startedAt`, and bounded latency histograms.
   - Integrate `ErrorIngestionService` into `CameraLifecycleService`, `CameraReconciliationWorker` (cycle failures), and `CameraSignalingService` (5xx/unexpected failures only).
   - Add read-only Camera subsystem summary to `SystemOverviewService` (strictly additive, preserving all Storage fields).
   - Unit tests for redaction, metric counting, latency recording, and zero leakage.

2. **Batch 20.6.3 — RBAC Permissions & Read-Only Camera Admin APIs**
   - Seed `cameras.read` and `cameras.sessions.read` in `admin_rbac_seed.ts`; implement `'camera'` and `'camera_session'` checks in `object_authorization.ts`.
   - Implement `/api/v1/admin/operations/cameras/*` read-only routes (metrics, fleet list, detail, redacted sessions list/detail, signaling diagnostics, sanitized `CameraAccessAuditEvent` & `CameraUsageRecord` queries) with strict DTO allowlists, bounded date windows, pagination (`max 100`), and `adminOperationsRateLimitConfig` / `adminHeavyQueryRateLimitConfig`.
   - Comprehensive RBAC, tenant/object-isolation, redaction, and pagination tests.

3. **Batch 20.6.4 — Privileged Containment Controls, Admin Audit Actions & Camera Retention Worker**
   - Add `cameras.manage` permission and `AdminAuditAction` enum entries (`ADMIN_CAMERA_DISABLED`, `ADMIN_CAMERA_SESSION_REVOKED`, `ADMIN_CAMERA_SESSIONS_BULK_REVOKED`, `ADMIN_CAMERA_AUDIT_EXPORTED`).
   - Implement `POST .../disable`, `POST .../sessions/:sessionId/revoke`, and `POST .../sessions/revoke-all` via `executeAdminOperation()` with fail-closed SHA-256 `AdminAuditLog` + `20 req/min` rate limits.
   - Implement bounded `CameraRetentionWorker` (`CameraAccessAuditEvent` + terminal `CameraStreamSession` pruning with distributed MySQL lock & dry-run mode) and register it in `AdminBackgroundJobsService.listWorkers()`.
   - End-to-end admin containment, fail-closed audit, retention safety, and Storage non-regression tests.

---

## 7. Dependencies & Migration Requirements

- **Immediate (Phase 20.6.2 & Read-Only 20.6.3)**:
  - **Zero Prisma schema migrations required** for Batch 20.6.2 instrumentation or basic read-only Camera admin endpoints, provided existing indexes and `CameraStreamSession` timestamps are used.
  - `AdminPermission` / `AdminRolePermission` rows are populated idempotently by `seedAdminRbac()` (requires `seedAdminRbac()` execution on startup/seed if used for non-SuperAdmin roles).
- **Schema Migration Needed Before/In Batch 20.6.3 / 20.6.4**:
  1. **New `AdminAuditAction` enum values** in `main website/Backend/prisma/schema.prisma` (and MySQL migration) for dedicated Camera admin actions (`ADMIN_CAMERA_DISABLED`, `ADMIN_CAMERA_SESSION_REVOKED`, `ADMIN_CAMERA_SESSIONS_BULK_REVOKED`, etc.).
  2. **Composite Indexes (Recommended for Query & Retention Performance)**:
     - `CameraInstance`: `@@index([status, lastSeenAt])`
     - `CameraStreamSession`: `@@index([cameraInstanceId, status, createdAt])`, `@@index([status, endedAt])`
     - `CameraAccessAuditEvent`: `@@index([cameraInstanceId, createdAt])`, `@@index([eventType, createdAt])`
  3. **Optional `CameraStreamSession` Latency Columns** (only if persistent DB calculation of `INITIATED -> NEGOTIATING -> ACTIVE` latency is required beyond in-memory signaling histograms): `negotiatingStartedAt DateTime?` and `activatedAt DateTime?`.
- **Zero Storage Schema Changes**: No modifications to `Device`, `ServerInstance`, `ServerEndpoint`, `DeviceConnection`, or `GatewayNode` are needed or permitted.

---

## 8. Audit-Only Confirmation

- This batch (**Phase 20.6.1**) was strictly **audit-only**.
- **Zero source code files modified.**
- **Zero tests created, modified, or executed.**
- **Zero builds, type-checkers, migrations, database mutations, deployments, or service restarts executed.**
- Only this audit report (`docs/PHASE_20_6_1_CAMERA_OBSERVABILITY_ADMIN_AUDIT.md`) was created.
