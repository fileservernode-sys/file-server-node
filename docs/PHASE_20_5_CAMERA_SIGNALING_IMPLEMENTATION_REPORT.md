# ZdexCloud — Phase 20.5 Implementation Report
## Camera Signaling, Session Negotiation & ICE Exchange

- **Roadmap Phase:** Phase 20 — Camera Backend & Infrastructure
- **Batch:** 20.5 — Camera Signaling, Session Negotiation & ICE Exchange
- **Status:** Implementation Complete (Tests Created — Execution Deferred to Phase 28)
- **Database Migrations:** None required (existing Phase 20.1–20.4 Prisma schema satisfies all signaling and audit requirements)

---

## 1. Objective & Architectural Separation

Phase 20.5 establishes the isolated WebRTC signaling control plane enabling authenticated ZdexCloud Android Camera devices and authorized browser viewers to coordinate session negotiation (`SESSION_INITIATE`, `WEBRTC_OFFER`, `WEBRTC_ANSWER`, `ICE_CANDIDATE`, `SESSION_RESTART`, `NEGOTIATION_FAILED`, `SESSION_TERMINATE`) before media transport occurs in future WebRTC phases.

Signaling remains strictly separated from:
1. **Media Transport / STUN / TURN / SFU**: No binary frames, audio/video buffers, Coturn relays, or SFU routers are added or permitted on the signaling channel.
2. **Storage File Gateway (`GatewayService`)**: Storage `DeviceConnection` tokens, `FILE_REQUEST` / 10 MB file chunking, `hostnameToConnectionMap`, and `ConnectionStateMachine` remain completely isolated from Camera signaling.

---

## 2. Pre-Implementation Storage Gateway Audit & Path Isolation

Auditing `src/gateway/gateway_service.ts` showed that Storage `GatewayService.attachToHttpServer(httpServer)` previously initialized `new WebSocketServer({ server: httpServer })` with no URL path filter, which would intercept all HTTP `Upgrade` requests across the backend process, and used `PrismaTokenValidator` scoped exclusively to Storage `DeviceConnection` records.

To preserve Storage Gateway transport unchanged while hosting Camera signaling cleanly on the same HTTP server:
- `GatewayService.attachToHttpServer(httpServer, excludedPaths?)` now configures `new WebSocketServer({ noServer: true, maxPayload })` and attaches a managed `httpUpgradeHandler` that skips requests targeting `CAMERA_SIGNALING_PATH` (`/ws/camera-signaling`).
- `GatewayService` now tracks `ownsHttpServer` (`true` in standalone `start()`, `false` in `attachToHttpServer()`), detaches its `upgrade` listener in `stop()`, and avoids closing Fastify's shared `http.Server` prematurely.
- `CameraSignalingService` attaches its own dedicated `WebSocketServer({ noServer: true, maxPayload })` listening strictly on `CAMERA_SIGNALING_PATH` (`/ws/camera-signaling`).

---

## 3. Environment Configuration (`src/config/env.ts`)

Added validated runtime settings to `envSchema`:
- `CAMERA_SIGNALING_PATH` (default: `'/ws/camera-signaling'`)
- `CAMERA_SIGNALING_MAX_PAYLOAD_BYTES` (int, `4096..262144`, default: `65536`)
- `CAMERA_SIGNALING_AUTH_TIMEOUT_MS` (int, `1000..60000`, default: `10000`)
- `CAMERA_SIGNALING_RATE_LIMIT_PER_MIN` (int, `10..10000`, default: `240`)
- `CAMERA_SIGNALING_MAX_VIEWERS_PER_CAMERA` (int, `1..100`, default: `5`)
- `CAMERA_SIGNALING_REAPER_INTERVAL_MS` (int, `1000..300000`, default: `30000`)

---

## 4. Database & Schema Assessment

No schema modifications or SQL migrations were needed:
- `CameraStreamSession` provides `id`, `cameraInstanceId`, `viewerUserId`, `sessionTokenHash`, `status` (`INITIATED | NEGOTIATING | ACTIVE | ENDED | FAILED | TIMED_OUT | REVOKED`), `transportType`, `protocol`, `startedAt`, `endedAt`, `expiresAt`, and `terminationReason`.
- `CameraInstance` provides `userId`, `deviceId`, `status`, and `lastSeenAt`.
- `CameraAccessAuditEvent` provides `SIGNALING_AUTHENTICATED`, `SIGNALING_AUTH_FAILED`, `VIEWING_ACCESS_DENIED`, and `VIEWING_SESSION_ENDED`.

---

## 5. Versioned Signaling Protocol (`version: "1.0"`)

