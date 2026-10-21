-- =============================================================================
-- PHASE 9.2: CUSTOMER ACTIVITY EVENT LOG (Customer-Visible Activity Feed)
-- Migration: 20261011104000_add_customer_activity_event
-- NOTE: Unapplied migration authored in repository. Apply via `npx prisma migrate deploy`
-- followed by `npx prisma generate` prior to runtime activation.
-- =============================================================================

CREATE TABLE `CustomerActivityEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(100) NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `severity` VARCHAR(20) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `deviceId` VARCHAR(191) NULL,
    `serverId` VARCHAR(191) NULL,
    `invoiceId` VARCHAR(191) NULL,
    `subscriptionId` VARCHAR(191) NULL,
    `paymentId` VARCHAR(191) NULL,
    `receiptId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customer_activity_idempotency_key_uniq`(`idempotencyKey`),
    INDEX `customer_activity_user_time_idx`(`userId`, `occurredAt` DESC),
    INDEX `customer_activity_user_cat_time_idx`(`userId`, `category`, `occurredAt` DESC),
    INDEX `customer_activity_user_type_time_idx`(`userId`, `eventType`, `occurredAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign Key Constraints
ALTER TABLE `CustomerActivityEvent`
    ADD CONSTRAINT `CustomerActivityEvent_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
