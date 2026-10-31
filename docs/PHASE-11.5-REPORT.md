# ZDEXCLOUD PHASE 11.5 IMPLEMENTATION REPORT: NOTIFICATION PREFERENCES IMPLEMENTATION

**Document Version:** 1.0.0  
**Phase:** 11.5  
**Status:** IMPLEMENTED WITH DOCUMENTED LIMITATIONS  
**Target Architecture:** ZdexCloud Central Notification System, Customer Preference Management (Website & Flutter Android), Delivery Routing Engine  
**Date:** October 21, 2026  

---

## 1. Executive Summary & Final Status

Phase 11.5 establishes a unified, authoritative customer notification preference model across the ZdexCloud website, Flutter Android app, and backend delivery services.

### Core Objectives Accomplished:
1. **One Authoritative Notification Preference Model:**
   Extended user preference management from coarse global-only flags to granular category-level (`enabled` boolean) and channel-level (`IN_APP`, `PUSH`, `EMAIL`) controls across all 6 registered backend categories: `ACCOUNT_SECURITY`, `DEVICE_SERVER`, `BILLING`, `STORAGE`, `FILE_OPERATIONS`, and `SYSTEM`.
2. **Defensive Normalization for Existing & New Accounts:**
   Implemented `normalizeNotificationPreferences()` to guarantee that existing user accounts whose stored records lack newer categories (e.g. `BILLING` introduced in Phase 11.2) or granular channel fields seamlessly inherit documented defaults without data corruption or database migration requirements.
3. **Refined Security-Critical Notification Policy:**
   Eliminated the blanket override in `ChannelRouter` that previously forced all three channels for any security-flagged event. Replaced it with an explicit policy: essential security communications (`ACCOUNT_SECURITY` events such as login alerts, password resets, verification codes, and hardware `DEVICE_LINKED` pairings) guarantee mandatory `IN_APP` and `EMAIL` delivery. Push notifications are routed if target devices are paired and push is enabled or for high-severity security incidents. Customer preferences cannot disable mandatory security alerts.
4. **Website Notification Preferences Experience:**
   Replaced the placeholder website controls with a responsive, accessible interface in `main website/Frontend/js/notification-center.js` and `main website/Frontend/css/notification-center.css`. The interface displays master delivery switches, 6 granular category cards with channel checkboxes, mandatory security policy badges, locked controls for required alerts, dirty-change tracking (`window.onbeforeunload`), in-flight submit protection, and authoritative state refresh.
5. **Android Notification Preferences Experience:**
   Upgraded the Flutter Android application (`notification_preferences.dart`, `notification_provider.dart`, and `notification_preferences_screen.dart`). Added an Android OS system notification permission advisory banner with direct access to Android system settings via `PushNotificationService.instance.openNotificationSettings()`, master delivery toggles, category cards with channel switches, mandatory alert badges, pull-to-refresh (`RefreshIndicator`), and safe saving state controls.
6. **Delivery-Time Enforcement & Invoice Deduplication Guard:**
   Updated `ChannelRouter.evaluateRouting()` to evaluate both master channel toggles and granular category channel toggles for ordinary notifications, while preserving `IN_APP` history feeds even when outbound channels are disabled. Preserved the statutory invoice email deduplication guard ensuring `INVOICE_ISSUED` never sends duplicate emails from the central dispatcher.

**Final Status:** `IMPLEMENTED WITH DOCUMENTED LIMITATIONS`

---

## 2. Files Changed and Purpose of Each Change

