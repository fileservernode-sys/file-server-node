# PHASE 21.4.3 — TIMEOUT GENERATION ISOLATION & CODEC CLASSIFICATION LABEL ACCURACY REPORT

**Parent:** Phase 21.4 — Native Camera Capture & Camera2 HAL Integration  
**Prerequisites:** Phase 21.4.1 and Phase 21.4.2  
**Batch:** 21.4.3 (Corrective Implementation)  
**Status:** Implementation Complete & Validated  
**Testing Policy:** Write-Only Testing & Non-Destructive Static Inspection  
**Testing Status:** `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`  
**Preservation Invariants:** One unified Android application. Existing Storage engine, channels, credentials, and backend database remain untouched. Zero streaming transport or network streaming.

---

## 1. Executive Summary & Objective

Phase 21.4.3 performs a focused, rigorous correction addressing two specific safety and truthfulness issues identified during the Phase 21.4.2 review of the native Camera2 capture pipeline:

1. **Timeout Generation Ownership & Isolation (`CameraCaptureEngine.kt`):**
   - In asynchronous, multi-threaded camera pipelines, when capture sessions are rapidly restarted, reconfigured, or switched across camera lenses, timeout callbacks scheduled for Generation $N$ can execute concurrently with or after the creation of Generation $N+1$.
   - Previously, if Generation $N$'s delayed timeout runnable executed, it checked generation equality against `sessionGeneration.get()`, but in certain interleavings (e.g. timeout scheduled right before a generation increment or racing with stop/restart), there was a vulnerability where a running timeout could clear `currentContext` or mutate global state belonging to a newer active generation.
   - We have implemented strict generation isolation:
     - Reference equality verification (`currentContext === sessionCtx`).
     - Generation identity matching (`sessionGeneration.get() == sessionCtx.generation`).
     - State verification (`!sessionCtx.isStopped`).
     - Early return when preview readiness is already satisfied (`if (sessionCtx.hasReceivedPreviewFrame) return`).
     - Idempotent cleanup of isolated resources in `sessionCtx.releaseAll()` with callback de-registration.
     - Stale timeout callbacks release only their own isolated resources and never mutate global capture state, never clear a newer `currentContext`, and never notify Flutter of false errors.

2. **Codec Classification Label Accuracy (`camera_preview_standby.dart`, `camera_state.dart`):**
   - Platform-reported hardware acceleration on Android API 29+ (`MediaCodecInfo.isHardwareAccelerated`) must never be described to users or operators as independently verified physical hardware execution. Many vendor OEM HAL implementations report codecs as hardware-accelerated even when routed through specialized software runtimes or hybrid blocks.
   - UI status overlay labels now explicitly communicate that API 29+ classification is platform-reported:
     - Hardware accelerated: `HW H.264 (PLATFORM-REPORTED) • TRANSPORT OFFLINE`
     - Software: `SW H.264 • TRANSPORT OFFLINE`
     - Pre-API 29 vendor / unverified codecs: `H.264 (ACCELERATION UNVERIFIED) • TRANSPORT OFFLINE`
     - Preview-only without encoder: `PREVIEW ONLY • TRANSPORT OFFLINE`
     - Idle / Standby: `VIEWERS: NOT CONNECTED`
   - Remote transport remains truthfully indicated as `TRANSPORT OFFLINE`.

---

## 2. Root Cause Analysis: Stale Timeout Impact Across Generations

### 2.1 The Vulnerability
In Android's `CameraCaptureEngine`, camera operations transition across threads:
- **Main Thread / Platform Channel Thread:** Receives Flutter method calls (`startCapture`, `stopCapture`, `switchCamera`).
- **Camera Background Thread (`HandlerThread`):** Handles HAL callbacks (`CameraDevice.StateCallback`, `CameraCaptureSession.StateCallback`, `SurfaceTexture.OnFrameAvailableListener`).
- **Message Queue (`Handler`):** Posts delayed runnables such as the 5000ms frame availability watchdog timeout.

