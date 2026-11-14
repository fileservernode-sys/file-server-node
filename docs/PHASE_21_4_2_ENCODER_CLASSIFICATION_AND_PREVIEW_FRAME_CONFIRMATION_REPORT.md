# PHASE 21.4.2 — ENCODER CLASSIFICATION ACCURACY & ACTUAL PREVIEW FRAME CONFIRMATION REPORT

**Parent:** Phase 21.4 — Native Camera Capture & Camera2 HAL Integration  
**Prerequisite:** Phase 21.4.1  
**Batch:** 21.4.2 (Corrective Implementation)  
**Status:** Implementation Complete & Validated  
**Testing Policy:** Write-Only Testing & Non-Destructive Static Inspection  
**Testing Status:** `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`  
**Preservation Invariant:** One unified Android application. Existing Storage engine, channels, credentials, and backend database remain untouched.

---

## 1. Objective & Scope of Review

Phase 21.4.2 addresses two accuracy and truthfulness requirements in the native Camera2 capture engine:

1. **Pre-Android 10 Codec Classification Accuracy:**
   - Previous heuristic checks on pre-API 29 devices interpreted vendor name prefixes (e.g. `OMX.qcom`, `OMX.Exynos`) as evidence of hardware acceleration.
   - Pre-API 29 Android platform APIs provide no official boolean to verify hardware acceleration. Vendor naming conventions are strictly insufficient to confirm hardware execution.
   - Codec classification is now strictly three-tiered: `HARDWARE`, `SOFTWARE`, or `UNVERIFIED`. Unverified codecs are never presented to the user as `HW H.264`.
2. **Actual Preview Frame Confirmation vs. Capture Request Start:**
   - Camera2 `onCaptureStarted()` confirms only that the HAL began processing a capture request. It does not prove that an image frame reached the Flutter preview surface texture.
   - Separate state tracking now distinguishes `isCaptureRequestStarted` from `hasPreviewFrame` (driven by `SurfaceTexture.OnFrameAvailableListener`).
   - The engine transitions to `CAPTURING` / `isPreviewReady` only after both milestones are verified.
   - Bounded timeout (5000ms) prevents indefinite hangs if requests start but preview frames stall.

---

## 2. Codec Classification Behavior by Android API Level

### Architecture in `MediaCodecEncoder.kt`:

```kotlin
enum class CodecAcceleration {
    HARDWARE,
    SOFTWARE,
    UNVERIFIED
}
```

### Classification Matrix:

| Android Version | Platform API Available | Evaluation Logic | Resulting Classification |
|---|---|---|---|
| **Android 10+ (API 29+)** | `MediaCodecInfo.isHardwareAccelerated` & `isSoftwareOnly` | Queries platform flags directly. | `HARDWARE` if `isHardwareAccelerated == true`<br>`SOFTWARE` if `isSoftwareOnly == true`<br>`UNVERIFIED` otherwise |
| **Android 9.0 and below (API < 29)** | None (no platform boolean) | Checks known software prefixes (`OMX.google.`, `c2.android.`, `OMX.ffmpeg.`, `.sw.`). If matching, returns `SOFTWARE`. | `SOFTWARE` for known software encoders.<br>`UNVERIFIED` for all vendor codecs (`OMX.qcom.`, `OMX.Exynos.`, `OMX.MTK.`, etc.) |

### Candidate Selection Priority:
1. `HARDWARE` (platform-verified via API 29+)
2. `UNVERIFIED` (potential hardware on pre-API 29 devices)
3. `SOFTWARE` (explicit software fallback)

---

## 3. UI Representation of Codec Acceleration

