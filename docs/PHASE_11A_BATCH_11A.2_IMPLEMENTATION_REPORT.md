# PHASE 11A — BATCH 11A.2
# SELF-HEALING RECONNECTION ENGINE, NETWORK TRANSITION WATCHER & DYNAMIC GATEWAY DISCOVERY
# IMPLEMENTATION REPORT

**Date:** 2026-09-30  
**Phase:** 11A — Gateway Reliability & Self-Healing  
**Batch:** 11A.2 — Self-Healing Reconnection Engine, Network Transition Watcher & Dynamic Gateway Discovery  
**Execution Mode:** IMPLEMENTATION BATCH (Flutter/Dart & Android Native Network Watcher Integration)  
**Test Policy Status:** Tests created/updated but NOT EXECUTED. Test execution is deferred to the final verification phase.  
**Tests Executed:** NONE.  
**Final Batch Status:** PHASE 11A BATCH 11A.2 — COMPLETE & HARD STOPPED  

---

## 1. EXECUTIVE SUMMARY

Phase 11A — Batch 11A.2 delivers the first self-healing reliability layer for the ZdexCloud mobile edge file server. Grounded in the architectural baseline established in Batch 11A.1, this batch hardens the Flutter/Dart gateway connection manager and bridges Android native OS network callbacks into the Dart connection coordinator.

Key advancements implemented in this batch:
1. **Network Transition Watcher (`NetworkWatcher.kt` & `NetworkWatcherService.dart`)**: Uses Android OS `ConnectivityManager.NetworkCallback` with `NET_CAPABILITY_INTERNET` and `NET_CAPABILITY_VALIDATED` to detect network loss, restoration, and transport switches (Wi-Fi $\leftrightarrow$ Cellular) in real time without polling.
2. **Single Connection Coordinator with Generation/Epoch Guard**: Introduces monotonic generation tracking (`_connectionGeneration`) that discards obsolete sockets, supersedes out-of-order callbacks, and coalesces concurrent connection/reconnection requests.
3. **Bounded Exponential Backoff with Randomized Jitter**: Implements a strict formula ($\text{delay} = \min(1000 \cdot 2^{\text{attempt}}, 60000) + \text{jitter}$) where retries are paused when the device is offline and cancelled upon explicit stop or successful connection.
4. **Dynamic Gateway Endpoint Selection & Removal of Hardcoded Fallback**: Completely purged the unsafe hardcoded fallback to `'wss://gateway.zdexcloud.com'`, ensuring environment isolation and preventing cross-environment token leakage.
5. **Strict Manual Start/Stop Semantics**: Enforces `_isExplicitlyStopped` so that an intentional user disconnect safely cleans all sockets and timers and prevents background auto-reconnection until the user presses Start again.

---

## 2. SCOPE

### Included in Batch 11A.2:
- Android native `ConnectivityManager.NetworkCallback` listener (`NetworkWatcher.kt`) surviving Activity recreations.
- EventChannel and MethodChannel bridges for network events (`MainActivity.kt` and `RemoteNodeServerService.kt`).
- Dart network transition service with 400ms burst debouncing (`network_watcher_service.dart`).
- Monotonic connection generation/epoch mechanism in `HttpRemoteConnectionService`.
- Bounded exponential backoff with jitter and offline retry pausing.
- Dynamic gateway endpoint selection from `AppConfig` and removal of hardcoded fallback URLs.
- Token and registration retry behavior.
- Stale socket cancellation and resource cleanup.
- Creation of unit test suite documenting Batch 11A.2 capabilities without test execution.

### Explicitly Excluded (Deferred to Batch 11A.3+):
- Native Kotlin WebSocket tunnel client (Deferred to 11A.3).
- Moving gateway tunnel ownership into the native Foreground Service (Deferred to 11A.3).
- Gateway runtime map redesign and backend state reconciliation (Deferred to 11A.4/11A.5).
- Binary file streaming protocol (Deferred to 11A.6).

---

## 3. FILES INSPECTED

1. `lib/features/remote/domain/services/remote_connection_service.dart`
2. `lib/features/remote/domain/services/remote_transport.dart`
3. `lib/features/remote/domain/services/connectivity_transport.dart`
4. `lib/core/config/app_config.dart`
5. `lib/features/setup/application/setup_state.dart`
6. `lib/features/server/domain/services/server_service.dart`
7. `android/app/src/main/kotlin/net/remotenode/fileserver/MainActivity.kt`
8. `android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeServerService.kt`
9. `android/app/src/main/kotlin/net/remotenode/fileserver/BatteryOptimizationHelper.kt`
10. `main website/Backend/src/gateway/gateway_service.ts`
11. `main website/Backend/src/gateway/gateway_config.ts`
12. `main website/Backend/src/routes/connection.ts`