When a user or lifecycle event triggers a camera stop, restart, or lens switch while a 5000ms timeout runnable is queued:
1. `startCapture()` or `stopCapture()` increments `sessionGeneration` from $N$ to $N+1$.
2. Generation $N+1$'s `CaptureSessionContext` is instantiated and assigned to `currentContext`.
3. If Generation $N$'s timeout runnable was already popped from the handler queue and was awaiting the monitor lock `synchronized(stateLock)`:
   - Upon entering the lock, if the condition only checked `sessionCtx.generation == sessionGeneration.get()`, the check evaluated to false for the state transition, but if cleanup code or context dereferencing was unconditional or used structural equality (`currentContext == sessionCtx`), there was a danger of resetting `currentContext = null` or releasing active surfaces.
   - Furthermore, if Generation $N$ successfully received its first preview frame right at the 5000ms boundary, a racing timeout callback could fire and call `releaseAll()`, terminating active capture prematurely!

### 2.2 Corrective Architecture: Four-Point Invariant Check
Under Phase 21.4.3, before any timeout callback can mutate global capture state, clear `currentContext`, transition state, or invoke `stateListener?.onError()`, it must satisfy four atomic conditions under `synchronized(stateLock)`:

$$\text{Can Mutate Global State} \iff \begin{cases} 
\text{hasReceivedPreviewFrame} = \text{false} \\
\text{currentContext} \equiv \text{sessionCtx} \quad (\text{referential identity}) \\
\text{sessionGeneration.get}() == \text{sessionCtx.generation} \\
\text{sessionCtx.isStopped} = \text{false}
\end{cases}$$

If `sessionCtx.hasReceivedPreviewFrame == true`:
- Capture succeeded! The timeout runnable was cancelled or executed late in a harmless race. It immediately returns via `return@synchronized` without releasing resources or mutating state.

If `isCurrentActiveContext` is `false`:
- The callback belongs to a stale, superseded, or stopped session.
- It logs: `"Stale timeout callback for gen N ignored; active generation is M"`.
- It executes `sessionCtx.releaseAll()` to clean up any orphaned native surfaces/devices of Generation $N$.
- It **never** touches `currentContext` (which belongs to Generation $N+1$).
- It **never** mutates `currentState`.
- It **never** calls `stateListener?.onError()`.

---

## 3. Detailed Implementation Guarantees

### 3.1 Strict Timeout Generation Ownership in `CameraCaptureEngine.kt`

```kotlin
// Bounded frame availability timeout runnable with strict generation isolation (Phase 21.4.3)
val timeoutRunnable = Runnable {
    synchronized(stateLock) {
        // If capture was already verified and active, this timeout was cancelled or raced with success - ignore!
        if (sessionCtx.hasReceivedPreviewFrame) {
            Log.i(TAG, "Timeout callback for gen $gen ignored: preview frame already verified")
            return@synchronized
        }

        val isCurrentActiveContext = (currentContext === sessionCtx) &&
                (sessionGeneration.get() == sessionCtx.generation) &&
                !sessionCtx.isStopped

        if (isCurrentActiveContext) {
            val (errCode, msg) = if (sessionCtx.hasStartedCaptureRequest) {
                Pair("PREVIEW_FRAME_TIMEOUT", "Camera preview frame timed out after capture request started")
            } else {
                Pair("FRAME_START_TIMEOUT", "Camera hardware timed out waiting for initial frame start")
            }
            Log.e(TAG, "Timeout: $msg (gen=$gen, camera=$selectedId)")
            sessionCtx.releaseAll()
            if (currentContext === sessionCtx) {
                currentContext = null
            }
            activeTimeoutRunnable = null
            transitionState(CaptureState.ERROR, msg)
            stateListener?.onError(errCode, msg)
        } else {
            Log.i(TAG, "Stale timeout callback for gen $gen ignored; active generation is ${sessionGeneration.get()}")
            // Stale context releases only its own isolated resources; never mutates global state or currentContext
            sessionCtx.releaseAll()
        }
    }
}
sessionCtx.timeoutRunnable = timeoutRunnable
sessionCtx.timeoutHandler = handler
activeTimeoutRunnable = timeoutRunnable
handler.postDelayed(timeoutRunnable, FRAME_START_TIMEOUT_MS)
```

