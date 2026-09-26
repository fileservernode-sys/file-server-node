-- AlterTable admin_audit_logs
ALTER TABLE `admin_audit_logs` MODIFY `action` ENUM('ADMIN_LOGIN_SUCCESS', 'ADMIN_LOGIN_FAILURE', 'ADMIN_LOGOUT', 'ADMIN_SESSION_REVOKED', 'ADMIN_SESSION_EXPIRED', 'ADMIN_AUTH_BLOCKED', 'ADMIN_OTP_SENT', 'ADMIN_OTP_VERIFIED', 'ADMIN_OTP_FAILED', 'ADMIN_ROLE_CREATED', 'ADMIN_ROLE_UPDATED', 'ADMIN_ROLE_ASSIGNED', 'ADMIN_ROLE_REMOVED', 'ADMIN_PERMISSION_ASSIGNED', 'ADMIN_PERMISSION_REMOVED', 'ADMIN_AUTHZ_DENIED') NOT NULL;

-- CreateTable admin_roles
CREATE TABLE IF NOT EXISTS `admin_roles` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NULL,
  `isSystemRole` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `admin_roles_slug_key`(`slug`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable admin_permissions
CREATE TABLE IF NOT EXISTS `admin_permissions` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NULL,
  `resource` VARCHAR(191) NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `admin_permissions_slug_key`(`slug`),
  INDEX `admin_permissions_resource_action_idx`(`resource`, `action`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable admin_user_roles
CREATE TABLE IF NOT EXISTS `admin_user_roles` (
  `id` VARCHAR(191) NOT NULL,
  `adminId` VARCHAR(191) NOT NULL,
  `roleId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `admin_user_roles_adminId_roleId_key`(`adminId`, `roleId`),
  INDEX `admin_user_roles_adminId_idx`(`adminId`),
  INDEX `admin_user_roles_roleId_idx`(`roleId`),
  CONSTRAINT `admin_user_roles_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `admin_user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `admin_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable admin_role_permissions
CREATE TABLE IF NOT EXISTS `admin_role_permissions` (
  `id` VARCHAR(191) NOT NULL,
  `roleId` VARCHAR(191) NOT NULL,
  `permissionId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `admin_role_permissions_roleId_permissionId_key`(`roleId`, `permissionId`),
  INDEX `admin_role_permissions_roleId_idx`(`roleId`),
  INDEX `admin_role_permissions_permissionId_idx`(`permissionId`),
  CONSTRAINT `admin_role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `admin_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `admin_role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `admin_permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
