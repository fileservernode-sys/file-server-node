# PHASE 11A — BATCH 11A.1
# GATEWAY & CONNECTION ARCHITECTURE AUDIT & READ-ONLY RELIABILITY BASELINE
# AUTHORITATIVE REPORT

**Date:** 2026-09-30  
**Phase:** 11A — Gateway Reliability & Self-Healing  
**Batch:** 11A.1 — Gateway & Connection Architecture Audit (Read-Only Reliability Baseline)  
**Execution Mode:** STRICT READ-ONLY AUDIT (Zero Production Code Changes)  
**Test Policy Status:** Tests Executed: NONE (Mandatory Zero-Test Policy Observed)  

---

## 1. EXECUTIVE SUMMARY & SCOPE BOUNDARY

This document constitutes the authoritative, 100% repository-grounded engineering audit for **Phase 11A — Batch 11A.1**. The purpose of this audit is to map, analyze, and document the complete end-to-end gateway and remote connection architecture of ZdexCloud across all three primary tiers:
1. **Android Client Layer (Native Kotlin & Flutter Dart VM)**: Foreground service lifecycle, local server loopback daemon, WakeLocks, background execution, and remote WebSocket connection client.
2. **Backend Gateway & Relay Service**: Edge WebSocket terminating proxy, HTTP reverse proxy for `*.remotenode.net` / `*.zdexcloud.com`, session router, RPC multiplexer, and large-file streaming pipeline.
3. **Control Plane & Database Model**: REST API registration endpoints, heartbeat trackers, session persistence, device/server state synchronization, and audit event producers.

### Strict Scope Boundaries
- **No Code Modifications**: Batch 11A.1 is strictly read-only. No application source code, configuration files, or database schemas have been altered.
- **No Speculative Implementations**: The reconnection engine refactor, native service migration, and architectural redesigns are scheduled for subsequent Phase 11A batches (11A.2+).
- **Mandatory Test Policy**: In accordance with the explicit batch directives, no unit, integration, or live tests were executed during this baseline audit.

---

## 2. ARCHITECTURAL TOPOGRAPHY & COMPONENT INVENTORY

The ZdexCloud remote access architecture bridges external web/client requests to personal Android storage devices via a multi-tier relay and reverse-proxy topography:

```
+----------------------------------------------------------------------------------------------------+
|                                           REMOTE CLIENT                                            |
|                                (Web Browser / REST API / Mobile App)                               |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  │ HTTPS / WSS
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                      ZDEXCLOUD BACKEND GATEWAY                                     |
|                                                                                                    |
|  [Fastify Control Plane]          [Gateway WebSocket Server]         [HTTP Reverse Proxy / Subdomain]  |
|  - POST /connections/register    - ActiveConnections Map (connId)   - *.remotenode.net router       |
|  - POST /connections/heartbeat   - DeviceToConnection Map           - PendingRequests RPC map       |
|  - Prisma Database Sync          - Sliding Rate Limiter             - ActiveTransfers Stream map    |
+----------------------------------------------------------------------------------------------------+
                                                  ▲
                                                  │ WSS Outbound Persistent Tunnel (AUTH, PING, RPC)
                                                  │
+----------------------------------------------------------------------------------------------------+
|                                    ANDROID MOBILE DEVICE (EDGE NODE)                               |
|                                                                                                    |
|  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐  |
|  │ FLUTTER DART VM ISOLATE                                                                      │  |
|  │ - HttpRemoteConnectionService (Lifecycle, Exponential Backoff Reconnect, RPC Dispatcher)     │  |
|  │ - WebSocketRemoteTransport (dart:io WebSocket, Ping Interval 10s, Failover Candidate URLs)   │  |
|  │ - RemoteNodeClient (HTTP loopback client -> 127.0.0.1:8080)                                  │  |
|  └──────────────────────────────────────────────────────────────────────────────────────────────┘  |
|                                                 │ Loopback HTTP Requests (127.0.0.1:8080)          |
|                                                 ▼                                                  |
|  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐  |
|  │ ANDROID NATIVE KOTLIN LAYER (Process / Foreground Service)                                   │  |
|  │ - RemoteNodeServerService (Foreground Service with specialUse type, Partial WakeLock)        │  |
|  │ - LocalServerEngine (Embedded ServerSocket HTTP Server on 127.0.0.1:8080)                    │  |
|  │ - BootReceiver (AUTO-START on BOOT_COMPLETED & QUICKBOOT_POWERON)                            │  |
|  │ - MainActivity (MethodChannel "net.remotenode.fileserver/server_engine")                     │  |
|  └──────────────────────────────────────────────────────────────────────────────────────────────┘  |
+----------------------------------------------------------------------------------------------------+
```