| File Path | Component | Purpose of Change |
| :--- | :--- | :--- |
| `main website/Backend/src/notifications/types/preference.ts` | Backend Types | Added `normalizeNotificationPreferences()` to ensure full 6-category completeness, channel integrity, and mandatory security policy enforcement across partial/legacy records. |
| `main website/Backend/src/notifications/repositories/notification_repository.ts` | Backend Repository | Updated `getUserPreferences` and `updateUserPreferences` to deeply merge category settings and apply `normalizeNotificationPreferences()` prior to Prisma storage and response dispatch. |
| `main website/Backend/src/notifications/routes/preference_routes.ts` | Backend REST API | Expanded Zod schema to support partial category updates and both `categories` and `categoryPreferences` payload aliases; returns authoritative normalized preferences. |
| `main website/Backend/src/notifications/services/channel_router.ts` | Central Routing Engine | Refined security policy evaluation in `evaluateRouting()`; enforced mandatory `IN_APP` and `EMAIL` for security-critical events; applied granular category channel evaluations for ordinary events; preserved `INVOICE_ISSUED` email deduplication guard. |
| `main website/Frontend/js/notification-center.js` | Website Client | Upgraded `renderPreferencesForm` to render global switches and all 6 category preference cards; added dirty tracking, in-flight submission fencing, and authoritative server re-rendering. |
| `main website/Frontend/css/notification-center.css` | Website Styling | Added responsive CSS styles for category preference cards, channel toggle grids, and mandatory security badges (`.pref-category-card`, `.pref-channel-grid`, `.pref-category-badge--mandatory`). |
| `Android app/Android app code/lib/features/notifications/domain/models/notification_preferences.dart` | Flutter Domain Model | Created `CategoryPreferenceItem` and updated `NotificationPreferences` to store typed category models; supported both `categories` and `categoryPreferences` JSON keys with default fallbacks. |
| `Android app/Android app code/lib/features/notifications/providers/notification_provider.dart` | Flutter State Management | Added `savePreferences()` and updated `updatePreferences()` in `NotificationPreferencesNotifier` to send complete structured preferences to backend. |
| `Android app/Android app code/lib/features/notifications/screens/notification_preferences_screen.dart` | Flutter UI | Redesigned preferences screen to show OS system permission banner with settings shortcut, mandatory security notice, master switches, 6 category cards with channel switches, and saving state indicators. |
| `main website/Backend/tests/notification_preferences_expansion.test.ts` | Backend Test Suite | Created 8 unit test specifications (marked `NOT EXECUTED`) covering defaults, legacy record enrichment, mandatory security invariants, and channel routing decisions. |
| `Android app/Android app code/test/unit/notification_integration_test.dart` | Android Test Suite | Added tests 26–30 (marked `NOT EXECUTED`) covering Flutter model deserialization, category fallbacks, security invariants, and copyWith operations. |

---

## 3. Effective Preference Model and Supported Categories/Channels

The effective preference model operates on a two-tier hierarchy:
1. **Master Delivery Channels (`globalPushEnabled`, `globalEmailEnabled`):**
   - Serves as a top-level kill switch for outbound channels. If disabled globally, outbound push or email will not be sent for optional notification categories.
2. **Category & Channel Controls (`categories.<CATEGORY>.enabled`, `categories.<CATEGORY>.channels.<CHANNEL>`):**
   - Each category can be enabled/disabled as a whole.
   - For an enabled category, each delivery channel (`IN_APP`, `PUSH`, `EMAIL`) can be toggled.

### Supported Category Matrix:

| Category | Display Name | In-App Default | Push Default | Email Default | User Configurable? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ACCOUNT_SECURITY` | Account & Security | **true** (Locked) | **true** (Configurable) | **true** (Locked) | Partial (Push only; In-App & Email mandatory) |
| `DEVICE_SERVER` | Servers & Devices | **true** | **true** | **true** | Fully Configurable |
| `BILLING` | Billing & Subscriptions | **true** | **true** | **true** | Fully Configurable (Statutory invoices always emailed via dedicated outbox) |
| `STORAGE` | Storage & Capacity | **true** | **true** | **true** | Fully Configurable |
| `FILE_OPERATIONS` | File Operations | **true** | **true** | **false** | Fully Configurable |
| `SYSTEM` | System Announcements | **true** | **true** | **false** | Fully Configurable |

---

## 4. Default Behavior for Existing and New Users

1. **New Users (No Stored Preference Record):**
   - When `getUserPreferences(userId)` finds no database record, `getDefaultNotificationPreferences(userId)` provides the documented baseline.
   - All categories are enabled with default channels enabled (`IN_APP` and `PUSH` on all categories; `EMAIL` enabled on Security, Devices, Billing, and Storage).
2. **Existing Users (Legacy JSON Records):**
   - Existing records stored in PostgreSQL `UserNotificationPreferences.categoryPreferences` may lack newer categories (such as `BILLING`) or granular channel mappings.
   - When loaded, `normalizeNotificationPreferences()` iterates through all canonical `NotificationCategory` enums. Any missing category is populated from the documented defaults, preserving the user's previously saved settings without dropping new capabilities or requiring database migrations.
3. **Partial Updates:**
   - When a client sends a partial update (e.g. only modifying `BILLING`), the repository deep-merges the payload onto existing preferences and normalizes the output.

---

## 5. Website Preference UI and API Integration

- **Entry Point:** Located at `main website/Frontend/pages/notifications.html` in the Preferences & Policy panel.
- **Client Script:** Implemented in `main website/Frontend/js/notification-center.js` (`renderPreferencesForm`).
- **User Experience:**
  - Displays a yellow warning banner summarizing the mandatory security alert policy.
  - Presents master switches for Android Push Notifications and Email Delivery.
  - Lists all 6 notification categories with clear descriptions, category master toggles, and granular checkboxes for In-App, Push, and Email.
  - `Account & Security` shows locked, disabled checkboxes for In-App and Email with a "Mandatory Policy" badge.
  - Dirty-state tracking displays an "Unsaved changes" badge and intercepts page unload with `window.onbeforeunload`.
  - On submit, dispatches `PATCH /api/v1/notifications/preferences` with full payload.
  - Disables the submit button during in-flight requests ("Saving Preferences...").
  - On 200 OK, re-renders the form with authoritative server data and displays an accessible green confirmation badge.

---

## 6. Android Preference UI and API Integration

- **Screen Implementation:** `Android app/Android app code/lib/features/notifications/screens/notification_preferences_screen.dart`.
- **Domain & State:** `NotificationPreferences` model and `NotificationPreferencesNotifier` in `notification_provider.dart`.
- **User Experience:**
  - **OS Permission Advisory:** A dedicated blue information card explains that Android OS system notification permission operates independently from account push preferences. Provides a direct action button: "System Settings", calling `PushNotificationService.instance.openNotificationSettings()` (`android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS`).
  - **Mandatory Policy Banner:** Clarifies why account security notifications cannot be disabled.
  - **Master Channels:** SwitchListTiles for Master Android Push and Email notifications.
  - **Granular Categories:** 6 custom category cards with category master switch and In-App / Push / Email checkboxes.
  - **Save & Refresh Controls:** AppBar and bottom save buttons with in-flight loading spinners. Pull-to-refresh (`RefreshIndicator`) refreshes authoritative settings from the backend.
  - **Session Safety:** Displays an error state with a "Retry" button if session is expired or unauthenticated.

---

## 7. Delivery-Time Enforcement and Cross-Platform Consistency

`ChannelRouter.evaluateRouting()` in `main website/Backend/src/notifications/services/channel_router.ts` enforces the authoritative delivery rules:
1. **Preferences Normalization:** Always normalizes incoming preferences through `normalizeNotificationPreferences(event.userId, userPreferences)` before evaluating.
2. **Category Suppression:** If a category has `enabled: false`, outbound channels (`PUSH`, `EMAIL`) are suppressed. `IN_APP` is preserved so the event remains in the customer's notification history feed.
3. **Channel Filtering:**
   - `PUSH` is allowed only if `prefs.globalPushEnabled === true` AND `catPref.channels[PUSH] === true` AND registered devices exist.
   - `EMAIL` is allowed only if `prefs.globalEmailEnabled === true` AND `catPref.channels[EMAIL] === true`.
   - `IN_APP` is allowed if `catPref.channels[IN_APP] !== false`.
4. **Cross-Platform Consistency:** Because preferences are persisted in the centralized PostgreSQL database (`UserNotificationPreferences`), changes made on the website immediately apply to the Android application (and vice versa) upon fetch.

---

## 8. Security-Critical Notification Policy & Unresolved Decisions

### Explicit Security Policy Implemented:
1. **Mandatory Communication Classification:**
   - Essential security events: `EMAIL_VERIFICATION`, `SIGN_IN`, `SECURITY_EVENT` (Category: `ACCOUNT_SECURITY`), and `DEVICE_LINKED` (Category: `DEVICE_SERVER`).
2. **Channel Guarantee:**
   - For all security-critical events, `IN_APP` and `EMAIL` delivery are mandatory and bypass user preference suppression.
   - `PUSH` is routed if paired Android devices exist AND (`prefs.globalPushEnabled` is true OR the event has severity `SECURITY` or `CRITICAL`).
3. **Immutability in Preferences:**
   - Neither the website nor the Android app allows disabling `ACCOUNT_SECURITY` or its `IN_APP` and `EMAIL` delivery channels. If a malformed or hostile request attempts to set them to false, `normalizeNotificationPreferences()` resets them to true.

### Documented Policy Nuance:
- **`DEVICE_LINKED` Category Placement:** `DEVICE_LINKED` belongs to the `DEVICE_SERVER` category in `type_registry.ts`. While the general `DEVICE_SERVER` category can be disabled by the user for everyday server start/stop notices, pairing a new physical device to the account represents a critical hardware access event. Under the current policy, `DEVICE_LINKED` has `isSecurityCritical: true` and will always dispatch an email and in-app alert to notify the account owner, even if general server alerts are silenced.

---

## 9. Invoice Email Deduplication Preservation

In Phase 11.2 and Phase 11.3, statutory tax invoice delivery was integrated with a dedicated outbox worker (`InvoiceNotificationOutboxWorker` and `BillingInvoiceNotificationService`).

In `main website/Backend/src/notifications/services/channel_router.ts`:
```typescript
const effectiveChannels = event.eventType === NotificationType.INVOICE_ISSUED
  ? allowedChannels.filter((ch) => ch !== NotificationChannel.EMAIL)
  : allowedChannels;
