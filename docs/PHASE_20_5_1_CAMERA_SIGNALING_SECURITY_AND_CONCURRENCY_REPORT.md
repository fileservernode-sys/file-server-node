# ZdexCloud — Phase 20.5.1 Implementation Report
## Corrective Security Audit & Hardening: WebSocket Origin Security, Viewer Concurrency & Gateway Isolation

- **Parent Phase:** Phase 20.5 — Camera Signaling, Session Negotiation & ICE Exchange
- **Execution Mode:** Focused Security Audit & Corrective Implementation
- **Status:** Complete (Tests Written — Execution Deferred to Phase 28)
- **Database Migrations:** None (zero schema changes or remote DB mutations)

---

## 1. Actual Source Files Inspected

Before modifying code, the following source files were directly inspected:
- `main website/Backend/src/services/camera_signaling_service.ts`
- `main website/Backend/src/gateway/gateway_service.ts`
- `main website/Backend/src/gateway/gateway_config.ts`
- `main website/Backend/src/config/env.ts`
- `main website/Backend/src/config/env_validator.ts`
- `main website/Backend/src/app.ts`
- `main website/Backend/src/server.ts`
- `main website/Backend/src/middleware/security.ts`
- `main website/Backend/src/utils/security.ts`
- `main website/Backend/src/routes/connection.ts`
- `main website/Backend/tests/gateway.test.ts`
- `main website/Backend/tests/camera_signaling.test.ts`
- `main website/Frontend/js/config.js`
- `main website/Frontend/file-manager-assets/js/api.js`
- `Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeTunnelManager.kt`

---

## 2. Static Inspection Findings (Pre-Hardening Gaps Identified)

Inspecting the actual code rather than relying on the Phase 20.5 summary revealed four concrete gaps:
1. **Missing WebSocket `Origin` and `wss://` Enforcement**: `CameraSignalingService.attachToHttpServer()` upgraded all `/ws/camera-signaling` requests without checking the `Origin` header, TLS status, or trusted reverse-proxy `X-Forwarded-Proto` constraints.
2. **TOCTOU Race on `CAMERA_SIGNALING_MAX_VIEWERS_PER_CAMERA`**: `authenticateViewerSocket()` checked `this.countLiveViewersForCamera(...) < maxViewersPerCamera`, awaited `CameraService.recordAuditEvent(...)`, and only inserted into `this.viewerConnections` afterward — permitting concurrent handshakes to slip past the ceiling together before any connection was registered.
3. **Permissive Unknown Upgrade Path Acceptance in Storage Gateway**: `GatewayService.attachToHttpServer()` skipped only `excludedPaths` (`/ws/camera-signaling`) and upgraded any other arbitrary path (e.g. `/unknown/ws`) rather than strictly scoping upgrades to actual Storage paths (`/`, `/tunnel`, `/ws`) and rejecting unknown paths cleanly.
4. **Environment Validation Coverage**: `env_validator.ts` had no startup checks banning wildcard (`*`) browser origins or `http://` / TLS-disabled configurations for Camera signaling in production.

---

## 3. Origin Validation Design & Trusted-Origin Configuration

Implemented in `main website/Backend/src/utils/ws_upgrade_security.ts`, `src/config/env.ts`, `src/config/env_validator.ts`, and `src/services/camera_signaling_service.ts`:
- **Environment Allowlist**:
  - Added `CAMERA_SIGNALING_ALLOWED_ORIGINS` to `envSchema`. When unset/empty, `buildAllowedBrowserOrigins` derives exact normalized origins from explicit non-wildcard entries in `CORS_ORIGIN` and `FRONTEND_URL`.
  - `validateEnvironment` rejects any wildcard (`*`) or malformed entry in `CAMERA_SIGNALING_ALLOWED_ORIGINS`, and forbids non-`https://` entries in `NODE_ENV === 'production'`.
- **Exact Origin Normalization (`normalizeExactOrigin` & `isExactBrowserOriginAllowed`)**:
  - Rejects `null`, wildcards (`*`), trailing slashes, embedded paths/queries/hashes, userinfo (`user@host`), whitespace/commas, or schemes other than `http:`/`https:`.
  - Uses exact `Set.has(normalizedOrigin)` equality (no substring or suffix matching).
  - In `production`/`staging`, HTTP origins are strictly forbidden (`https://` only); in `development`/`test`, allowlisted HTTP origins such as `http://localhost:3000` remain usable.