### Component Inventory Table
| Component | Layer / Language | Key Source Files | Primary Responsibility |
|---|---|---|---|
| `RemoteNodeServerService` | Android / Kotlin | `android/app/src/main/kotlin/.../RemoteNodeServerService.kt` | Foreground service lifecycle, partial WakeLock management, foreground notification. |
| `LocalServerEngine` | Android / Kotlin | `android/app/src/main/kotlin/.../LocalServerEngine.kt` | Embedded HTTP server (`ServerSocket`) serving local file endpoints on `127.0.0.1:8080`. |
| `BootReceiver` | Android / Kotlin | `android/app/src/main/kotlin/.../BootReceiver.kt` | Broadcast receiver listening for device boot to auto-restart the foreground service. |
| `MainActivity` | Android / Kotlin | `android/app/src/main/kotlin/.../MainActivity.kt` | MethodChannel bridge between Flutter and native service / power management. |
| `HttpRemoteConnectionService` | Flutter / Dart | `lib/features/remote/domain/services/remote_connection_service.dart` | Remote tunnel manager: registration, WebSocket connection, RPC proxying, reconnect loops. |
| `WebSocketRemoteTransport` | Flutter / Dart | `lib/features/remote/domain/services/remote_transport.dart` | Low-level `dart:io` WebSocket transport, socket pinging, failover URL iteration. |
| `GatewayService` | Backend / TypeScript | `src/gateway/gateway_service.ts` | WebSocket server, connection router, Fastify proxy integration, streaming manager. |
| `GatewayConfig` | Backend / TypeScript | `src/gateway/gateway_config.ts` | Configuration loader, validation schema (Zod), environment overrides. |
| `ConnectionRoutes` | Backend / TypeScript | `src/routes/connection.ts` | REST endpoints for connection registration, heartbeats, status queries, and disconnects. |

---

## 3. ANDROID NATIVE FOREGROUND SERVICE & LIFECYCLE ARCHITECTURE

