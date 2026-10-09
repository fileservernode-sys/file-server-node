-- Migration: 20261009230000_add_billing_profile_company_and_tax_id
-- Scope: ZDEXCLOUD Phase 6.4 - Optional Company Name and Tax Registration Identifier
-- STATUS: AUTHORED ONLY (UNAPPLIED per Phase 6.4 testing and change control rules)

-- AlterTable
ALTER TABLE `AccountBillingState` 
  ADD COLUMN `companyName` VARCHAR(191) NULL,
  ADD COLUMN `taxId` VARCHAR(191) NULL;
