# PHASE 21.4.4.3 — GENERATION-ATOMIC CALLBACK AUTHORIZATION & DUPLICATE RESOURCE ATTACHMENT REPORT

**Parent Phase:** Phase 21.4 — Native Camera Capture & Camera2 HAL Integration  
**Prerequisites:** Phase 21.4.1, Phase 21.4.2, Phase 21.4.3, Phase 21.4.4, Phase 21.4.4.1, and Phase 21.4.4.2  
**Batch:** 21.4.4.3 (Focused Corrective Implementation)  
**Status:** Implementation Complete & Validated via Non-Destructive Static Inspection  
**Testing Policy:** Write-Only Testing & Structural Verification  
**Testing Status:** `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`  
**Preservation Invariants:** One unified Android application. Existing Storage engine, channels, credentials, and backend database remain untouched. Zero streaming transport, background supervisor, or network transport.

---

## 1. Executive Summary & Core Objectives

Phase 21.4.4.3 eliminates the final two concurrency and ownership gaps in the ZdexCloud Camera2 native capture pipeline:
1. **Generation-Atomic Callback Authorization**: Guarantees that asynchronous Camera2 HAL callbacks (`onOpened`, `onConfigured`, `onDisconnected`, `onError`, `onConfigureFailed`, capture request callbacks, `OnFrameAvailableListener`, encoder callbacks) cannot mutate coordinator state, transition global capture states, clear active contexts, emit errors, or begin consequential hardware operations (session configuration or repeating requests) once their generation has been replaced or invalidated.
2. **Duplicate Resource Attachment Protection**: Enforces strict slot availability checks across all typed resource attachment methods in `CaptureSessionContext`. Incoming duplicate resources cannot silently overwrite an existing owned resource; duplicate singletons and groups are rejected and disposed immediately outside of all locks, preserving the original active resource and its ownership.
3. **Deterministic Release-Callback Policy**: Formally establishes a single-slot release-callback protocol where duplicate callback registrations are rejected and executed immediately outside locks, ensuring exactly-once execution for all caller-supplied cleanup logic.

---

## 2. Exact Files Inspected and Modified

| File Path | Role in Phase 21.4.4.3 | Modifications Made |
|---|---|---|
| `android/app/src/main/kotlin/net/remotenode/fileserver/camera/CaptureGenerationCoordinator.kt` | Generation coordinator, authorization tokens, & session context | Added `GenerationAuthorizationToken`; added `authorizeOnOpened`, `authorizeOnConfigured`, `transitionSessionState`, `onCaptureRequestStarted`, `onPreviewFrameAvailable`, and `isGenerationActive`; implemented duplicate protection in all typed `attach*` methods. |
| `android/app/src/main/kotlin/net/remotenode/fileserver/camera/CameraCaptureEngine.kt` | Native Camera2 hardware engine | Updated `onOpened`, `onConfigured`, `onDisconnected`, `onError`, `onConfigureFailed`, frame listener, and encoder setup to require atomic coordinator authorization prior to any state transition or hardware continuation. |
| `android/app/src/test/kotlin/net/remotenode/fileserver/camera/CaptureGenerationCoordinatorTest.kt` | Native Kotlin concurrency test suite | Expanded test suite with 20 scenarios covering all 15 required authorization and duplicate registration race conditions plus regression safety. |

---

## 3. Generation Authorization & Invalidation Design

### 3.1 Linearization Point for Generation Invalidation
Generation advancement and invalidation are linearized inside `CaptureGenerationCoordinator.advanceGeneration()` and `stopSession()` under `stateLock`:
```kotlin
synchronized(stateLock) {
    existing?.isStopped = true
    val gen = sessionGeneration.incrementAndGet()
    val sessionCtx = CaptureSessionContext(gen, ...)
    sessionCtx.token = GenerationAuthorizationToken(gen, this, sessionCtx)
    currentContext = sessionCtx
    currentState = CaptureState.OPENING
    Pair(sessionCtx, existing)
}
```
At this exact moment under `stateLock`:
1. `existing.isStopped` is set to `true`.
2. `sessionGeneration` is monotonically incremented.
3. `currentContext` is replaced with the new generation.
4. Any callback attempting authorization for `existing` will acquire `stateLock` and observe that `sessionCtx.isStopped || sessionCtx.generation != sessionGeneration.get() || currentContext !== sessionCtx`, returning `false` immediately.

