# ZDEXCLOUD — PHASE 20.4 IMPLEMENTATION REPORT
## Camera Lifecycle Management & Heartbeat

**Batch:** Phase 20.4 — Camera Lifecycle Management & Heartbeat  
**Scope:** Backend Camera Lifecycle State Machine, Device Heartbeat & Lifecycle Ingestion, Stale Heartbeat Reconciliation, Command Ordering Safety, Viewer vs Camera Lifecycle Decoupling  
**Test Execution Status:** NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28  
**Database / Migration Execution Status:** ZERO MIGRATIONS CREATED OR APPLIED (existing Phase 20.1–20.3 Prisma schema fully satisfies Phase 20.4)

---

## 1. Pre-Implementation Audit Summary

Inspection of existing Phase 20.1–20.3 schema and backend code established the following baseline:

- `main website/Backend/prisma/schema.prisma`:
  - `CameraInstance` already includes `status: CameraStatus` (`OFFLINE | CONNECTING | ONLINE | STREAMING | RECONNECTING | ERROR`), `lastSeenAt`, `startedAt`, `stoppedAt`, `metadata` (JSON), `deviceId`, `userId`, and indexes on `(userId)`, `(deviceId)`, `(status)`, `(lastSeenAt)`, and `(createdAt)`.
  - `CameraEndpoint` already includes `status: CameraEndpointStatus` (`INACTIVE | READY | CONNECTED | FAILED`), `lastHeartbeatAt`, `connectedAt`, `disconnectedAt`.
  - `CameraStreamSession` already includes `status: CameraStreamSessionStatus` (`INITIATED | NEGOTIATING | ACTIVE | ENDED | FAILED | TIMED_OUT | REVOKED`), `startedAt`, `endedAt`, and `expiresAt`.
  - `CameraAccessAuditEvent` and `CameraAuditEventType` already provide durable audit logging (noting 12 existing enum values in SQL/Prisma: `CAMERA_REGISTERED`, `CAMERA_UNLINKED`, `CAMERA_CONFIG_UPDATED`, `CAMERA_STARTED`, `CAMERA_STOPPED`, `VIEWING_SESSION_REQUESTED`, `VIEWING_SESSION_STARTED`, `VIEWING_SESSION_ENDED`, `VIEWING_ACCESS_DENIED`, `TURN_CREDENTIALS_ISSUED`, `SIGNALING_AUTHENTICATED`, `SIGNALING_AUTH_FAILED`).
- `main website/Backend/src/middleware/customer-auth.ts` & `src/routes/device.ts`:
  - Persistent Android devices authenticate via `DeviceAuthCredential` (`credentialHash`) or scoped `SERVER_RUNTIME` sessions (`dst_<deviceId>_<hex>`), whereas interactive browser sessions use HttpOnly cookies or Bearer tokens without `deviceScope`.
- `main website/Backend/src/services/camera_service.ts`:
  - `requestStartCamera` and `requestStopCamera` previously persisted `metadata.pendingCommand` without `commandId`, `requestStartCamera` exited early on `ONLINE`/`STREAMING` even when superseding a pending `STOP`, `classifyAuditEvent` referenced non-existent `CameraAuditEventType` keys, and `revokeViewingSession` did not reconcile `CameraInstance.status` from `STREAMING` back to `ONLINE`.

---

## 2. Files Modified & Created

### Created Files
- `main website/Backend/src/services/camera_lifecycle_service.ts` — Centralized Camera lifecycle state machine, strict device authentication, heartbeat ingestion, explicit lifecycle reporting, command ordering enforcement, streaming-session reconciliation, and stale-camera reconciliation (`reconcileStaleCameras`).
- `main website/Backend/tests/camera_lifecycle_and_heartbeat.test.ts` — 24-scenario Phase 20.4 test suite (`NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`).
- `docs/PHASE_20_4_CAMERA_LIFECYCLE_AND_HEARTBEAT_REPORT.md` — This implementation report.

