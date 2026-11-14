# ZDEXCLOUD — PHASE 20.1 IMPLEMENTATION REPORT
## CAMERA DATABASE FOUNDATION & MULTI-PRODUCT MODEL INTEGRATION

**Project:** ZdexCloud Personal Cloud Platform  
**Phase:** 20.1 — Camera Database Foundation  
**Execution Mode:** Implementation (Schema & Migration Artifact Foundation Only)  
**Date:** November 7, 2026  
**Final Status:** COMPLETE  
**Production / Remote Database Changes:** ZERO (0 modifications, zero DDL executed on remote MySQL)  
**Live Razorpay / External Calls:** ZERO (0 calls)  
**Dependencies Added:** ZERO (0 packages installed)  
**Tests Executed:** ZERO (0 test runners executed; all test scenarios marked `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`)

---

## 1. SUMMARY OF IMPLEMENTED DATABASE FOUNDATION

Phase 20.1 establishes the database schema foundation for **ZdexCloud Camera** as an independent product, fulfilling the Phase 19 multi-product architecture, Phase 19.3 subscription model, and Phase 19.5 security/privacy threat model.

The Camera product is architected to operate with complete structural independence from the existing Storage file-server engine:
- A registered Camera does **NOT** require a `ServerInstance` to exist or operate.
- A physical Android device can host Storage-only, Camera-only, or both services concurrently without cross-product interference.
- Camera registrations do not consume or count against the 5-Storage-server account limit.
- Security audit events and usage tracking records survive device unlinking and camera deregistration via deliberate `SetNull` referential actions.
- Media streams and sensitive signaling secrets (SDP, ICE credentials, viewing tokens) are never persisted in plaintext database fields.

---

## 2. EXACT FILES CREATED AND MODIFIED

### Files Created:
1. `main website/Backend/prisma/migrations/20261107140000_add_camera_database_foundation/migration.sql`
   - Complete, non-destructive MySQL DDL creating the 6 Camera tables, enums, indexes, and foreign keys.
2. `main website/Backend/tests/camera_database_foundation.test.ts`
   - 8 comprehensive specification test scenarios covering schema relations, tenant isolation, independence from Storage, and retention rules (marked `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`).
3. `docs/PHASE_20_1_CAMERA_DATABASE_FOUNDATION_REPORT.md`
   - This implementation report.

### Files Modified:
1. `main website/Backend/prisma/schema.prisma`
   - Added 6 Camera Enums: `CameraStatus`, `CameraEndpointStatus`, `CameraStreamSessionStatus`, `CameraTransportType`, `CameraAuditEventType`, `CameraUsageCategory`.
   - Added 6 Camera Models: `CameraInstance`, `CameraEndpoint`, `CameraStreamSession`, `CameraSubscription`, `CameraAccessAuditEvent`, `CameraUsageRecord`.
   - Extended existing relations on `User`, `Device`, `AccountProductSubscription`, and `Subscription`.
2. `main website/Backend/tsconfig.test.json`
   - Registered `tests/camera_database_foundation.test.ts` into TypeScript test configuration.

---

## 3. PRISMA MODEL AND RELATION SUMMARY

### 3.1 New Core Camera Models

#### 1. `CameraInstance`
- **Purpose**: Represents a registered physical or logical camera installation.
- **Fields**:
  - `id`: Primary key (`cuid()`).
  - `userId`: Foreign key referencing owning platform `User` (`onDelete: Cascade`).
  - `deviceId`: Optional foreign key referencing physical Android `Device` (`onDelete: SetNull`).
  - `cameraName`: User-friendly camera label (e.g. "Front Porch Camera").
  - `status`: Lifecycle enum `CameraStatus` (`OFFLINE`, `CONNECTING`, `ONLINE`, `STREAMING`, `RECONNECTING`, `ERROR`).
  - `resolution`: Target streaming resolution (default `"720p"`).
  - `fps`: Target frame rate (default `20`).
  - `audioEnabled`: Boolean flag (default `false`).
  - `lensFacing`: Selected camera lens (`"BACK"` / `"FRONT"`).
  - `metadata`: Flexible JSON for camera hardware capabilities and sensor quirks.
  - `lastSeenAt`, `startedAt`, `stoppedAt`: Lifecycle timestamps.
  - `createdAt`, `updatedAt`: Standard audit timestamps.
