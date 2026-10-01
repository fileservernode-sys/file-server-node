-- Step 1: Securely migrate any existing plaintext session tokens to SHA-256 hashes
UPDATE `UserSession` SET `token` = SHA2(`token`, 256) WHERE `token` IS NOT NULL;

-- Step 2: Rename token column to tokenHash with updated unique index
ALTER TABLE `UserSession` DROP INDEX `UserSession_token_key`;
ALTER TABLE `UserSession` DROP INDEX `UserSession_token_idx`;
ALTER TABLE `UserSession` CHANGE COLUMN `token` `tokenHash` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `UserSession_tokenHash_key` ON `UserSession`(`tokenHash`);
CREATE INDEX `UserSession_tokenHash_idx` ON `UserSession`(`tokenHash`);
