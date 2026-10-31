# ZDEXCLOUD PHASE 11.4 IMPLEMENTATION REPORT: ANDROID APP NOTIFICATION EXPANSION

**Document Version:** 1.0.0  
**Phase:** 11.4  
**Status:** IMPLEMENTED WITH DOCUMENTED LIMITATIONS  
**Target Architecture:** ZdexCloud Android Flutter Application, Native Android OS Channels & Firebase Cloud Messaging (FCM) Integration  
**Date:** October 15, 2026  

---

## 1. Executive Summary & Final Status

Phase 11.4 addresses the integration gap between the ZdexCloud Flutter Android application, native Android OS notification infrastructure, and backend Firebase Cloud Messaging (FCM) services.

### Core Defects Resolved:
1. **Elimination of Synthetic FCM Tokens:** Removed the legacy defect in `MainActivity.kt` where `getFcmToken()` generated synthetic mock UUIDs (`fcm_token_` + random UUID) and stored them in `SharedPreferences`. Purged legacy synthetic tokens upon discovery and enforced genuine token acquisition semantics where `null` is safely returned and registration is aborted if real FCM tokens are unavailable.
2. **Native Android Notification Channel Creation:** Registered the three canonical user-facing notification channels (`remotenode_general`, `remotenode_critical`, `remotenode_security`) in Android's `NotificationManager` during `configureFlutterEngine`. This ensures Android 8.0+ (API 26+) does not discard incoming push notices.
3. **App-Launch & Tap Routing:** Implemented intent extra extraction (`getInitialNotification`) and runtime intent routing (`onNewIntent`) in `MainActivity.kt`. Connected native callbacks to Flutter's `PushNotificationService` and wired global navigator routing via `AppRouter.navigatorKey`.
4. **Notification Center & Preferences Discovery:** Linked the previously isolated `NotificationCenterScreen` and `NotificationPreferencesScreen` into `AppRouter`, added navigation tiles in `SettingsScreen`, and added a Notification Center action button in `HomeScreen`'s `AppHeader`.
5. **Token Privacy & Revocation on Logout:** Added token masking utilities (`maskToken`) across all loggers, and wired token revocation (`PushTokenManager.revokePushToken`) on device sign-out in `SettingsScreen`.
6. **Official Firebase Manifest Alignment:** Added `firebase_core: ^2.32.0` and `firebase_messaging: ^14.9.4` to `pubspec.yaml`, applied `com.google.gms.google-services` in Gradle DSL, and documented the exact external setup required to transition from dummy `google-services.json` to production FCM credentials.

**Final Status:** `IMPLEMENTED WITH DOCUMENTED LIMITATIONS`

---

## 2. Files Changed and Purpose of Each Change

| File Path | Component | Purpose of Change |
| :--- | :--- | :--- |
| `android/app/src/main/kotlin/net/remotenode/fileserver/MainActivity.kt` | Native Android Host | Eliminated synthetic UUID token generation in `getFcmToken`; added legacy token purging; implemented `registerNotificationChannels` for OS channels (`remotenode_general`, `remotenode_critical`, `remotenode_security`); implemented `onNewIntent` and `getInitialNotification` for tap routing; added `checkNotificationPermissionRationale`. |
| `android/settings.gradle.kts` | Gradle Build System | Added `com.google.gms.google-services` plugin dependency (`version 4.4.2`). |
| `android/app/build.gradle.kts` | Android App Gradle | Applied `com.google.gms.google-services` Gradle plugin to app module. |
| `pubspec.yaml` | Flutter Manifest | Added official Firebase dependencies: `firebase_core: ^2.32.0` and `firebase_messaging: ^14.9.4`. |
| `lib/core/notifications/push_notification_service.dart` | Flutter Notification Service | Added MethodChannel handler for `onNotificationTap` and `onForegroundMessage`; implemented `checkInitialNotification()`, `checkNotificationPermissionRationale()`, and `openNotificationSettings()`. |
| `lib/core/notifications/push_token_manager.dart` | Push Token Manager | Added `maskToken` to prevent token leakage in logs; hardened `PlatformFcmTokenAdapter` to avoid token fabrication and handle null tokens cleanly. |
| `lib/core/routing/app_router.dart` | Central App Router | Defined `navigatorKey`, route constants (`/notifications`, `/notifications/preferences`), and registered `NotificationCenterScreen` and `NotificationPreferencesScreen`. |
| `lib/main.dart` | Flutter Entrypoint | Assigned `AppRouter.navigatorKey` to `MaterialApp`; subscribed to `pushService.onNotificationTap` with automated navigation; invoked `checkInitialNotification()` on post-frame callback. |
| `lib/features/notifications/screens/notification_center_screen.dart` | Notification UI | Replaced mock SnackBar navigation with real routing via `AppRouter` and `UrlLauncherService` for billing and file management portal URLs. |
| `lib/features/settings/presentation/settings_screen.dart` | Settings UI | Added "Notifications & Communication" management card; wired `pushTokenManager.revokePushToken` on device sign-out. |
| `lib/features/home/presentation/home_screen.dart` | Home Screen UI | Added Notification Center navigation icon button to `AppHeader`. |
| `test/unit/notification_integration_test.dart` | Test Suite | Added policy notice (`NOT EXECUTED`); added tests 19–25 covering null token handling, token masking, cold launch intent extraction, permission rationale, and billing deep-link routing. |