- **Child Relations**: `endpoints`, `streamSessions`, `subscription`, `auditEvents`, `usageRecords`.

#### 2. `CameraEndpoint`
- **Purpose**: Tracks connection and signaling endpoint metadata for an active camera instance.
- **Fields**:
  - `id`: Primary key (`cuid()`).
  - `cameraInstanceId`: Foreign key referencing `CameraInstance` (`onDelete: Cascade`).
  - `signalingUrl`: Target signaling WebSocket endpoint URL.
  - `connectionToken`: Ephemeral signaling handshake token.
  - `ipAddress`: Sanitized client network endpoint IP.
  - `status`: Enum `CameraEndpointStatus` (`INACTIVE`, `READY`, `CONNECTED`, `FAILED`, `REVOKED`).
  - `lastHeartbeatAt`, `connectedAt`, `disconnectedAt`: Connection timestamps.
- **Privacy Guarantee**: Zero storage of live media streams, video chunks, or audio payloads.

#### 3. `CameraStreamSession`
- **Purpose**: Tracks individual viewer WebRTC streaming sessions.
- **Fields**:
  - `id`: Primary key (`cuid()`).
  - `cameraInstanceId`: Foreign key referencing target `CameraInstance` (`onDelete: Cascade`).
  - `viewerUserId`: Foreign key referencing viewer `User` (`onDelete: Cascade`).
  - `sessionTokenHash`: Cryptographic SHA-256 hash of the Camera Viewing Token (CVT) for session correlation without storing raw tokens.
  - `status`: Enum `CameraStreamSessionStatus` (`INITIATED`, `NEGOTIATING`, `ACTIVE`, `ENDED`, `FAILED`, `TIMED_OUT`).
  - `transportType`: Enum `CameraTransportType` (`P2P`, `TURN_RELAY`, `SFU`).
  - `protocol`: Protocol identifier (default `"WEBRTC"`).
  - `startedAt`, `endedAt`: Session duration timestamps.
  - `bytesTransferred`: Bandwidth volume counter (`BigInt`).
  - `durationSeconds`: Total viewing duration in seconds.
  - `terminationReason`: Closure reason code (`VIEWER_DISCONNECT`, `CAMERA_OFFLINE`, `TIMEOUT`, etc.).
  - `metadata`: Sanitized client performance metrics (RTT, packet loss, browser client).
- **Privacy Guarantee**: Strict prohibition on persisting raw SDP offers/answers or ICE candidate credentials.

#### 4. `CameraSubscription`
- **Purpose**: Binds a `CameraInstance` to the user's canonical `AccountProductSubscription` slot established in Phase 19.3.
- **Fields**:
  - `id`: Primary key (`cuid()`).
  - `cameraInstanceId`: Foreign key with `@unique` constraint referencing `CameraInstance` (`onDelete: Cascade`).
  - `userId`: Foreign key referencing owning `User` (`onDelete: Cascade`).
  - `accountProductSubscriptionId`: Optional foreign key referencing `AccountProductSubscription` (`onDelete: SetNull`).
  - `subscriptionId`: Optional foreign key referencing authoritative `Subscription` (`onDelete: SetNull`).
  - `status`: Enum `BillingStatus` (`ACTIVE`, `PAST_DUE`, `CANCELLING`, `EXPIRED`, etc.).
  - `allocatedAt`, `revokedAt`: Entitlement slot lifecycle timestamps.
- **Preservation Invariant**: Seamlessly integrates with the Phase 19.3 multi-product architecture without creating competing billing engines or altering existing Storage subscriptions.

