# ZDEXCLOUD PHASE 15.5: ANDROID <-> DASHBOARD INTEGRATION REPORT

## 1. Executive Summary

- **Phase:** 15.5 - Cross-System Integration & Security Hardening (Android <-> Dashboard Integration)
- **Status:** PASS WITH DOCUMENTED LIMITATIONS
- **Target Systems:**
  - Android Flutter Application (`Android app/Android app code/lib/`)
  - Android Native Platform Engine (`Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/`)
  - Backend Control Plane (`main website/Backend/src/`)
  - Gateway WebSocket Server (`main website/Backend/src/gateway/`)
  - Authenticated Dashboard (`main website/Frontend/pages/servers.html`)
  - Embedded File Manager (`main website/Frontend/pages/file-manager.html`, `js/file-manager-embedded.js`)
- **Canonical Domain:** `https://zdexcloud.com`
- **Audit Outcome:**
  - The Android storage model remains authentic: files are physically hosted on the Android phone and served through an outbound encrypted WebSocket relay tunnel (`wss://gateway.zdexcloud.com`), requiring zero port forwarding or public IP exposure.
  - Device identity mapping is strictly enforced via persistent installation identity (`inst-<uuid>`) tied to authenticated accounts through compound unique keys (`userId_installationId`).
  - Multi-device boundaries and the 5-server instance limit per account are transactional and backed by database row locking (`SELECT id FROM User WHERE id = ? FOR UPDATE`).
  - Server lifecycle states (`STOPPED`, `STARTING`, `RUNNING`, `RECONNECTING`, `ERROR`, `OFFLINE`) are authoritatively derived via `CustomerStatusService.deriveCustomerStatus()`, avoiding stale heartbeat false positives.
  - File-manager routing resolves server identifiers to active device connections, enforces account ownership, issues an end-to-end `HEALTH` probe prior to session establishment, and safely proxies file operations to the phone-hosted engine.
  - Three in-scope files with forbidden em-dash characters were remediated.
  - TypeScript build (`npm run build`) in Backend passed with exit code 0.
  - Targeted Flutter analysis (`flutter analyze lib/features/device lib/features/server lib/features/remote`) passed with zero issues.
  - Full test suite was explicitly reserved for Phase 18.

---

## 2. Files and Services Inspected

### Android Application
- `Android app/Android app code/lib/core/config/app_config.dart`
- `Android app/Android app code/lib/features/device/domain/services/device_identity_service.dart`
- `Android app/Android app code/lib/features/device/data/datasources/device_remote_datasource.dart`
- `Android app/Android app code/lib/features/server/domain/services/server_service.dart`
- `Android app/Android app code/lib/features/remote/domain/services/remote_connection_service.dart`
- `Android app/Android app code/android/app/src/main/AndroidManifest.xml`
- `Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/MainActivity.kt`
- `Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeTunnelManager.kt`
- `Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeServerService.kt`
- `Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/LocalServerEngine.kt`
- `Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/NetworkWatcher.kt`

### Backend Control Plane & Gateway
- `main website/Backend/src/routes/device.ts`
- `main website/Backend/src/routes/server.ts`
- `main website/Backend/src/routes/connection.ts`
- `main website/Backend/src/routes/file-manager.ts`
- `main website/Backend/src/gateway/gateway_service.ts`
- `main website/Backend/src/services/customer_status_service.ts`
- `main website/Backend/src/services/connection_state_machine.ts`
- `main website/Backend/src/services/billing/entitlement_service.ts`
- `main website/Backend/src/middleware/customer-auth.ts`

### Authenticated Web Dashboard & File Manager
- `main website/Frontend/pages/servers.html`
- `main website/Frontend/pages/file-manager.html`
- `main website/Frontend/js/file-manager-embedded.js`
- `main website/Frontend/js/config.js`
- `main website/Frontend/js/auth.js`

---

## 3. Pre-Implementation Findings and Confirmed Defects

1. **Android Package & Code Location:**
   - Package name is verified as `net.remotenode.fileserver` in `AndroidManifest.xml` and Kotlin source files.
   - Android code resides at `Android app/Android app code/` (with Flutter `lib/` and native `android/app/src/main/kotlin/net/remotenode/fileserver/`).