### Implementation Details (`RemoteNodeServerService.kt`)
1. **Service Type & Permissions**:
   - Declared in `AndroidManifest.xml` as `android:foregroundServiceType="specialUse"`.
   - Android 14 (API 34) compliance requires `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Personal local file server and remote access tunnel host" />`.
   - Declares `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, and `POST_NOTIFICATIONS`.
2. **Notification & Channel**:
   - Channel ID: `remote_node_server_channel`.
   - Importance: `NotificationManager.IMPORTANCE_LOW` (non-intrusive ongoing background notification).
   - Shows real-time server status and port `8080`.
3. **Power & WakeLock Management**:
   - Acquires `PowerManager.PARTIAL_WAKE_LOCK` with tag `"RemoteNode::ServerWakeLock"`.
   - Explicit timeout guard: `wakeLock?.acquire(12 * 60 * 60 * 1000L)` (12 hours maximum duration to avoid permanent CPU drain).
4. **Boot Auto-Start**:
   - `BootReceiver.kt` listens for `android.intent.action.BOOT_COMPLETED` and `android.intent.action.QUICKBOOT_POWERON`.
   - Checks `SharedPreferences` (`net.remotenode.server_prefs`) for `server_enabled == true`.
   - If enabled, invokes `ContextCompat.startForegroundService(context, intent)` to restore daemon immediately after reboot.

---

## 4. LOCAL SERVER ENGINE ARCHITECTURE & HTTP PROCESSING

### Implementation Details (`LocalServerEngine.kt`)
1. **Concurrency & Threading**:
   - Uses `Executors.newCachedThreadPool()` for dispatching inbound HTTP socket connections.
   - Listens on `127.0.0.1:8080` (loopback interface only).
2. **REST Endpoints Exposed Locally**:
   - `GET /api/files`: Lists directory contents with metadata (size, MIME type, last modified, directory flag).
   - `GET /api/download`: Streams file bytes with HTTP range support.
   - `POST /api/upload`: Handles multipart file uploads and writes directly to local storage.
   - `GET /api/stream`: Optimised media streaming endpoint for audio/video playback.
   - `GET /api/storage`: Returns volume capacity, used space, free space, and storage mount point.
3. **Storage Access**:
   - Interacts with Android Storage Access Framework (SAF) and scoped storage directories.
   - Sandboxed to authorized user storage paths.

---

## 5. FLUTTER DART VM REMOTE CONNECTION ARCHITECTURE

### Implementation Details (`remote_connection_service.dart` & `remote_transport.dart`)
1. **Connection Lifecycle State Machine**:
   - States: `disconnected` -> `connecting` -> `connected` -> `reconnecting` -> `failed`.
2. **Two-Step Registration & Handshake**:
   - **Step 1 (Control Plane REST)**: Calls `POST /api/v1/connections/register` with `{ deviceId }` and Bearer token.
   - **Step 2 (Data Plane WebSocket)**: Extracts `connectionToken`, `remoteEndpoint`, and `gatewayWsUrl`. Connects to Gateway WebSocket server and immediately transmits:
     ```json
     {
       "type": "AUTH",
       "deviceId": "<deviceId>",
       "connectionToken": "<token>"
     }
     ```
3. **RPC Message Dispatcher (`FILE_REQUEST` -> Loopback HTTP -> `FILE_RESPONSE`)**:
   - Inbound `FILE_REQUEST` received over WebSocket.
   - Flutter service parses `operation`, `path`, and payload.
   - Dispatches local HTTP request to `http://127.0.0.1:8080/api/...` via `RemoteNodeClient`.
   - Formats result and transmits `FILE_RESPONSE` back across the WebSocket tunnel.
4. **Heartbeat Pinging Mechanism**:
   - `_startPingTimer()` fires application `PING` frame every 15 seconds.
   - Tracks `_lastPongTime` and increments `_missedPings`.
   - If `_missedPings >= 2` or `now - _lastPongTime > 35s`, connection is flagged dead and `_triggerReconnect()` is called.

---

## 6. THE NATIVE VS. DART PROCESS/ISOLATE DISCONNECT (CRITICAL DEEP-DIVE)

### The Architectural Flaw
There is a fundamental structural disconnect between the Android Native Service and the Flutter Remote Connection Service:

| Characteristic | Android Native Layer (`RemoteNodeServerService`) | Flutter Dart Layer (`HttpRemoteConnectionService`) |
|---|---|---|
| **Process / Host** | Native Android Foreground Service Process | Flutter Dart VM Engine / UI Activity Isolate |
| **Lifecycle Durability** | Immune to background memory reclamation (holds WakeLock + Ongoing Notification) | Terminated/Suspended when Android OS reclaims the Flutter Activity |
| **Loopback HTTP Server** | **YES** (Owned and managed here) | NO (Only acts as client) |
| **Gateway WebSocket Tunnel** | **NO** (Zero gateway awareness) | **YES** (Owned and managed here) |

### Failure Manifestation:
1. When the user swipes away the ZdexCloud app from the Android Recent Apps screen or Android puts the UI isolate into deep suspension, the **Flutter Dart VM terminates**.
2. The **native foreground service remains alive**, maintaining the local HTTP server on `127.0.0.1:8080`.
3. However, because the WebSocket connection was hosted inside Dart, the **outbound tunnel to the gateway dies silently**.
4. The remote user experiences `503 SERVER_OFFLINE` when trying to reach their node, despite the phone's notification bar proudly stating "Server Running".

---

## 7. WEBSOCKET TRANSPORT LAYER ARCHITECTURE