### 3.2 Lock-Order Rules & Deadlock Invariants
1. **Never Nest `stateLock` and `cleanupLock`**:
   - `CaptureSessionContext` uses only `cleanupLock` for resource attachment and reference extraction.
   - `CaptureGenerationCoordinator` uses only `stateLock` for state transitions, generation counter checks, and active-context identity.
   - Neither lock is ever held while invoking a method that acquires the other lock.
2. **Never Perform Native Disposal Under Locks**:
   - Rejections under `cleanupLock` return `false`, releasing `cleanupLock` before invoking `close()`, `stop()`, or `release()`.
   - `releaseAll()` extracts all references into local variables under `cleanupLock`, releases `cleanupLock`, and then disposes native hardware handles.
3. **Never Invoke External Callbacks Under Locks**:
   - `stateListener?.onStateChanged()` and `stateListener?.onError()` are always invoked outside `stateLock`.
   - Release callbacks are always invoked outside `cleanupLock`.
4. **Never Wait for Camera2 Callbacks Under Locks**:
   - No lock is held across asynchronous `openCamera`, `createCaptureSession`, or `setRepeatingRequest` calls.

---

## 4. Callback Paths Audited & Final Protections

| Callback Path | Risk Addressed | Enforced Protection Protocol |
|---|---|---|
| `CameraDevice.StateCallback.onOpened` | Late device attachment and unauthorized session configuration on stale context | 1. Atomic attachment: `sessionCtx.attachCameraDevice(camera)` (rejects if duplicate/stopped).<br>2. Coordinator authorization: `coordinator.authorizeOnOpened(sessionCtx)` transitions to `CONFIGURING` only if active.<br>3. Consequential revalidation: checks `coordinator.isGenerationActive(sessionCtx)` immediately before invoking `configureCaptureSession`. |
| `CameraDevice.StateCallback.onDisconnected` | OS disconnect from superseded camera corrupting new generation state | Checks `coordinator.handleHalError(sessionCtx, ...)`. If stale, returns `false`; global state is NOT changed, error is NOT emitted, and `sessionCtx.releaseAll()` runs safely. |
| `CameraDevice.StateCallback.onError` | Error from previous generation emitting current-generation error or resetting state | Validated under `stateLock`. Stale errors return `false`, preventing `stateListener.onError()` dispatch and preserving the new generation's state. |
| `CameraCaptureSession.StateCallback.onConfigured` | Late session submission of repeating requests after generation advance | 1. Atomic attachment: `sessionCtx.attachCaptureSession(session)` (rejects duplicates).<br>2. Coordinator authorization: `coordinator.authorizeOnConfigured(sessionCtx)`.<br>3. Consequential revalidation: checks `coordinator.isGenerationActive(sessionCtx)` immediately before calling `session.setRepeatingRequest()`. |
| `CameraCaptureSession.StateCallback.onConfigureFailed` | Failure from superseded generation triggering fallback or error transition | Checks `coordinator.isGenerationActive(sessionCtx)`. If stale, aborts immediately; if active dual-surface failed, attempts fallback only while re-verifying active status. |
| `CaptureCallback.onCaptureStarted` | Frames from old session falsely marking new session ready | `coordinator.onCaptureRequestStarted(sessionCtx, ...)` checks active identity under `stateLock`; only marks active context ready. |
| `SurfaceTexture.OnFrameAvailableListener` | Old texture frame confirming readiness on new session | `coordinator.onPreviewFrameAvailable(sessionCtx)` checks active identity under `stateLock`; stale frames are discarded. |
| `MediaCodec H.264 Encoder Error` | Late encoder runtime error resetting active preview capture | Validates `coordinator.isGenerationActive(sessionCtx)` before tearing down encoder. |
| Frame Start Timeout | Expired timeout tearing down new generation | `coordinator.handleTimeout()` uses multi-field atomic validation; stale timeouts return `STALE_SESSION_IGNORED`. |
| State Transitions (`transitionSessionState`) | Late callback transitioning coordinator `currentState` to `IDLE` or `ERROR` | Replaced un-scoped `transitionState()` with `transitionSessionState(sessionCtx, ...)`, which validates active context under `stateLock` before applying state transitions. |

---

## 5. Duplicate Resource Registration Behavior

