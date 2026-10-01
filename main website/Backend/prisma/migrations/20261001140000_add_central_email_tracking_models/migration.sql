-- CreateTable EmailMessage
CREATE TABLE IF NOT EXISTS `EmailMessage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `notificationRecordId` VARCHAR(191) NULL,
    `channelDeliveryRecordId` VARCHAR(191) NULL,
    `emailType` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `recipientEmail` VARCHAR(191) NOT NULL,
    `recipientName` VARCHAR(191) NULL,
    `senderEmail` VARCHAR(191) NOT NULL,
    `senderName` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NOT NULL,
    `sourcePipeline` ENUM('OTP', 'NOTIFICATION', 'SYSTEM', 'TRANSACTIONAL') NOT NULL DEFAULT 'OTP',
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'RETRYING', 'FAILED', 'PERMANENTLY_FAILED', 'BOUNCED', 'BLOCKED', 'SPAM', 'DEFERRED') NOT NULL DEFAULT 'SENT',
    `provider` VARCHAR(191) NOT NULL DEFAULT 'BREVO',
    `transport` ENUM('BREVO_API', 'SMTP_RELAY', 'MOCK') NOT NULL DEFAULT 'BREVO_API',
    `providerMessageId` VARCHAR(191) NULL,
    `providerResponseCode` VARCHAR(191) NULL,
    `providerResponse` JSON NULL,
    `failureCode` VARCHAR(191) NULL,
    `failureReason` TEXT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 1,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `queuedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `lastAttemptAt` DATETIME(3) NULL,
    `nextRetryAt` DATETIME(3) NULL,
    `requestId` VARCHAR(191) NULL,
    `correlationId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `serverId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmailMessage_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `EmailMessage_recipientEmail_createdAt_idx`(`recipientEmail`, `createdAt`),
    INDEX `EmailMessage_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `EmailMessage_emailType_createdAt_idx`(`emailType`, `createdAt`),
    INDEX `EmailMessage_providerMessageId_idx`(`providerMessageId`),
    INDEX `EmailMessage_notificationRecordId_idx`(`notificationRecordId`),
    INDEX `EmailMessage_channelDeliveryRecordId_idx`(`channelDeliveryRecordId`),
    INDEX `EmailMessage_requestId_idx`(`requestId`),
    INDEX `EmailMessage_correlationId_idx`(`correlationId`),
    INDEX `EmailMessage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable EmailDeliveryAttempt
CREATE TABLE IF NOT EXISTS `EmailDeliveryAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `emailMessageId` VARCHAR(191) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `transport` ENUM('BREVO_API', 'SMTP_RELAY', 'MOCK') NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'RETRYING', 'FAILED', 'PERMANENTLY_FAILED', 'BOUNCED', 'BLOCKED', 'SPAM', 'DEFERRED') NOT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `providerResponseCode` VARCHAR(191) NULL,
    `providerResponse` JSON NULL,
    `failureReason` TEXT NULL,
    `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `durationMs` INTEGER NULL,

    INDEX `EmailDeliveryAttempt_emailMessageId_attemptNumber_idx`(`emailMessageId`, `attemptNumber`),
    INDEX `EmailDeliveryAttempt_status_idx`(`status`),
    INDEX `EmailDeliveryAttempt_providerMessageId_idx`(`providerMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey EmailMessage -> User
ALTER TABLE `EmailMessage` ADD CONSTRAINT `EmailMessage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey EmailMessage -> NotificationRecord
ALTER TABLE `EmailMessage` ADD CONSTRAINT `EmailMessage_notificationRecordId_fkey` FOREIGN KEY (`notificationRecordId`) REFERENCES `NotificationRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey EmailMessage -> ChannelDeliveryRecord
ALTER TABLE `EmailMessage` ADD CONSTRAINT `EmailMessage_channelDeliveryRecordId_fkey` FOREIGN KEY (`channelDeliveryRecordId`) REFERENCES `ChannelDeliveryRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey EmailDeliveryAttempt -> EmailMessage
ALTER TABLE `EmailDeliveryAttempt` ADD CONSTRAINT `EmailDeliveryAttempt_emailMessageId_fkey` FOREIGN KEY (`emailMessageId`) REFERENCES `EmailMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
