-- =============================================================================
-- PHASE 20.3: GLOBAL INSTALLATION CLAIM & RE-ENROLLMENT MIGRATION
-- Migration: 20261107180000_add_device_installation_claim
-- Scope: Global uniqueness for Android installation identities
--
-- NON-DESTRUCTIVE EXECUTION & RECOVERABILITY DESIGN:
--   Step 1: Preflight Duplicate Detection (BEFORE schema changes).
--           Scans existing Device rows (WHERE installationId IS NOT NULL) for
--           duplicate installationId values across Device records.
--           If any duplicates exist, the scalar CASE expression evaluates a
--           multi-row UNION ALL subquery, forcing MySQL to abort (ERROR 1242)
--           BEFORE any DDL statement executes. Zero silent owner selection.
--
--   Step 2: Idempotent Table, Index & Inline FK Creation (CREATE TABLE IF NOT EXISTS).
--           MySQL does not support transactional DDL; CREATE TABLE implicitly
--           commits. Defining UNIQUE INDEX and CONSTRAINT FOREIGN KEY inline
--           inside CREATE TABLE IF NOT EXISTS ensures safe retry after partial
--           migration failure without ERROR 1050 (table exists) or ERROR 1826
--           (duplicate FK constraint name).
--
--   Step 3: Existing-Claim Consistency Verification (AFTER DDL, BEFORE backfill).
--           Verifies that any already-present DeviceInstallationClaim row
--           matching a Device.installationId agrees on BOTH userId and deviceId
--           (c.userId = d.userId AND c.deviceId IS NOT NULL AND c.deviceId = d.id).
--           Aborts with ERROR 1242 if any owner mismatch or device association
--           conflict is found. Never overwrites or reassigns existing claims.
--
--   Step 4: Non-Destructive, Fail-Closed Authoritative Backfill.
--           Inserts ONLY missing claims via LEFT JOIN ... WHERE c.id IS NULL.
--           - Preserves all existing valid DeviceInstallationClaim rows
--             (including REVOKED / RECOVERY_PENDING claims and post-DDL claims).
--           - Deliberately avoids DELETE FROM DeviceInstallationClaim (blanket
--             deletion would destroy legitimate ownership records on retry).
--           - Deliberately avoids INSERT IGNORE (retains fail-closed ER_DUP_ENTRY
--             protection on DeviceInstallationClaim_installationId_key).
--           - Excludes legacy Device rows where installationId IS NULL.
--           - Runs atomically as a single InnoDB INSERT ... SELECT statement.
--
-- Safety: 100% additive, non-destructive, retry-safe.
-- DO NOT APPLY TO LOCAL, STAGING, REMOTE, OR PRODUCTION DATABASE.
--
-- MANUAL RECONCILIATION PROCEDURE:
--   A. If Step 1 halts (duplicate installationId in Device):
--      1. Inspect conflicting rows:
--         SELECT `installationId`, COUNT(*) AS `rowCount`, COUNT(DISTINCT `userId`) AS `userCount`,
--                GROUP_CONCAT(`userId`) AS `conflictingUsers`, GROUP_CONCAT(`id`) AS `deviceIds`
--         FROM `Device`
--         WHERE `installationId` IS NOT NULL
--         GROUP BY `installationId`
--         HAVING COUNT(*) > 1;
--      2. Review audit logs, lastSeenAt, and account activity to establish genuine ownership.
--      3. With customer authorization, assign a distinct reconciled ID to the stale Device row:
--         UPDATE `Device` SET `installationId` = CONCAT('inst-reconciled-', `id`) WHERE `id` = '<stale_device_id>';
--      4. Re-run migration.
--
--   B. If Step 3 halts (existing claim disagrees with Device record):
--      1. Inspect conflicting claims vs Device rows:
--         SELECT `c`.`id` AS `claimId`, `c`.`installationId`, `c`.`status` AS `claimStatus`,
--                `c`.`userId` AS `claimUserId`, `d`.`userId` AS `deviceUserId`,
--                `c`.`deviceId` AS `claimDeviceId`, `d`.`id` AS `deviceId`
--         FROM `DeviceInstallationClaim` AS `c`
--         INNER JOIN `Device` AS `d` ON `c`.`installationId` = `d`.`installationId`
--         WHERE `c`.`userId` <> `d`.`userId`
--            OR `c`.`deviceId` IS NULL
--            OR `c`.`deviceId` <> `d`.`id`;
--      2. Resolve the mismatch manually after auditing ownership before retrying.
--      3. Never run blanket DELETE FROM DeviceInstallationClaim or blindly transfer ownership.
-- =============================================================================

