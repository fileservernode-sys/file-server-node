-- =============================================================================
-- PHASE 20.1: CAMERA DATABASE FOUNDATION MIGRATION
-- Migration: 20261107140000_add_camera_database_foundation
-- Objective: Introduce independent Camera database foundation models:
--   1. CameraInstance
--   2. CameraEndpoint
--   3. CameraStreamSession
--   4. CameraSubscription
--   5. CameraAccessAuditEvent
--   6. CameraUsageRecord
-- Preserves 100% backward compatibility with existing Storage, ServerInstance,
-- and Phase 19.3 Multi-Product Subscription architecture.
-- =============================================================================

-- 1. Create CameraInstance table
CREATE TABLE `CameraInstance` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NULL,
    `cameraName` VARCHAR(191) NULL,
    `status` ENUM('OFFLINE', 'CONNECTING', 'ONLINE', 'STREAMING', 'RECONNECTING', 'ERROR') NOT NULL DEFAULT 'OFFLINE',
    `resolution` VARCHAR(191) NULL DEFAULT '720p',
    `fps` INT NULL DEFAULT 20,
    `audioEnabled` BOOLEAN NOT NULL DEFAULT false,
    `lensFacing` VARCHAR(191) NULL DEFAULT 'BACK',
    `metadata` JSON NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `stoppedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `CameraInstance_userId_idx`(`userId`),
    INDEX `CameraInstance_deviceId_idx`(`deviceId`),
    INDEX `CameraInstance_status_idx`(`status`),
    INDEX `CameraInstance_lastSeenAt_idx`(`lastSeenAt`),
    INDEX `CameraInstance_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Create CameraEndpoint table
