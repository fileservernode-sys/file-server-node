-- CreateTable admin_users
CREATE TABLE IF NOT EXISTS `admin_users` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `passwordHash` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `isSuperAdmin` BOOLEAN NOT NULL DEFAULT false,
  `lastLoginAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `admin_users_email_key`(`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable admin_sessions
CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `adminId` VARCHAR(191) NOT NULL,
  `sessionTokenHash` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ipAddress` VARCHAR(191) NULL,
  `userAgent` VARCHAR(512) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `admin_sessions_sessionTokenHash_key`(`sessionTokenHash`),
  INDEX `admin_sessions_adminId_idx`(`adminId`),
  INDEX `admin_sessions_sessionTokenHash_idx`(`sessionTokenHash`),
  INDEX `admin_sessions_expiresAt_idx`(`expiresAt`),
  INDEX `admin_sessions_revokedAt_idx`(`revokedAt`),
  CONSTRAINT `admin_sessions_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable admin_email_otps
CREATE TABLE IF NOT EXISTS `admin_email_otps` (
  `id` VARCHAR(191) NOT NULL,
  `adminId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `otpHash` VARCHAR(191) NOT NULL,
  `purpose` ENUM('ADMIN_LOGIN_2FA') NOT NULL DEFAULT 'ADMIN_LOGIN_2FA',
  `expiresAt` DATETIME(3) NOT NULL,
  `isUsed` BOOLEAN NOT NULL DEFAULT false,
  `attempts` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `admin_email_otps_adminId_idx`(`adminId`),
  INDEX `admin_email_otps_email_purpose_idx`(`email`, `purpose`),
  INDEX `admin_email_otps_expiresAt_idx`(`expiresAt`),
  CONSTRAINT `admin_email_otps_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable admin_audit_logs
CREATE TABLE IF NOT EXISTS `admin_audit_logs` (
  `id` VARCHAR(191) NOT NULL,
  `adminId` VARCHAR(191) NULL,
  `action` ENUM('ADMIN_LOGIN_SUCCESS', 'ADMIN_LOGIN_FAILURE', 'ADMIN_LOGOUT', 'ADMIN_SESSION_REVOKED', 'ADMIN_SESSION_EXPIRED', 'ADMIN_AUTH_BLOCKED', 'ADMIN_OTP_SENT', 'ADMIN_OTP_VERIFIED', 'ADMIN_OTP_FAILED') NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'SUCCESS',
  `ipAddress` VARCHAR(191) NULL,
  `userAgent` VARCHAR(512) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `admin_audit_logs_adminId_idx`(`adminId`),
  INDEX `admin_audit_logs_action_idx`(`action`),
  INDEX `admin_audit_logs_createdAt_idx`(`createdAt`),
  CONSTRAINT `admin_audit_logs_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