-- Step 1: Preflight Conflict Detection (Executes BEFORE DDL)
-- Aborts immediately before table creation if duplicate non-null installationIds exist in Device.
SELECT CASE WHEN (
    SELECT COUNT(*) FROM (
        SELECT `installationId`
        FROM `Device`
        WHERE `installationId` IS NOT NULL
        GROUP BY `installationId`
        HAVING COUNT(*) > 1
    ) AS `_preflight_conflicts`
) > 0 THEN (
    SELECT 'MIGRATION_ABORTED_CONFLICTING_INSTALLATION_IDS_FOUND_IN_DEVICE_TABLE'
    UNION ALL
    SELECT CONCAT('CONFLICT: installationId=', `installationId`, ' accounts=', GROUP_CONCAT(`userId`), ' devices=', GROUP_CONCAT(`id`))
    FROM `Device`
    WHERE `installationId` IS NOT NULL
    GROUP BY `installationId`
    HAVING COUNT(*) > 1
) ELSE 'PREFLIGHT_OK_NO_DUPLICATE_INSTALLATION_IDS' END AS `preflight_status`;

-- Step 2: Idempotent Table, Unique Index & Inline Foreign Key Creation
-- Defined inline with IF NOT EXISTS to survive MySQL DDL implicit commits on retry.
CREATE TABLE IF NOT EXISTS `DeviceInstallationClaim` (
    `id` VARCHAR(191) NOT NULL,
    `installationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `metadata` JSON NULL,
    `claimedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DeviceInstallationClaim_installationId_key`(`installationId`),
    INDEX `DeviceInstallationClaim_userId_idx`(`userId`),
    INDEX `DeviceInstallationClaim_status_idx`(`status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `DeviceInstallationClaim_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 3: Non-Destructive Existing-Claim Consistency Check (Executes BEFORE Backfill)
-- Verifies that every existing DeviceInstallationClaim matching a Device.installationId
-- agrees on both userId and deviceId. Aborts on any ownership or device-link conflict.
SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM `DeviceInstallationClaim` AS `c`
    INNER JOIN `Device` AS `d` ON `c`.`installationId` = `d`.`installationId`
    WHERE `d`.`installationId` IS NOT NULL
      AND (
          `c`.`userId` <> `d`.`userId`
          OR `c`.`deviceId` IS NULL
          OR `c`.`deviceId` <> `d`.`id`
      )
) > 0 THEN (
    SELECT 'MIGRATION_ABORTED_EXISTING_CLAIM_CONFLICTS_WITH_DEVICE_RECORD'
    UNION ALL
    SELECT CONCAT(
        'CONFLICT: installationId=', `c`.`installationId`,
        ' claimUserId=', `c`.`userId`,
        ' deviceUserId=', `d`.`userId`,
        ' claimDeviceId=', COALESCE(`c`.`deviceId`, 'NULL'),
        ' deviceId=', `d`.`id`
    )
    FROM `DeviceInstallationClaim` AS `c`
    INNER JOIN `Device` AS `d` ON `c`.`installationId` = `d`.`installationId`
    WHERE `d`.`installationId` IS NOT NULL
      AND (
          `c`.`userId` <> `d`.`userId`
          OR `c`.`deviceId` IS NULL
          OR `c`.`deviceId` <> `d`.`id`
      )
) ELSE 'CLAIM_CONSISTENCY_OK' END AS `claim_consistency_status`;

-- Step 4: Non-Destructive, Fail-Closed Authoritative Backfill
-- Preserves all existing valid claims and inserts only missing claims for non-null Device rows.
-- Deliberately omits IGNORE and avoids blanket DELETE so interrupted backfills retry safely.
INSERT INTO `DeviceInstallationClaim` (`id`, `installationId`, `userId`, `deviceId`, `status`, `claimedAt`, `updatedAt`)
SELECT
    CONCAT('clm_', SUBSTRING(MD5(CONCAT(`d`.`userId`, '_', `d`.`installationId`)), 1, 25)),
    `d`.`installationId`,
    `d`.`userId`,
    `d`.`id`,
    'ACTIVE',
    `d`.`createdAt`,
    `d`.`updatedAt`
FROM `Device` AS `d`
LEFT JOIN `DeviceInstallationClaim` AS `c`
    ON `c`.`installationId` = `d`.`installationId`
WHERE `d`.`installationId` IS NOT NULL
  AND `c`.`id` IS NULL;