### Implementation Details (`remote_transport.dart`)
1. **Client Implementation**:
   - Uses `dart:io` `WebSocket.connect(targetUrl)`.
   - `pingInterval` set to `Duration(seconds: 10)` at the TCP/WebSocket protocol frame level.
   - TLS Certificate validation: `badCertificateCallback` allows self-signed certificates when `AppConfig.current.environment != 'production'`.
2. **Message Framing**:
   - Standard UTF-8 JSON text frames for control messages (`HELLO`, `AUTH`, `AUTH_SUCCESS`, `AUTH_FAILURE`, `PING`, `PONG`, `FILE_REQUEST`, `FILE_RESPONSE`, `DISCONNECT`).
   - Base64 string payload chunks for binary streaming transfers over JSON framing (`FILE_STREAM_CHUNK`).
3. **Hardcoded Fallback Flaw**:
   - Hardcoded failover candidate list: `[url, 'wss://gateway.zdexcloud.com']`.
   - In non-production environments (e.g., local dev or staging), falling back to production `gateway.zdexcloud.com` results in routing mismatch or invalid token errors.

---

## 8. GATEWAY SERVER / RELAY ARCHITECTURE (BACKEND)

### Implementation Details (`gateway_service.ts`)
1. **WebSocket Terminating Relay**:
   - Instantiates `WebSocketServer` from `ws` package, binding to HTTP server on port 4001 (or attached to Fastify main HTTP instance).
   - Max payload guard: `GATEWAY_MAX_MESSAGE_SIZE_BYTES` (default 200MB).
   - Capacity guard: Rejects connections when `activeConnections.size >= GATEWAY_MAX_CONNECTIONS` (default 1000).
2. **In-Memory Connection Maps**:
   - `activeConnections`: `Map<connectionId, ActiveGatewayConnection>`
   - `deviceToConnectionMap`: `Map<deviceId, connectionId>`
   - `hostnameToConnectionMap`: `Map<hostname, connectionId>`
   - `pendingRequests`: `Map<requestId, PendingClientRequest>`
   - `activeTransfers`: `Map<transferId, ActiveFileTransfer>`
3. **Session Eviction & Duplicate Handshake Handling**:
   - When an `AUTH` message is processed for an already-connected `deviceId` or `connectionId`, the gateway sends `DISCONNECT` ("Replaced by newer connection session") to the old socket and immediately closes it before registering the new socket.
4. **Dead Connection Reaper**:
   - Runs every `GATEWAY_HEARTBEAT_INTERVAL_MS` (30s).
   - Iterates `activeConnections`. If `now - conn.lastHeartbeatAt > 60000ms`, terminates the socket and marks the connection `DISCONNECTED` in database.

---

## 9. CONTROL PLANE & REGISTRATION HANDSHAKE FLOW

### End-to-End Sequence Diagram:
```mermaid
sequenceDiagram
    autonumber
    participant App as Android Flutter App
    participant CP as Control Plane (Fastify)
    participant DB as Prisma PostgreSQL
    participant GW as Gateway WebSocket Server

    App->>CP: POST /api/v1/connections/register (Bearer Auth, deviceId)
    CP->>DB: Find/Update DeviceConnection (status=CONNECTING)
    CP->>DB: Allocate/Verify ServerEndpoint (hostname)
    CP-->>App: 200 OK (connectionToken, remoteEndpoint, hostname)
    
    App->>GW: WebSocket Connect (wss://gateway...)
    GW-->>App: {"type":"HELLO","version":"2.0"}
    
    App->>GW: {"type":"AUTH","deviceId":"...","connectionToken":"..."}
    GW->>DB: Validate Token (findFirst deviceConnection)
    GW->>DB: markConnected (status=CONNECTED, Device=ONLINE, Server=RUNNING)
    GW->>GW: Bind deviceId & hostname to active socket
    GW-->>App: {"type":"AUTH_SUCCESS","connectionId":"...","remoteEndpoint":"..."}
```

---

## 10. REVERSE PROXY SUBDOMAIN ROUTING MECHANISM