### Modified Files
- `main website/Backend/src/config/env.ts` — Added `CAMERA_HEARTBEAT_TIMEOUT_MS` (default `90000`), `CAMERA_CONNECTING_TIMEOUT_MS` (default `120000`), `CAMERA_RECONNECT_GRACE_MS` (default `180000`), `CAMERA_RECONCILIATION_BATCH_SIZE` (default `100`).
- `main website/Backend/src/services/camera_service.ts` — Fixed `classifyAuditEvent` enum keys, added `commandId` generation and `STOP -> START` superseding in `requestStartCamera` / `requestStopCamera`, updated `getCameraStatus` to count active non-expired sessions (`expiresAt > now`) and report heartbeat staleness metadata, and invoked `CameraLifecycleService.reconcileCameraStreamingStateWithTx` inside `revokeViewingSession`.
- `main website/Backend/src/routes/camera.ts` — Added Zod schemas (`cameraHeartbeatSchema`, `cameraLifecycleReportSchema`) and registered device-only routes `POST /api/v1/cameras/:cameraId/heartbeat` and `POST /api/v1/cameras/:cameraId/lifecycle`.

---

## 3. Lifecycle State Machine & Transition Validation Rules

Defined in `PERMITTED_CAMERA_TRANSITIONS`, `isValidLifecycleTransition`, and `assertValidLifecycleTransition` (`main website/Backend/src/services/camera_lifecycle_service.ts`):

- `OFFLINE` -> `OFFLINE`, `CONNECTING`, `ONLINE`, `ERROR`
- `CONNECTING` -> `CONNECTING`, `ONLINE`, `RECONNECTING`, `OFFLINE`, `ERROR`
- `ONLINE` -> `ONLINE`, `STREAMING`, `RECONNECTING`, `OFFLINE`, `ERROR`
- `STREAMING` -> `STREAMING`, `ONLINE`, `RECONNECTING`, `OFFLINE`, `ERROR`
- `RECONNECTING` -> `RECONNECTING`, `ONLINE`, `STREAMING`, `OFFLINE`, `ERROR`
- `ERROR` -> `ERROR`, `CONNECTING`, `ONLINE`, `OFFLINE`

Disallowed jumps (such as `OFFLINE -> STREAMING`, `OFFLINE -> RECONNECTING`, `CONNECTING -> STREAMING`, `ONLINE -> CONNECTING`, `ERROR -> STREAMING`, `ERROR -> RECONNECTING`) throw `ConflictError(..., 'INVALID_LIFECYCLE_TRANSITION')`. Transitioning to `STREAMING` also requires at least one `ACTIVE`, non-expired `CameraStreamSession` (`NO_ACTIVE_STREAM_SESSION` otherwise).

---

## 4. Device Authentication & Ownership Enforcement Behavior

Implemented in `CameraLifecycleService.authenticateDeviceRequest` and `assertAuthorizedCameraDevice`:

- Rejects requests without Bearer device credentials (`401 DEVICE_CREDENTIAL_REQUIRED`) and explicitly rejects cookie-based interactive browser sessions or interactive user Bearer tokens lacking `deviceScope.scope === 'SERVER_RUNTIME'` (`403 DEVICE_CREDENTIAL_REQUIRED`).
- Validates persistent `DeviceAuthCredential` (`credentialHash`, non-revoked `revokedAt === null`, non-expired, `Device` ownership match, `User.status === ACTIVE`) and `SERVER_RUNTIME` `UserSession` tokens (`dst_<deviceId>_...`), plus `DeviceInstallationClaim` active ownership checks (`DEVICE_REVOKED` if revoked or mismatched).
- Rejects cross-account cameras (`403 CROSS_ACCOUNT_CAMERA_ACCESS_DENIED`), device-to-camera binding mismatches even under the same account (`403 DEVICE_CAMERA_MISMATCH`), and `deviceId` payload mismatches (`403 DEVICE_MISMATCH` / `DEVICE_ID_MISMATCH_REJECTED`).
- Ignores client-supplied `userId` in route schemas; ownership is resolved strictly from server-side verified credentials.

---

## 5. Heartbeat Ingestion & Idempotency Handling

Implemented in `CameraLifecycleService.recordCameraHeartbeat` (`POST /api/v1/cameras/:cameraId/heartbeat`):

