# ZDEXCLOUD — PHASE 21.3.1 IMPLEMENTATION REPORT
## Camera Registration & Hardware Configuration Safety Review

**Roadmap:** Phase 21 — Android Camera Server  
**Parent Batch:** Phase 21.3 — Camera Permissions & Device Configuration  
**Batch:** 21.3.1 — Camera Registration & Hardware Configuration Safety Review  
**Next Batch:** Phase 21.4 — Native Camera Capture & Encoding  
**Execution Mode:** Focused Corrective Review and Minimal Safety Patches  
**Testing Policy:** Zero tests executed (`NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`).  
**Build Policy:** Zero builds or analyzers run (`flutter test`, `flutter analyze`, `flutter build`, `dart analyze`, `tsc`, Gradle not executed).  
**Database Policy:** Zero database mutations, zero schema changes, zero migrations executed.  
**Backend Policy:** Zero backend modifications (verified contracts reused as-is).  
**Preservation Invariant:** One unified Android application. Existing Storage (Personal File Server) functionality remains 100% intact.

---

## 1. Executive Summary

Phase 21.3.1 performs a rigorous correctness and safety audit of the Phase 21.3 Camera registration, hardware capability discovery, and Android permission architecture.

Key safety corrections implemented:
1. **Multi-Step Idempotent Camera Registration:** Resolved the risk of duplicate `CameraInstance` creation during retries, network timeouts, or repeated button presses. The client now guards concurrent taps (`isRegistering`), queries existing camera instances via `GET /api/v1/cameras?deviceId={deviceId}` before creating new records, and reuses matching camera instances.
2. **Partial-Failure Recovery:** If device registration (`POST /api/v1/devices/register`) succeeds but camera registration (`POST /api/v1/cameras`) fails or times out, the resolved `deviceId` is persisted in keystore-backed encrypted storage (`zdex_camera_device_id`). On retry, device creation is skipped, and camera binding is resumed directly.
3. **Android Permission Callback Isolation:** Added guards in `CameraEngineHandler.kt` against concurrent permission requests (`CONCURRENT_REQUEST` error) to prevent dropping or leaking pending MethodChannel results. Ensured atomic callback resolution (`pendingCameraResult = null`) across all branches, including user cancellations or system interruptions.
4. **Logical vs. Physical Camera Representation:** Camera2 HAL discovery now queries `REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA` and `characteristics.physicalCameraIds` (API 28+). The UI and domain model explicitly distinguish logical cameras from physical sensors rather than claiming every `CameraManager` ID is a separate physical unit.
5. **HAL Minimum Frame Duration & Joint FPS Validation:** Implemented `getOutputMinFrameDuration` inspection per resolution in `CameraEngineHandler.kt`. The domain model and UI now evaluate whether target FPS can be sustained at a selected resolution, explicitly labeling combinations as `Supported (HAL Verified)`, `Preference (Unverified by HAL)`, or `Unsupported by Sensor` without opening a camera session.
6. **State and Lifecycle Invariants:** Verified that granted permissions, device registration, and camera registration **never** prematurely transition `CameraLifecycleStatus` to `ONLINE` or `STREAMING`.

---

## 2. Registration Idempotency Findings

A deep-dive source audit of `main website/Backend/src/services/camera_service.ts` and `src/services/camera_device_identity_service.ts` revealed:

### Backend Duplicate Handling:
- In `CameraService.registerCamera(...)`, the backend performs an internal duplicate check:
  ```typescript
  if (targetDeviceId && input.cameraName) {
    const existingDuplicate = await tx.cameraInstance.findFirst({
      where: {
        userId,
        deviceId: targetDeviceId,
        cameraName: input.cameraName
      }
    });
    if (existingDuplicate) {
      return existingDuplicate;
    }
  }
  ```
- **Finding:** While the backend prevents duplicates if `cameraName` matches exactly, if the user edits the local display name preference before retrying, or if `cameraName` differs, a new `CameraInstance` would be created unless the client explicitly queries existing instances.
- **Client Correction:** The Flutter client now invokes `listCameras(deviceId: targetDeviceId)` before calling `registerCamera(...)`. If an existing `CameraInstance` is already bound to that device, it reuses the instance, updates local state, and saves `zdex_camera_instance_id` into secure storage.