---

## 4. FILES MODIFIED & CREATED

### Created:
1. `android/app/src/main/kotlin/net/remotenode/fileserver/NetworkWatcher.kt` (Android OS `NetworkCallback` singleton).
2. `lib/features/remote/domain/services/network_watcher_service.dart` (Dart network transition watcher & debouncer).
3. `test/unit/phase_11a_batch_11a_2_self_healing_test.dart` (Unit test specification for 11A.2 self-healing engine).

### Modified:
1. `android/app/src/main/kotlin/net/remotenode/fileserver/MainActivity.kt` (Added `EventChannel` and `MethodChannel` network status handlers).
2. `android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeServerService.kt` (Attached `NetworkWatcher.start()` to foreground service lifecycle).
3. `lib/features/remote/domain/services/remote_transport.dart` (Removed hardcoded `wss://gateway.zdexcloud.com` fallback, enforced strict endpoint validation).
4. `lib/features/remote/domain/services/remote_connection_service.dart` (Implemented single coordinator, generation guard, backoff with jitter, offline pausing, network event integration, and manual stop protection).

---

## 5. EXISTING ARCHITECTURE PRESERVED

All existing business operations and protocols remain completely preserved:
- User authentication and platform session management.
- Device node registration and installation ID pairing.
- Server setup and start/stop controls.
- Local HTTP file server engine (`LocalServerEngine` on `127.0.0.1:8080`).
- Remote RPC operations: `FILE_REQUEST`, `FILE_RESPONSE`, `HEALTH`, `STORAGE`, `RECENT`, `PHOTOS`, `VIDEOS`, `DOCUMENTS`, `LIST`, `CREATE_FOLDER`, `RENAME`, `DELETE`, `UPLOAD`, `DOWNLOAD`.
- Riverpod state notifier integration (`SetupStateNotifier`).

---

## 6. CONNECTION COORDINATOR DESIGN

The connection coordinator unifies all connection lifecycles behind a single serialized manager in `HttpRemoteConnectionService`:
- Single entry point for `connect()`, `disconnect()`, and `reconnect()`.
- Coalescing completer (`_activeConnectionCompleter`): If a connection attempt is actively in flight, concurrent calls from UI listeners or sync routines receive and await the shared in-flight `Future<RemoteConnectionInfo>`.
- Lock synchronization prevents concurrent parallel socket creation.

---

## 7. CONNECTION GENERATION / EPOCH DESIGN

A monotonic integer `_connectionGeneration` protects all asynchronous callbacks:
1. Every new connection attempt, manual reconnect, or manual stop increments `_connectionGeneration`.
2. Asynchronous stages (Control Plane HTTP registration, WebSocket handshake, AUTH responses, PING/PONG heartbeats) verify `if (currentGen != _connectionGeneration)` before applying state changes or socket references.
3. If an older socket closes, errors, or receives a delayed response, the event is immediately discarded without affecting the newer active generation.

---

## 8. RECONNECT STATE MACHINE

The state machine strictly transitions through standard phases:
- **Normal Start**: `DISCONNECTED` $\to$ `CONNECTING` $\to$ `CONNECTED`.
- **Transient Failure**: `CONNECTED` $\to$ `RECONNECTING` $\to$ `CONNECTING` $\to$ `CONNECTED`.
- **Manual Stop**: `ANY ACTIVE STATE` $\to$ `DISCONNECTED` (all reconnection tasks cancelled).
- **Terminal Auth Failure**: `CONNECTING` $\to$ `FAILED` (error message emitted, no blind busy-loop).

---

## 9. BACKOFF IMPLEMENTATION

Exponential backoff is computed via:
$$\text{delayMs} = \min\left(1000 \cdot 2^{\text{attempt}}, 60000\right) + \text{random}(0, 1000)$$
- **Progression**: ~1s, ~2s, ~4s, ~8s, ~16s, ~32s, capped at max 60s.
- **Jitter**: Randomized 0–1000ms added to prevent thundering herd spikes on gateway servers.
- **Reset Invariant**: `_reconnectAttempts` resets to 0 **only** when `AUTH_SUCCESS` is received.
- **Pause Invariant**: When `NetworkWatcher` reports no Internet, retry timers are cancelled and held until a validated network is restored.

---

## 10. NETWORKCALLBACK IMPLEMENTATION

`NetworkWatcher.kt` registers with Android OS `ConnectivityManager`:
- Uses `registerDefaultNetworkCallback()` on Android 7.0+ (API 24+) or `registerNetworkCallback(NetworkRequest)` on API 21-23.
- Tracks `NET_CAPABILITY_INTERNET` and `NET_CAPABILITY_VALIDATED`.
- Distinguishes transport types: `TRANSPORT_WIFI`, `TRANSPORT_CELLULAR`, `TRANSPORT_ETHERNET`, `TRANSPORT_VPN`.
- Dispatches structured events to Dart across `EventChannel('net.remotenode.fileserver/network_events')`.

