# ZDEXCLOUD — PHASE 21.5.1.1 IMPLEMENTATION REPORT
## Foreground Service Startup Order, Android 15 Compliance & Engine Ownership Correction

**Parent Phase:** 21.5.1 — Platform Supervisor Service & Independent Engine Lifecycle  
**Batch:** 21.5.1.1  
**Execution Mode:** Focused Corrective Implementation  
**Testing Policy:** Write-Only Testing & Static Source Inspection  
**Test Execution Status:** NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.  
**Completion Date:** November 14, 2026  

---

## 1. Executive Summary & Existing Source Behavior Inspected

Phase 21.5.1.1 resolves the remaining architectural and Android platform compatibility concerns identified during the Phase 21.5.1 review. While Phase 21.5.1 established the unified supervisor (`PlatformSupervisorService`) and independent engine lifecycle states, a rigorous source audit identified five critical hazards in the initial design:

1. **Premature Camera2 Hardware Acquisition (Startup Inversion):**
   - *Previous behavior:* In `CameraEngineHandler.handleStartCapture`, `PlatformSupervisorService.onCameraStarted` merely invoked `ContextCompat.startForegroundService(context, intent)` (which returns immediately) and then directly opened Camera2 hardware via `captureEngine.startCapture()`.
   - *Risk:* On Android 14+ (API 34/35), opening the camera device before the foreground service is confirmed running with `FOREGROUND_SERVICE_TYPE_CAMERA` violates the platform contract. If background execution restrictions reject the FGS start asynchronously, Camera2 hardware is left running without FGS coverage.
2. **Fragile Engine Ownership & Accidental Teardown on Activity Destruction:**
   - *Previous behavior:* The supervisor held a weak/volatile reference to `activeCameraEngine`. When `MainActivity` was recreated or detaching its Flutter engine, `CameraEngineHandler.cleanUp()` directly invoked `captureEngine.release()` and `PlatformSupervisorService.onCameraStopped()`.
   - *Risk:* Transitioning away from the app or rotating the screen accidentally destroyed the active Camera capture engine, defeating the core purpose of running a persistent background camera foreground service.
3. **Background Lifecycle Policy Contradiction:**
   - *Previous behavior:* `camera_state.dart` had an app lifecycle listener that stopped Camera capture whenever the app entered `paused`, `inactive`, or `detached`.
   - *Risk:* Directly conflicted with maintaining an explicitly user-started camera foreground service across background transitions.
4. **Android 15 (API 35+) `BOOT_COMPLETED` Restriction on `dataSync` FGS:**
   - *Previous behavior:* `BootReceiver` called `ContextCompat.startForegroundService()` with `ACTION_START_STORAGE`, attempting to start `PlatformSupervisorService` with `DATA_SYNC` type upon device reboot.
   - *Risk:* Android 15 prohibits launching `dataSync` foreground services from `BOOT_COMPLETED`. Target API 35 devices would encounter `ForegroundServiceStartNotAllowedException` upon reboot.
5. **Stale Legacy Fallback Drift & Missing Special Use Manifest Property:**
   - *Previous behavior:* `RemoteNodeServerService.isServiceRunning` fell back to `_legacyServiceRunning` when `PlatformSupervisorService.isStorageActive` was false, creating split-brain state reporting. Additionally, the required `android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE` lacked a precise self-hosted file server explanation.

Phase 21.5.1.1 resolves all five issues while maintaining strict isolation between Storage and Camera engines.

---

## 2. Exact Files Modified and Created