---

## 3. Firebase Initialization and Configuration Status

### Current Configuration State:
1. **Configuration File (`google-services.json`):**
   - File exists at `Android app/Android app code/android/app/google-services.json`.
   - **Current Status:** Contains placeholder/dummy credentials (`"project_id": "zdexcloud-production"`, `"current_key": "AIzaSyDummyKeyForZdexCloudProductionFCM"`, `"package_name": "net.remotenode.fileserver"`).
2. **Gradle Plugin Registration:**
   - Declared in `android/settings.gradle.kts` (`id("com.google.gms.google-services") version "4.4.2" apply false`).
   - Applied in `android/app/build.gradle.kts` (`id("com.google.gms.google-services")`).
3. **Flutter Dependencies:**
   - Manifested in `pubspec.yaml` (`firebase_core: ^2.32.0`, `firebase_messaging: ^14.9.4`).
   - In accordance with verification constraints, `flutter pub get` was **not executed**, leaving lockfile update and generated plugin registrant code for the final deployment build pipeline.

---

## 4. Real FCM Token Acquisition and Backend Registration Flow

### Token Lifecycle Flow:
```
+───────────────────────────+
|   PushTokenManager.dart   |
+───────────────────────────+
              │
              │ 1. Requests token via PlatformFcmTokenAdapter.getToken()
              ▼
+───────────────────────────+
|      MainActivity.kt      |
+───────────────────────────+
              │
              ├── If legacy "fcm_token_*" synthetic token found ──> Purged from SharedPreferences
              ├── If genuine FCM token present ───────────────────> Returned to Flutter
              └── If no genuine token available ──────────────────> Returns null (NO FABRICATION)
              │
              ▼
+───────────────────────────+
|   PushTokenManager.dart   |
+───────────────────────────+
              │
              ├── If token == null ──> Logs warning; skips registration (No backend call)
              │
              └── If genuine token available:
                    │
                    │ 2. Queries SecureStorage for session accessToken
                    │ 3. Issues POST /api/v1/devices/:deviceId/push-token
                    │    Body: { "token": token, "platform": "ANDROID", "appVersion": "1.0.0" }
                    │    Header: Authorization: Bearer <sessionToken>
                    ▼
+───────────────────────────────────────────+
| Backend (src/notifications/routes/        |
|          push_token_routes.ts)            |
+───────────────────────────────────────────+
                    │
                    │ 4. Verifies user ownership: device.userId === authUser.id
                    │ 5. Upserts DevicePushToken table (isActive = true)
                    │ 6. Emits PUSH_TOKEN_REGISTERED audit event
                    ▼
+───────────────────────────────────────────+
| Database: DevicePushToken Record Active   |
+───────────────────────────────────────────+
```

---

## 5. Permission and Token-Refresh Handling

