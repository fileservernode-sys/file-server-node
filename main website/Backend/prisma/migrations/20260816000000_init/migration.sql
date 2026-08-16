-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `status` ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'PENDING_VERIFICATION',
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailOtp` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `otpCode` VARCHAR(191) NOT NULL,
    `purpose` ENUM('REGISTRATION_VERIFICATION', 'LOGIN_2FA', 'PASSWORD_RESET') NOT NULL DEFAULT 'REGISTRATION_VERIFICATION',
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailOtp_email_idx`(`email`),
    INDEX `EmailOtp_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSession` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserSession_token_key`(`token`),
    INDEX `UserSession_userId_idx`(`userId`),
    INDEX `UserSession_token_idx`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Device` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deviceName` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL DEFAULT 'Android',
    `osVersion` VARCHAR(191) NULL,
    `appVersion` VARCHAR(191) NULL,
    `status` ENUM('ONLINE', 'OFFLINE', 'CONNECTING', 'RECONNECTING') NOT NULL DEFAULT 'OFFLINE',
    `lastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Device_userId_idx`(`userId`),
    INDEX `Device_status_idx`(`status`),
    INDEX `Device_lastSeenAt_idx`(`lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServerInstance` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `status` ENUM('STOPPED', 'STARTING', 'RUNNING', 'ERROR') NOT NULL DEFAULT 'STOPPED',
    `startedAt` DATETIME(3) NULL,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServerInstance_deviceId_idx`(`deviceId`),
    INDEX `ServerInstance_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServerEndpoint` (
    `id` VARCHAR(191) NOT NULL,
    `serverInstanceId` VARCHAR(191) NOT NULL,
    `hostname` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ServerEndpoint_hostname_key`(`hostname`),
    INDEX `ServerEndpoint_hostname_idx`(`hostname`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GatewayNode` (
    `id` VARCHAR(191) NOT NULL,
    `hostname` VARCHAR(191) NOT NULL,
    `region` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'MAINTENANCE') NOT NULL DEFAULT 'ACTIVE',
    `lastHeartbeatAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GatewayNode_hostname_key`(`hostname`),
    INDEX `GatewayNode_hostname_idx`(`hostname`),
    INDEX `GatewayNode_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceConnection` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `gatewayNodeId` VARCHAR(191) NULL,
    `connectionToken` VARCHAR(191) NULL,
    `remoteEndpoint` VARCHAR(191) NULL,
    `status` ENUM('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'FAILED') NOT NULL DEFAULT 'DISCONNECTED',
    `connectedAt` DATETIME(3) NULL,
    `disconnectedAt` DATETIME(3) NULL,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DeviceConnection_deviceId_idx`(`deviceId`),
    INDEX `DeviceConnection_gatewayNodeId_idx`(`gatewayNodeId`),
    INDEX `DeviceConnection_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `eventType` ENUM('ACCOUNT_CREATED', 'EMAIL_VERIFIED', 'LOGIN_ATTEMPT_SUCCESS', 'LOGIN_ATTEMPT_FAILED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_SUCCESS', 'OTP_SENT', 'OTP_VERIFIED', 'DEVICE_REGISTERED', 'DEVICE_CONNECTED', 'DEVICE_DISCONNECTED', 'SERVER_STARTED', 'SERVER_STOPPED', 'ENDPOINT_ASSIGNED', 'REMOTE_CONNECTION_CREATED', 'REMOTE_CONNECTION_CONNECTED', 'REMOTE_CONNECTION_DISCONNECTED', 'REMOTE_CONNECTION_FAILED', 'SERVER_ENDPOINT_ALLOCATED') NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditEvent_userId_idx`(`userId`),
    INDEX `AuditEvent_deviceId_idx`(`deviceId`),
    INDEX `AuditEvent_eventType_idx`(`eventType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmailOtp` ADD CONSTRAINT `EmailOtp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSession` ADD CONSTRAINT `UserSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Device` ADD CONSTRAINT `Device_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServerInstance` ADD CONSTRAINT `ServerInstance_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServerEndpoint` ADD CONSTRAINT `ServerEndpoint_serverInstanceId_fkey` FOREIGN KEY (`serverInstanceId`) REFERENCES `ServerInstance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceConnection` ADD CONSTRAINT `DeviceConnection_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceConnection` ADD CONSTRAINT `DeviceConnection_gatewayNodeId_fkey` FOREIGN KEY (`gatewayNodeId`) REFERENCES `GatewayNode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