2. **Storage Architecture Invariant:**
   - The Android phone is confirmed to host all physical user files in app-private or SAF storage (`LocalServerEngine.kt` binding to `127.0.0.1:8080`).
   - The web platform acts purely as an authenticated management plane and WebSocket relay. No public IP address or router port forwarding is required or expected.

3. **Confirmed Em-Dash Violations:**
   - `remote_connection_service.dart` line 16 contained an em-dash in a class doc comment.
   - `RemoteNodeTunnelManager.kt` lines 557 and 653 contained em-dashes in the user-visible status string `"ZdexCloud - Sign-in Required"`.
   - `RemoteNodeServerService.kt` line 262 contained an em-dash in notification text `"ZdexCloud - Device Authorization Required"`.
   - **Remediation:** Em-dashes were replaced with colons or hyphens (`"ZdexCloud: Sign-in Required"` and `"ZdexCloud: Device Authorization Required"`).

4. **Zero Localhost in Production:**
   - Production URLs correctly use `https://zdexcloud.com`, `https://api.zdexcloud.com/api/v1`, and `wss://gateway.zdexcloud.com`.
   - References to `127.0.0.1:8080` in backend metadata and Android code are restricted to internal phone loopback communications between `RemoteNodeTunnelManager` and `LocalServerEngine`.

---

## 4. End-to-End Account / Device / Server Identity Mapping

The complete mapping follows an unambiguous authoritative chain:

`Authenticated User Account -> Physical Installation -> Device Record -> ServerInstance Record -> DeviceConnection Record -> Dashboard Card -> File-Manager Access`

1. **Physical Device Identification:**
   - On the Android device, `MethodChannelDeviceIdentityService` resolves a stable installation identifier from Android SharedPreferences (`net.remotenode.device_identity`).
   - Format: `inst-<uuid>`. This identity survives app restarts, background eviction, and session logouts.
2. **Registration Idempotency (`POST /api/v1/devices/register`):**
   - The backend checks `prisma.device.findUnique({ where: { userId_installationId: { userId: user.id, installationId } } })`.
   - If the installation already exists for the authenticated user, it updates metadata (`deviceName`, `osVersion`, `appVersion`, `lastSeenAt`) without creating duplicate records.
   - If a new installation registers, a new `Device` record and linked `ServerInstance` record are created within a serialized database transaction.
3. **Multi-Device Support:**
   - Two physical phones logged into the same account generate different installation IDs and map to distinct `Device` records and distinct `ServerInstance` records.
   - Neither device can read, mutate, stop, or delete the other device's records.
4. **Credential Isolation:**
   - Every device receives an isolated, cryptographically generated `DeviceAuthCredential` (`generateSessionToken()`).
   - Device runtime access tokens (`dst_<deviceId>_<token>`) are scoped to the specific target device. `customer-auth.ts` verifies that `resolved.deviceScope.deviceId === options.requiredDeviceId`, denying cross-device escalation attempts.

---

## 5. Android Lifecycle and Dashboard State Synchronization Findings

### Authoritative State Meanings
- **`OFFLINE`:** Device has no active WebSocket connection on the gateway, and its heartbeat timestamp has expired (> 60 seconds).
- **`STOPPED`:** The server instance has been explicitly stopped by the user (either in the Android app via Server Mode toggle or through the web dashboard). Endpoints are marked `INACTIVE`, and active connections are evicted.
- **`STARTING` / `CONNECTING`:** Outbound tunnel connection is actively performing handshake negotiation or candidate gateway discovery.
- **`RECONNECTING`:** Tunnel connection was interrupted (e.g., cellular-to-Wi-Fi network handoff) and is undergoing auto-healing with bounded exponential backoff.
- **`ERROR`:** Authentication failure, suspended account, or invalid gateway state.
- **`ONLINE`:** Authoritative WebSocket session is active in memory on the gateway, or durable connection heartbeat is fresh (< 60 seconds), and the end-to-end local server engine is responsive.

### Dashboard Polling and Synchronization Safety (`servers.html`)
- **Tab Visibility Integration:** Polling halts when the tab is backgrounded (`document.hidden`). When the tab becomes visible (`visibilitychange`), an immediate refresh is triggered.
- **Monotonic Request Sequencing:** Every fetch increments `serverFetchSequence`. If an out-of-order response resolves after a newer request, it is discarded, preventing stale network responses from overwriting newer state.
- **Startup Protection:** The dashboard provides no fake web-side "Start" action. When a server is stopped, the card displays a "Start on Phone" button that opens guidance explaining how to toggle Server Mode in the Android app.
- **Remote Stop:** The dashboard provides a "Stop Server" action that calls `POST /api/v1/servers/:serverId/stop`, evicts the live gateway connection, marks connections `DISCONNECTED`, marks `ServerInstance` `STOPPED`, and updates the UI immediately.