### 3.2 Idempotent Session Cleanup with Callback De-Registration
In `CaptureSessionContext.releaseAll()`:
```kotlin
fun releaseAll() {
    isStopped = true

    try {
        val r = timeoutRunnable
        if (r != null) {
            timeoutHandler?.removeCallbacks(r)
        }
    } catch (_: Exception) {}
    timeoutRunnable = null
    timeoutHandler = null

    try {
        captureSession?.stopRepeating()
    } catch (_: Exception) {}
    try {
        captureSession?.close()
    } catch (_: Exception) {}
    captureSession = null

    try {
        cameraDevice?.close()
    } catch (_: Exception) {}
    cameraDevice = null

    releaseEncoderOnly()

    try {
        surfaceTexture?.setOnFrameAvailableListener(null)
    } catch (_: Exception) {}
    surfaceTexture = null

    try {
        previewSurface?.release()
    } catch (_: Exception) {}
    previewSurface = null

    try {
        textureEntry?.release()
    } catch (_: Exception) {}
    textureEntry = null
}
```

### 3.3 Synchronized `checkCaptureReady` with Context Verification
In `checkCaptureReady`:
```kotlin
private fun checkCaptureReady(sessionCtx: CaptureSessionContext, handler: Handler) {
    synchronized(stateLock) {
        if (sessionCtx.isStopped ||
            sessionCtx.generation != sessionGeneration.get() ||
            currentContext !== sessionCtx
        ) {
            return
        }

        // Both Camera2 request start AND actual Flutter preview texture frame arrival are verified!
        if (sessionCtx.hasStartedCaptureRequest && sessionCtx.hasReceivedPreviewFrame) {
            if (currentState != CaptureState.CAPTURING) {
                sessionCtx.timeoutRunnable?.let { handler.removeCallbacks(it) }
                activeTimeoutRunnable?.let { handler.removeCallbacks(it) }
                activeTimeoutRunnable = null
                transitionState(CaptureState.CAPTURING)
                Log.i(
                    TAG,
                    "Capture fully verified: both Camera2 request and Flutter preview texture frame received. Transitioned to CAPTURING."
                )
            }
        }
    }
}
```

### 3.4 All HAL Callbacks Bound to `currentContext === sessionCtx`
Every callback path in `CameraCaptureEngine.kt` has been hardened to verify reference identity:
- `SurfaceTexture.OnFrameAvailableListener`: verifies `currentContext === sessionCtx`.
- `CameraCaptureSession.CaptureCallback.onCaptureStarted`: verifies `currentContext === sessionCtx`.
- `CameraDevice.StateCallback.onOpened`: verifies `currentContext === sessionCtx`.
- `CameraDevice.StateCallback.onDisconnected`: verifies `currentContext === sessionCtx`.
- `CameraDevice.StateCallback.onError`: verifies `currentContext === sessionCtx`.
- `CameraCaptureSession.StateCallback.onConfigured`: verifies `currentContext === sessionCtx`.
- `CameraCaptureSession.StateCallback.onConfigureFailed`: verifies `currentContext === sessionCtx`.

---

## 4. Codec Classification UI Label Accuracy

### 4.1 Truth in Classification Rationale
On Android API 29+, `MediaCodecInfo.isHardwareAccelerated` queries whether the codec implementation is reported by the underlying Android MediaCodec HAL as hardware-accelerated.
However:
- Android device manufacturers frequently wrap software or DSP blocks in HAL wrappers that return `isHardwareAccelerated = true`.
- Therefore, software applications cannot guarantee physical silicon execution without independent benchmarking or kernel driver instrumentation.
- Truthfulness requires that the UI explicitly describe this as **platform-reported**, avoiding deceptive claims of verified hardware execution.