- **Browser vs. Native Android Camera Differentiation**:
  - If an `Origin` header is present on the HTTP Upgrade handshake, it is validated immediately during handshake (`403 ORIGIN_NOT_ALLOWED`, `socket.destroy()` before `wss.handleUpgrade`).
  - If `Origin` is absent AND browser/viewer indicators exist (`sec-fetch-site`, `sec-fetch-mode`, `sec-fetch-dest`, `cookie`, or `?role=viewer`), the handshake is rejected immediately (`403 ORIGIN_REQUIRED`).
  - Native Android Camera clients connecting without `Origin` and without browser indicators are permitted through Upgrade and must still pass full device authentication (`CameraLifecycleService.authenticateDeviceRequest` + `CameraInstance` ownership + device binding).
  - Inside `authenticateViewerSocket`, `role === 'VIEWER'` unconditionally requires `pending.hasValidBrowserOrigin === true` (`4403 ORIGIN_REQUIRED` + critical `SIGNALING_AUTH_FAILED` audit), preventing a non-browser script without `Origin` from impersonating a browser viewer.

---

## 4. Secure Transport & Reverse-Proxy Handling

- Added `CAMERA_SIGNALING_REQUIRE_TLS` (defaults to `true` when `NODE_ENV === 'production' || NODE_ENV === 'staging'`, `false` in `development`/`test`, and forbidden from being set `false` in production by `env_validator.ts`).
- Implemented `isTrustedProxyIp` and `isSecureUpgradeRequest` in `src/utils/ws_upgrade_security.ts` matching the backend's existing `TRUST_PROXY` semantics (`loopback`, `linklocal`, `uniquelocal`, exact IPs, IPv4/IPv6 CIDRs, `'true'`/`'false'`).
- On HTTP Upgrade:
  - Direct TLS (`req.socket.encrypted === true`) is trusted.
  - Plaintext HTTP upgrades from `127.0.0.1` / loopback or private proxy IPs trust `X-Forwarded-Proto: https` (or RFC 7239 `Forwarded: ...;proto=https`, rejecting mixed values like `http, https`) **only when `req.socket.remoteAddress` matches `TRUST_PROXY`**.
  - Arbitrary client-supplied `X-Forwarded-Proto: https` from untrusted peer IPs is ignored, rejecting insecure `ws://` handshakes with `403 TLS_REQUIRED`.
- No raw tokens, credentials, SDP, ICE payloads, or cookie values are ever logged or echoed in handshake error bodies.

---

## 5. Viewer-Capacity Concurrency Analysis, Reservation Lifecycle & Cleanup

- Replaced the non-atomic async check-then-insert with a synchronous per-camera reservation structure:
  - `cameraViewerSlots: Map<cameraId, Map<sessionId, Set<connectionId>>>`
  - `socketSlotReservation: Map<connectionId, { cameraId, sessionId }>`
- **Atomic Acquire (`tryAcquireViewerSlot`)**: Runs synchronously immediately after `CameraService.validateViewingToken` resolves (zero `await` between check and insert):
  - If `sessionId` is already present in `cameraViewerSlots.get(cameraId)`, `connectionId` is added to the existing `Set<connectionId>` (reconnection never consumes a second slot and `size` stays invariant).
  - If `sessionId` is new and `camSlots.size >= maxViewersPerCamera`, the handshake is rejected with `VIEWER_CAPACITY_EXCEEDED` without consuming a slot.
  - Otherwise `camSlots.set(sessionId, new Set([connectionId]))` synchronously reserves the slot **before** `await CameraService.recordAuditEvent(...)` and before `viewerConnections.set(...)`.
- **Idempotent Connection-Scoped Cleanup (`releaseViewerSlot`)**:
  - Invoked on auth failure (`catch` block), mid-auth socket close (`pending.isClosed` post-`await` check + `handleSocketClosed`), terminal disconnect/eviction/revocation (`evictConnection`, `detachViewerSessionOnly`, `closeViewerOnTerminalSession`, `notifySessionRevoked`), and `stop()`.
  - Deletes ONLY its own `connectionId` from `Set<connectionId>`; only removes `sessionId` when the set becomes empty (`size === 0`). Thus, evicted old socket cleanup never frees a replacement connection's slot, unauthenticated pending sockets never consume capacity, and different cameras (`cameraId`) stay strictly independent.

---

## 6. Storage/Camera Upgrade Routing, Shared HTTP Server Ownership & Shutdown

Inspected both `GatewayService` and `CameraSignalingService` against `src/gateway/web/js/api.js`, `Frontend/js/config.js`, `src/routes/connection.ts` (`/tunnel`), and `tests/gateway.test.ts` (`/`):
- **Path Routing**:
  - `GatewayService.attachToHttpServer()` now accepts ONLY Storage WebSocket paths (`/`, `/tunnel`, `/ws`) while explicitly excluding `CAMERA_SIGNALING_PATH` (`/ws/camera-signaling`).
  - `CameraSignalingService.attachToHttpServer()` handles ONLY `CAMERA_SIGNALING_PATH` (`/ws/camera-signaling`).
  - Shared `markUpgradeHandled(req)` and `scheduleUnhandledUpgradeRejection(req, socket)` ensure: (a) at most one WebSocket server claims each Upgrade request, and (b) unknown paths (or a path whose owning service has been stopped) deterministically return `404 WS_PATH_NOT_FOUND` and destroy the socket.