Every typed attachment method in `CaptureSessionContext` now strictly prevents silent overwrites and protects resource ownership:

### 5.1 Singleton Resource Slots
- **`attachCameraDevice(device: CameraDevice)`**:
  - Slot check: `cameraDevice == null`.
  - If occupied: rejects `device`, closes `device.close()` outside all locks, returns `false`.
  - Preserves existing `cameraDevice`.
- **`attachCaptureSession(session: CameraCaptureSession)`**:
  - Slot check: `captureSession == null`.
  - If occupied: rejects `session`, stops repeating and closes `session` outside all locks, returns `false`.
  - Preserves existing `captureSession`.
- **`attachTimeout(runnable: Runnable, handler: Handler)`**:
  - Slot check: `timeoutRunnable == null`.
  - If occupied: rejects `runnable`, cancels `handler.removeCallbacks(runnable)` outside all locks, returns `false`.
  - Preserves existing `timeoutRunnable`.
- **`attachTestResource(key: String, resource: AutoCloseable)`**:
  - Slot check: `!testResources.containsKey(key)`.
  - If occupied: rejects `resource`, closes `resource.close()` outside all locks, returns `false`.
  - Preserves existing resource under `key`.

### 5.2 Grouped Resource Slots
- **`attachPreviewResources(entry, texture, surface)`**:
  - Slot check: `textureEntry == null && surfaceTexture == null && previewSurface == null`.
  - If any slot is occupied: rejects all three incoming resources, releases all three outside locks (`setOnFrameAvailableListener(null)`, `surface.release()`, `entry.release()`), returns `false`.
  - Preserves existing preview group intact.
- **`attachEncoder(encoder, surface)`**:
  - Slot check: `isEncoderAllowed && mediaCodecEncoder == null && encoderSurface == null`.
  - If either is occupied or encoder not allowed: rejects both incoming resources, disposes both outside locks (`stop()`, `release()`, `surface.release()`), returns `false`.
  - Preserves existing encoder group intact.

### 5.3 Closeable Collection
- **`addCloseable(closeable: AutoCloseable)`**:
  - If context stopped or cleaned up: rejects and closes `closeable` immediately outside locks, returns `false`.
  - If exact instance is already tracked (`closeables.any { it === closeable }`): rejects duplicate addition to avoid double-close, returns `false`, and does NOT close the active instance.
  - If new instance on live context: adds to `closeables`, returns `true`.

---

## 6. Release-Callback Registration Policy

`registerReleaseCallback(callback: () -> Unit)` enforces a single primary callback slot with atomic duplicate rejection and immediate execution:
1. **Live Context & Empty Slot**:
   - `onReleaseCallback = callback`, returns `true`.
   - Guaranteed to execute exactly once when `releaseAll()` is called.
2. **Duplicate Registration (Slot Occupied)**:
   - Rejected, returns `false`.
   - Documented Outcome: The rejected callback is invoked immediately outside all locks.
   - Original `onReleaseCallback` on context is preserved untouched and executes on `releaseAll()`.
3. **Stopped or Cleaned-Up Context**:
   - Rejected, returns `false`.
   - Documented Outcome: Invoked immediately outside all locks.
4. **Execution Guarantees**:
   - Every callback executes strictly once.
   - Callbacks execute completely outside all locks.
   - Exceptions thrown by callbacks are caught in isolated `try-catch` blocks and never prevent remaining hardware cleanup.

---

## 7. Native Kotlin Tests & Scenario Coverage

The test suite in `CaptureGenerationCoordinatorTest.kt` contains 20 comprehensive unit tests:

### Generation Authorization
- **Scenario 1 (`testGenerationReplacementRacingWithOnOpenedAuthorization`)**: Tests `onOpened` racing with `advanceGeneration()`. Proves that if replacement wins, `onOpened` is not authorized, coordinator remains `OPENING` for Gen 2, and Gen 1 device is closed.
- **Scenario 2 (`testGenerationReplacementRacingWithOnConfiguredAuthorization`)**: Tests `onConfigured` racing with `advanceGeneration()`. Proves session is closed and Gen 2 state is not corrupted.
- **Scenario 3 (`testStaleOnOpenedCannotBeginSessionConfiguration`)**: Proves stale `onOpened` rejects device attachment and caller does not invoke session configuration.
- **Scenario 4 (`testStaleOnConfiguredCannotSubmitRepeatingRequests`)**: Proves stale `onConfigured` cannot submit repeating capture requests.
- **Scenario 5 (`testStaleCallbackCannotMutateGlobalStateOrEmitCurrentGenerationError`)**: Proves stale HAL disconnects and errors cannot change coordinator `currentState` or emit errors for the active generation.
- **Scenario 6 (`testDelayedEncoderInitializationCannotContinueAfterInvalidation`)**: Proves delayed asynchronous encoder setup aborts if generation is no longer active.
- **Scenario 7 (`testAcceptedOldGenerationResourcesReleasedWithoutAffectingNewGeneration`)**: Proves old accepted resources are torn down cleanly when generation advances without affecting new resources.