- Validates optional ISO timestamps (`reportedAt`, `commandRequestedAt`) and rejects stale `reportedAt` exceeding `CAMERA_HEARTBEAT_TIMEOUT_MS` or predating `lockedCamera.stoppedAt` / `lockedCamera.lastSeenAt` (`409 STALE_HEARTBEAT_REPORT`), as well as excessive future clock skew (> 5 minutes).
- Executes under row lock (`SELECT id FROM CameraInstance WHERE id = ... FOR UPDATE`) to serialize concurrent heartbeats, stop/start commands, and stream-session expirations.
- Repeated heartbeats in `ONLINE` state refresh `CameraInstance.lastSeenAt`, `CameraEndpoint.lastHeartbeatAt`, `Device.lastSeenAt`, and `DeviceAuthCredential.lastUsedAt` idempotently (`transitioned: false`, `idempotent: true`) without generating redundant audit log spam unless status transitioned or a pending command was resolved.

---

## 6. Stale Heartbeat Detection & Reconciliation Logic

Implemented in `CameraLifecycleService.reconcileStaleCameras`:

- Step 1: Expires `CameraStreamSession` rows in `INITIATED`, `NEGOTIATING`, or `ACTIVE` whose `expiresAt <= now` to `TIMED_OUT` (`terminationReason: 'TOKEN_EXPIRED'`).
- Step 2: Reconciles `STREAMING` cameras via `reconcileCameraStreamingState`; if `activeViewerCount === 0`, downgrades `STREAMING -> ONLINE` (never `OFFLINE`).
- Step 3: Evaluates candidate `CONNECTING`, `ONLINE`, `STREAMING`, and `RECONNECTING` cameras in batches (`CAMERA_RECONCILIATION_BATCH_SIZE`, default `100`):
  - `ONLINE` / `STREAMING` stale past `heartbeatTimeoutMs` (`90s`) -> `RECONNECTING` (recording `reconnectingSince`).
  - `ONLINE` / `STREAMING` stale past `heartbeatTimeoutMs + reconnectGraceMs` (`270s`) or `RECONNECTING` past `reconnectGraceMs` (`180s`) -> `OFFLINE` (marking active endpoints `INACTIVE`).
  - `CONNECTING` past `connectingTimeoutMs` (`120s`) with stale heartbeat -> `OFFLINE` and marks pending `START` command as `TIMED_OUT` in `lastCommandResolution`.
- Applies optimistic Compare-And-Set (`updateMany` matching `id`, `status`, `updatedAt`, and `OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: heartbeatCutoff } }]`) across all candidate states so concurrent fresh heartbeats are never overwritten, with per-camera error isolation. No new persistent background daemon/worker was started or deployed in this batch.

---

## 7. Command Intent & Delayed Confirmation Ordering Protection

Implemented across `CameraService.requestStartCamera`, `CameraService.requestStopCamera`, and `CameraLifecycleService.evaluateCommandResolution`:

- Both `requestStartCamera` and `requestStopCamera` assign a unique `commandId` (`cmd_<hex>`) and `requestedAt` timestamp in `metadata.pendingCommand`.
- `requestStopCamera` NEVER forces `OFFLINE` directly; `stateConfirmedByDevice` remains `false` until confirmed by the device lifecycle endpoint.
- `requestStartCamera` supersedes an existing pending `STOP` command with a new `START` command even when `status` is still `ONLINE`/`STREAMING`/`CONNECTING`.
- `evaluateCommandResolution` validates `confirmedCommand`, `commandId`, and `commandRequestedAt` against `pendingCommand`, rejecting mismatched or predating confirmations with `409 STALE_COMMAND_CONFIRMATION` so delayed `START` confirmations never override a newer `STOP`, and delayed `STOP` confirmations never force a newly `START`-requested camera `OFFLINE`.

---

## 8. Viewer Session vs CameraInstance Lifecycle Separation

Implemented in `CameraLifecycleService.reconcileCameraStreamingStateWithTx`, `onViewerSessionEnded`, `CameraService.revokeViewingSession`, and `CameraService.getCameraStatus`:

- `CameraInstance.status` represents physical Android camera capture hardware state; `CameraStreamSession` represents individual viewer sessions.
- Revoking, ending, or expiring the final active `CameraStreamSession` transitions `CameraInstance.status` from `STREAMING -> ONLINE` and NEVER marks a healthy camera `OFFLINE`.
- Active viewer counts strictly require `status = ACTIVE` and `expiresAt > now`, ensuring expired sessions cannot keep a camera falsely `STREAMING`.

---

## 9. Route Definitions & Endpoints Added/Updated

Registered under `/api/v1` in `main website/Backend/src/routes/camera.ts`:

- `POST /api/v1/cameras/:cameraId/heartbeat` (`customerStandardRateLimitConfig`, `CameraLifecycleService.authenticateDeviceRequest`, `CameraLifecycleService.recordCameraHeartbeat`)
- `POST /api/v1/cameras/:cameraId/lifecycle` (`customerStandardRateLimitConfig`, `CameraLifecycleService.authenticateDeviceRequest`, `CameraLifecycleService.reportCameraLifecycle`)
- `GET /api/v1/cameras/:cameraId/status` (updated via `CameraService.getCameraStatus` to exclude expired sessions and include `isHeartbeatStale`, `heartbeatTimeoutMs`, and `lastCommandResolution`)
- `POST /api/v1/cameras/:cameraId/start` & `POST /api/v1/cameras/:cameraId/stop` (updated command IDs & superseding semantics via `CameraService`)

---

## 10. Configuration Parameters Added

Added to `envSchema` in `main website/Backend/src/config/env.ts`:

- `CAMERA_HEARTBEAT_TIMEOUT_MS` (integer >= 5000, default `90000`)
- `CAMERA_CONNECTING_TIMEOUT_MS` (integer >= 10000, default `120000`)
- `CAMERA_RECONNECT_GRACE_MS` (integer >= 10000, default `180000`)
- `CAMERA_RECONCILIATION_BATCH_SIZE` (integer 1..1000, default `100`)

---

## 11. Schema & Migration Impact

- **No Prisma schema changes required.**
- **No migration created or applied.** Existing Phase 20.1–20.3 models (`CameraInstance`, `CameraEndpoint`, `CameraStreamSession`, `CameraAccessAuditEvent`, `Device`, `DeviceAuthCredential`, `DeviceInstallationClaim`) and indexes (`(status)`, `(lastSeenAt)`) provide full support without schema alteration.

---

## 12. Security & Audit Event Behavior

- Security denials (cross-account device report, device/camera mismatch, revoked device credential, stale command/heartbeat rejection) are audited via `CameraService.recordAuditEvent` with critical classification (`SecurityAuditPersistenceError` fail-closed on persistence failure after retries).
- Operational lifecycle state transitions and stale-reconciliation transitions record `CameraAccessAuditEvent` without logging raw Bearer tokens, session tokens, `credentialHash`, or PII.
- Repeated idempotent `ONLINE` heartbeats intentionally skip creating duplicate audit rows.

---

## 13. Tests Written & Deferred Execution Notice

- Created `main website/Backend/tests/camera_lifecycle_and_heartbeat.test.ts` covering all 24 mandatory scenarios from Section 10 using `node:test`, `node:assert/strict`, Fastify route injection, and Prisma mock instrumentation.
- **Explicit Policy Notice:** **NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.** No tests, builds, or type-checkers were executed during this batch.

---

## 14. Deferred Boundary Confirmation

- **Phase 20.5 (Signaling / SDP / ICE / TURN):** Untouched.
- **Phase 21 / Android App / Frontend / Dashboard UI / Storage Systems:** Untouched.
- **Deployments / Service Restarts / Remote DB:** Zero deployments, restarts, or remote database mutations performed.

---

## 15. Open Questions / Verification Items for Review

1. Confirm whether the Phase 20.5+ worker host (`server.ts`) or scheduled job runner should invoke `CameraLifecycleService.reconcileStaleCameras()` on a periodic interval when background Camera workers are wired in a later batch (intentionally left as an explicit service boundary in Phase 20.4).
2. Execute `tests/camera_lifecycle_and_heartbeat.test.ts` during Phase 28 consolidated verification.