- **Independent Shutdown & Shared Server Safety**:
  - `GatewayService` uses `ownsHttpServer` (`false` in `attachToHttpServer`, `true` only in standalone `start()`) and `off('upgrade', this.httpUpgradeHandler)` — stopping `GatewayService` never stops `CameraSignalingService` and never closes Fastify's shared `http.Server`.
  - `CameraSignalingService` never closes `this.httpServer` and removes only `this.upgradeHandler` via `httpServer.off('upgrade', this.upgradeHandler)` — stopping `CameraSignalingService` never stops `GatewayService`.
  - Both services guard repeated `attachToHttpServer` calls and track `stopPromise` for idempotent concurrent `stop()`.

---

## 7. Epoch & Multi-Instance Deployment Boundary

- `cameraEpochMap` (`cameraId -> number`) and `viewerEpochMap` (`sessionId -> number`) enforce monotonic session supersession inside a Node signaling process: delayed frames from evicted sockets fail `isConnectionAuthoritative()` (`STALE_SIGNALING_CONNECTION`), and delayed `close` events verify `epoch` before deleting connection entries and `connectionId` before releasing slot reservations.
- **Process-Local Deployment Boundary**: WebSocket connection maps, monotonic epochs, and per-camera viewer slot reservations are **process-local in memory** (matching Storage `GatewayService`).
- **Required Production Topology**: Current deployment requires either **a single Camera signaling Node instance** OR **sticky L7 WebSocket routing keyed cleanly (e.g., all traffic for a `cameraId` routed to the same signaling instance)**. Cross-replica WebSocket eviction, cross-replica signaling delivery, and cluster-wide `maxViewersPerCamera` ceilings across uncoordinated replicas do **not** exist in Phase 20.5.1 and would require a dedicated external Pub/Sub + shared counter broker in a future horizontal-scaling phase.

---

## 8. Files Created & Modified

| File | Action | Purpose |
| --- | --- | --- |
| `main website/Backend/src/utils/ws_upgrade_security.ts` | Created | Exact Origin allowlist parsing/validation, `TRUST_PROXY` CIDR/IP matcher, TLS/forwarded-proto check, shared Upgrade routing symbols |
| `main website/Backend/src/config/env.ts` | Modified | Added `CAMERA_SIGNALING_ALLOWED_ORIGINS` and `CAMERA_SIGNALING_REQUIRE_TLS` |
| `main website/Backend/src/config/env_validator.ts` | Modified | Added production & wildcard validation for Camera signaling origins and TLS requirement |
| `main website/Backend/src/gateway/gateway_service.ts` | Modified | Scoped `attachToHttpServer` to `/`, `/tunnel`, `/ws` (excluding Camera signaling), unknown-path rejection coordination, idempotent `stopPromise` |
| `main website/Backend/src/services/camera_signaling_service.ts` | Modified | Enforced Origin & TLS handshake checks, viewer origin requirement, atomic per-camera viewer slot reservations, idempotent shutdown |
| `main website/Backend/tests/camera_signaling.test.ts` | Modified | Added Phase 20.5.1 tests (Tests 23–29) covering all Origin, TLS/proxy, concurrency race, isolation, shutdown, epoch, and revocation cases |
| `docs/PHASE_20_5_1_CAMERA_SIGNALING_SECURITY_AND_CONCURRENCY_REPORT.md` | Created | Corrective review and hardening implementation report |

---

## 9. Tests Written & Deferred Execution Status

- All Phase 20.5 and Phase 20.5.1 tests are located in `main website/Backend/tests/camera_signaling.test.ts` (Tests 1–29), covering:
  - Origin allowlist, untrusted/suffix/wildcard/malformed/missing Origin rejection, and native Android Camera non-Origin compatibility.
  - Trusted-proxy `X-Forwarded-Proto` handling vs. untrusted-peer spoofing rejection + `env_validator.ts` production guards.
  - Concurrent `Promise.all` handshake race prevention, auth/handshake/close reservation cleanup, reconnection slot reuse, independent per-camera limits, and unauthenticated socket exclusion.
  - Storage (`/`, `/tunnel`) and Camera (`/ws/camera-signaling`) upgrade isolation, `404` unknown path rejection, independent stop/restart, shared HTTP server preservation, and non-duplicated `'upgrade'` listeners.
  - Stale epoch eviction/cleanup preservation and targeted single-session revocation.
- **Test Execution Status:** `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`

---

## 10. Scope & Verification Confirmations

- **Zero deployments, restarts, builds, test executions, or remote database mutations** were performed.
- **Phase 21 and Phase 22 remain completely untouched**; scope stayed strictly within Phase 20.5.1 signaling security, concurrency hardening, and Storage/Camera gateway upgrade isolation.