All frames are strictly validated UTF-8 JSON objects carrying `version: "1.0"`:
- **Handshake / Heartbeat**: `SIGNALING_AUTH`, `SIGNALING_AUTH_OK`, `PING`, `PONG`, `SIGNALING_ERROR`, `SIGNALING_DISCONNECTED`.
- **Negotiation & Control**: `SESSION_INITIATE` (`VIEWER`-only), `WEBRTC_OFFER` (`sdpType: 'offer'`, max `32768` bytes), `WEBRTC_ANSWER` (`sdpType: 'answer'`, max `32768` bytes), `ICE_CANDIDATE` (max `4096` bytes), `SESSION_RESTART`, `NEGOTIATION_FAILED`, `SESSION_TERMINATE`, `PEER_DISCONNECTED`.
- **Forbidden Media / Storage Payloads**: Binary WebSocket frames (`1003` / `BINARY_FRAMES_NOT_SUPPORTED`) and keys associated with file/media byte transfer (`dataBase64`, `binaryPayload`, `chunk`, `chunkIndex`, `totalChunks`, `fileData`, `filePath`, `mediaFrame`, `videoFrame`, `audioFrame`) are rejected with `MEDIA_PAYLOAD_FORBIDDEN`.

---

## 6. Participant Authentication & Existing Auth Reuse

No parallel identity or credential store was introduced:
1. **Camera Device Authentication (`role: "CAMERA"`)**:
   - Extracts device credential from `SIGNALING_AUTH.credential` or HTTP Upgrade `Authorization` / `x-device-credential` headers (failing closed if dual conflicting credentials are supplied).
   - Delegates verification to `CameraLifecycleService.authenticateDeviceRequest(...)`, validating active `DeviceAuthCredential`, revocation (`revokedAt`), `DeviceInstallationClaim` active ownership, and `UserStatus.ACTIVE`.
   - Verifies target `CameraInstance` exists, belongs to `authDevice.userId`, and matches `camera.deviceId === authDevice.deviceId`.
2. **Viewer Authentication (`role: "VIEWER"`)**:
   - Extracts ephemeral token from `SIGNALING_AUTH.viewingToken` or HTTP Upgrade headers (failing closed on conflicts).
   - Delegates validation to `CameraService.validateViewingToken(rawToken, { expectedCameraId })`, verifying SHA-256 token hash, non-null `expiresAt > now`, active `CameraStreamSession` status, ownership, and active `EntitlementService.resolveUserEntitlements(...)` camera streaming entitlement.
   - Enforces optional `sessionId` match and `CAMERA_SIGNALING_MAX_VIEWERS_PER_CAMERA` concurrent viewer ceiling (while allowing seamless reconnection for an already-active `sessionId`).

---

## 7. Authorization, Multi-Viewer Isolation & Reconnect Safety

- **Per-Message Verification**: Every post-auth message checks monotonic socket epoch (`STALE_SIGNALING_CONNECTION`), sliding-window rate limits (`SIGNALING_RATE_LIMITED`), authenticated `cameraId` and `sessionId` bindings (`CAMERA_MISMATCH`, `VIEWER_SESSION_MISMATCH`), live `CameraStreamSession` status/expiry/ownership/entitlement in MySQL, and active device-to-camera binding.
- **Role & Offer/Answer State Guards**:
  - Only `VIEWER` connections may emit `SESSION_INITIATE`.
  - `WEBRTC_ANSWER` requires an active prior `WEBRTC_OFFER` on the same `sessionId` submitted by the opposite participant role (`MISSING_ACTIVE_OFFER`, `INVALID_SIGNALING_STATE`).
- **Multi-Viewer & Multi-Camera Isolation**: Viewers are indexed independently by `sessionId` and cameras by `cameraId`. Messages for `sess_A` on `cam_1` never propagate to `sess_B` or `cam_2`.
- **Monotonic Epoch Eviction**: Reconnecting a `CAMERA` (for a `cameraId`) or `VIEWER` (for a `sessionId`) increments `cameraEpochMap` / `viewerEpochMap`, evicts the superseded socket (`4409` / `SESSION_SUPERSEDED`), and ensures delayed close events or late frames from an evicted socket never drop the replacement connection.

---

## 8. Camera vs. Session Lifecycle Separation & Reaper Behavior

- Exchanging `SESSION_INITIATE`, `WEBRTC_OFFER`, `WEBRTC_ANSWER`, or `ICE_CANDIDATE` moves `CameraStreamSession.status` from `INITIATED` to `NEGOTIATING` via conditional update, but **never** automatically promotes physical `CameraInstance.status` to `STREAMING` (device-confirmed capture reports in Phase 20.4 remain authoritative).
- A temporary `VIEWER` WebSocket disconnect notifies the `CAMERA` socket via `PEER_DISCONNECTED` (`temporary: true`) scoped to that `sessionId` without touching other viewers or marking physical `CameraInstance.status = OFFLINE`.
- `SESSION_TERMINATE`, `NEGOTIATION_FAILED`, and timed-out sessions update `CameraStreamSession` atomically inside `prisma.$transaction`, call `CameraLifecycleService.reconcileCameraStreamingStateWithTx` (`STREAMING -> ONLINE` only when no active viewer sessions remain; never `OFFLINE`), and persist `VIEWING_SESSION_ENDED` audit records.
- `CameraService.revokeViewingSession` notifies `defaultCameraSignalingService.notifySessionRevoked(sessionId, reason)` after DB commit so live revoked viewer sockets disconnect immediately (`4403`) and the camera is notified.
- A periodic reaper (`CAMERA_SIGNALING_REAPER_INTERVAL_MS`) closes unauthenticated sockets past `authTimeoutMs` and terminates live viewer sockets whose `CameraStreamSession.expiresAt` has elapsed (`TIMED_OUT`).

