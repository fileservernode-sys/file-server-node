-- AlterTable: Add installationId to Device
ALTER TABLE `Device` ADD COLUMN `installationId` VARCHAR(191) NULL;

-- Backfill existing Device records with unique installation IDs
UPDATE `Device` SET `installationId` = CONCAT('inst-migrated-', `id`) WHERE `installationId` IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Device_userId_installationId_key` ON `Device`(`userId`, `installationId`);

-- CreateIndex
CREATE INDEX `Device_installationId_idx` ON `Device`(`installationId`);
