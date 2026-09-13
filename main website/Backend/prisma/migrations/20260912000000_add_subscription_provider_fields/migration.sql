-- AlterTable
ALTER TABLE `Subscription` 
    MODIFY COLUMN `status` ENUM('FREE', 'CREATED', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `provider` ENUM('RAZORPAY') NOT NULL DEFAULT 'RAZORPAY',
    ADD COLUMN `providerEnvironment` ENUM('TEST', 'LIVE') NOT NULL DEFAULT 'TEST',
    ADD COLUMN `providerSubscriptionId` VARCHAR(191) NULL,
    ADD COLUMN `providerPlanId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `AccountBillingState` 
    MODIFY COLUMN `status` ENUM('FREE', 'CREATED', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'FREE';

-- CreateIndex
CREATE UNIQUE INDEX `Subscription_providerSubscriptionId_key` ON `Subscription`(`providerSubscriptionId`);