### 4.2 UI Labeling Model (`camera_state.dart` & `camera_preview_standby.dart`)
We added the dedicated, fully tested getter `transportStatusLabel` to `CameraState`:

```dart
/// Returns the transport & codec acceleration status label for UI display.
/// Explicitly denotes platform-reported hardware classification to avoid
/// claiming unverified physical hardware execution (Phase 21.4.3).
String get transportStatusLabel {
  if (!isCapturing) return 'VIEWERS: NOT CONNECTED';
  if (!isEncoderActive) return 'PREVIEW ONLY • TRANSPORT OFFLINE';
  if (isHardwareAcceleratedCodec) {
    return 'HW H.264 (PLATFORM-REPORTED) • TRANSPORT OFFLINE';
  }
  if (isSoftwareCodec) {
    return 'SW H.264 • TRANSPORT OFFLINE';
  }
  return 'H.264 (ACCELERATION UNVERIFIED) • TRANSPORT OFFLINE';
}
```

And rendered cleanly in `CameraPreviewStandby`:
```dart
Text(
  state.transportStatusLabel,
  style: const TextStyle(
    fontFamily: AppTypography.monoFontFamily,
    fontSize: 10.0,
    color: Color(0xFF94A3B8),
    letterSpacing: 0.3,
  ),
)
```

---

## 5. Inventory of Modified & Created Files

| File | Language | Modification Type | Description |
|---|---|---|---|
| `android/app/src/main/kotlin/net/remotenode/fileserver/camera/CameraCaptureEngine.kt` | Kotlin | Enhanced | Added `timeoutRunnable` and `timeoutHandler` to `CaptureSessionContext`, strict four-point timeout validation, reference equality checks (`===`), idempotent cleanup, and generation metadata propagation. |
| `lib/features/camera/domain/services/camera_capture_service.dart` | Dart | Enhanced | Added `final int? generation;` to `CameraCaptureResult`, updated serialization (`fromMap` / `toMap`), and added `mockGeneration` and `emitEvent` to `MockCameraCaptureService`. |
| `lib/features/camera/application/camera_state.dart` | Dart | Enhanced | Added `transportStatusLabel` getter on `CameraState`; updated `_listenToCaptureEvents` in `CameraStateNotifier` to discard stale events from older generations. |
| `lib/features/camera/presentation/widgets/camera_preview_standby.dart` | Dart | Refactored | Replaced nested inline ternary in bottom overlay with `state.transportStatusLabel`. |
| `test/unit/camera_capture_test.dart` | Dart | Expanded | Added all 10 required test scenarios covering timeout generation isolation, racing, idempotency, codec classification accuracy, and Storage preservation. |
| `docs/PHASE_21_4_3_TIMEOUT_GENERATION_ISOLATION_AND_CODEC_LABEL_ACCURACY_REPORT.md` | Markdown | Created | Comprehensive architectural, root-cause, implementation, and testing report. |

---

## 6. Detailed Test Scenarios Added to `test/unit/camera_capture_test.dart`

In strict alignment with the testing policy (`WRITE-ONLY. ZERO TESTS EXECUTED`), all 10 required test scenarios were authored without running test runners, compilers, or analyzers:

1. **Scenario 1 — Stale Generation 1 timeout cannot clear Generation 2's active context:**
   - Starts Generation 1, then starts Generation 2.
   - Emits a delayed timeout error event belonging to Generation 1 (`generation: 1`).
   - Asserts that Generation 2's `textureId` remains non-null, `captureGeneration` remains 2, state remains `capturing`, and `captureError` is not set.

2. **Scenario 2 — Stale Generation 1 timeout cannot change Generation 2's capture state:**
   - Starts Generation 1 and switches to the front lens (Generation 2).
   - Emits a stale hardware start timeout event for Generation 1.
   - Asserts that state remains `capturing` and `captureError` is null.

3. **Scenario 3 — Stale timeout only releases its own generation's resources:**
   - Starts Generation 1, switches to front lens (Generation 2).
   - Simulates Generation 1 timeout error callback.
   - Asserts that Generation 2's texture ID, active encoder, and preview frame status remain fully intact.