### Android 13+ (API 33+) Runtime Permission Strategy:
1. **Non-Intrusive Prompting:** Permissions are not requested on cold app boot or on every screen render.
2. **Contextual Onboarding Flow:** Handled during the Server Setup Wizard (`setup_device_screen.dart`) and Server Telemetry Status (`server_status_screen.dart`), clearly explaining why notification permission is necessary for background hosting.
3. **Denied & Permanently Denied Handling:**
   - `PushNotificationService.checkNotificationPermissionRationale()` queries `ActivityCompat.shouldShowRequestPermissionRationale()`.
   - If denied permanently ("Don't ask again"), `PushNotificationService.openNotificationSettings()` triggers `android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS` to guide the customer directly to Android System Settings.
4. **Token Refresh Synchronization:**
   - Platform channel invokes `onFcmTokenRefresh` when Firebase issues a new token.
   - `PushTokenManager.listenToTokenRefresh` triggers `PATCH /api/v1/devices/:deviceId/push-token` with the rotated token, updating the backend deterministically without interrupting app operations.

---

## 6. Foreground, Background, and Notification-Tap Behavior

| Scenario | Platform Trigger | App State | Handling Flow |
| :--- | :--- | :--- | :--- |
| **Cold Launch from Notification Tap** | Intent contains notification extras (`deepLink`, `serverId`) | App Terminated | Android OS creates `MainActivity`. Flutter invokes `getInitialNotification()` during post-frame callback; `NotificationRouter.parsePayload` resolves target; `AppRouter.navigatorKey` pushes destination. |
| **Notification Tap while Running** | Customer taps notification banner | App in Background or Foreground | `MainActivity.onNewIntent()` captures intent extras and invokes `onNotificationTap` MethodChannel call; `PushNotificationService` routes target via `AppRouter.navigatorKey`. |
| **Foreground Message Arrival** | FCM message received | App Active in Foreground | Delivered via `onForegroundMessage`; payload added to `_foregroundMessageController` for in-app toast/banner display; system notification suppressed to prevent duplicate visible banners. |
| **Unauthenticated / Expired Session** | Tap occurs with invalid session | Any | Router checks destination. Protected screens safely redirect to Login screen or Home fallback without crashing. |

---

## 7. Deep-Link and Duplicate-Notification Safeguards

### Deep-Link Allowlist & Fallback:
In `lib/core/notifications/notification_router.dart`:
- **Dual Scheme Support:** Supports both modern `zdexcloud://` and legacy `remotenode://` URI schemes.
- **Strict Destination Mapping:**
  - `server/` $\rightarrow$ `NotificationTargetType.serverDetail` (Navigates to `/server/status`)
  - `security` $\rightarrow$ `NotificationTargetType.securitySettings` (Navigates to `/settings`)
  - `device/` $\rightarrow$ `NotificationTargetType.deviceDetail` (Navigates to `/settings`)
  - `billing`, `invoices`, `subscription` $\rightarrow$ `NotificationTargetType.billing` (Launches web portal `/pages/billing.html`)
  - `filemanager` $\rightarrow$ `NotificationTargetType.fileManager` (Launches web portal `/pages/file-manager.html`)
- **Arbitrary URL Neutralization:** Any unapproved URL or malformed scheme falls back safely to `NotificationTargetType.dashboard` (`/home`), preventing phishing or external website hijacking.

### Duplicate Notification Prevention:
1. **Foreground Fencing:** When the app is in the foreground, local OS notification alerts are suppressed; the event is routed exclusively through Flutter's in-app reactive notification state.
2. **Foreground Service Segregation:** The Android foreground service notification (`remotenode_server_channel`) remains strictly isolated in `RemoteNodeServerService.kt` with `IMPORTANCE_LOW` and does not interact with customer push alert channels (`remotenode_general`, `remotenode_critical`, `remotenode_security`).

---

## 8. Backend Compatibility and Token Privacy

1. **Zero Credential Exposure:** No Firebase service-account private keys, API secrets, or passwords are hardcoded in Android or Flutter code.
2. **Token Masking:** Implemented `PushTokenManager.maskToken`:
   ```dart
   static String maskToken(String? token) {
     if (token == null || token.isEmpty) return '<none>';
     if (token.length <= 10) return '***';
     return '${token.substring(0, 6)}...${token.substring(token.length - 4)}';
   }
   ```
   All operational log lines mask token strings (e.g. `fcm_to..._key`), preventing sensitive tokens from being captured in Android logcat or telemetry pipelines.