---

## 6. Multi-Device Isolation and Subscription Capacity Enforcement Findings

1. **Transactional Row Locking:**
   - Both `POST /api/v1/devices/register` and `POST /api/v1/servers` acquire an exclusive row lock on the User record:
     `SELECT id FROM \`User\` WHERE id = ? FOR UPDATE`
   - This prevents race conditions where two simultaneous registrations could exceed the account's plan limit.
2. **Entitlement Limit Enforcement:**
   - `EntitlementService.resolveUserEntitlements(user.id)` resolves the plan's `maxServers` limit (default 1 for Free, up to 5 for multi-server plans).
   - If `serverCount >= entitlements.maxServers`, registration is rejected with `ConflictError('Your account has reached the maximum limit of X active servers.', 'MAX_SERVERS_REACHED')`.
3. **One Server per Device Invariant:**
   - Each physical device node supports at most one active `ServerInstance`. Re-registration idempotently updates the existing server instance on that device.
4. **Dashboard Slot Awareness:**
   - `servers.html` displays current capacity (`${currentServerCount} / ${maxServers} Servers`).
   - If `currentServerCount < maxServers`, a "Pair Another Phone" card is rendered. If capacity is reached, the pair prompt is suppressed.

---

## 7. Gateway Authentication and Reconnection Findings

1. **Outbound WSS Protocol:**
   - Android initiates outbound WebSocket connection to `wss://gateway.zdexcloud.com`.
   - Before opening the socket, Android calls `POST /api/v1/connections/register`, receiving a temporary single-use `connectionToken`.
   - On socket open, Android sends `{"type": "AUTH", "deviceId": devId, "connectionToken": connectionToken}`.
   - Gateway verifies token and device ownership via `PrismaTokenValidator`, marks connection `CONNECTED`, and confirms with `AUTH_SUCCESS`.
2. **Auto-Healing & Supervision:**
   - `RemoteNodeTunnelManager.kt` maintains a background supervisor tick every 30 seconds.
   - Detects black-holed sockets if pong responses lapse for > 45 seconds or after 3 missed pings.
   - Triggers automatic reconnect with bounded exponential backoff (1s, 2s, 4s, 8s, 16s, 32s, max 60s) with random jitter.
3. **Session Refresh via Device Credential:**
   - If a normal access session expires, `RemoteNodeTunnelManager` automatically calls `POST /api/v1/devices/:deviceId/session/refresh` using its persistent `DeviceAuthCredential` without prompting the user.
   - If the credential itself has been revoked, permanent auth failure is flagged, and the app transitions to `AUTH_FAILED` (`"ZdexCloud: Sign-in Required"`).

---

## 8. File-Manager Routing and Authorization Findings

1. **URL Construction:**
   - Dashboard card "Open File Manager" button links to:
     `file-manager.html?server=${encodeURIComponent(serverId)}`
   - `EmbeddedFileManager` in `file-manager-embedded.js` resolves `serverId` from query parameters (`?server=`, `?id=`, `?serverId=`).
2. **Access Verification (`GET /api/v1/file-manager/:serverId/access`):**
   - Resolves `ServerInstance` by `id` or `deviceId`.
   - Verifies ownership: `if (device.userId !== userId) throw new ForbiddenError(...)`.
   - Verifies operational status: fails closed if `serverInstance.status === 'STOPPED'`.
   - Verifies gateway connection: checks `defaultGatewayService.hasActiveConnectionForDevice(device.id)`.
   - Issues end-to-end `HEALTH` probe across the tunnel to the phone's `LocalServerEngine`.
   - If the probe succeeds, returns `{ ok: true, online: true }`.
3. **Proxied Operations:**
   - All file operations (`/storage`, `/files/recent`, `/files`, `/folders`, `/rename`, `/upload`, `/download`, `/files` [DELETE]) proxy through `defaultGatewayService.handleProxiedFileRequestByDeviceId(device.id, op, params)`.
   - File data is streamed or Base64-transferred between the gateway and Android phone.
   - Range requests (HTTP 206) are supported for media streaming with `Accept-Ranges: bytes`.
   - Path traversal attempts (`..`, `\0`) are strictly blocked at both the backend route layer and the Android `resolveSandboxPath` layer.

