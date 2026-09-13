-- CreateTable
CREATE TABLE `BillingProviderPlanMapping` (
    `id` VARCHAR(191) NOT NULL,
    `provider` ENUM('RAZORPAY') NOT NULL DEFAULT 'RAZORPAY',
    `environment` ENUM('TEST', 'LIVE') NOT NULL DEFAULT 'TEST',
    `planId` VARCHAR(191) NOT NULL,
    `planPriceId` VARCHAR(191) NOT NULL,
    `providerPlanId` VARCHAR(191) NOT NULL,
    `currency` ENUM('INR', 'USD') NOT NULL,
    `amountMinorUnits` INTEGER NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `interval` INTEGER NOT NULL DEFAULT 1,
    `priceVersion` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `provider_plan_map_plan_idx`(`planId`),
    INDEX `provider_plan_map_price_idx`(`planPriceId`),
    INDEX `provider_env_active_idx`(`provider`, `environment`, `isActive`),
    UNIQUE INDEX `provider_env_price_uniq`(`provider`, `environment`, `planPriceId`),
    UNIQUE INDEX `provider_env_provider_plan_uniq`(`provider`, `environment`, `providerPlanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BillingProviderPlanMapping` ADD CONSTRAINT `BillingProviderPlanMapping_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillingProviderPlanMapping` ADD CONSTRAINT `BillingProviderPlanMapping_planPriceId_fkey` FOREIGN KEY (`planPriceId`) REFERENCES `PlanPrice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
