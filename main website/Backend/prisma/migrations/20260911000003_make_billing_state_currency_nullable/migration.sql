-- AlterTable
ALTER TABLE `AccountBillingState` MODIFY `currency` ENUM('INR', 'USD') NULL;

-- Normalize unconfirmed and confirmed rows
UPDATE `AccountBillingState` SET `currency` = NULL WHERE `billingCountry` IS NULL;
UPDATE `AccountBillingState` SET `currency` = 'INR' WHERE `billingCountry` = 'IN';
UPDATE `AccountBillingState` SET `currency` = 'USD' WHERE `billingCountry` IS NOT NULL AND `billingCountry` != 'IN';