| File | Change Type | Purpose |
| :--- | :--- | :--- |
| `android/app/src/main/kotlin/net/remotenode/fileserver/PlatformSupervisorService.kt` | **Modified** | Implemented asynchronous FGS promotion acknowledgement queue (`requestCameraForegroundPromotion`), strong engine ownership (`attachActiveCameraEngine`/`detachActiveCameraEngine`), shutdown generation tracking to prevent delayed `stopSelf()` races, and `SupervisorBinder`. |
| `android/app/src/main/kotlin/net/remotenode/fileserver/camera/CameraEngineHandler.kt` | **Modified** | Reordered Camera startup: permission check -> async FGS promotion acknowledgement -> Camera2 hardware start. Reused active engine across Activity recreation and preserved running engine on Activity teardown. |
| `android/app/src/main/kotlin/net/remotenode/fileserver/camera/CameraCaptureEngine.kt` | **Modified** | Converted CameraManager and permission checks to use `context.applicationContext`, preventing Activity Context retention/leaks. |
| `android/app/src/main/kotlin/net/remotenode/fileserver/BootReceiver.kt` | **Modified** | Enforced Android 15 (API 35+) policy: suppressed `dataSync` FGS start from `BOOT_COMPLETED` on API >= 35, setting `KEY_BOOT_RESTORE_SUPPRESSED` for foreground recovery on app open. |
| `android/app/src/main/kotlin/net/remotenode/fileserver/MainActivity.kt` | **Modified** | Added `bootRestorationSuppressed` to `getServerStatus` payload; cleared suppression flag when user opens app in foreground; removed duplicate legacy fallback in `isServiceRunning`. |
| `android/app/src/main/kotlin/net/remotenode/fileserver/RemoteNodeServerService.kt` | **Modified** | Removed stale legacy fallbacks (`_legacyServiceRunning`, etc.); all state queries strictly delegate to `PlatformSupervisorService`. |
| `android/app/src/main/AndroidManifest.xml` | **Modified** | Refined `android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE` value with exact, compliant description of self-hosted personal file server engine. |
| `lib/features/camera/application/camera_state.dart` | **Modified** | Resolved background lifecycle contradiction: `handleAppLifecycleState` preserves service-owned capture on background transitions (`paused`/`inactive`/`detached`); `resumed` queries native engine reality via `syncCaptureState()`. |
| `android/app/src/test/kotlin/net/remotenode/fileserver/PlatformSupervisorServiceTest.kt` | **Modified** | Added 8 new native unit tests (22 total) verifying promotion ordering, promotion failure blocking Camera2, strong engine ownership, Activity teardown preservation, Android 15 boot restriction, `SPECIAL_USE` property compliance, stale state rejection, and shutdown race abortion. |
| `test/unit/platform_supervisor_test.dart` | **Modified** | Updated Flutter unit tests to verify background capture preservation and explicit user stop semantics. |
| `docs/PHASE_21_5_1_1_FGS_STARTUP_ORDER_ANDROID_15_COMPLIANCE_AND_ENGINE_OWNERSHIP_REPORT.md` | **Created** | Comprehensive architectural and compliance report. |

---

## 3. Corrected Camera Startup Sequence

To comply with Android 14+ FGS security rules, the Camera startup sequence was completely reordered:

```
[User Action in Flutter UI]
          │
          ▼
[CameraEngineHandler.handleStartCapture]
          │  1. Check ContextCompat.checkSelfPermission(CAMERA)
          │     (If denied -> return result.error("PERMISSION_DENIED"))
          ▼
[PlatformSupervisorService.requestCameraForegroundPromotion]
          │  2. Enqueue callback; post 5000ms safety timeout
          │  3. ContextCompat.startForegroundService(ACTION_START_CAMERA)
          ▼
[PlatformSupervisorService.onStartCommand -> handleStartCamera]
          │  4. updateNotification() -> promoteToForeground()
          │     ServiceCompat.startForeground(NOTIFICATION_ID, notif, FOREGROUND_SERVICE_TYPE_CAMERA)
          │     (Try-Catch handles ForegroundServiceStartNotAllowedException / SecurityException)
          ▼
[Promotion Outcome Dispatch]
     ┌────┴────────────────────────┐
     │ Success                     │ Failure
     ▼                             ▼
[CameraEngineHandler]         [CameraEngineHandler]
  5. captureEngine.startCapture() 5. Do NOT open Camera2
     Open Camera2 hardware           Return result.error("CAMERA_FGS_REJECTED")
     Attach preview/encoder
  6. PlatformSupervisorService.attachActiveCameraEngine()
  7. Return result.success(metadata)
```

### Key Invariants Established:
1. `ContextCompat.startForegroundService()` is **never** treated as proof of successful promotion.
2. `CameraCaptureEngine.startCapture()` and `CameraManager.openCamera()` are **never** invoked until `PlatformSupervisorService` has confirmed that `ServiceCompat.startForeground()` completed without exception.
3. If promotion fails or times out (5000ms), Camera2 hardware remains completely unopened, avoiding invalid hardware state.
4. Concurrent start requests queue into `pendingCameraPromotionCallbacks` and receive the same promotion acknowledgement without launching duplicate services or opening multiple capture sessions.
5. Lifecycle locks (`supervisorLock`) are never held while waiting for service startup or Camera2 callbacks.