CREATE TABLE `CameraEndpoint` (
    `id` VARCHAR(191) NOT NULL,
    `cameraInstanceId` VARCHAR(191) NOT NULL,
    `signalingUrl` VARCHAR(191) NULL,
    `connectionToken` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `status` ENUM('INACTIVE', 'READY', 'CONNECTED', 'FAILED', 'REVOKED') NOT NULL DEFAULT 'INACTIVE',
    `lastHeartbeatAt` DATETIME(3) NULL,
    `connectedAt` DATETIME(3) NULL,
    `disconnectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `CameraEndpoint_cameraInstanceId_idx`(`cameraInstanceId`),
    INDEX `CameraEndpoint_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. Create CameraStreamSession table
CREATE TABLE `CameraStreamSession` (
    `id` VARCHAR(191) NOT NULL,
    `cameraInstanceId` VARCHAR(191) NOT NULL,
    `viewerUserId` VARCHAR(191) NOT NULL,
    `sessionTokenHash` VARCHAR(191) NULL,
    `status` ENUM('INITIATED', 'NEGOTIATING', 'ACTIVE', 'ENDED', 'FAILED', 'TIMED_OUT') NOT NULL DEFAULT 'INITIATED',
    `transportType` ENUM('P2P', 'TURN_RELAY', 'SFU') NOT NULL DEFAULT 'P2P',
    `protocol` VARCHAR(191) NOT NULL DEFAULT 'WEBRTC',
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `bytesTransferred` BIGINT NULL DEFAULT 0,
    `durationSeconds` INT NULL DEFAULT 0,
    `terminationReason` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `CameraStreamSession_cameraInstanceId_idx`(`cameraInstanceId`),
    INDEX `CameraStreamSession_viewerUserId_idx`(`viewerUserId`),
    INDEX `CameraStreamSession_status_idx`(`status`),
    INDEX `CameraStreamSession_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. Create CameraSubscription table
CREATE TABLE `CameraSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `cameraInstanceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accountProductSubscriptionId` VARCHAR(191) NULL,
    `subscriptionId` VARCHAR(191) NULL,
    `status` ENUM('FREE', 'CREATED', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'ACTIVE',
    `allocatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CameraSubscription_cameraInstanceId_key`(`cameraInstanceId`),
    INDEX `CameraSubscription_userId_idx`(`userId`),
    INDEX `CameraSubscription_cameraInstanceId_idx`(`cameraInstanceId`),
    INDEX `CameraSubscription_accountProductSubscriptionId_idx`(`accountProductSubscriptionId`),
    INDEX `CameraSubscription_subscriptionId_idx`(`subscriptionId`),
    INDEX `CameraSubscription_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. Create CameraAccessAuditEvent table
CREATE TABLE `CameraAccessAuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `cameraInstanceId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `actorType` VARCHAR(191) NOT NULL DEFAULT 'USER',
    `eventType` ENUM(
        'CAMERA_REGISTERED',
        'CAMERA_UNLINKED',
        'CAMERA_CONFIG_UPDATED',
        'CAMERA_STARTED',
        'CAMERA_STOPPED',
        'VIEWING_SESSION_REQUESTED',
        'VIEWING_SESSION_STARTED',
        'VIEWING_SESSION_ENDED',
        'VIEWING_ACCESS_DENIED',
        'TURN_CREDENTIALS_ISSUED',
        'SIGNALING_AUTHENTICATED',
        'SIGNALING_AUTH_FAILED'
    ) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `result` VARCHAR(191) NOT NULL DEFAULT 'SUCCESS',
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CameraAccessAuditEvent_cameraInstanceId_idx`(`cameraInstanceId`),
    INDEX `CameraAccessAuditEvent_userId_idx`(`userId`),
    INDEX `CameraAccessAuditEvent_eventType_idx`(`eventType`),
    INDEX `CameraAccessAuditEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 6. Create CameraUsageRecord table
CREATE TABLE `CameraUsageRecord` (
    `id` VARCHAR(191) NOT NULL,
    `cameraInstanceId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `category` ENUM(
        'STREAMING_SECONDS',
        'TURN_RELAY_BYTES',
        'STREAM_SESSION_COUNT',
        'ACTIVE_CAMERA_HOURS'
    ) NOT NULL,
    `quantity` BIGINT NOT NULL DEFAULT 0,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'SECONDS',
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `CameraUsageRecord_userId_idx`(`userId`),
    INDEX `CameraUsageRecord_cameraInstanceId_idx`(`cameraInstanceId`),
    INDEX `CameraUsageRecord_category_idx`(`category`),
    INDEX `CameraUsageRecord_periodStart_periodEnd_idx`(`periodStart`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 7. Add Foreign Key Constraints for CameraInstance
ALTER TABLE `CameraInstance`
    ADD CONSTRAINT `CameraInstance_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CameraInstance`
    ADD CONSTRAINT `CameraInstance_deviceId_fkey`
    FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. Add Foreign Key Constraints for CameraEndpoint
ALTER TABLE `CameraEndpoint`
    ADD CONSTRAINT `CameraEndpoint_cameraInstanceId_fkey`
    FOREIGN KEY (`cameraInstanceId`) REFERENCES `CameraInstance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. Add Foreign Key Constraints for CameraStreamSession
ALTER TABLE `CameraStreamSession`
    ADD CONSTRAINT `CameraStreamSession_cameraInstanceId_fkey`
    FOREIGN KEY (`cameraInstanceId`) REFERENCES `CameraInstance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CameraStreamSession`
    ADD CONSTRAINT `CameraStreamSession_viewerUserId_fkey`
    FOREIGN KEY (`viewerUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 10. Add Foreign Key Constraints for CameraSubscription
ALTER TABLE `CameraSubscription`
    ADD CONSTRAINT `CameraSubscription_cameraInstanceId_fkey`
    FOREIGN KEY (`cameraInstanceId`) REFERENCES `CameraInstance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CameraSubscription`
    ADD CONSTRAINT `CameraSubscription_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CameraSubscription`
    ADD CONSTRAINT `CameraSubscription_accountProductSubscriptionId_fkey`
    FOREIGN KEY (`accountProductSubscriptionId`) REFERENCES `AccountProductSubscription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CameraSubscription`
    ADD CONSTRAINT `CameraSubscription_subscriptionId_fkey`
    FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 11. Add Foreign Key Constraints for CameraAccessAuditEvent
ALTER TABLE `CameraAccessAuditEvent`
    ADD CONSTRAINT `CameraAccessAuditEvent_cameraInstanceId_fkey`
    FOREIGN KEY (`cameraInstanceId`) REFERENCES `CameraInstance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CameraAccessAuditEvent`
    ADD CONSTRAINT `CameraAccessAuditEvent_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 12. Add Foreign Key Constraints for CameraUsageRecord
ALTER TABLE `CameraUsageRecord`
    ADD CONSTRAINT `CameraUsageRecord_cameraInstanceId_fkey`
    FOREIGN KEY (`cameraInstanceId`) REFERENCES `CameraInstance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CameraUsageRecord`
    ADD CONSTRAINT `CameraUsageRecord_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