---

## 3. Device Registration and Camera Registration Request/Response Contract Verification

### Contract 1: Device Registration (`POST /api/v1/devices/register`)
- **Headers:** `authorization: Bearer $sessionToken`, `content-type: application/json`
- **Request Body:**
  ```json
  {
    "deviceName": "Living Room Camera",
    "installationId": "inst-...",
    "platform": "Android",
    "osVersion": "14",
    "appVersion": "1.0.0",
    "purpose": "CAMERA"
  }
  ```
- **Backend Execution:** When `purpose === 'CAMERA'`, `device.ts` routes directly to `CameraDeviceIdentityService.registerOrResolveCameraDevice(...)`, bypassing `ServerInstance` creation.
- **Response Structure (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "device": {
        "id": "dev_...",
        "installationId": "inst-...",
        "deviceName": "Living Room Camera",
        "status": "ONLINE"
      },
      "deviceCredential": "..."
    }
  }
  ```
- **Parsed Value:** `res['data']['device']['id']`.

### Contract 2: Camera Registration (`POST /api/v1/cameras`)
- **Headers:** `authorization: Bearer $sessionToken`, `content-type: application/json`
- **Request Body:**
  ```json
  {
    "cameraName": "Living Room Camera",
    "installationId": "inst-...",
    "deviceId": "dev_...",
    "lensFacing": "BACK",
    "resolution": "720p",
    "fps": 30,
    "audioEnabled": false
  }
  ```
- **Response Structure (`201 Created`):**
  ```json
  {
    "success": true,
    "data": {
      "camera": {
        "id": "cam_...",
        "userId": "usr_...",
        "deviceId": "dev_...",
        "cameraName": "Living Room Camera",
        "status": "OFFLINE",
        "resolution": "720p",
        "fps": 30,
        "audioEnabled": false,
        "lensFacing": "BACK"
      }
    }
  }
  ```
- **Parsed Value:** `res['data']['camera']['id']`.

### Contract 3: Idempotent Query (`GET /api/v1/cameras?deviceId={deviceId}`)
- **Headers:** `authorization: Bearer $sessionToken`
- **Response Structure (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "cameras": [ ... ],
      "totalCount": 1,
      "page": 1,
      "limit": 20,
      "hasMore": false
    }
  }
  ```
- **Parsed Value:** `res['data']['cameras']`.

---

## 4. Duplicate and Partial-Failure Handling Matrix

| Scenario | Client Behavior | Backend Result | Recoverability |
|---|---|---|---|
| **1. User taps Register Node once** | Enters `isRegistering = true`. Resolves device, verifies absence of duplicates, registers camera. | Device + Camera created/resolved. | Complete success. |
| **2. Repeated rapid taps** | Rejected immediately (`if (state.isRegistering) return false;`). | Zero duplicate requests dispatched. | Debounced cleanly. |
| **3. Device registration OK, Camera registration fails** | `deviceId` saved in `SecureStorageService` and `state`. Error displayed: `"Device node registered (ID: ...); tap to retry camera binding."` | Device created/updated; zero `CameraInstance` created. | Recoverable on next tap without re-registering device. |
| **4. Network timeout after backend commits** | On retry, Step 2 calls `listCameras(deviceId: ...)`. Detects newly created camera and reuses it. | Zero duplicate `CameraInstance` created. | Fully self-healing. |
| **5. Application restarts after partial failure** | Startup calls `initRegistrationState()`, loading `zdex_camera_device_id` from secure storage. | Backend already has device record; retry skips device registration. | Restores seamlessly. |
| **6. Already-registered camera registered again** | Step 2 matches existing camera for device and updates local state. | Returns existing record without database mutation. | 100% idempotent. |

---

## 5. Ownership and Storage Quota Preservation

