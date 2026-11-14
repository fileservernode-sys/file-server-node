# Phase 21.3.7 — Atomic Camera Credential Mutations & Guaranteed Authentication Lifecycle Hooks

**Roadmap:** Phase 21 — Android Camera Server  
**Parent:** Phase 21.3 — Camera Permissions & Device Configuration  
**Prerequisite:** Phase 21.3.6 — Account-Safe Camera Credential Cleanup, Global Resume Validation & Diagnostic Hardening  
**Status:** IMPLEMENTATION COMPLETE — Tests written, NOT RUN (deferred to Phase 28)  
**Date:** 2026-11-13

---

## 1. Executive Summary

Phase 21.3.7 resolves the fundamental concurrency and lifecycle coupling risks identified in the Phase 21.3.6 review:
1. **Eliminated Time-of-Check / Time-of-Use (TOCTOU) Storage Races**: Replaced decoupled reads and separate deletions with a reentrant asynchronous mutex (`CameraStorageLock`), making all Camera credential mutations atomic relative to one another.
2. **Guaranteed App-Startup Invalidation Hook**: Decoupled immediate registration invalidation from lazy Riverpod provider initialization, ensuring invalidation is registered at application boot before any UI route is mounted.
3. **Robust Root Lifecycle Management**: Hardened `ZdexCloudApp` root observer registration and teardown with fault-tolerant guard resets.
4. **Decoupled Permission Probing from Session Validation**: Coordinated `CameraScreen` resume handling with in-flight root session validation, preventing unauthenticated camera operations or permission races against expired sessions.

---

## 2. Exact Files Changed

| File | Purpose of Changes |
|------|--------------------|
| [`lib/features/camera/application/camera_state.dart`](../Android%20app/Android%20app%20code/lib/features/camera/application/camera_state.dart) | Implemented `CameraStorageLock` reentrant mutex; protected all Camera credential reads, writes, and deletions under atomic critical sections; added static notifier registration/disposal and global generation tracking; removed lazy provider hook registration. |
| [`lib/features/auth/application/auth_state.dart`](../Android%20app/Android%20app%20code/lib/features/auth/application/auth_state.dart) | Exposed `currentResumeValidation` Future in `AuthStateNotifier` to allow child screens to await root validation; fired `_fireImmediateInvalidation()` on account switch in `verifyOtp`. |
| [`lib/main.dart`](../Android%20app/Android%20app%20code/lib/main.dart) | Registered static `CameraStateNotifier.invalidateAllActiveRegistrations` at app startup (`main()`) and in `_ZdexCloudAppState.initState()`; unregistered in `dispose()`; wrapped `validateSessionOnResume` with `try / whenComplete` to guarantee `_isValidatingResume` release on any failure; fixed string interpolation logging. |
| [`lib/features/camera/presentation/camera_screen.dart`](../Android%20app/Android%20app%20code/lib/features/camera/presentation/camera_screen.dart) | Coordinated mount and resume lifecycle to await pending root `currentResumeValidation`; guarded registration action against expired sessions; decoupled permission checks from authenticated mutations. |
| [`test/unit/camera_state_test.dart`](../Android%20app/Android%20app%20code/test/unit/camera_state_test.dart) | Updated Phase 21.3.6 Test 3 to fail closed on empty storage; added comprehensive Phase 21.3.7 unit test suite (12 tests) covering lock serialization, exception release, startup hook execution, root observer, and session coordination. |

---

## 3. Synchronization Strategy & Race Prevention

### 3.1 The Identified Interleaving Problem (TOCTOU)
Previously, `_clearCameraStorageIfOwned(expectedUserId)` executed:
1. `final storedUserId = await _secureStorage.read(key: _keyCameraUserId);`
2. Evaluated condition: `storedUserId != expectedUserId`.
3. Executed multiple asynchronous delete operations:
   `await _secureStorage.delete(key: _keyCameraDeviceId);`
   `await _secureStorage.delete(key: _keyCameraInstanceId);`
   `await _secureStorage.delete(key: _keyCameraDeviceCredential);`
   `await _secureStorage.delete(key: _keyCameraUserId);`
   `await _secureStorage.delete(key: _keyCameraInstallationId);`

If Account B initiated credential rotation or backend registration between step 1 and step 3, Account A's stale cleanup deleted Account B's newly stored credentials. Furthermore, if storage was temporarily empty, a stale operation erroneously proceeded with deletion.

### 3.2 The Chosen Synchronization Architecture: `CameraStorageLock`
A dedicated asynchronous mutual-exclusion lock was introduced:
```dart
class CameraStorageLock {
  static final Object _zoneKey = Object();
  Future<void>? _lastOperation;

  Future<T> synchronized<T>(Future<T> Function() criticalSection) async {
    if (Zone.current[_zoneKey] == true) {
      return await criticalSection(); // Reentrant: avoids self-deadlock
    }

    final previous = _lastOperation;
    final completer = Completer<void>();
    _lastOperation = completer.future;

    if (previous != null) {
      try {
        await previous;
      } catch (_) {
        // Prevent prior failure from breaking subsequent lock acquisitions
      }
    }

    return runZoned(
      () async {
        try {
          return await criticalSection();
        } finally {
          completer.complete(); // Guarantees release on return, exception, or cancellation
        }
      },
      zoneValues: {_zoneKey: true},
    );
  }
}
```