---

## 9. REST Endpoints & Lifecycle Wiring

- **`src/routes/camera.ts`**:
  - `GET /api/v1/cameras/:cameraId/signaling` — Owner-authenticated endpoint returning non-secret signaling metadata (`signalingPath`, `protocolVersion`, `cameraConnected`, `connectedAt`, `lastHeartbeatAt`, `activeViewerConnections`, `maxViewersPerCamera`).
  - `POST /api/v1/cameras/:cameraId/sessions/:sessionId/revoke` — Owner-authenticated endpoint delegating to `CameraService.revokeViewingSession(..., { expectedCameraId })`.
- **`src/services/camera_service.ts`**:
  - `ViewingTokenResult` now includes `signalingPath: config.CAMERA_SIGNALING_PATH`.
  - `revokeViewingSession` triggers live signaling socket teardown on commit and validates `expectedCameraId` when provided.
- **`src/server.ts`**:
  - Attaches `defaultCameraSignalingService.attachToHttpServer(app.server)` after `defaultGatewayService.attachToHttpServer(app.server)` and stops both cleanly inside `shutdown()` prior to Fastify `app.close()` and database disconnect.

---

## 10. Secret-Zero Logging & Fail-Closed Auditing

- Raw SDP bodies, ICE candidate strings, `viewingToken` values, and `DeviceAuthCredential` secrets are never logged to `appLogger` or stored in `CameraAccessAuditEvent.metadata`.
- Security failures (`SIGNALING_AUTH_FAILED`, `VIEWING_ACCESS_DENIED`) persist `CameraAccessAuditEvent` records fail-closed; if audit persistence fails during authentication, the socket is denied (`AUDIT_PERSISTENCE_FAILED`, `4500`) and closed unconditionally.
- Auth failure auditing performs an existence check (`prisma.cameraInstance.findUnique({ select: { id: true } })`) so unknown/forged `cameraId` claims do not violate foreign keys (`cameraInstanceId: null` with `claimedCameraId` in sanitized metadata).

---

## 11. Known Multi-Instance Architecture Boundary

- All `CameraStreamSession` authorization state, `expiresAt`, revocation, ownership, and audit records are persisted in MySQL and re-evaluated on every signaling interaction.
- In-memory WebSocket connection maps (`cameraConnections`, `viewerConnections`) are process-local (matching Storage `GatewayService`). Horizontal scaling beyond a single Node instance will require sticky WebSocket routing by `cameraId` or adding a Redis Pub/Sub cross-node relay adapter in a future horizontal-scaling phase.

---

## 12. Modified & Created Files

| File | Action | Purpose |
| --- | --- | --- |
| `main website/Backend/src/config/env.ts` | Modified | Added `CAMERA_SIGNALING_*` config variables |
| `main website/Backend/src/gateway/gateway_service.ts` | Modified | Switched `attachToHttpServer` to `noServer` + `/ws/camera-signaling` exclusion and safe `ownsHttpServer` tracking |
| `main website/Backend/src/services/camera_signaling_service.ts` | Created | Isolated WebRTC signaling server, protocol validation, auth reuse, routing, epoch eviction, reaper |
| `main website/Backend/src/services/camera_service.ts` | Modified | Exposed `signalingPath` on viewing tokens; live signaling disconnect + `expectedCameraId` on revocation |
| `main website/Backend/src/routes/camera.ts` | Modified | Added `GET /api/v1/cameras/:cameraId/signaling` and `POST /api/v1/cameras/:cameraId/sessions/:sessionId/revoke` |
| `main website/Backend/src/server.ts` | Modified | Wired `defaultCameraSignalingService` startup attachment and graceful shutdown |
| `main website/Backend/tests/camera_signaling.test.ts` | Created | 22-test WebSocket & REST signaling specification suite |
| `docs/PHASE_20_5_CAMERA_SIGNALING_IMPLEMENTATION_REPORT.md` | Created | Phase 20.5 technical implementation report |

---

## 13. Deferred Testing Status

- **Execution Status:** `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`
- Per Phase 20.5 policy, no unit/integration tests, TypeScript builds, or database migrations were executed.