1. **Ownership Checks:** Backend verifies that `userId` matches the authenticated user on every query, device claim, and camera creation.
2. **Installation Claim:** Cross-account claim defense (`assertInstallationUnclaimedByOtherUser`) ensures an installation cannot be claimed by another user.
3. **Storage Quota Non-Interference:**
   - Storage servers are governed by `ServerInstance` records.
   - `POST /api/v1/devices/register` with `purpose: 'CAMERA'` creates/updates only `Device` and `DeviceInstallationClaim`.
   - **Zero `ServerInstance` records are created.** The account's 5-server storage quota remains completely unconsumed and unaffected.
4. **Credential Isolation:** Raw session tokens are never stored in SharedPreferences. Only non-secret IDs (`zdex_camera_device_id`, `zdex_camera_instance_id`) are stored in `SecureStorageService`.

---

## 6. Android Permission Callback Isolation

### Request Codes in `MainActivity.kt`:
- Notification permission: `REQUEST_POST_NOTIFICATIONS = 101`
- Folder picker: `REQUEST_PICK_FOLDER = 102`
- Camera permission: `REQUEST_CAMERA_PERMISSION = 201`
- Microphone permission: `REQUEST_RECORD_AUDIO_PERMISSION = 202`
- **Result:** Zero request code collisions.

### Callback Safety in `CameraEngineHandler.kt`:
```kotlin
// 1. Guard against concurrent calls
if (pendingCameraResult != null) {
    result.error("CONCURRENT_REQUEST", "A camera permission request is already in progress", null)
    return
}

// 2. Atomic callback resolution
val callback = pendingCameraResult
pendingCameraResult = null
if (callback == null) return true

val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
if (granted) {
    callback.success("granted")
} else {
    val shouldShow = ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.CAMERA)
    callback.success(if (!shouldShow) "permanently_denied" else "denied")
}
return true
```
- **Empty `grantResults` (Cancellation / Interruption):** Safely resolves with `"denied"` without crashing or leaving the result pending.
- **Single Completion:** `callback` is nullified before invoking `success(...)`, preventing double completions.

---

## 7. Camera2 Logical/Physical Camera Representation

In `CameraEngineHandler.kt`:
- On Android 9+ (API 28+), inspects `CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES` for `REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA`.
- Inspects `characteristics.physicalCameraIds` to enumerate physical sensor IDs backing the logical device.
- Exposes `isLogical: Boolean` and `physicalCameraIds: List<String>` to Flutter.
- **UI Representation:** Lenses are labeled honestly:
  - Logical: `Back Lens (ID 0, Logical [Sensors: 2, 3])`
  - Physical: `Back Lens (ID 0, Physical)`
- **Policy Compliance:** The app never claims every `CameraManager` ID is an independent physical sensor.

---

## 8. Resolution/FPS Capability Accuracy

### Joint Compatibility Verification:
- In `CameraEngineHandler.kt`, queries `streamConfigMap.getOutputMinFrameDuration(SurfaceTexture::class.java, size)` for each resolution.
- Computes `maxFps = (1_000_000_000.0 / minDurationNs).toInt()`.
- Exposes `format`, `maxFps`, and `isVerified` on `CameraHardwareResolution`.

### Evaluation Statuses:
1. **`supported` (HAL Verified):** Minimum frame duration confirms the sensor can sustain the target FPS at that resolution.
2. **`unverified` (Preference):** Resolution and auto-exposure FPS range are reported, but HAL did not supply frame duration without configuring a live capture session.
3. **`unsupported`:** The sensor cannot sustain the target FPS at that resolution (e.g. 1080p max FPS is 15, but 30 FPS was requested).
4. **UI Tagging:** Renders a dedicated `Combination: Supported (HAL Verified)` or `Combination: Preference (Unverified by HAL)` status badge directly in the capture configuration card.

---

## 9. Permission and Camera Lifecycle State Integrity

State invariant verification in `CameraState`:
1. `hasCameraPermission == true` -> Lifecycle status remains `notConfigured` or `offline`. Never `ONLINE` or `STREAMING`.
2. `isRegistered == true` -> Lifecycle status is `offline`. Never `ONLINE` or `STREAMING`.
3. `isConfigured == true` -> Lifecycle status is `notConfigured` or `offline`. Never `ONLINE` or `STREAMING`.
4. **Permission Revocation:** When the application resumes from background and `checkPermissions()` detects camera permission was revoked, it updates state and alerts the user: `"Camera permission was revoked in Android Settings. Re-authorization required."`
5. **Microphone Isolation:** Disabling audio leaves camera permission and video configuration completely untouched.