### 3.3 Why This Prevents Interleaving
1. **Strict Mutual Exclusion**: All operations that read ownership, write credentials, or delete credentials acquire `_storageLock.synchronized`. An ownership read and subsequent deletion are atomic — no write can interleave between the check and the delete.
2. **Reentrancy via Zone Tokens**: Atomic helper methods (e.g. `_clearCameraStorageIfOwned`) can be called from within larger compound operations (such as `handleCredentialRotation`) without deadlocking.
3. **Lock Release Guaranteed**: Implemented using `try / finally` inside `runZoned`, ensuring the lock is released whether the operation succeeds, throws an exception, or is cancelled.
4. **No Locks Held Across Network Calls**: Long-running network requests (`registerCameraDevice`, `listCameras`, `registerCamera`) execute strictly outside `_storageLock`. The lock is only acquired for microsecond-duration encrypted key-value operations.
5. **Fail-Closed Empty Storage Invariant**: In `_clearCameraStorageIfOwned`, if `storedUserId == null || storedUserId != expectedUserId`, deletion is immediately refused (`return false`). A stale operation cannot delete credentials merely because storage is temporarily empty.

---

## 4. Camera Credential Mutation Paths Covered by `_storageLock`

Every Camera credential mutation path is now protected by `_storageLock`:

1. **Initial Device Registration & Key Persistence**:
   - Device ID write and User ID write in `registerWithBackend` are executed under `_storageLock.synchronized`.
2. **Camera Instance Registration & Key Persistence**:
   - Existing camera ID reuse write is executed under `_storageLock.synchronized`.
   - New camera ID write is executed under `_storageLock.synchronized`.
3. **Device Credential Rotation (`handleCredentialRotation`)**:
   - Pre-write generation validation, existing ownership verification, encrypted write of all 4 keys, verification read-back, and post-write generation validation are executed inside a single reentrant `_storageLock.synchronized` transaction.
   - If verification or generation fails, recovery cleanup executes `_clearCameraStorageIfOwned(expectedUserId)` inside the same lock.
4. **Account-Safe Conditional Cleanup (`_clearCameraStorageIfOwned`)**:
   - Reading `_keyCameraUserId`, checking ownership against `expectedUserId`, and deleting all 5 keys are executed atomically inside `_storageLock.synchronized`.
5. **Global Session Clearance (`handleGlobalSessionCleared`)**:
   - Deleting all 5 camera keys from `SecureStorageService` is serialized under `_storageLock.synchronized`.
6. **Account-Switch In-Flight Purge**:
   - Account switch verification read and subsequent `_clearCameraStorage()` inside `registerWithBackend` are serialized under `_storageLock.synchronized`.
7. **Storage Credential Isolation**:
   - Zero Storage (File Server) credentials (`storage_server_admin_token`, `device_installation_id`) are accessed or touched by `_storageLock`.

---

## 5. Hook Registration & Lifecycle Decoupling

### 5.1 Decoupling from Lazy Riverpod Providers
Previously, `immediateInvalidationHook` was registered in `cameraStateProvider`. In Riverpod, providers are evaluated lazily upon first read/watch. If a user never navigated to the Camera screen, the hook was never registered.

### 5.2 The Application-Startup Solution
1. **Global Hook Registration**:
   `AuthStateNotifier.registerImmediateInvalidationHook(CameraStateNotifier.invalidateAllActiveRegistrations)` is called in `main()` during application startup and in `_ZdexCloudAppState.initState()`.
2. **Active Notifier Registry**:
   `CameraStateNotifier` maintains a static registry of active instances (`_activeInstances`).
   - When a `CameraStateNotifier` is constructed, it registers itself: `_activeInstances.add(this)`.
   - When disposed, it unregisters itself: `_activeInstances.remove(this)`.
   - No disposed notifiers or stale callbacks are retained.
3. **Synchronous Invocation Before Network Latency**:
   When `AuthStateNotifier.logout()`, `restoreSession()` (expired), or `verifyOtp()` (account switch) fires, `_fireImmediateInvalidation()` executes synchronously:
   - Increments `_globalRegistrationGeneration`.
   - Synchronously calls `notifier.invalidateInFlightRegistrations()` on all active notifiers.
   - Sets `state = state.copyWith(isRegistering: false)`.
   - **All of this occurs BEFORE `await _repository.logout()` network call begins.**

---

## 6. Root Lifecycle Observer & Concurrency Safety