---

## 9. Files Modified and Reasons

| File | Modification Details | Reason |
| :--- | :--- | :--- |
| `Android app/Android app code/lib/features/remote/domain/services/remote_connection_service.dart` | Replaced em-dash with hyphen in `RemoteConnectionInfo` doc comment (line 16). | Enforce zero em-dash compliance standard. |
| `Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeTunnelManager.kt` | Replaced em-dashes with colons in `STATE_AUTH_FAILED` status strings (lines 557 and 653). | Enforce zero em-dash compliance standard and eliminate forbidden characters from error telemetry. |
| `Android app/Android app code/android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeServerService.kt` | Replaced em-dash with colon in foreground notification status string (line 262). | Enforce zero em-dash compliance standard in native notification presentation. |

---

## 10. Focused Verification Commands and Actual Results

### Backend TypeScript Compilation
- **Command:** `npm run build` (executed in `main website/Backend`)
- **Result:** Exited with code 0.
- **Output:** Prisma client generated successfully, `tsc -p tsconfig.json` compiled with zero diagnostic errors, distribution bundles built cleanly.

### Targeted Flutter Static Analysis
- **Command:** `flutter analyze lib/features/device lib/features/server lib/features/remote --no-pub` (executed in `Android app/Android app code`)
- **Result:** Exited with code 0.
- **Output:** `Analyzing 3 items... No issues found! (ran in 9.1s)`. Zero syntax, type, or lint errors in in-scope Android integration packages.

### Comprehensive Static Invariant Verification
- **Verification Script:** Evaluated multi-device compound key checks, transactional row locks (`FOR UPDATE`), entitlement checks, file-manager ownership boundaries, `HEALTH` probe, dashboard monotonic sequencing (`serverFetchSequence`), visibility awareness (`document.hidden`), and zero em-dash presence across all modified in-scope files.
- **Result:** `ALL PHASE 15.5 INVARIANTS VERIFIED!`

### Untested Paths
- Live physical Android hardware device execution (no physical Android phone connected in CI/CD environment).
- Production WebSocket tunnel live packet transmission against live cloud gateway nodes (requires live infrastructure deployment).
- Full browser Playwright automation suite (reserved for Phase 18).

---

## 11. Remaining Risks and Limitations

1. **Hardware Dependent Network Handoff:**
   - In production, aggressive OEM battery management (e.g., Xiaomi MIUI, Samsung OneUI) may terminate background foreground services despite `WAKE_LOCK` and battery optimization exemptions.
   - The app incorporates `RemoteNodeServerService` auto-restart and `NetworkWatcher` listeners, but users on strict battery-saver modes must be guided to exempt the app.
2. **Tunnel Bandwidth for Large File Streaming:**
   - Large file transfers (> 100 MB) over Base64-encoded WebSocket messages introduce memory overhead. Direct streaming chunks are supported for range requests, but very large multi-gigabyte files require stable network conditions.
3. **Local Storage Permission Contract:**
   - On Android 13+ (API 33+), granular media permissions (`READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`) apply. The app handles storage readiness, but revoked permissions trigger `Android Storage Permission Required` error overlays in the dashboard file manager.

---

## 12. Explicit Confirmation on Test Suite Execution

In strict accordance with Phase 15 constraints:
- **The full test suite was NOT run.**
- Vitest full-suite test runs and Playwright end-to-end browser suites remain reserved for **Phase 18 (Full System Verification & Regression Testing)**.
- Only focused static checks, targeted TypeScript compilation, targeted Flutter analysis, and custom invariant scripts were executed.

---

## 13. Recommendation for Phase 15.6: Gateway Security Review

Prior to concluding Phase 15, conduct a dedicated Gateway Security Review in Phase 15.6 focused on:
1. Validating token entropy and expiration intervals for single-use connection tokens.
2. Auditing WebSocket frame payload limits and defenses against denial-of-service / buffer exhaustion attacks.
3. Verifying that connection eviction and monotonic session epoch incrementation prevent stale socket resurrection across edge network splits.
4. Ensuring that rate limiting on `/connections/register` and file-manager proxy routes resists brute-force scanning.