### Mechanism & Routing Logic:
1. Inbound HTTP requests hit `GatewayService` (via `*.remotenode.net` or `*.zdexcloud.com` subdomain, or Fastify `/api/v1/file-manager` proxy).
2. Hostname resolution:
   - Strips protocol and port to isolate hostname (e.g. `node-abc12345.remotenode.net`).
   - Queries `hostnameToConnectionMap` or `deviceToConnectionMap`.
3. If node is missing or socket is closed:
   - Returns HTTP 503 `SERVER_OFFLINE` or 404 `SERVER_NOT_FOUND`.
4. If node is active:
   - Allocates unique `requestId` (`http-req-...` or `fm-...`).
   - Wraps HTTP request into `FILE_REQUEST` JSON message.
   - Forwards message over device's active WebSocket tunnel.
   - Creates `Promise` with timeout (`GATEWAY_REQUEST_TIMEOUT_MS` = 60s).
   - Upon receiving `FILE_RESPONSE` with matching `requestId`, resolves Promise and pipes data/status back to HTTP client.

---

## 11. LARGE FILE STREAMING & DATA PLANE FLOW

### Protocol Framing for File Streaming:
- `FILE_STREAM_START`: Contains `transferId`, `requestId`, `connectionId`, and `totalBytes`.
- `FILE_STREAM_CHUNK`: Carries base64 encoded chunks up to `GATEWAY_TRANSFER_CHUNK_SIZE_BYTES` (4MB).
- `FILE_STREAM_END`: Signals successful stream completion and triggers counter increments.
- `FILE_STREAM_CANCEL`: Bi-directional abort message sent when either client or host drops or cancels transfer.

---

## 12. HEARTBEAT & LIVENESS VERIFICATION SYSTEM

### Dual-Layer Heartbeat Architecture:
1. **Application Layer (WebSocket JSON PING/PONG)**:
   - Client sends `{"type":"PING"}` every 15s.
   - Gateway responds `{"type":"PONG"}` and updates `conn.lastHeartbeatAt = new Date()`.
   - Client tracks unacknowledged pings.
2. **Socket Layer (TCP WebSocket Ping Frames)**:
   - Gateway reaper sends raw `socket.ping()` every 30s to keep NAT mappings open.
   - Client transport configures `pingInterval = 10s`.
3. **Database Liveness Synchronization**:
   - `lastHeartbeatAt` updated in DB on initial auth and periodically via `/connections/:id/heartbeat` or socket disconnect.

---

## 13. CONNECTION RECONNECTION & BACKOFF ENGINE (CURRENT STATE)

### Current Implementation (`remote_connection_service.dart`):
- Exponential Backoff Algorithm:
  $$\text{delay} = \min(\text{baseDelay} \cdot 2^{\text{attempt}}, \text{maxDelay}) + \text{jitter}$$
- Parameters:
  - `_initialRetryDelay`: 1.0 second.
  - `_maxRetryDelay`: 60.0 seconds.
  - `_backoffMultiplier`: 2.0.
  - Jitter: Random float between 0 and 1.0 second.
- Reset Trigger: Successfully receiving `AUTH_SUCCESS` resets `_reconnectAttempts = 0`.
- Max Retries: Currently unlimited (continues retrying indefinitely in background until stopped).

---

## 14. FALLBACK & FAILOVER ROUTING MECHANICS

### Current Mechanics & Deficiencies:
- `WebSocketRemoteTransport` accepts an initial URL and attempts failover:
  ```dart
  final endpoints = [url, 'wss://gateway.zdexcloud.com'];
  for (final endpoint in endpoints) {
    try {
      _socket = await WebSocket.connect(endpoint)...;
      return;
    } catch (_) {}
  }
  ```
- **Identified Deficiency**: Hardcoded fallback to production host disrupts staging/local developer environments and can leak connection tokens to unintended hosts.

---

## 15. AUTHENTICATION, SECURITY & TOKEN LIFECYCLE

