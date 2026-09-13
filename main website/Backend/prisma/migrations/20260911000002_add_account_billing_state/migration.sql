-- CreateTable
CREATE TABLE `AccountBillingState` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` ENUM('FREE', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'FREE',
    `activeSubscriptionId` VARCHAR(191) NULL,
    `billingCountry` VARCHAR(191) NULL,
    `billingPostalCode` VARCHAR(191) NULL,
    `currency` ENUM('INR', 'USD') NOT NULL DEFAULT 'INR',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountBillingState_userId_key`(`userId`),
    UNIQUE INDEX `AccountBillingState_activeSubscriptionId_key`(`activeSubscriptionId`),
    INDEX `AccountBillingState_userId_idx`(`userId`),
    INDEX `AccountBillingState_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `planPriceId` VARCHAR(191) NOT NULL,
    `status` ENUM('FREE', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'ACTIVE',
    `billingInterval` ENUM('FREE', 'MONTHLY', 'YEARLY') NOT NULL DEFAULT 'MONTHLY',
    `currency` ENUM('INR', 'USD') NOT NULL DEFAULT 'INR',
    `amountMinorUnits` INTEGER NOT NULL,
    `priceVersion` INTEGER NOT NULL DEFAULT 1,
    `currentPeriodStart` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `currentPeriodEnd` DATETIME(3) NOT NULL,
    `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
    `cancelledAt` DATETIME(3) NULL,
    `gracePeriodStartedAt` DATETIME(3) NULL,
    `gracePeriodEndsAt` DATETIME(3) NULL,
    `expiredAt` DATETIME(3) NULL,
    `refundedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Subscription_userId_idx`(`userId`),
    INDEX `Subscription_planId_idx`(`planId`),
    INDEX `Subscription_planPriceId_idx`(`planPriceId`),
    INDEX `Subscription_status_idx`(`status`),
    INDEX `Subscription_currentPeriodEnd_idx`(`currentPeriodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `AuditEvent` MODIFY `eventType` ENUM(
    'ACCOUNT_CREATED',
    'EMAIL_VERIFIED',
    'LOGIN_ATTEMPT_SUCCESS',
    'LOGIN_ATTEMPT_FAILED',
    'PASSWORD_RESET_REQUESTED',
    'PASSWORD_RESET_SUCCESS',
    'OTP_SENT',
    'OTP_VERIFIED',
    'DEVICE_REGISTERED',
    'DEVICE_CONNECTED',
    'DEVICE_DISCONNECTED',
    'SERVER_CREATED',
    'SERVER_STARTED',
    'SERVER_STOPPED',
    'ENDPOINT_ASSIGNED',
    'REMOTE_CONNECTION_CREATED',
    'REMOTE_CONNECTION_CONNECTED',
    'REMOTE_CONNECTION_DISCONNECTED',
    'REMOTE_CONNECTION_FAILED',
    'SERVER_ENDPOINT_ALLOCATED',
    'FILE_MANAGER_LOGIN_SUCCESS',
    'FILE_MANAGER_LOGIN_FAILED',
    'PUSH_TOKEN_REGISTERED',
    'PUSH_TOKEN_UPDATED',
    'PUSH_TOKEN_REVOKED',
    'NOTIFICATION_CREATED',
    'NOTIFICATION_DELIVERY_FAILED',
    'SUBSCRIPTION_CREATED',
    'SUBSCRIPTION_ACTIVATED',
    'SUBSCRIPTION_PAST_DUE',
    'SUBSCRIPTION_GRACE_PERIOD_STARTED',
    'SUBSCRIPTION_GRACE_PERIOD_RECOVERED',
    'SUBSCRIPTION_CANCELLATION_REQUESTED',
    'SUBSCRIPTION_EXPIRED',
    'SUBSCRIPTION_REFUNDED',
    'BILLING_STATE_UPDATED'
) NOT NULL;

-- AddForeignKey
ALTER TABLE `AccountBillingState` ADD CONSTRAINT `AccountBillingState_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountBillingState` ADD CONSTRAINT `AccountBillingState_activeSubscriptionId_fkey` FOREIGN KEY (`activeSubscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planPriceId_fkey` FOREIGN KEY (`planPriceId`) REFERENCES `PlanPrice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
