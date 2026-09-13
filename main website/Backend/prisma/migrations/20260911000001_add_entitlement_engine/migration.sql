-- CreateTable
CREATE TABLE `EntitlementDefinition` (
    `id` VARCHAR(191) NOT NULL,
    `code` ENUM('MAX_SERVERS', 'PRIORITY_RELAY') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `valueType` ENUM('INTEGER', 'BOOLEAN') NOT NULL DEFAULT 'INTEGER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EntitlementDefinition_code_key`(`code`),
    INDEX `EntitlementDefinition_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanEntitlement` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `entitlementDefinitionId` VARCHAR(191) NOT NULL,
    `intValue` INTEGER NULL,
    `boolValue` BOOLEAN NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlanEntitlement_planId_idx`(`planId`),
    INDEX `PlanEntitlement_entitlementDefinitionId_idx`(`entitlementDefinitionId`),
    UNIQUE INDEX `PlanEntitlement_planId_entitlementDefinitionId_key`(`planId`, `entitlementDefinitionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlanEntitlement` ADD CONSTRAINT `PlanEntitlement_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanEntitlement` ADD CONSTRAINT `PlanEntitlement_entitlementDefinitionId_fkey` FOREIGN KEY (`entitlementDefinitionId`) REFERENCES `EntitlementDefinition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