### Security Controls:
1. **Single-Use/Session Connection Tokens**: Generated upon `POST /connections/register` with cryptographic randomness and timestamp.
2. **Cross-User Routing Isolation**: Gateway verifies `authorizedUserId` against `conn.userId` to strictly prevent tenant cross-talk.
3. **Rate Limiting**: Sliding window tracking 600 requests/minute per remote IP.
4. **Log Redaction**: Automatic stripping of tokens, passwords, secrets, OTPs, and binary base64 payloads from all gateway log output.

---

## 16. NETWORK TRANSITION & OS SUSPENSION FAILURE MODES

### Failure Scenarios:
1. **Wi-Fi to Cellular Handoff (Network Switch)**:
   - Active TCP socket becomes a "black hole" (silent disconnect without TCP RST/FIN).
   - Dart VM takes up to 35s to detect missed PONGs before initiating reconnect.
2. **OS Deep Sleep / Doze Mode**:
   - Android stops CPU execution on Dart threads.
   - Gateway times out after 60s and closes socket.
   - When device wakes, client sends PING on dead socket, receives socket error, and only then triggers reconnect.

---

## 17. DOZE MODE, APP STANDBY & OEM BATTERY OPTIMIZATION MATRIX

| OEM / Android Version | Behavior Observed | Mitigation in Codebase | Remaining Gap |
|---|---|---|---|
| **Stock Android (API 28-34)** | Doze mode suspends background network access unless foreground service with WakeLock is active. | `RemoteNodeServerService` holds `PARTIAL_WAKE_LOCK`. | Flutter isolate is not protected by native WakeLock if Activity is destroyed. |
| **Samsung (OneUI)** | Aggressive sleeping apps kill background sockets after 3-5 minutes of screen off. | MethodChannel checks `isBatteryOptimizationIgnored()`. | Requires user to manually whitelist app in system settings. |
| **Xiaomi (MIUI/HyperOS)** | Kills background child processes regardless of foreground service. | Foreground notification active. | WebSocket must be moved to native service to survive MIUI process reaper. |

---

## 18. ZOMBIE CONNECTION & STALE STATE FAILURE MODES

### Failure Scenarios & Analysis:
1. **Gateway In-Memory vs. Database Desynchronization**:
   - If gateway crashes or restarts abruptly, in-memory `activeConnections` map is wiped, but DB records may remain `CONNECTED`.
   - On gateway boot, all orphaned DB connections must be transitioned to `DISCONNECTED`.
2. **Client Ghost Reconnect**:
   - If client reconnects with a new socket before the old socket is reaped, duplicate session eviction safely closes the prior socket.

---

## 19. CROSS-TIER PROTOCOL & MESSAGE SCHEMA INVENTORY

### Protocol Messages (JSON):
```typescript
interface GatewayMessage {
  type: 'HELLO' | 'AUTH' | 'AUTH_SUCCESS' | 'AUTH_FAILURE' | 'PING' | 'PONG' |
        'FILE_REQUEST' | 'FILE_RESPONSE' | 'FILE_STREAM_START' | 'FILE_STREAM_CHUNK' |
        'FILE_STREAM_END' | 'FILE_STREAM_CANCEL' | 'FILE_ERROR' | 'DISCONNECT' | 'ERROR';
  version?: string;
  deviceId?: string;
  connectionToken?: string;
  connectionId?: string;
  requestId?: string;
  transferId?: string;
  operation?: 'LIST' | 'STORAGE' | 'RECENT' | 'DOWNLOAD' | 'UPLOAD' | 'CREATE_FOLDER' | 'RENAME' | 'DELETE' | 'HEALTH';
  path?: string;
  data?: any;
  error?: { code: string; message: string };
  dataBase64?: string;
}
```

---

## 20. DATABASE & STATE SYNCHRONIZATION MODEL

### Prisma Models Involved:
- `Device`: `status` (`ONLINE` / `OFFLINE`), `lastSeenAt`.
- `ServerInstance`: `status` (`STOPPED` / `RUNNING`), `startedAt`, `lastHeartbeatAt`.
- `ServerEndpoint`: `hostname`, `status` (`ACTIVE` / `INACTIVE`).
- `DeviceConnection`: `status` (`DISCONNECTED` / `CONNECTING` / `CONNECTED` / `RECONNECTING` / `FAILED`), `connectedAt`, `disconnectedAt`, `lastHeartbeatAt`.
- `AuditEvent`: Emits `REMOTE_CONNECTION_CREATED`, `REMOTE_CONNECTION_CONNECTED`, `REMOTE_CONNECTION_DISCONNECTED`.

