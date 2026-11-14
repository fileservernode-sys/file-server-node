# Phase 21.3.6 — Account-Safe Camera Credential Cleanup, Global Resume Validation & Diagnostic Hardening

**Roadmap:** Phase 21 — Android Camera Server  
**Parent:** Phase 21.3 — Camera Permissions & Device Configuration  
**Prerequisite:** Phase 21.3.5 — In-Flight Registration Cancellation & Authentication Cleanup Reliability  
**Status:** IMPLEMENTATION COMPLETE — Tests written, NOT RUN (deferred to Phase 28)  
**Date:** 2026-11-13

---

## 1. Objective

Close four remaining correctness gaps identified in the Phase 21.3.5 review:

| Gap | Description |
|-----|-------------|
| **Gap 1** | Stale cleanup after account switching could delete the new user's credentials |
| **Gap 2** | `invalidateInFlightRegistrations()` was called too late — after the repository network await, not before |
| **Gap 3** | Session resume validation only triggered when `CameraScreen` was active (missed Home, Server, Settings tabs) |
| **Gap 4** | `SessionClearedResult.sanitizedErrors` exposed arbitrary regex-processed exception strings |

---

## 2. Changes Implemented

### 2.1 Account-Safe Conditional Credential Deletion — `camera_state.dart`

**New method:** `_clearCameraStorageIfOwned(String expectedUserId) → Future<bool>`

Before deleting camera credentials from `SecureStorageService`, this method reads `zdex_camera_user_id`. Deletion only proceeds if:
- Storage is **unowned** (`null` or empty), OR  
- Stored userId **exactly matches** `expectedUserId`

**Returns `false` and aborts deletion** if another user's credentials are detected — preventing User A's stale operation from silently wiping User B's fresh credentials.

**Call-site replacements (Gap 1 fix):**
- `handleCredentialRotation()` Step 4 (post-write generation check failure) → `_clearCameraStorageIfOwned(expectedUserId)`
- `handleCredentialRotation()` Step 6 catch (write/verify failure) → `_clearCameraStorageIfOwned(expectedUserId)`

The unconditional `_clearCameraStorage()` is preserved for cases where the caller has explicitly confirmed they own the data (e.g. the account-switch purge inside `registerWithBackend`, where `storedUserId != currentUserId` has already been verified).

**Testing wrapper:** `clearCameraStorageIfOwnedForTesting(expectedUserId)` added for unit test access.

---

### 2.2 Immediate Synchronous Invalidation Before Repository Latency — `auth_state.dart`

**New infrastructure:**
```dart
static final List<void Function()> _immediateInvalidationHooks = [];
static void registerImmediateInvalidationHook(void Function() hook)
static void unregisterImmediateInvalidationHook(void Function() hook)
static void _fireImmediateInvalidation()  // internal — calls all hooks synchronously
```

**Updated `logout()` execution order:**
1. `state = const AuthState(status: AuthStatus.unauthenticated)` — synchronous state transition
2. `_fireImmediateInvalidation()` — synchronous, calls all immediate hooks **before any `await`**
3. `await _repository.logout()` — network/disk call (may be slow)
4. `await notifySessionCleared()` — async cleanup hooks

**Updated `restoreSession()` expired-session branch:**
- `_fireImmediateInvalidation()` now fires immediately after the state transition and before `await _repository.logout()`

**Hook registered in `cameraStateProvider`:**
```dart
void immediateInvalidationHook() {
  notifier.invalidateInFlightRegistrations();
}
AuthStateNotifier.registerImmediateInvalidationHook(immediateInvalidationHook);
```

This ensures `_registrationGeneration` is incremented synchronously at the start of logout, before the repository network round-trip introduces any latency that could allow in-flight registration responses to slip through.

---

### 2.3 Global Resume Validation in Root Widget — `main.dart`

**`ZdexCloudApp` converted from `StatefulWidget` → `ConsumerStatefulWidget`** (and `_ZdexCloudAppState` from `State<ZdexCloudApp>` → `ConsumerState<ZdexCloudApp>`).

This grants `_ZdexCloudAppState` access to Riverpod's `ref`, allowing it to call `authStateProvider.notifier.validateSessionOnResume()`.

**New global lifecycle handler:**
```dart
@override
void didChangeAppLifecycleState(AppLifecycleState lifecycleState) {
  AppLogger.info('App Lifecycle State changed: $lifecycleState');
  if (lifecycleState == AppLifecycleState.resumed) {
    if (_isValidatingResume) { return; }  // duplicate-event guard
    _isValidatingResume = true;
    ref.read(authStateProvider.notifier).validateSessionOnResume().then((_) {
      _isValidatingResume = false;
    }).catchError((_) {
      _isValidatingResume = false;
    });
  }
}
```

**`_isValidatingResume` guard:** Prevents duplicate concurrent validations from rapid OS lifecycle events (partial occlusion → full resume pairs).

**`CameraScreen.didChangeAppLifecycleState` simplified:**
- `validateSessionOnResume()` call removed — delegated to the root widget
- Now only performs the Camera-specific permission re-check (`checkPermissions`) when `auth.status == AuthStatus.authenticated`
- Guards `mounted` before accessing `ref`

---

### 2.4 Structured Diagnostic Categories — `auth_state.dart`

**Replaced `sanitizedErrors: List<String>` with `failureCategories: List<CleanupFailureCategory>`**

```dart
enum CleanupFailureCategory {
  storageWriteFailure,
  storageDeleteFailure,
  networkFailure,
  unknownFailure,
}
```