---

## 4. Service-Owned Camera Engine Lifetime

The lifecycle of `CameraCaptureEngine` is now firmly anchored to `PlatformSupervisorService`:

1. **Strong Service Ownership:**
   - The supervisor holds a strong reference (`activeCameraEngine`) while Camera is active.
   - `PlatformSupervisorService.attachActiveCameraEngine(engine)` retains the engine; `detachActiveCameraEngine()` clears it.
2. **Decoupled Activity Teardown:**
   - In `CameraEngineHandler.cleanUp()`, which is triggered when `MainActivity` detaches or is destroyed (e.g., config changes, memory reclamation):
     ```kotlin
     if (!PlatformSupervisorService.isCameraActive) {
         PlatformSupervisorService.detachActiveCameraEngine()
         captureEngine.release()
     } else {
         // Decouple listener to prevent leaking destroyed Activity Context
         captureEngine.stateListener = null
     }
     ```
   - If the camera is actively running under the supervisor, Activity destruction **does not** stop or release the engine.
3. **Re-Attachment on Activity Re-Creation:**
   - In `CameraEngineHandler.register()`, the handler queries `PlatformSupervisorService.getActiveCameraEngine()`. If an engine is already running, the new Activity instance re-attaches its listeners and MethodChannels without restarting capture.
4. **Clean Service Teardown:**
   - When the Camera is explicitly stopped (`handleStopCamera()`, persistent notification `"Stop Camera"` button, or `PlatformSupervisorService.onDestroy()`), the service detaches the engine, calls `stopCapture()`, and releases native resources outside of locks.
5. **Context Decoupling:**
   - `CameraCaptureEngine` uses `context.applicationContext` for `CameraManager` and permission queries, completely avoiding Activity Context leaks.

---

## 5. Background and Resume Lifecycle Policy

In `camera_state.dart`, the background lifecycle policy was updated to reconcile the contradiction between UI visibility and background service execution:

```dart
void handleAppLifecycleState(AppLifecycleState lifecycleState) {
  if (lifecycleState == AppLifecycleState.paused ||
      lifecycleState == AppLifecycleState.inactive ||
      lifecycleState == AppLifecycleState.detached) {
    // NOTE: Service-owned Camera capture is maintained continuously in the background
    // by PlatformSupervisorService. Do NOT terminate capture on background transition.
  } else if (lifecycleState == AppLifecycleState.resumed) {
    // Synchronize presentation state with actual native platform engine status
    syncCaptureState();
  }
}
```

- **Background Transition:** Moving the app to the background (screen lock, home button, switching apps) does **not** stop the camera capture engine if it was explicitly started by the user and promoted to a Camera foreground service.
- **Preview Independence:** The Flutter zero-copy `SurfaceTexture` preview remains valid, and the MediaCodec H.264 hardware encoder continues processing frames.
- **App Resume:** When returning to the app, `syncCaptureState()` queries the native engine via `getCaptureState()`. If the engine is capturing, Flutter updates its presentation state (`textureId`, resolution, fps, hardware acceleration flags). If the engine was stopped by the user via the notification or encountered an error, Flutter reflects that state accurately. No duplicate capture sessions are launched.
- **Explicit Stop Required:** Only an explicit user stop in the UI, clicking `"Stop Camera"` in the persistent notification, camera permission revocation, or fatal hardware error will terminate capture.

---

## 6. Android 14/15 Compatibility Decisions

### Android 14 (API 34)
- **FGS Type Mandatory:** Declared `dataSync|specialUse|camera` in `AndroidManifest.xml`.
- **Dynamic Bitmask Switching:** Uses `ServiceCompat.startForeground()` with the exact bitmask matching active engines (`DATA_SYNC | SPECIAL_USE`, `CAMERA`, or dual `DATA_SYNC | SPECIAL_USE | CAMERA`).
- **`SPECIAL_USE` Property Required:** Android 14 requires `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" ... />` inside the `<service>` tag. Added to both `PlatformSupervisorService` and `RemoteNodeServerService`.

### Android 15 (API 35)
- **`BOOT_COMPLETED` Restriction on `dataSync`:** Android 15 prohibits starting a `dataSync` FGS from `BOOT_COMPLETED`. Attempting this throws `ForegroundServiceStartNotAllowedException`.
- **`dataSync` 6-Hour Quota:** `dataSync` foreground services on Android 15 have a 6-hour cumulative limit in a 24-hour rolling window.