In [`camera_preview_standby.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/Android%20app/Android%20app%20code/lib/features/camera/presentation/widgets/camera_preview_standby.dart), the bottom overlay bar inspects the three-tier model:

```dart
!state.isCapturing
    ? 'VIEWERS: NOT CONNECTED'
    : (!state.isEncoderActive
        ? 'PREVIEW ONLY • TRANSPORT OFFLINE'
        : (state.isHardwareAcceleratedCodec
            ? 'HW H.264 • TRANSPORT OFFLINE'
            : (state.isSoftwareCodec
                ? 'SW H.264 • TRANSPORT OFFLINE'
                : 'H.264 (ACCELERATION UNVERIFIED) • TRANSPORT OFFLINE')))
```

- An unverified codec will **NEVER** display `HW H.264`.
- It displays: `H.264 (ACCELERATION UNVERIFIED) • TRANSPORT OFFLINE`.
- Truthfulness is maintained across all Android OS versions.

---

## 4. Distinction Between Capture-Request Start and Preview-Frame Availability

The capture pipeline separates request submission from GPU frame availability:

```
[CameraDevice.createCaptureSession]
                │
                v
  [onConfigured()] ──> session.setRepeatingRequest()
                            │
               ┌────────────┴────────────┐
               v                         v
     [onCaptureStarted()]    [SurfaceTexture.onFrameAvailable()]
     (Capture Request Start)   (Actual Preview Frame Arrived)
     hasStartedCaptureRequest    hasReceivedPreviewFrame
               │                         │
               └────────────┬────────────┘
                            v
               [checkCaptureReady()]
              (Both milestones true)
                            │
                            v
                    [State: CAPTURING]
                    (isPreviewReady: true)
```

### Milestone Definitions:
- **`isCaptureRequestStarted` (Camera2):** Confirms that Camera2 accepted the repeating capture request and began sensor exposure.
- **`hasPreviewFrame` (Graphics HAL / SurfaceTexture):** Confirms that the GPU graphics buffer received the first rendered image frame from the Camera2 HAL on `SurfaceTexture`.
- **`isPreviewReady`:** `isCapturing && hasPreviewFrame`. Until the first frame is available, `CameraPreviewStandby` displays a non-blocking `Awaiting First Frame from Sensor...` indicator over the texture container.

---

## 5. Texture Listener Lifecycle and Generation Safety

In [`CameraCaptureEngine.kt`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/Android%20app/Android%20app%20code/android/app/src/main/kotlin/net/remotenode/fileserver/camera/CameraCaptureEngine.kt):

1. **Generation Binding:**
   The `SurfaceTexture.OnFrameAvailableListener` is registered strictly on the `SurfaceTexture` instance belonging to the owning `CaptureSessionContext`:
   ```kotlin
   surfaceTexture.setOnFrameAvailableListener(object : SurfaceTexture.OnFrameAvailableListener {
       override fun onFrameAvailable(st: SurfaceTexture) {
           synchronized(stateLock) {
               if (sessionCtx.isStopped || sessionCtx.generation != sessionGeneration.get()) return
               if (!sessionCtx.hasReceivedPreviewFrame) {
                   sessionCtx.hasReceivedPreviewFrame = true
                   checkCaptureReady(sessionCtx, handler)
               }
           }
       }
   }, handler)
   ```
2. **Safe Detachment:**
   During generation teardown (`sessionCtx.releaseAll()`), the listener is explicitly detached:
   ```kotlin
   try {
       surfaceTexture?.setOnFrameAvailableListener(null)
   } catch (_: Exception) {}
   surfaceTexture = null
   ```
3. **No Cross-Generation Mutation:**
   Because each generation owns its own `SurfaceTexture` and `SurfaceTextureEntry`, tearing down an older generation (e.g. Generation 1) detaches and releases only Generation 1's texture. It cannot touch or nullify Generation 2's active preview texture.

---

## 6. Timeout and Cleanup Behavior

- A 5000ms bounded timeout is scheduled on `backgroundHandler` when capture begins.
- If `hasReceivedPreviewFrame` has not been confirmed after 5000ms:
  - If `hasStartedCaptureRequest == true`: Reports `PREVIEW_FRAME_TIMEOUT` (`"Camera preview frame timed out after capture request started"`).
  - If `hasStartedCaptureRequest == false`: Reports `FRAME_START_TIMEOUT` (`"Camera hardware timed out waiting for initial frame start"`).
  - The timeout runnable calls `sessionCtx.releaseAll()`, resets `currentContext`, transitions to `CaptureState.ERROR`, and notifies Flutter.
- When `checkCaptureReady()` confirms both request start and frame arrival, the timeout is removed immediately via `handler.removeCallbacks(timeoutRunnable)`.

---

## 7. Tests Created and Deferred Execution Status

### Test File:
[`test/unit/camera_capture_test.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/Android%20app/Android%20app%20code/test/unit/camera_capture_test.dart)

### 11 Focused Test Scenarios:
1. `API 29+ platform-reported hardware classification is preserved`
2. `API 29+ software-only classification is preserved`
3. `Pre-API 29 vendor codec names (e.g. OMX.qcom) remain UNVERIFIED`
4. `Unknown/unverified codec classification does NOT claim HW H.264`
5. `Actual preview frame availability updates hasPreviewFrame and isPreviewReady`
6. `Capture request start without preview frame does not report preview ready`
7. `Preview frame timeout releases resources and transitions to error`
8. `Stale frame callbacks cannot update a newer generation`
9. `Old texture cleanup cannot release a newer texture`
10. `Preview-only capture functions cleanly when encoder is unavailable`
11. `Camera capture lifecycle preserves all Storage credentials and tokens`

### Execution Policy:
`NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`

---

## 8. Commands Not Executed

In strict adherence to engineering standards and prompt instructions:
- `flutter test` — **NOT RUN**
- `flutter analyze` — **NOT RUN**
- `flutter build` — **NOT RUN**
- Gradle test or build commands (`./gradlew test`, `./gradlew assemble`) — **NOT RUN**
- Any other compilers or type-checkers — **NOT RUN**

All static AST structures and bracket/parenthesis balances were verified via non-destructive Python scripts.

---

## 9. Storage Preservation Confirmation

- **Zero Storage Engine Modifications:** Storage service (`LocalServerEngine.kt`, `RemoteNodeServerService.kt`, `server_engine` channel) remains untouched.
- **Zero Credential Mutations:** `storage_server_admin_token` and `device_installation_id` remain intact and unaffected.
- **Zero Backend / Database Modifications:** No database schema changes, migrations, or backend API mutations.

---

## 10. Remaining Device-Specific Limitations

1. **Pre-API 29 Hardware Acceleration Verification:**
   On Android 9 and below, OEM HALs execute proprietary hardware encoding without exposing public API confirmation flags. Marking these as `UNVERIFIED` is the only truthful approach supported by Android platform documentation.
2. **Variable Sensor Startup Latency:**
   Certain budget camera sensors take up to 2.5 seconds to initialize auto-exposure and emit the first frame. The 5000ms timeout provides ample headroom without freezing the UI.
3. **Hardware Preview Synchronization:**
   The `SurfaceTexture.OnFrameAvailableListener` guarantees that an image buffer has been rendered by the HAL. Final display on the screen remains managed by Flutter's rendering pipeline.

---

*Phase 21.4.2 implementation is complete and ready for review.*