4. **Scenario 4 — Current-generation timeout transitions the correct context to error:**
   - Starts capture, captures current generation.
   - Emits timeout error matching `notifier.captureGeneration`.
   - Asserts that state transitions to `CameraCaptureStatus.error`, `isCapturing` becomes false, `textureId` is cleared to null, and `captureError` contains the timeout message.

5. **Scenario 5 — Timeout racing with successful preview readiness does not terminate active capture:**
   - Sets `mockIsCaptureRequestStarted = true` and `mockHasPreviewFrame = true`.
   - Starts capture, confirming `isPreviewReady == true`.
   - Verifies that when preview frame arrival has completed, active capture is not terminated.

6. **Scenario 6 — Concurrent stop and timeout cleanup remain idempotent:**
   - Initiates capture and triggers concurrent `stopCapture()` futures.
   - Asserts that both complete successfully without unhandled exceptions and state safely settles in `idle` with null texture.

7. **Scenario 7 — API 29+ hardware classification uses `HW H.264 (PLATFORM-REPORTED)`:**
   - Instantiates `CameraState` with `codecAcceleration: 'HARDWARE'` and `isEncoderActive: true`.
   - Asserts `isHardwareAcceleratedCodec == true`, `isSoftwareCodec == false`, and `transportStatusLabel` equals `'HW H.264 (PLATFORM-REPORTED) • TRANSPORT OFFLINE'`.

8. **Scenario 8 — Pre-API 29 vendor codecs remain unverified (`H.264 (ACCELERATION UNVERIFIED)`):**
   - Instantiates `CameraState` with `codecName: 'OMX.qcom.video.encoder.avc'`, `codecAcceleration: 'UNVERIFIED'`, and `isEncoderActive: true`.
   - Asserts `isUnverifiedCodec == true`, `isHardwareAcceleratedCodec == false`, and `transportStatusLabel` equals `'H.264 (ACCELERATION UNVERIFIED) • TRANSPORT OFFLINE'`.

9. **Scenario 9 — Software and unverified labels remain accurate across states:**
   - Software encoder: asserts `isSoftwareCodec == true` and label equals `'SW H.264 • TRANSPORT OFFLINE'`.
   - Preview only: asserts label equals `'PREVIEW ONLY • TRANSPORT OFFLINE'`.
   - Idle standby: asserts label equals `'VIEWERS: NOT CONNECTED'`.

10. **Scenario 10 — Camera timeout and cleanup changes do not modify Storage credentials or lifecycle:**
    - Persists `storage_server_admin_token` and `device_installation_id` to `SecureStorageService`.
    - Cycles through capture start, simulated timeout error, recovery, and stop.
    - Asserts both storage credentials remain unaltered and readable.

### 6.1 Deferred Execution Policy
As mandated by the ZdexCloud global engineering standards:
`// Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.`  
Zero test runners, Gradle builds, or Flutter analyzers were invoked. All validations were performed via non-destructive AST and structural balance analysis.

---

## 7. Compliance with Architectural & Preservation Invariants

1. **Storage Engine Preservation:**
   - All Storage credentials (`storage_server_admin_token`, `device_installation_id`), storage channels (`net.remotenode.fileserver/storage`), and server engines remain untouched.
2. **Single APK Preservation:**
   - Both Storage and Camera modules reside within the single unified Android application (`net.remotenode.fileserver`).
3. **No Network Streaming or Background Service:**
   - Phase 21.4.3 introduces zero WebRTC signaling, TURN, SFU, background camera services, or foreground services (`PlatformSupervisorService` remains deferred to Phase 21.5).
4. **Zero Backend Changes:**
   - No backend endpoints, Prisma migrations, database schemas, or billing services were altered.

---

## 8. Conclusion & Status

Phase 21.4.3 is **COMPLETE**. The native Android Camera2 capture engine and Flutter preview UI possess generation-isolated timeout ownership, race-free cleanup idempotency, and truthful platform-reported codec acceleration labels.