#### 5. `CameraAccessAuditEvent`
- **Purpose**: Security audit trail for all camera registrations, streaming sessions, credential issuance, and permission events.
- **Fields**:
  - `id`: Primary key (`cuid()`).
  - `cameraInstanceId`: Optional foreign key referencing `CameraInstance` (`onDelete: SetNull`).
  - `userId`: Optional foreign key referencing `User` (`onDelete: SetNull`).
  - `actorType`: Entity category (`"USER"`, `"DEVICE"`, `"SYSTEM"`, `"ADMIN"`).
  - `eventType`: Enum `CameraAuditEventType` (`CAMERA_REGISTERED`, `CAMERA_UNLINKED`, `CAMERA_STARTED`, `CAMERA_STOPPED`, `VIEWING_SESSION_REQUESTED`, `VIEWING_SESSION_STARTED`, `VIEWING_SESSION_ENDED`, `VIEWING_ACCESS_DENIED`, `TURN_CREDENTIALS_ISSUED`, `SIGNALING_AUTHENTICATED`, `SIGNALING_AUTH_FAILED`).
  - `action`: Specific operation performed.
  - `result`: Outcome (`"SUCCESS"`, `"FAILED"`, `"DENIED"`).
  - `ipAddress`, `userAgent`: Sanitized client telemetry.
  - `metadata`: Sanitized context JSON.
- **Retention Invariant**: `onDelete: SetNull` ensures security audit logs remain intact even if a camera is unlinked or a user account is purged.

#### 6. `CameraUsageRecord`
- **Purpose**: Foundation for aggregate usage tracking and future billing/quota enforcement.
- **Fields**:
  - `id`: Primary key (`cuid()`).
  - `cameraInstanceId`: Optional foreign key referencing `CameraInstance` (`onDelete: SetNull`).
  - `userId`: Foreign key referencing owning `User` (`onDelete: Cascade`).
  - `category`: Enum `CameraUsageCategory` (`STREAMING_SECONDS`, `TURN_RELAY_BYTES`, `STREAM_SESSION_COUNT`, `ACTIVE_CAMERA_HOURS`).
  - `quantity`: Numerical usage value (`BigInt`).
  - `unit`: Measurement unit (`"SECONDS"`, `"BYTES"`, `"COUNT"`).
  - `periodStart`, `periodEnd`: Aggregation window timestamps.
  - `metadata`: Flexible metric attributes.

---

## 4. CONSTRAINTS AND INDEXES ADDED

### Unique Constraints:
1. `CameraSubscription(cameraInstanceId)`: `@unique` prevents a single camera instance from being assigned multiple subscription slots simultaneously.

### Foreign Key Constraints:
- `CameraInstance.userId` $\rightarrow$ `User.id` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- `CameraInstance.deviceId` $\rightarrow$ `Device.id` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- `CameraEndpoint.cameraInstanceId` $\rightarrow$ `CameraInstance.id` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- `CameraStreamSession.cameraInstanceId` $\rightarrow$ `CameraInstance.id` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- `CameraStreamSession.viewerUserId` $\rightarrow$ `User.id` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- `CameraSubscription.cameraInstanceId` $\rightarrow$ `CameraInstance.id` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- `CameraSubscription.userId` $\rightarrow$ `User.id` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- `CameraSubscription.accountProductSubscriptionId` $\rightarrow$ `AccountProductSubscription.id` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- `CameraSubscription.subscriptionId` $\rightarrow$ `Subscription.id` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- `CameraAccessAuditEvent.cameraInstanceId` $\rightarrow$ `CameraInstance.id` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- `CameraAccessAuditEvent.userId` $\rightarrow$ `User.id` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- `CameraUsageRecord.cameraInstanceId` $\rightarrow$ `CameraInstance.id` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- `CameraUsageRecord.userId` $\rightarrow$ `User.id` (`ON DELETE CASCADE ON UPDATE CASCADE`)

