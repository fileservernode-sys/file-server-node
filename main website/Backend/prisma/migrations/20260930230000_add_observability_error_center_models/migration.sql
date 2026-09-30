-- CreateTable error_fingerprints
CREATE TABLE IF NOT EXISTS `error_fingerprints` (
    `id` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorType` VARCHAR(191) NULL,
    `component` VARCHAR(191) NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL') NOT NULL DEFAULT 'ERROR',
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `totalOccurrences` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'MUTED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `error_fingerprint_hash_uniq`(`fingerprint`),
    INDEX `error_fingerprint_status_idx`(`status`),
    INDEX `error_fingerprint_severity_idx`(`severity`),
    INDEX `error_fingerprint_component_idx`(`component`),
    INDEX `error_fingerprint_last_seen_idx`(`lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable error_incidents
CREATE TABLE IF NOT EXISTS `error_incidents` (
    `id` VARCHAR(191) NOT NULL,
    `fingerprintId` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'MUTED') NOT NULL DEFAULT 'OPEN',
    `severity` ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL') NOT NULL DEFAULT 'ERROR',
    `title` VARCHAR(191) NULL,
    `summary` TEXT NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedBy` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedBy` VARCHAR(191) NULL,
    `resolutionNotes` TEXT NULL,
    `mutedAt` DATETIME(3) NULL,
    `mutedUntil` DATETIME(3) NULL,
    `mutedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `error_incident_fingerprint_idx`(`fingerprintId`),
    INDEX `error_incident_status_idx`(`status`),
    INDEX `error_incident_severity_idx`(`severity`),
    INDEX `error_incident_updated_idx`(`updatedAt`),
    INDEX `error_incident_created_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable error_occurrences
CREATE TABLE IF NOT EXISTS `error_occurrences` (
    `id` VARCHAR(191) NOT NULL,
    `fingerprintId` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `component` VARCHAR(191) NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL') NOT NULL DEFAULT 'ERROR',
    `errorCode` VARCHAR(191) NULL,
    `errorType` VARCHAR(191) NULL,
    `message` TEXT NOT NULL,
    `stackTrace` TEXT NULL,
    `httpMethod` VARCHAR(191) NULL,
    `httpPath` VARCHAR(191) NULL,
    `httpStatus` INTEGER NULL,
    `requestId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `serverInstanceId` VARCHAR(191) NULL,
    `gatewayNodeId` VARCHAR(191) NULL,
    `connectionId` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `error_occurrence_fingerprint_idx`(`fingerprintId`),
    INDEX `error_occurrence_incident_idx`(`incidentId`),
    INDEX `error_occurrence_occurred_idx`(`occurredAt`),
    INDEX `error_occurrence_component_idx`(`component`),
    INDEX `error_occurrence_severity_idx`(`severity`),
    INDEX `error_occurrence_code_idx`(`errorCode`),
    INDEX `error_occurrence_request_id_idx`(`requestId`),
    INDEX `error_occurrence_user_idx`(`userId`),
    INDEX `error_occurrence_device_idx`(`deviceId`),
    INDEX `error_occurrence_server_idx`(`serverInstanceId`),
    INDEX `error_occurrence_gateway_idx`(`gatewayNodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey error_incidents -> error_fingerprints
ALTER TABLE `error_incidents` ADD CONSTRAINT `error_incidents_fingerprintId_fkey` FOREIGN KEY (`fingerprintId`) REFERENCES `error_fingerprints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey error_occurrences -> error_fingerprints
ALTER TABLE `error_occurrences` ADD CONSTRAINT `error_occurrences_fingerprintId_fkey` FOREIGN KEY (`fingerprintId`) REFERENCES `error_fingerprints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey error_occurrences -> error_incidents
ALTER TABLE `error_occurrences` ADD CONSTRAINT `error_occurrences_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `error_incidents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey error_occurrences -> User
ALTER TABLE `error_occurrences` ADD CONSTRAINT `error_occurrences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey error_occurrences -> Device
ALTER TABLE `error_occurrences` ADD CONSTRAINT `error_occurrences_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey error_occurrences -> ServerInstance
ALTER TABLE `error_occurrences` ADD CONSTRAINT `error_occurrences_serverInstanceId_fkey` FOREIGN KEY (`serverInstanceId`) REFERENCES `ServerInstance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey error_occurrences -> GatewayNode
ALTER TABLE `error_occurrences` ADD CONSTRAINT `error_occurrences_gatewayNodeId_fkey` FOREIGN KEY (`gatewayNodeId`) REFERENCES `GatewayNode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