### 6.1 `ZdexCloudApp` Observer Registration & Disposal
`_ZdexCloudAppState` implements `WidgetsBindingObserver`:
- **Registration**: In `initState()`, `WidgetsBinding.instance.addObserver(this)` is called, guarded by `_isObserverRegistered` to prevent duplicate registration.
- **Disposal**: In `dispose()`, `WidgetsBinding.instance.removeObserver(this)` is called, and `AuthStateNotifier.unregisterImmediateInvalidationHook` cleans up the startup hook.

### 6.2 Guaranteed Guard Release
The `_isValidatingResume` guard prevents duplicate overlapping validations from rapid OS lifecycle events. It is wrapped in `try / whenComplete`:
```dart
try {
  ref
      .read(authStateProvider.notifier)
      .validateSessionOnResume()
      .whenComplete(() {
    _isValidatingResume = false;
  });
} catch (_) {
  _isValidatingResume = false;
}
```
This guarantees `_isValidatingResume` is reset even if a synchronous exception or asynchronous rejection occurs.

---

## 7. Resume-Validation and Permission-Check Ordering

### 7.1 Prevention of Permission Races
When returning from background:
1. `_ZdexCloudAppState.didChangeAppLifecycleState` initiates `validateSessionOnResume()`.
2. `AuthStateNotifier` exposes `Future<bool>? get currentResumeValidation => _activeResumeValidation;`.
3. In `CameraScreen`, `_checkPermissionsSafely()` is invoked on mount and resume:
   - It checks: `final pendingValidation = authNotifier.currentResumeValidation;`
   - If validation is in-flight, it awaits its completion before checking permissions or initiating state restoration.
   - If session is confirmed valid: proceeds with non-prompting permission probe with active `userId`.
   - If session is expired or unauthenticated: immediately invokes `notifier.invalidateInFlightRegistrations()` and does not perform authenticated operations.
4. When tapping "Register Camera Node":
   - The button handler also checks and awaits `authNotifier.currentResumeValidation`.
   - If the session expired while in background, it displays "Session Expired" dialog and aborts without issuing network calls.

---

## 8. Focused Tests (Write-Only, Marked NOT RUN)

All tests added to `test/unit/camera_state_test.dart` under group:
`Phase 21.3.7 — Atomic Camera Credential Mutations & Guaranteed Authentication Lifecycle Hooks [NOT RUN — DEFERRED TO PHASE 28]`

| # | Test Name | Requirements Verified |
|---|-----------|----------------------|
| 1 | Ownership check and deletion cannot interleave with a newer account credential write | TOCTOU lock protection; User B credentials preserved |
| 2 | Account A cleanup cannot delete account B credentials during concurrent credential rotation | Mutual exclusion between concurrent rotation and cleanup |
| 3 | Storage mutation lock releases cleanly after an operation throws an exception | Lock fault tolerance; deadlocks prevented on exceptions |
| 4 | Network requests do not hold the local storage mutation lock | Concurrency; network operations execute outside the storage lock |
| 5 | Immediate invalidation works at startup even when Camera screen has never been opened | Startup hook registration independent of provider instantiation |
| 6 | Immediate invalidation hook registration is idempotent and added exactly once | Duplicate registrations prevent duplicate hook executions |
| 7 | Immediate invalidation hook is unregistered safely on lifecycle disposal | Lifecycle teardown safety; no memory leaks |
| 8 | Root lifecycle observer registers on init and unregisters on disposal | `ZdexCloudApp` observer lifecycle correctness |
| 9 | Global resume validation detects expired session and resets authentication state | Expiration detection across all routes and tabs |
| 10 | Camera authenticated work awaits pending resume validation before proceeding | Screen-level coordination with `currentResumeValidation` |
| 11 | Expired session prevents Camera registration from issuing network calls | Zero network calls issued when session is invalid |
| 12 | Preservation Invariant: Storage credentials remain completely untouched | Storage credentials (`storage_server_admin_token`) untouched |

---

## 9. Verification & Invariant Confirmations

- **Zero Builds Run**: No Flutter or Android compilation was executed.
- **Zero Test Runners Run**: No tests were executed. All tests marked: `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`.
- **Zero Analyzers / Type-Checkers Run**: Static source inspection and Python brace validation only.
- **Zero Backend Changes**: No files in `main website/Backend` modified.
- **Zero Database Changes / Migrations**: No Prisma schema changes or SQL migrations.
- **Zero Storage Credential Modifications**: Storage keys remain isolated from Camera operations.
- **No Camera Capture / Foreground Service Implementation**: Phase 21.4 capture work has not commenced.

---

## 10. Remaining Limitations & Risks

1. **OS Process Termination**: If the Android operating system kills the application process while a credential rotation write is in progress, Android `EncryptedSharedPreferences` / KeyStore guarantees atomic commit per write, but compound operations rely on fail-closed state restoration on the subsequent app launch (`initRegistrationState`).
2. **Clock Skew on Offline Resume**: If the device clock is rolled backward while the app is in the background, token expiration checks fall back to backend 401 challenge responses.

---

## 11. Next Phase Recommendation

**Phase 21.4 — Native Camera Capture & Camera2 HAL Integration**  
Prerequisite: Review and acceptance of Phase 21.3.7 report.