---

## 21. RATE LIMITING, CAPACITY & BACKPRESSURE ANALYSIS

- **Rate Limiting**: 600 RPM per IP enforced via sliding window in memory.
- **Max Connections**: Enforced at 1,000 concurrent sockets per gateway process.
- **Backpressure**: WebSocket buffering uses native Node `ws` backpressure events and Dart stream buffers.

---

## 22. LOGGING, OBSERVABILITY & ERROR TRACING BASELINE

- **Gateway Metrics**: `getHealthStatus()` tracks `activeConnections`, `reconnectCount`, `rateLimitEvents`, `timedOutRequests`, `failedAuthCount`, `activeTransfersCount`, `completedTransfersCount`, `failedTransfersCount`.
- **Structured JSON Logging**: Standardized `{ timestamp, level, service: "gateway", message, ...meta }` with recursive credential redaction.

---

## 23. COMPREHENSIVE FAILURE-MODE & ROOT-CAUSE MATRIX

| ID | Failure Mode | Root Cause | Impact | Recommended Batch Fix |
|---|---|---|---|---|
| **FM-01** | WebSocket tunnel dies when app backgrounded/swiped. | Tunnel hosted in Flutter Dart isolate rather than Android Native Foreground Service. | Remote node unreachable even though server service runs. | Batch 11A.3 / 11A.4 (Native Tunnel Migration) |
| **FM-02** | Stale socket after Wi-Fi to Cellular handoff. | Lack of native `ConnectivityManager.NetworkCallback` listening to OS network switches. | 35s dead time before timeout reconnect. | Batch 11A.2 (Self-Healing Network Watcher) |
| **FM-03** | Hardcoded production fallback URL in client. | `WebSocketRemoteTransport` contains hardcoded `wss://gateway.zdexcloud.com`. | Dev/Staging environments break on failover. | Batch 11A.2 (Dynamic Gateway Discovery) |
| **FM-04** | Stale DB connection status after gateway crash. | In-memory connection map loss without startup DB reconciliation. | UI displays "Connected" for offline nodes. | Batch 11A.5 (Gateway State Reconciliation) |
| **FM-05** | Memory bloat on large file base64 streaming. | JSON base64 chunking incurs 33% overhead and GC pressure. | High RAM consumption on edge Android device. | Batch 11A.6 (Binary Stream Optimization) |

---

## 24. CROSS-PLATFORM ARCHITECTURAL STATE MACHINES

### Client State Machine:
```
[DISCONNECTED] ──(register/connect)──> [CONNECTING] ──(auth_success)──> [CONNECTED]
      ▲                                      │                                │
      │                                 (auth_fail)                     (ping timeout /
      │                                      │                           socket error)
      │                                      ▼                                │
      └───────────────────────────────── [FAILED] <──(max retries)── [RECONNECTING]
```

### Gateway Connection State Machine:
```
[SOCKET_OPEN] ──(send HELLO)──> [AWAIT_AUTH] ──(valid token)──> [AUTHENTICATED / ACTIVE]
      │                               │                                    │
(capacity/rate limit)           (auth timeout)                     (silent 60s reaper /
      │                               │                             client disconnect)
      ▼                               ▼                                    │
 [CLOSED_4000]                  [AUTH_FAILURE] ────────────────────────────▼
                                                                     [CLEANUP & DB SYNC]
```

---

## 25. SOURCE CODE LOCATION & FILE INVENTORY