```
This deduplication guard was strictly preserved in Phase 11.5:
- When `INVOICE_ISSUED` is dispatched, `ChannelRouter` allows `IN_APP` and `PUSH` (based on user preferences), but unconditionally filters out `EMAIL`.
- The statutory PDF invoice email continues to be dispatched exclusively through the dedicated outbox pipeline, preventing customer inbox duplication.

---

## 10. Tests Created or Updated (Status: NOT EXECUTED)

In compliance with project execution policy, all test files are marked **NOT EXECUTED**:

### 1. Backend Test Specifications:
File: `main website/Backend/tests/notification_preferences_expansion.test.ts`
- **Test 1:** `getDefaultNotificationPreferences supplies all 6 categories and documented channel defaults`
- **Test 2:** `normalizeNotificationPreferences enriches older records missing BILLING or channel keys`
- **Test 3:** `normalizeNotificationPreferences enforces mandatory security policy invariants`
- **Test 4:** `ChannelRouter enforces mandatory delivery for security-critical events (SIGN_IN, SECURITY_EVENT)`
- **Test 5:** `ChannelRouter respects user disablement for ordinary categories (BILLING, STORAGE, DEVICE_SERVER)`
- **Test 6:** `ChannelRouter respects individual channel toggles (Push and Email) for enabled categories`
- **Test 7:** `ChannelRouter preserves deduplication guard for INVOICE_ISSUED (EMAIL filtered from central dispatch)`
- **Test 8:** `ChannelRouter preserves IN_APP history when all outbound channels are globally disabled`

### 2. Android Flutter Test Specifications:
File: `Android app/Android app code/test/unit/notification_integration_test.dart`
- **Test 26:** `NotificationPreferences parses granular categories and populates default fallbacks`
- **Test 27:** `NotificationPreferences enforces mandatory security policy invariants on deserialization`
- **Test 28:** `CategoryPreferenceItem serializes and deserializes channel mappings cleanly`
- **Test 29:** `NotificationPreferences supports both categories and legacy categoryPreferences JSON keys`
- **Test 30:** `NotificationPreferences copyWith updates individual and category preferences accurately`

---

## 11. Static Verification Performed & Remaining Unverified Items

### Static Verification Completed:
- Verified JSON schema alignment between backend `updatePreferencesSchema`, repository persistence, and website/Flutter serialization formats.
- Verified that all 6 enum keys in `NotificationCategory` (`ACCOUNT_SECURITY`, `DEVICE_SERVER`, `FILE_OPERATIONS`, `STORAGE`, `SYSTEM`, `BILLING`) are rendered in both website JS and Flutter Dart UI.
- Verified that all 3 delivery channels (`IN_APP`, `PUSH`, `EMAIL`) have corresponding toggles in both frontends.
- Verified that security-critical event evaluation in `ChannelRouter` bypasses only mandatory channels and records `securityBypassTriggered`.
- Verified invoice deduplication logic remains active on `INVOICE_ISSUED`.

### What Remains Unverified:
- Live network roundtrips between a browser client and the running Fastify backend server.
- Live rendering and accessibility compliance across specific mobile browser engines (WebKit/Blink).
- Flutter UI rendering on physical Android devices across diverse display densities.

---

## 12. Database and Configuration Requirements

- **Zero Schema Migrations Required:** The existing `UserNotificationPreferences.categoryPreferences` column in `schema.prisma` is of type `Json`. It natively supports the granular category and channel structures without database schema changes.
- **Zero Package Installations Required:** Utilizes existing dependencies (`fastify`, `zod`, `@prisma/client` on Backend; `flutter_riverpod`, `flutter/material.dart` on Android).

---

## 13. Final Compliance Confirmation

- **Zero test runners or test suites were executed.**
- **Zero builds, TypeScript compilations, Gradle tasks, or Dart analysis commands were executed.**
- **Zero package installations (`npm install`, `flutter pub get`) were run.**
- **Zero database migrations or Prisma Client generation commands were applied.**
- **Zero live emails or push notifications were dispatched.**
- **Zero production customer data was accessed.**

---

**End of Phase 11.5 Report**