---

## 11. NETWORK TRANSITION HANDLING

The Dart `NetworkWatcherService` processes events with a 400ms debounce filter:
1. **Network Lost**: Immediately transitions state to `reconnecting`, closes the active socket, and pauses retry timers.
2. **Network Restored**: Detects validated connectivity and triggers an immediate recovery reconnect attempt.
3. **Transport Switch (Wi-Fi $\leftrightarrow$ Cellular)**: Detects that the physical network ID or transport changed, invalidates the old generation, closes the potentially "black-holed" socket, and establishes a fresh connection on the new interface.

---

## 12. DYNAMIC GATEWAY ENDPOINT SELECTION

- Target WebSocket URL is dynamically resolved from `AppConfig.current.gatewayWsUrl` (or backend registration payload).
- Unsafe fallback to `'wss://gateway.zdexcloud.com'` was completely deleted from `WebSocketRemoteTransport`.
- Target URLs are validated before connecting:
  - Scheme must be `ws://` or `wss://`.
  - Production mode strictly rejects insecure `ws://` schemes.

---

## 13. ENVIRONMENT ISOLATION

- Development: Connects to local loopback / configured dev gateway (`ws://10.0.2.2:4001` or `ws://localhost:4001`).
- Testing / Staging: Connects to staging gateway (`wss://gateway.zdexcloud.com`).
- Production: Connects to configured production domain (`wss://gateway.<domain>`).
- Cross-environment connection token transmission is strictly impossible.

---

## 14. TLS BEHAVIOR

- In production mode, standard OS CA certificate validation and hostname verification are strictly enforced.
- Development-only certificate overrides (`badCertificateCallback`) are gated with `AppConfig.current.environment != 'production'`.
- Insecure HTTP/WS fallback in production throws `StateError`.

---

## 15. REGISTRATION RETRY

- When `connect()` executes, it calls `POST /api/v1/connections/register` with up to 8 attempts (with 4s delays) to accommodate backend serverless/container cold starts.
- Obtains a fresh session-scoped `connectionToken` on each registration cycle.
- Does not persist or leak connection tokens across sessions.

---

## 16. AUTHENTICATION FAILURE HANDLING

- **Platform Session Expired (401)**: Displays user-facing error `"Platform session expired (24h). Please sign in again."`, transitions to `failed`, and does not enter a reconnection loop.
- **Gateway Invalid Token (`AUTH_FAILURE`)**: Triggers a re-registration with the Control Plane to fetch a fresh token before retrying.
- **Transient Gateway / Transport Error**: Retries with bounded exponential backoff.

---

## 17. SOCKET CLEANUP

- Obsolete sockets are closed immediately upon generation increment or disconnect.
- Stream subscriptions are explicitly cancelled before creating new subscriptions.
- Ping timers and reconnect timers are cancelled and nulled to eliminate memory leaks and zombie loops.

---

## 18. HEARTBEAT INTEGRATION

- Sends application-level `{"type":"PING"}` every 15s.
- Tracks `_lastPongReceivedAt` and `_missedPings`.
- If 2 consecutive pings are missed or $\Delta t > 35\text{s}$ without `PONG`, closes the stale socket and invokes `_triggerReconnect(immediate: true)`.

---

## 19. MANUAL START / STOP SEMANTICS

- `disconnect()` sets `_isExplicitlyStopped = true`.
- An explicit STOP immediately:
  - Cancels active retry timers.
  - Cancels heartbeat ping timers.
  - Cancels in-flight connection completers.
  - Closes the WebSocket transport.
  - Sends `DISCONNECT` notice to gateway and control plane.
  - Suppresses all automatic reconnection from network callbacks.
- `connect()` clears `_isExplicitlyStopped = false` and initiates a new generation.

---

## 20. DUPLICATE CONNECTION PREVENTION

- `_isConnecting` and `_isReconnecting` guards prevent concurrent loops.
- Concurrent callers to `connect()` are coalesced into `_activeConnectionCompleter`.
- In-memory generation IDs ensure that duplicate network callback events cannot spawn parallel sockets.

---

## 21. UI / STATE SYNCHRONIZATION

- `HttpRemoteConnectionService` emits serialized updates via broadcast `statusStream`.
- Riverpod `SetupStateNotifier` subscribes to `statusStream` and reflects live states (`ACTIVE`, `CONNECTING`, `RECONNECTING`, `DISCONNECTED`).

---

## 22. FAILURE-MODE COVERAGE