---

## 7. Corrected `BootReceiver` Behavior

`BootReceiver.kt` now strictly enforces Android 15 compliance:

```kotlin
val isDesiredEnabled = RemoteNodeServerService.getDesiredServerEnabled(context)
if (!isDesiredEnabled) return

// CAMERA ENGINE IS NEVER RESTORED AT BOOT UNDER ANY CIRCUMSTANCES

// Android 15+ (API 35+) Platform Policy Enforcement:
// BroadcastReceivers responding to BOOT_COMPLETED cannot start dataSync foreground services.
if (Build.VERSION.SDK_INT >= 35) {
    android.util.Log.i(
        "BootReceiver",
        "Storage boot restoration suppressed on Android 15+ (API 35+) per platform FGS policy. Awaiting user app launch."
    )
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putBoolean(KEY_BOOT_RESTORE_SUPPRESSED, true).apply()
    return
}

// Android 14 and earlier (API < 35): Legally permitted to restore Storage foreground service
val serviceIntent = Intent(context, PlatformSupervisorService::class.java).apply {
    this.action = PlatformSupervisorService.ACTION_START_STORAGE
    putExtra(PlatformSupervisorService.EXTRA_PORT, RemoteNodeServerService.getPersistedPort(context))
}
try {
    ContextCompat.startForegroundService(context, serviceIntent)
} catch (e: Exception) {
    android.util.Log.e("BootReceiver", "Failed to restore storage service at boot: ${e.message}")
}
```

### Flutter Visibility & Foreground Auto-Recovery
In `MainActivity.kt`:
- `"getServerStatus"` includes `bootRestorationSuppressed: Boolean`.
- When the user launches the app into the foreground on Android 15+, `MainActivity` detects the suppression flag, clears it, and can prompt or auto-start the server legally from the visible Activity context.

---

## 8. Storage Foreground-Service Type Decision & Rationale

| Foreground Service Type | Workload Covered | Platform Constraints | Policy Decision |
| :--- | :--- | :--- | :--- |
| `dataSync` | Active file uploads, chunked downloads, directory synchronization | 6-hour runtime limit per 24 hours on Android 15 (API 35) | Maintained for active data synchronization operations; dynamically paired with `specialUse`. |
| `specialUse` | Continuous local HTTP server daemon and secure WebSocket gateway tunnel host | Requires manifest property explanation; subject to Google Play review | Declared as primary persistent service type for self-hosted server capability. |
| `camera` | Live Camera2 capture, preview surface rendering, hardware H.264 encoding | Must be started from visible state; restricted from background start | Declared exclusively for Camera capture engine. |

Both `dataSync` and `specialUse` are declared because the storage server performs active chunked data synchronization (`dataSync`) while continuously serving as a self-hosted node daemon (`specialUse`).

---

## 9. `SPECIAL_USE` Manifest Property

In `AndroidManifest.xml`, the required property was configured with a specific, compliant description:

```xml
<service
    android:name=".PlatformSupervisorService"
    android:foregroundServiceType="dataSync|specialUse|camera"
    android:exported="false">
    <property
        android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
        android:value="Self-hosted personal file server engine with encrypted peer-to-peer remote node access, maintaining local network HTTP endpoints and persistent gateway connectivity for remote file storage management." />
</service>
```

---

## 10. Legacy State Delegation Corrections

In `RemoteNodeServerService.kt`:
- Removed `_legacyServiceRunning`, `_legacyServerState`, `_legacyActivePort`.
- Custom getters delegate **exclusively** to `PlatformSupervisorService`:
  ```kotlin
  var isServiceRunning: Boolean
      get() = PlatformSupervisorService.isStorageActive
      set(_) {}

  var currentServerState: String
      get() = PlatformSupervisorService.storageServerState
      set(_) {}

  var activePort: Int
      get() = PlatformSupervisorService.activePort
      set(_) {}
  ```
- Setters are no-ops to prevent stale legacy variable drift from ever masking the supervisor's stopped state.
- In `MainActivity.kt`:
  `"isServiceRunning"` returns `PlatformSupervisorService.isStorageActive` directly without dual-check fallback.

---

## 11. Concurrency and Cleanup Guarantees

All 12 lifecycle races audited in Section 8 are addressed:

1. **Camera startup while supervisor is already starting:** Asynchronous callbacks queue in `pendingCameraPromotionCallbacks`; both complete when promotion finishes.
2. **Two simultaneous Camera startup requests:** First starts promotion (`isCameraPromotionInFlight = true`); second joins queue. Only one capture engine is created.
3. **Camera FGS succeeds but Camera2 fails:** Catch block calls `onCameraStopped()`, rolling back `isCameraActive = false` and demoting FGS.
4. **Camera FGS fails before Camera2 startup:** Callback receives `success = false`; `CameraCaptureEngine.startCapture()` is never called.
5. **Camera stops while start is pending:** `handleStopCamera()` cancels pending promotion callbacks with `"OPERATION_CANCELLED"`.
6. **Storage stops while Camera active:** Bitmask demotes to `CAMERA`; supervisor stays in foreground.
7. **Camera stops while Storage active:** Bitmask demotes to `DATA_SYNC | SPECIAL_USE`; supervisor stays in foreground.
8. **Both engines stop concurrently:** Mutex serializes state; second stop invokes `stopForeground(STOP_FOREGROUND_REMOVE)` and `stopSelf()`.
9. **New engine starts during last-engine shutdown:** `shutdownGeneration` increment aborts pending `stopSelf()`.
10. **Activity destroyed while Camera active:** Supervisor holds strong reference; `cleanUp()` only detaches listeners, preserving running engine.
11. **Supervisor destroyed unexpectedly:** `onDestroy()` stops capture and releases native resources outside of locks.
12. **Android 15 rejects Storage boot restoration:** `BootReceiver` checks `Build.VERSION.SDK_INT >= 35` and avoids prohibited FGS start.

---

## 12. Tests Created & Deferred Execution Status

> **Testing Policy Directive:** `// Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.`  
> In compliance with strict project instructions, zero tests, builds, compilers, or analyzers were executed.

### Native Kotlin Tests (`PlatformSupervisorServiceTest.kt`)
Expanded to 22 test scenarios covering:
- Scenarios 1–14: Core lifecycle decoupling, dynamic bitmasks, independent notification actions, boot restoration isolation.
- Scenario 15: `camera_foreground_promotion_before_camera2_startup`
- Scenario 16: `camera2_startup_blocked_after_foreground_promotion_failure`
- Scenario 17: `strong_service_ownership_of_camera_engine`
- Scenario 18: `activity_destruction_preserves_running_camera_engine`
- Scenario 19: `android_15_boot_completed_storage_restriction`
- Scenario 20: `special_use_manifest_property_compliance`
- Scenario 21: `stale_legacy_state_rejection`
- Scenario 22: `concurrent_start_and_delayed_supervisor_shutdown`

### Flutter Unit Tests (`platform_supervisor_test.dart`)
- `app pause preserves background camera capture without stopping service engine`: Asserts `stopCallCount == 0` on pause.
- `explicit user stop terminates capture and releases resources`: Asserts `stopCallCount == 1` and texture cleared.
- `app resume queries HAL reality via syncCaptureState`: Asserts HAL state query.
- `app resume synchronizes native running capture parameters accurately`: Asserts parameter alignment.
- `fgs rejection surfaces CAMERA_FGS_REJECTED without leaving state in fake running`: Asserts error state handling.

---

## 13. Static Inspection Results

A Python non-destructive AST and bracket balance check was executed across all created and touched files:

```text
PlatformSupervisorService.kt: Balanced
RemoteNodeServerService.kt: Balanced
MainActivity.kt: Balanced
BootReceiver.kt: Balanced
CameraEngineHandler.kt: Balanced
CameraCaptureEngine.kt: Balanced
PlatformSupervisorServiceTest.kt: Balanced
camera_state.dart: Balanced
platform_supervisor_test.dart: Balanced
AndroidManifest.xml: Valid XML
STATIC BALANCE VERIFICATION: PASSED
```

---

## 14. Remaining Limitations and Unresolved Risks

1. **Android 15 Foreground Service Quota Monitoring:** While `specialUse` accommodates ongoing daemon execution, Google Play policy review for `specialUse` requires clear store listing disclosures.
2. **WebRTC & Signaling Deferred:** Phase 21.5.1.1 governs local capture and foreground persistence. WebRTC signaling, ICE negotiation, and remote streaming transport remain strictly deferred to Phase 21.6 / Phase 22.
3. **Consolidated Testing Deferred:** In accordance with project policy, all test execution remains deferred until Phase 28.