### Complete File Inventory:
1. `android/app/src/main/AndroidManifest.xml`
2. `android/app/src/main/kotlin/net/remotenode/fileserver/MainActivity.kt`
3. `android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeServerService.kt`
4. `android/app/src/main/kotlin/net/remotenode/fileserver/LocalServerEngine.kt`
5. `android/app/src/main/kotlin/net/remotenode/fileserver/BootReceiver.kt`
6. `lib/features/remote/domain/services/remote_connection_service.dart`
7. `lib/features/remote/domain/services/remote_transport.dart`
8. `lib/features/remote/domain/services/remote_node_client.dart`
9. `main website/Backend/src/gateway/gateway_service.ts`
10. `main website/Backend/src/gateway/gateway_config.ts`
11. `main website/Backend/src/routes/connection.ts`
12. `main website/Backend/src/routes/device.ts`
13. `main website/Backend/src/routes/server.ts`
14. `main website/Backend/src/routes/endpoint.ts`
15. `main website/Backend/prisma/schema.prisma`

---

## 26. FINDINGS SEVERITY CLASSIFICATION

- **CRITICAL**:
  - Process/Isolate Disconnect: Dart VM hosts the gateway tunnel while Kotlin Foreground Service hosts local server, causing tunnel death on app backgrounding.
- **HIGH**:
  - Network Switch Black Hole: Lack of native network callback leaves dead sockets open for up to 35-60s during Wi-Fi/Cellular transitions.
  - Hardcoded Failover URL: Hardcoded production gateway address in client transport breaks staging/local isolation.
- **MEDIUM**:
  - Database Stale State on Crash: Gateway restart leaves orphan `CONNECTED` records in PostgreSQL.
  - Base64 Transfer Overhead: Large file streaming over JSON text frames adds memory and CPU strain on mobile devices.
- **LOW**:
  - 12h WakeLock Safety Timeout: WakeLock expires after 12 hours if not refreshed.

---

## 27. ARCHITECTURAL INVARIANTS FOR FUTURE BATCHES

1. **Zero Data Loss / Zero Storage Intrusion**: Gateway acts purely as an ephemeral routing proxy; user filesystem data is never retained on backend disks.
2. **Unified Lifecycle**: Gateway tunnel lifecycle must match the Native Android Foreground Service lifecycle.
3. **Graceful Degradation & Backoff**: Reconnection engines must always employ randomized jitter and bounded exponential backoff to prevent thundering herd spikes.
4. **Strict Multi-Tenant Isolation**: Cross-user connection forwarding is permanently forbidden.

---

## 28. RECOMMENDED PHASE 11A ROADMAP & NEXT-BATCH SEQUENCE

- **Batch 11A.1** (CURRENT): Gateway & Connection Architecture Audit & Read-Only Reliability Baseline (**COMPLETED & HARD STOPPED**).
- **Batch 11A.2**: Self-Healing Reconnection Engine, Network Transition Watcher & Dynamic Gateway Discovery.
- **Batch 11A.3**: Android Native Gateway Tunnel Client & Foreground Service Architecture Unification.
- **Batch 11A.4**: Gateway Session Resilience, Clean Session Handover & Fast Socket Eviction.
- **Batch 11A.5**: Control Plane & Gateway State Reconciliation Engine (Startup Pruning & Liveness Heartbeats).
- **Batch 11A.6**: High-Performance Binary File Streaming & Backpressure Optimization.

---

## 29. VERIFICATION PROTOCOL & MANDATORY ZERO-TEST POLICY STATEMENT

### Mandatory Test Policy Statement:
- **Policy Adherence**: In strict compliance with the Phase 11A.1 charter, **ZERO TESTS WERE EXECUTED** during this batch.
- **Rationale**: Batch 11A.1 is a purely analytical, architectural baseline audit. Executing tests or running test suites is strictly reserved for implementation batches with code modifications.
- **Verification Statement**:
  ```
  Tests Executed: NONE.
  Status: Mandatory Zero-Test Policy Observed.
  ```

---

## 30. AUDIT SIGN-OFF & BATCH 11A.1 COMPLETION DECLARATION

### Declaration of Completion:
The Phase 11A.1 Architecture Audit and Read-Only Reliability Baseline is hereby formally completed. All 30 required sections have been thoroughly analyzed, documented, and cross-referenced with the physical repository implementation.

**Batch Status:** COMPLETED.  
**Execution Action:** HARD STOP ENFORCED. No code changes executed. Ready for Phase 11A — Batch 11A.2 upon user directive.