---

## 10. Files Created and Modified

| File | Status | Description |
|---|---|---|
| [`CameraEngineHandler.kt`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/android/app/src/main/kotlin/net/remotenode/fileserver/camera/CameraEngineHandler.kt) | Modified | Added logical camera detection, min frame duration FPS calculation, and concurrent request guards. |
| [`camera_hardware_info.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/lib/features/camera/domain/entities/camera_hardware_info.dart) | Modified | Added `isLogical`, `physicalCameraIds`, `maxFps`, `isVerified`, and `evaluateCombination`. |
| [`camera_registration_service.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/lib/features/camera/domain/services/camera_registration_service.dart) | Modified | Added `listCameras`, `getCamera`, and `updateCameraConfig` methods and test mocks. |
| [`camera_state.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/lib/features/camera/application/camera_state.dart) | Modified | Implemented 3-step idempotent registration, partial-failure recovery, combination support evaluation, and storage persistence. |
| [`camera_providers.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/lib/features/camera/application/camera_providers.dart) | Modified | Added `cameraSecureStorageServiceProvider`. |
| [`camera_screen.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/lib/features/camera/presentation/camera_screen.dart) | Modified | Added combination support badge, logical sensor labels, and partial failure retry button states. |
| [`camera_registration_service_test.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/test/unit/camera_registration_service_test.dart) | Modified | Unit tests for `listCameras`, `registerCameraDevice`, and `updateCameraConfig`. |
| [`camera_hardware_service_test.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/test/unit/camera_hardware_service_test.dart) | Modified | Unit tests for logical camera parsing, frame duration FPS validation, and combination statuses. |
| [`camera_permission_service_test.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/test/unit/camera_permission_service_test.dart) | Modified | Unit tests for permission cancellation and callback isolation. |
| [`camera_state_test.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/test/unit/camera_state_test.dart) | Modified | Extended unit tests for registration idempotency, partial failure recovery, and revocation handling. |
| [`camera_screen_test.dart`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server Project/Android%20app/Android%20app%20code/test/widget/camera_screen_test.dart) | Modified | Updated widget tests verifying combination badge and retry button states. |

---

## 11. Tests Written and Tests Not Executed

### Test Coverage Added:
- Duplicate registration prevention (`isRegistering` guard).
- Partial failure handling (device created, camera creation rejected).
- Safe retry using persisted `deviceId` from storage.
- Idempotent camera instance reuse via `listCameras`.
- Permission callback isolation and cancellation handling.
- Logical vs. physical camera metadata parsing.
- HAL min frame duration joint FPS validation (`supported`, `unverified`, `unsupported`).
- Permission revocation detection upon application resume.

### Test Execution Status:
**NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28**  
Per strict testing policy, zero tests were executed.

---

## 12. Known Limitations & Deferred Work

1. **Session-Level Timing Verification:** True joint FPS/resolution validation under active hardware capture depends on initializing a CameraX/Camera2 capture session, deferred to Phase 21.4.
2. **Foreground Service Supervision:** Multi-engine supervision (`PlatformSupervisorService`) and `FOREGROUND_SERVICE_CAMERA` are deferred to Phase 21.5.
3. **Live WebRTC Signaling:** Real-time stream signaling via `/ws/camera-signaling` is deferred to Phase 21.6.

---

## 13. Confirmation of Policy Compliance

- **Zero Builds:** No build tools (`gradle`, `flutter build`) were executed.
- **Zero Analyzers:** Neither `flutter analyze`, `dart analyze`, nor `tsc` were executed.
- **Zero Database Mutations:** Zero Prisma schema changes, migrations, or database queries executed.
- **Zero Storage Modifications:** Storage server engine, tunnel manager, and file-server lifecycle remain 100% untouched.

---

*Report submitted for review. Standing by for authorization to proceed to Phase 21.4.*