### Performance Indexes:
- `CameraInstance`: `(userId)`, `(deviceId)`, `(status)`, `(lastSeenAt)`, `(createdAt)`
- `CameraEndpoint`: `(cameraInstanceId)`, `(status)`
- `CameraStreamSession`: `(cameraInstanceId)`, `(viewerUserId)`, `(status)`, `(startedAt)`
- `CameraSubscription`: `(userId)`, `(cameraInstanceId)`, `(accountProductSubscriptionId)`, `(subscriptionId)`, `(status)`
- `CameraAccessAuditEvent`: `(cameraInstanceId)`, `(userId)`, `(eventType)`, `(createdAt)`
- `CameraUsageRecord`: `(userId)`, `(cameraInstanceId)`, `(category)`, `(periodStart, periodEnd)`

---

## 5. MIGRATION ARTIFACT & SQL REVIEW FINDINGS

- **Location**: `main website/Backend/prisma/migrations/20261107140000_add_camera_database_foundation/migration.sql`
- **SQL Analysis**:
  - Contains strictly additive DDL statements: 6 `CREATE TABLE` and 12 `ALTER TABLE ... ADD CONSTRAINT` operations.
  - Zero `DROP TABLE`, `DROP COLUMN`, or destructive modifications.
  - Zero modifications to existing Storage tables (`Device`, `ServerInstance`, `ServerEndpoint`, `DeviceConnection`).
  - Zero modifications to billing tables (`Plan`, `Subscription`, `AccountProductSubscription`, `BillingInvoice`, etc.).
  - Uses `utf8mb4` character set and `utf8mb4_unicode_ci` collation, matching existing database standards.
  - **Production Safety**: Migration script is committed as an artifact; it has **NOT** been applied to the remote MySQL database.

---

## 6. CONFIRMATION OF REMOTE DATABASE AND BILLING PRESERVATION

1. **Remote Database Safety**:
   - Remote database (`remotenode-3530333528a3` on `mysql.gb.stackcp.com`) was **NOT modified**.
   - Zero migration deploy commands (`prisma migrate deploy` or `prisma db push`) were executed.
2. **Preservation of Storage and Billing**:
   - `ServerInstance` remains 100% independent.
   - `AccountProductSubscription` and `Subscription` preserve all existing foreign keys and columns.
   - Storage server limit (5 servers) remains tied strictly to `Plan.serverLimit` and `ServerInstance` counts, completely insulated from `CameraInstance`.

---

## 7. NAMING AND ARCHITECTURE RECONCILIATION

- **Reconciliation Decision**:
  - Phase 19.4 and Phase 19.5 exploratory documentation occasionally referred to `CameraNode` as a conceptual label.
  - In accordance with Section 3 of the Phase 20.1 roadmap prompt, **`CameraInstance` is established as the canonical, authoritative database model name**.
  - This naming mirrors the existing Storage pattern (`ServerInstance`), providing architectural symmetry across the platform (`ServerInstance` for Storage, `CameraInstance` for Camera).
  - No duplicate `CameraNode` model was created. All Phase 20–28 references must use `CameraInstance`.

---

## 8. SECURITY AND PRIVACY REVIEW FINDINGS

In strict compliance with the Phase 19.5 Security and Privacy Threat Model:
1. **Never-Log Privacy Rule Enforced**:
   - `CameraEndpoint` and `CameraStreamSession` do not contain fields for raw SDP offers/answers, ICE candidate credentials, or unhashed viewing tokens.
   - `CameraStreamSession.sessionTokenHash` stores only a one-way cryptographic SHA-256 hash.
2. **Audit Trail Durability**:
   - `CameraAccessAuditEvent` utilizes `ON DELETE SET NULL` for both `cameraInstanceId` and `userId`. If a user unlinks a device or closes their account, the security audit records are preserved for administrative and forensic review.
