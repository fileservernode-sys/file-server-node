-- CreateTable
CREATE TABLE `BillingWebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `provider` ENUM('RAZORPAY') NOT NULL DEFAULT 'RAZORPAY',
    `environment` ENUM('TEST', 'LIVE') NOT NULL DEFAULT 'TEST',
    `providerEventId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `status` ENUM('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `failureReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `provider_env_event_uniq`(`provider`, `environment`, `providerEventId`),
    INDEX `provider_env_status_idx`(`provider`, `environment`, `status`),
    INDEX `provider_event_type_idx`(`eventType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