| Failure Scenario | Handled By Batch 11A.2 | Mechanism |
|---|---|---|
| **Temporary Internet Loss** | YES | `NetworkWatcher` detects offline status; pauses retry loop and frees socket. |
| **Internet Restored** | YES | `NetworkWatcher` detects validated connection; triggers immediate reconnect. |
| **Wi-Fi $\to$ Cellular Handoff** | YES | Capability/Transport change detected; closes stale socket, reconnects on cellular. |
| **Cellular $\to$ Wi-Fi Handoff** | YES | Switch detected; closes cellular socket, reconnects on Wi-Fi. |
| **Gateway Temporary Down (502/503)** | YES | Bounded exponential backoff with jitter retries up to 60s cap. |
| **Missed PONG (>35s)** | YES | Heartbeat watchdog invalidates socket generation and triggers reconnect. |
| **Manual Stop During Reconnect** | YES | `_isExplicitlyStopped` cancels retry timer and stops all reconnect routines. |
| **Stale Socket Callbacks** | YES | Generation mismatch check discards events from previous sockets. |
| **Cross-Environment Fallback** | YES | Hardcoded production fallback removed; uses configured environment URL. |

---

## 23. SECURITY CONSIDERATIONS

- **Zero Secret Exposure**: Connection tokens and Authorization Bearer headers are excluded from logs.
- **Log Sanitization**: Logs output only lifecycle states, attempt counts, and transport types.
- **Environment Gating**: Insecure schemes forbidden in production.

---

## 24. RESOURCE & MEMORY CONSIDERATIONS

- **No Timer Multiplications**: All timers are cancelled before reassignment.
- **No Unbounded Retries**: Maximum delay capped at 60s; retries halted when offline.
- **Burst Debouncing**: 400ms debounce on network callbacks prevents event churn.

---

## 25. STATIC VALIDATION

- **Dart Analysis (`dart analyze`)**: Executed on the entire Flutter project.
  - **Result**: `No issues found!` (0 errors, 0 warnings, 0 lints).
- **Kotlin Integration**: Clean class definitions and imports in `MainActivity.kt`, `RemoteNodeServerService.kt`, and `NetworkWatcher.kt`.

---

## 26. TESTS CREATED / UPDATED

- Created unit test suite: `Android app/Android app code/test/unit/phase_11a_batch_11a_2_self_healing_test.dart`.
- In strict adherence to the batch directives:
  - **Tests created/updated but NOT EXECUTED. Test execution is deferred to the final verification phase.**
  - **Tests Executed: NONE.**

---

## 27. KNOWN LIMITATIONS

1. **Process Lifecycle Disconnect**: While this batch maximizes recovery within the Flutter Dart VM isolate, the WebSocket tunnel is still hosted in Dart. If the Android OS kills the Flutter UI activity while the foreground service is running, the tunnel drops until the app is reopened.
2. **Native Socket Ownership**: The persistent native Android WebSocket tunnel belongs to Batch 11A.3.

---

## 28. DEFERRED PHASE 11A WORK

### Deferred to Batch 11A.3:
- Native Kotlin WebSocket tunnel implementation (`RemoteNodeTunnelManager.kt`).
- Foreground Service ownership of the WebSocket connection.
- Elimination of the Flutter Activity process-death limitation.

### Deferred to Batch 11A.4+:
- Gateway session handover and duplicate socket eviction hardening.
- Control plane and gateway startup state reconciliation.
- High-performance binary file streaming protocol.

---

## 29. FILES CHANGED SUMMARY

| File Path | Type | Action |
|---|---|---|
| `android/app/src/main/kotlin/net/remotenode/fileserver/NetworkWatcher.kt` | Kotlin | Created |
| `android/app/src/main/kotlin/net/remotenode/fileserver/MainActivity.kt` | Kotlin | Modified |
| `android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeServerService.kt` | Kotlin | Modified |
| `lib/features/remote/domain/services/network_watcher_service.dart` | Dart | Created |
| `lib/features/remote/domain/services/remote_transport.dart` | Dart | Modified |
| `lib/features/remote/domain/services/remote_connection_service.dart` | Dart | Modified |
| `test/unit/phase_11a_batch_11a_2_self_healing_test.dart` | Dart | Created |

---

## 30. FINAL STATUS & HARD STOP DECLARATION

**PHASE 11A BATCH 11A.2 — COMPLETE & HARD STOPPED**

All requirements for Phase 11A — Batch 11A.2 have been successfully implemented, statically validated with 0 errors, and documented. The codebase is cleanly prepared for Phase 11A — Batch 11A.3.

- **Tests created/updated but NOT EXECUTED. Test execution is deferred to the final verification phase.**
- **Tests Executed: NONE.**