3. **Device Ownership Verification:** Backend endpoint (`push_token_routes.ts`) requires active JWT session and validates `device.userId === user.id` prior to registering or rotating tokens.
4. **Clean Revocation on Sign-Out:** When a customer signs out via `SettingsScreen`, `pushTokenManager.revokePushToken(deviceId)` issues `DELETE /api/v1/devices/:deviceId/push-token`, deactivating the token on the backend and clearing local storage.

---

## 9. Tests Created or Updated (Status: NOT EXECUTED)

The test file `Android app/Android app code/test/unit/notification_integration_test.dart` has been updated with the mandatory constraint notice and 7 new test specifications:

**Header Notice:**
```dart
// NOTE: These tests are NOT EXECUTED as per policy.
```

### Test Case Directory:
- **Test 19:** `PlatformFcmTokenAdapter returns null when platform has no token without generating synthetic UUID`
- **Test 20:** `PushTokenManager aborts registration cleanly when no genuine token is available`
- **Test 21:** `PushTokenManager.maskToken masks sensitive tokens and protects logs`
- **Test 22:** `PushNotificationService.checkInitialNotification extracts payload on cold launch`
- **Test 23:** `PushNotificationService checks permission rationale and opens notification settings`
- **Test 24:** `Billing deep links route correctly across dual schemes and web URLs`
- **Test 25:** `Malformed and arbitrary deep links fallback safely to dashboard target`

*(In accordance with project constraints, `flutter test` was **NOT EXECUTED**).*

---

## 10. Static Verification Performed & Remaining Unverified Items

### Static Verification Completed:
- Verified Kotlin channel IDs match Dart `AndroidNotificationChannelInfo` IDs (`remotenode_general`, `remotenode_critical`, `remotenode_security`).
- Verified MethodChannel names match (`net.remotenode.fileserver/server_engine`).
- Verified API request contracts match backend schemas in `push_token_routes.ts`.
- Verified deep-link URI parsing handles all registered categories with fallback.
- Verified absence of synthetic UUID token generation in `MainActivity.kt`.

### What Remains Unverified:
- Runtime FCM token generation by Google Play Services on a physical Android device.
- Live APNs/FCM message relay from Google Cloud to physical hardware.
- Visual rendering of notification heads-up banners on physical Android OEM flavors (Samsung OneUI, Xiaomi MIUI, Google Pixel).

---

## 11. External Setup and Configuration Still Required

To enable live production push notifications on physical devices, the following operations must be completed outside the restricted test environment:

1. **Production `google-services.json`:**
   - Download the real production `google-services.json` from the Firebase Console for project `zdexcloud-production` (matching package name `net.remotenode.fileserver`).
   - Replace the placeholder file at `Android app/Android app code/android/app/google-services.json`.
2. **Backend FCM v1 Service Account:**
   - Generate a Firebase Admin SDK private key JSON from Firebase Console $\rightarrow$ Project Settings $\rightarrow$ Service Accounts.
   - Configure environment variables on the backend server:
     - `FCM_PROJECT_ID=<your-project-id>`
     - `FCM_CLIENT_EMAIL=<service-account-email>`
     - `FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"`
3. **Dependency Resolution & Build:**
   - Run `flutter pub get` in `Android app/Android app code/` to download `firebase_core` and `firebase_messaging` and update `pubspec.lock`.
   - Run `./gradlew assembleDebug` or `flutter build apk` to compile with the `com.google.gms.google-services` Gradle plugin.

---

## 12. Final Compliance Confirmation

- **Zero test runners or test suites were executed.**
- **Zero Flutter or Android builds, Gradle tasks, or Dart analysis commands were executed.**
- **Zero package installations (`flutter pub get`, `npm install`) were executed.**
- **Zero Prisma Client generations or database migrations were applied.**
- **Zero real push notifications or network provider requests were dispatched.**
- **Zero production customer data was accessed.**

---

**End of Phase 11.4 Report**