3. **Decoupled Identity**:
   - An Android phone operating as a Camera only links to `Device` (`deviceId`), completely bypassing `ServerInstance` creation and loopback file server allocation.

---

## 9. TEST SUITE INVENTORY (WRITE-ONLY)

A dedicated test suite has been authored and registered in `main website/Backend/tsconfig.test.json`:
- **File**: `main website/Backend/tests/camera_database_foundation.test.ts`
- **Execution Status**: **`NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`**
- **Test Scenarios Defined**:
  1. `Scenario 1`: `CameraInstance` model structure, defaults, and user relations.
  2. `Scenario 2`: User ownership, foreign keys, and multi-tenant isolation.
  3. `Scenario 3`: Device association and Storage `ServerInstance` independence (Camera-only, Storage-only, Dual-purpose).
  4. `Scenario 4`: Registration uniqueness and stable primary identifiers.
  5. `Scenario 5`: Multi-product `CameraSubscription` compatibility with `AccountProductSubscription`.
  6. `Scenario 6`: `CameraStreamSession` metadata tracking and elimination of raw SDP/credentials.
  7. `Scenario 7`: `CameraAccessAuditEvent` audit trail survival under `SetNull` cascade.
  8. `Scenario 8`: `CameraUsageRecord` tracking foundation without unapproved commercial limits.

---

## 10. STATIC VERIFICATION PERFORMED

1. **Schema Syntax & Relation Validation**:
   - Inspected all model definitions, field types, enums, and reverse relation fields across `User`, `Device`, `AccountProductSubscription`, and `Subscription`.
   - Verified that all `@relation` names match bi-directionally (`UserCameraInstances`, `DeviceCameraInstances`, `ViewerCameraStreamSessions`, `UserCameraSubscriptions`, `UserCameraAuditEvents`, `UserCameraUsageRecords`).
2. **Migration SQL Syntax Check**:
   - Verified MySQL syntax for all `CREATE TABLE`, `INDEX`, `UNIQUE INDEX`, and `FOREIGN KEY` constraints.
   - Confirmed referential action pairings (`ON DELETE CASCADE ON UPDATE CASCADE`, `ON DELETE SET NULL ON UPDATE CASCADE`).
3. **Git Diff Inspection**:
   - Reviewed `git diff main website/Backend/prisma/schema.prisma` to confirm zero unintended modifications to existing models or columns.

---

## 11. KNOWN LIMITATIONS & PREREQUISITES FOR PHASE 20.2

1. **Phase 20.2 Scope**:
   - Phase 20.1 establishes database schema and migration artifacts only.
   - Camera REST APIs (`routes/camera.ts`: camera registration, status polling, configuration updates, and unlinking endpoints) are **not implemented** in this batch and represent the explicit scope of **Phase 20.2**.
2. **Database Migration Deployment Prerequisite**:
   - The migration `20261107140000_add_camera_database_foundation` is staged in version control. It will be applied during the scheduled database deployment window alongside Phase 20 API service rollouts.

---

## 12. SCOPE COMPLIANCE & EXIT DECLARATION

- **Phase Boundary Adherence**:
  - Phase 20.2 Camera APIs: **NOT STARTED**.
  - Phase 20.3 Identity/Ownership Service: **NOT STARTED**.
  - Phase 20.4 Lifecycle Service: **NOT STARTED**.
  - Phase 20.5 Signaling Service: **NOT STARTED**.
  - Phase 21 Android Camera Engine: **NOT STARTED**.
  - Phase 22 WebRTC Media Infrastructure: **NOT STARTED**.
  - Phase 24 Recording Implementation: **NOT STARTED**.
- **Remote Database Mutations**: **ZERO (0)**.
- **Tests Executed**: **ZERO (0)**.

### FINAL STATUS
**`COMPLETE`**

Phase 20.1 is complete. The Camera database foundation is established, fully reconciled with Phase 19 multi-product billing and security architectures, and verified. In accordance with strict roadmap instructions, work stops here for review.