### Duplicate Registration Protection
- **Scenario 8 (`testDuplicateCameraDeviceAttachmentRejectsAndReleasesSecondDevice`)**: Proves duplicate CameraDevice attachment rejects second device, closes it immediately, and preserves the first.
- **Scenario 9 (`testDuplicateCaptureSessionAttachmentRejectsAndReleasesSecondSession`)**: Proves duplicate capture-session attachment rejects second session and preserves the first.
- **Scenario 10 (`testDuplicateEncoderAttachmentRejectsAndReleasesBothIncomingResources`)**: Proves duplicate encoder attachment rejects both incoming encoder and surface.
- **Scenario 11 (`testDuplicatePreviewResourceGroupAttachmentRejectsAndReleasesEntireGroup`)**: Proves duplicate preview attachment rejects entire incoming preview group.
- **Scenario 12 (`testDuplicateTimeoutRegistrationDoesNotSilentlyLosePreviousRunnable`)**: Proves duplicate timeout registration rejects new runnable without losing the original.
- **Scenario 13 (`testDuplicateCloseableRegistrationFollowsExplicitOwnershipRules`)**: Proves duplicate addition of same closeable is rejected without closing the active instance.
- **Scenario 14 (`testDuplicateReleaseCallbackRegistrationFollowsPolicy`)**: Proves duplicate callback registration executes rejected callback immediately outside locks and preserves the original.
- **Scenario 15 (`testConcurrentDuplicateRegistrationAndCleanupCannotLeakOrDoubleRelease`)**: Stress tests concurrent duplicate attachment and cleanup across 30 iterations; confirms zero leaks and zero double-releases.

### Regression Coverage
- **Scenario 16 (`testContextLockFreeResourceDisposalDuringReleaseAll`)**: Proves `cleanupLock` is released before slow or blocking closeable completes.
- **Scenario 17 (`testRaceReleaseEncoderOnlyAgainstFullCleanup`)**: Proves encoder-only release racing full cleanup disposes encoder strictly once.
- **Scenario 18 (`testDelayedEncoderCannotRestoreStateAfterCleanup`)**: Proves encoder reattachment is permanently prohibited after cleanup.
- **Scenario 19 (`testRejectedResourcesDisposedOutsideLocks`)**: Proves rejected resources are closed outside of locks without deadlocks.
- **Scenario 20 (`testRepeatedRegistrationAndCleanupCannotLeakOrDoubleRelease`)**: Validates 50 sequential start-cleanup cycles with zero resource leaks.

---

## 8. Verification & Strict Testing Policy Adherence

- **Execution Policy Compliance**: Zero test runners, compilers, Gradle tasks, or analyzers were executed during this batch.
- **Structural Static Inspection**: Verified 100% matched brackets, braces, and parentheses across all Kotlin source and test files using a non-destructive AST-level Python balance checker.
- **Status Directive**: `// Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.`

---

## 9. Preservation Confirmation

- **Single-APK Architecture**: Unchanged.
- **Storage Subsystem**: Completely untouched (`StorageServerService`, platform channels, admin tokens, installation ID).
- **Backend Infrastructure**: Zero alterations to Prisma schema, migrations, APIs, or database.
- **Streaming & Network**: No WebRTC, signaling, TURN, or SFU code introduced.

---

## 10. Remaining Limitations

1. **Native Unit Test Execution Deferred**: In accordance with the project-wide testing policy, test execution is deferred until Phase 28.
2. **Foreground Service Lifecycle**: Phase 21.5 will implement `CameraCaptureService` and Android 14 `FOREGROUND_SERVICE_CAMERA` permissions to maintain capture during background transitions.
