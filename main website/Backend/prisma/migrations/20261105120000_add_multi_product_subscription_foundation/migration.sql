-- =============================================================================
-- PHASE 19.3 - BATCH 1: MULTI-PRODUCT SUBSCRIPTION DATABASE FOUNDATION
-- Migration: 20261105120000_add_multi_product_subscription_foundation
-- Objective: Add product classification to Plan and introduce AccountProductSubscription
-- to support independent concurrent product subscriptions (Storage, Camera, Unified Pro)
-- while preserving complete backward compatibility with legacy AccountBillingState.
-- =============================================================================

-- 1. Add productType classification to Plan table with STORAGE as backward-compatible default
ALTER TABLE `Plan` 
    ADD COLUMN `productType` ENUM('STORAGE', 'CAMERA', 'UNIFIED_PRO') NOT NULL DEFAULT 'STORAGE';

-- 2. Add index on Plan(productType) for product-scoped plan lookups
CREATE INDEX `Plan_productType_idx` ON `Plan`(`productType`);

-- 3. Create AccountProductSubscription table
CREATE TABLE `AccountProductSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `productType` ENUM('STORAGE', 'CAMERA', 'UNIFIED_PRO') NOT NULL,
    `subscriptionId` VARCHAR(191) NOT NULL,
    `status` ENUM('FREE', 'CREATED', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLING', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `account_product_sub_subscription_uniq`(`subscriptionId`),
    UNIQUE INDEX `account_product_sub_user_product_uniq`(`userId`, `productType`),
    INDEX `account_product_sub_user_idx`(`userId`),
    INDEX `account_product_sub_product_status_idx`(`productType`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. Add foreign key constraints
ALTER TABLE `AccountProductSubscription` 
    ADD CONSTRAINT `AccountProductSubscription_userId_fkey` 
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AccountProductSubscription` 
    ADD CONSTRAINT `AccountProductSubscription_subscriptionId_fkey` 
    FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Safe backward-compatibility backfill:
-- For any account currently possessing an active subscription in AccountBillingState,
-- insert a corresponding STORAGE slot in AccountProductSubscription if not already present.
INSERT IGNORE INTO `AccountProductSubscription` (`id`, `userId`, `productType`, `subscriptionId`, `status`, `createdAt`, `updatedAt`)
SELECT 
    CONCAT('aps_', SUBSTRING(MD5(CONCAT(abs.`userId`, abs.`activeSubscriptionId`)), 1, 24)),
    abs.`userId`,
    'STORAGE',
    abs.`activeSubscriptionId`,
    s.`status`,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `AccountBillingState` abs
INNER JOIN `Subscription` s ON s.`id` = abs.`activeSubscriptionId`
WHERE abs.`activeSubscriptionId` IS NOT NULL;