**`_classifyCleanupFailure(Object e) → CleanupFailureCategory`** — classifies by keyword matching on lowercased `e.toString()`:

| Keywords matched | Category |
|-----------------|----------|
| `write`, `persist`, `keystore` | `storageWriteFailure` |
| `delete`, `remove`, `clear` | `storageDeleteFailure` |
| `network`, `socket`, `timeout`, `http`, `connection` | `networkFailure` |
| (none of the above) | `unknownFailure` |

The raw exception message, stack trace, and any credential values are **never stored, logged, or transmitted**. Only the enum value is retained.

**`SessionClearedResult` updated:**
```dart
class SessionClearedResult {
  final bool success;
  final int totalHooks;
  final int failedHooks;
  final List<CleanupFailureCategory> failureCategories;
}
```

---

### 2.5 Test-Support Utilities

| Utility | Location | Purpose |
|---------|----------|---------|
| `AuthStateNotifier.clearAllHooksForTesting()` | `auth_state.dart` | Clears both hook lists between tests |
| `CameraStateNotifier.clearCameraStorageIfOwnedForTesting()` | `camera_state.dart` | Test-visible wrapper for `_clearCameraStorageIfOwned` |
| `MockOrderTrackingAuthRepository` | `camera_state_test.dart` | Tracks logout call order for Gap 2 verification |

---

## 3. Files Modified

| File | Change Summary |
|------|---------------|
| [`lib/features/auth/application/auth_state.dart`](../Android%20app/Android%20app%20code/lib/features/auth/application/auth_state.dart) | Added `CleanupFailureCategory` enum; restructured `SessionClearedResult`; added immediate hook infrastructure; updated `logout()` and `restoreSession()`; added `clearAllHooksForTesting()` |
| [`lib/features/camera/application/camera_state.dart`](../Android%20app/Android%20app%20code/lib/features/camera/application/camera_state.dart) | Added `_clearCameraStorageIfOwned()`; updated `handleCredentialRotation()` Steps 4 & 6; added `immediateInvalidationHook` to provider; added `clearCameraStorageIfOwnedForTesting()` |
| [`lib/main.dart`](../Android%20app/Android%20app%20code/lib/main.dart) | Converted `ZdexCloudApp` to `ConsumerStatefulWidget`; added global `validateSessionOnResume()` in `didChangeAppLifecycleState`; added `_isValidatingResume` guard |
| [`lib/features/camera/presentation/camera_screen.dart`](../Android%20app/Android%20app%20code/lib/features/camera/presentation/camera_screen.dart) | Removed `validateSessionOnResume()` from `CameraScreen` lifecycle; retained Camera-specific permission re-check |
| [`test/unit/camera_state_test.dart`](../Android%20app/Android%20app%20code/test/unit/camera_state_test.dart) | Fixed Phase 21.3.5 diagnostics test (`sanitizedErrors` → `failureCategories`); added `MockOrderTrackingAuthRepository`; added Phase 21.3.6 group with 10 tests |

---

## 4. Preservation Invariants

| Invariant | Status |
|-----------|--------|
| Zero Storage credential modifications | ✅ All 5 camera keys are strictly isolated from Storage keys |
| `storage_server_admin_token` untouched | ✅ Verified — not in `_clearCameraStorage` or `_clearCameraStorageIfOwned` key lists |
| `device_installation_id` untouched | ✅ Verified |
| Phase 21.3.3 fail-closed pagination guarantee preserved | ✅ Unchanged |
| Phase 21.3.4 session-cleared hook architecture preserved | ✅ Hooks still fire; only the diagnostic type changed |
| Phase 21.3.5 in-flight cancellation via generation counters preserved | ✅ All 5 async boundaries still check `_isRegistrationValid` |
| `cameraStateProvider` account-switch listener preserved | ✅ Unchanged |
| Single APK architecture | ✅ No new entry points, build targets, or manifests |

---

## 5. Test Coverage Summary

**Test file:** `test/unit/camera_state_test.dart`  
**Test execution status:** NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28

| # | Test Name | Gap Covered |
|---|-----------|-------------|
| 1 | Stale cleanup cannot delete new account's credentials | Gap 1 |
| 2 | Account-safe cleanup allows deletion when userId matches | Gap 1 |
| 3 | Account-safe cleanup allows deletion when storage is empty | Gap 1 |
| 4 | Stale credential rotation does not overwrite newer credentials | Gap 1 |
| 5 | Immediate invalidation hook fires before repository call | Gap 2 |
| 6 | Multiple cleanup hooks all execute even when earlier hooks fail | Gap 3 (hook resilience) |
| 7 | Structured diagnostics classify failures without exposing raw strings | Gap 4 |
| 8 | Repeated rapid resume events do not cause duplicate validation | Gap 3 |
| 9 | Expired session on resume resets auth state and camera is invalidated | Gap 2 + Gap 3 |
| 10 | Storage credential keys are untouched by all Phase 21.3.6 operations | Preservation invariant |

---

## 6. Known Deferred Items

- `CameraScreen` permission re-check on resume reads from `authStateProvider` synchronously. If a concurrent `validateSessionOnResume()` from the root widget is still in-flight, there is a theoretical window where `auth.status` has not yet updated. This race is benign — `checkPermissions` is non-destructive and read-only; a redundant check has no adverse effect.
- `_classifyCleanupFailure` uses simple keyword matching. If a third-party storage library changes its exception message wording, some errors may fall through to `unknownFailure`. This is acceptable — the category is diagnostic only and does not affect control flow.

---

## 7. Next Phase

**Phase 21.4** — Native Camera Capture  
Prerequisites: Phase 21.3.6 accepted.
