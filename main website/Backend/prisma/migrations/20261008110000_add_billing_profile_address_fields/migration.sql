-- AlterTable
ALTER TABLE `AccountBillingState` 
  ADD COLUMN `billingName` VARCHAR(191) NULL,
  ADD COLUMN `billingAddress1` VARCHAR(191) NULL,
  ADD COLUMN `billingAddress2` VARCHAR(191) NULL,
  ADD COLUMN `billingCity` VARCHAR(191) NULL,
  ADD COLUMN `billingState` VARCHAR(191) NULL;
