-- =============================================================================
-- PHASE 20.2: CORRECTIVE ADDITIVE MIGRATION
-- Migration: 20261107160000_add_camera_stream_session_expires_at_and_revocation
-- Scope: Additive schema enhancement for CameraStreamSession
--   1. Add persisted expiresAt field for authoritative viewing token expiration.
--   2. Add sessionTokenHash and expiresAt lookup indexes.
--   3. Extend CameraStreamSessionStatus enum with REVOKED state.
--
-- Index Safety Audit Verification:
--   - In migration 20261107140000, CameraStreamSession was created without an index on sessionTokenHash.
--   - In schema.prisma, sessionTokenHash does NOT have @unique.
--   - Creating CameraStreamSession_sessionTokenHash_idx introduces the single, non-unique lookup index.
--   - No duplicate unique or non-unique index exists for sessionTokenHash or expiresAt.
--
-- Safety: 100% additive, non-destructive, non-breaking.
-- DO NOT APPLY TO LOCAL, STAGING, REMOTE, OR PRODUCTION DATABASE.
-- =============================================================================

-- 1. Add expiresAt column to CameraStreamSession
ALTER TABLE `CameraStreamSession` ADD COLUMN `expiresAt` DATETIME(3) NULL;

-- 2. Add performance index on expiresAt for TTL filtering and validation
CREATE INDEX `CameraStreamSession_expiresAt_idx` ON `CameraStreamSession`(`expiresAt`);

-- 3. Add performance index on sessionTokenHash for fast token lookups (single index, non-duplicate)
CREATE INDEX `CameraStreamSession_sessionTokenHash_idx` ON `CameraStreamSession`(`sessionTokenHash`);

-- 4. Extend status enum to include REVOKED state
ALTER TABLE `CameraStreamSession` MODIFY COLUMN `status` ENUM('INITIATED', 'NEGOTIATING', 'ACTIVE', 'ENDED', 'FAILED', 'TIMED_OUT', 'REVOKED') NOT NULL DEFAULT 'INITIATED';
