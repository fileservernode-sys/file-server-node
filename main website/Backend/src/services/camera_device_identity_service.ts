import crypto from 'node:crypto';
import {
  Device,
  CameraInstance,
  User,
  UserStatus,
  CameraAuditEventType
} from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnauthorizedError
} from '../errors/app-error.js';
import { hashSessionToken, generateSessionToken, verifyPassword } from '../utils/crypto.js';
import { issueDeviceReEnrollmentOtp, verifyDeviceReEnrollmentOtp } from '../utils/otp.js';
import { CameraService } from './camera_service.js';
import { sanitizeLogString, sanitizeLogMetadata, auditLogger } from '../observability/logger.js';
import { CustomerActivityService } from './activity/customer_activity_service.js';

function maskEmailAddress(email?: string | null): string {
  const trimmed = (email || '').trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 1) return '***' + (atIndex >= 0 ? trimmed.slice(atIndex) : '');
  return trimmed[0] + '***' + trimmed.slice(atIndex - 1);
}

export interface RegisterCameraDeviceInput {
  userId: string;
  installationId: string;
  deviceName: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  cameraId?: string;
  context?: { ip?: string; userAgent?: string };
}

export interface RequestReEnrollChallengeInput {
  userId: string;
  installationId: string;
  password?: string;
  context?: { ip?: string; userAgent?: string };
}

export interface ReEnrollChallengeResult {
  recoveryToken: string;
  expiresIn: number;
  expiresAt: string;
  installationId: string;
  requiresOtp: boolean;
  emailMasked?: string;
}

export interface ReEnrollDeviceInput {
  userId: string;
  installationId: string;
  recoveryToken: string;
  otp: string; // Mandatory 6-digit numeric email OTP
  deviceName?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  context?: { ip?: string; userAgent?: string };
}

export interface AssociateCameraDeviceInput {
  userId: string;
  cameraId: string;
  deviceId?: string;
  installationId?: string;
  context?: { ip?: string; userAgent?: string };
}

export interface PairingChallengeResult {
  pairingChallengeToken: string;
  expiresIn: number;
  expiresAt: string;
  cameraId: string;
}

export interface ConsumePairingChallengeInput {
  rawChallengeToken: string;
  installationId: string;
  deviceName: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  context?: { ip?: string; userAgent?: string };
}

/**
 * CameraDeviceIdentityService
 *
 * Centralized service for trusted device identity, account ownership,
 * duplicate registration prevention, cross-account claim defense,
 * and Camera-to-Device association enforcement.
 *
 * Architecture Principles (Phase 20.3):
 * 1. Camera devices work independently of Storage: does not require ServerInstance or Storage quotas.
 * 2. Cross-account installation claim prevention: an installationId cannot be hijacked by another account.
 * 3. Idempotent registration: same account + same installationId reuses and updates the existing Device.
 * 4. Multi-device support: separate phones have separate installationIds and separate Device records.
 * 5. Transaction-safe association: Camera and Device must belong to the same verified user.
 * 6. Revocation defense: revoked devices cannot register or control Camera resources.
 * 7. Privacy: raw tokens, credentials, and passwords are never persisted in logs or database fields.
 */
export class CameraDeviceIdentityService {

  /**
   * Validates the structure and length of an Android installation ID.
   * Expects format conforming to UUID, inst-<uuid>, or high-entropy alphanumeric string (8-128 chars).
   */
  public static validateInstallationId(installationId?: string | null): string {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('Installation ID is required and must be a non-empty string');
    }

    const trimmed = installationId.trim();
    if (trimmed.length < 8 || trimmed.length > 128) {
      throw new ValidationError('Installation ID must be between 8 and 128 characters');
    }

    // Must be valid URL/JSON-safe identifier characters (alphanumeric, hyphens, underscores)
    const validPattern = /^[A-Za-z0-9_-]+$/;
    if (!validPattern.test(trimmed)) {
      throw new ValidationError('Installation ID contains invalid characters');
    }

    return trimmed;
  }

  /**
   * Asserts that the authenticated user account meets verification requirements.
   * Rejects unverified or inactive accounts.
   */
  public static assertVerifiedUser(user: { id: string; status: UserStatus; emailVerified?: boolean }): void {
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenError(
        'Account is suspended, pending, or deactivated. Active account required to register devices.',
        'ACCOUNT_INACTIVE'
      );
    }

    if (user.emailVerified === false) {
      throw new ForbiddenError(
        'Email verification is required before registering Camera devices.',
        'EMAIL_VERIFICATION_REQUIRED'
      );
    }
  }

  /**
   * Cross-Account Installation Claim Defense:
   * Asserts that an installationId is NOT already claimed or registered under a different user account.
   * Checks authoritative DeviceInstallationClaim table as well as legacy Device records.
   * Throws ForbiddenError and logs a critical security audit event if another user claims it.
   */
  public static async assertInstallationUnclaimedByOtherUser(
    installationId: string,
    currentUserId: string,
    context?: { ip?: string; userAgent?: string }
  ): Promise<void> {
    const validInstallationId = this.validateInstallationId(installationId);

    // 1. Check authoritative global DeviceInstallationClaim table
    const existingClaim = await prisma.deviceInstallationClaim.findUnique({
      where: { installationId: validInstallationId },
      select: { id: true, userId: true, status: true, deviceId: true }
    });

    if (existingClaim && existingClaim.userId !== currentUserId) {
      await CameraService.recordAuditEvent({
        userId: currentUserId,
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'CROSS_ACCOUNT_DEVICE_CLAIM_REJECTED',
        result: 'DENIED',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: {
          attemptedInstallationId: validInstallationId.substring(0, 8) + '...',
          reason: 'installation_already_claimed_by_other_user'
        }
      });

      auditLogger.log({
        level: 'warn',
        event: 'CROSS_ACCOUNT_DEVICE_CLAIM_DETECTED',
        userId: currentUserId,
        currentUserId,
        existingClaimId: existingClaim.id,
        existingOwnerUserId: existingClaim.userId
      });

      throw new ForbiddenError(
        'This device installation is already registered to another ZdexCloud account. Please sign out from the existing account or reset app data.',
        'DEVICE_ALREADY_REGISTERED_OTHER_ACCOUNT'
      );
    }

    // 2. Defense-in-depth: check legacy Device rows
    const existingUnderOtherUser = await prisma.device.findFirst({
      where: {
        installationId: validInstallationId,
        userId: { not: currentUserId }
      },
      select: { id: true, userId: true, deviceName: true }
    });

    if (existingUnderOtherUser) {
      await CameraService.recordAuditEvent({
        userId: currentUserId,
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'CROSS_ACCOUNT_DEVICE_CLAIM_REJECTED',
        result: 'DENIED',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: {
          attemptedInstallationId: validInstallationId.substring(0, 8) + '...',
          reason: 'device_already_registered_to_different_user'
        }
      });

      auditLogger.log({
        level: 'warn',
        event: 'CROSS_ACCOUNT_DEVICE_CLAIM_DETECTED',
        userId: currentUserId,
        currentUserId,
        existingDeviceId: existingUnderOtherUser.id,
        existingOwnerUserId: existingUnderOtherUser.userId
      });

      throw new ForbiddenError(
        'This device installation is already registered to another ZdexCloud account. Please sign out from the existing account or reset app data.',
        'DEVICE_ALREADY_REGISTERED_OTHER_ACCOUNT'
      );
    }
  }

  /**
   * Registers or resolves an Android Device node for Camera operation.
   * Operates with 100% independence from Storage (zero ServerInstance requirement).
   *
   * Security & Lifecycle Guarantees (Phase 20.3 Corrective):
   * - Global uniqueness enforced via DeviceInstallationClaim.
   * - Cross-account claims rejected unconditionally before and inside transaction.
   * - Idempotent re-registration for active devices under same account.
   * - Terminal Revocation: Normal registration REJECTS revoked devices without clearing revokedAt.
   * - Separate explicit re-enrollment required to reinstate revoked devices.
   */
  public static async registerOrResolveCameraDevice(
    input: RegisterCameraDeviceInput
  ): Promise<{
    device: Device;
    deviceCredential?: string;
    isNewDevice: boolean;
  }> {
    const validInstallationId = this.validateInstallationId(input.installationId);

    // 1. Verify user status
    const user = await prisma.user.findUnique({
      where: { id: input.userId }
    });

    if (!user) {
      throw new NotFoundError('User account not found');
    }

    this.assertVerifiedUser(user);

    // 2. Enforce cross-account claim defense
    await this.assertInstallationUnclaimedByOtherUser(validInstallationId, input.userId, input.context);

    // 3. Check for existing claim status (reject if revoked)
    const existingClaim = await prisma.deviceInstallationClaim.findUnique({
      where: { installationId: validInstallationId }
    });

    if (existingClaim) {
      if (existingClaim.userId !== input.userId) {
        throw new ForbiddenError(
          'This device installation is already registered to another ZdexCloud account.',
          'DEVICE_ALREADY_REGISTERED_OTHER_ACCOUNT'
        );
      }
      if (existingClaim.status === 'REVOKED') {
        await CameraService.recordAuditEvent({
          userId: input.userId,
          eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
          action: 'REVOKED_DEVICE_REGISTRATION_REJECTED',
          result: 'DENIED',
          ipAddress: input.context?.ip,
          userAgent: input.context?.userAgent,
          metadata: {
            attemptedInstallationId: validInstallationId.substring(0, 8) + '...',
            reason: 'installation_claim_status_revoked'
          }
        });

        throw new ForbiddenError(
          'This device installation has been revoked. Explicit re-enrollment is required via /api/v1/devices/re-enroll.',
          'DEVICE_REVOKED'
        );
      }
    }

    // 4. Check for existing device under this user
    const existingDevice = await prisma.device.findUnique({
      where: {
        userId_installationId: {
          userId: input.userId,
          installationId: validInstallationId
        }
      },
      include: {
        credential: true
      }
    });

    if (existingDevice) {
      // Check if device credential was revoked: MUST NOT automatically reinstate!
      if (existingDevice.credential?.revokedAt) {
        await CameraService.recordAuditEvent({
          userId: input.userId,
          eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
          action: 'REVOKED_DEVICE_REGISTRATION_REJECTED',
          result: 'DENIED',
          ipAddress: input.context?.ip,
          userAgent: input.context?.userAgent,
          metadata: {
            deviceId: existingDevice.id,
            attemptedInstallationId: validInstallationId.substring(0, 8) + '...',
            reason: 'device_credential_revoked'
          }
        });

        throw new ForbiddenError(
          'This device has been revoked. Explicit re-enrollment is required via /api/v1/devices/re-enroll.',
          'DEVICE_REVOKED'
        );
      }

      // Idempotently update device status and metadata
      const updated = await prisma.device.update({
        where: { id: existingDevice.id },
        data: {
          deviceName: input.deviceName.trim(),
          osVersion: input.osVersion || existingDevice.osVersion,
          appVersion: input.appVersion || existingDevice.appVersion,
          status: 'ONLINE',
          lastSeenAt: new Date()
        }
      });

      // Synchronize DeviceInstallationClaim if needed
      if (!existingClaim) {
        await prisma.deviceInstallationClaim.create({
          data: {
            installationId: validInstallationId,
            userId: input.userId,
            deviceId: updated.id,
            status: 'ACTIVE'
          }
        }).catch(() => {});
      } else if (!existingClaim.deviceId) {
        await prisma.deviceInstallationClaim.update({
          where: { id: existingClaim.id },
          data: { deviceId: updated.id }
        }).catch(() => {});
      }

      // If a cameraId was passed, associate it with this device
      if (input.cameraId) {
        await this.associateCameraWithDevice({
          userId: input.userId,
          cameraId: input.cameraId,
          deviceId: updated.id,
          context: input.context
        });
      }

      return {
        device: updated,
        deviceCredential: undefined,
        isNewDevice: false
      };
    }

    // 5. Create new Device node inside a global unique claim transaction
    const result = await prisma.$transaction(async (tx) => {
      // Lock or claim the installationId in DeviceInstallationClaim globally
      let claim = await tx.deviceInstallationClaim.findUnique({
        where: { installationId: validInstallationId }
      });

      if (claim) {
        if (claim.userId !== input.userId) {
          throw new ForbiddenError(
            'This device installation is already registered to another ZdexCloud account.',
            'DEVICE_ALREADY_REGISTERED_OTHER_ACCOUNT'
          );
        }
        if (claim.status === 'REVOKED') {
          throw new ForbiddenError(
            'This device installation has been revoked. Explicit re-enrollment is required via /api/v1/devices/re-enroll.',
            'DEVICE_REVOKED'
          );
        }
      } else {
        try {
          claim = await tx.deviceInstallationClaim.create({
            data: {
              installationId: validInstallationId,
              userId: input.userId,
              status: 'ACTIVE',
              metadata: {
                initialPlatform: input.platform || 'Android',
                initialDeviceName: input.deviceName.trim()
              }
            }
          });
        } catch (error: any) {
          // Catch Prisma unique constraint error (P2002) in race conditions
          if (error?.code === 'P2002' || error?.message?.includes('Unique constraint failed')) {
            throw new ForbiddenError(
              'This device installation is already registered to another ZdexCloud account.',
              'DEVICE_ALREADY_REGISTERED_OTHER_ACCOUNT'
            );
          }
          throw error;
        }
      }

      // Double-check race condition on Device table
      const raceCheck = await tx.device.findUnique({
        where: {
          userId_installationId: {
            userId: input.userId,
            installationId: validInstallationId
          }
        }
      });

      if (raceCheck) {
        return { device: raceCheck, rawCredential: undefined, isNewDevice: false };
      }

      const newDevice = await tx.device.create({
        data: {
          userId: input.userId,
          installationId: validInstallationId,
          deviceName: input.deviceName.trim(),
          platform: input.platform || 'Android',
          osVersion: input.osVersion || null,
          appVersion: input.appVersion || null,
          status: 'ONLINE',
          lastSeenAt: new Date()
        }
      });

      // Bind claim to the new device
      await tx.deviceInstallationClaim.update({
        where: { id: claim.id },
        data: { deviceId: newDevice.id }
      });

      // Provision persistent DeviceAuthCredential (hashed storage only)
      const credential = `dst_${crypto.randomBytes(24).toString('hex')}`;
      const credentialHash = hashSessionToken(credential);

      await tx.deviceAuthCredential.create({
        data: {
          deviceId: newDevice.id,
          userId: input.userId,
          credentialHash,
          lastUsedAt: new Date(),
          lastRefreshAt: new Date()
        }
      });

      // Record platform audit event
      await tx.auditEvent.create({
        data: {
          userId: input.userId,
          deviceId: newDevice.id,
          eventType: 'DEVICE_REGISTERED',
          metadata: {
            installationId: validInstallationId.substring(0, 8) + '...',
            deviceName: newDevice.deviceName,
            purpose: 'CAMERA'
          }
        }
      });

      return {
        device: newDevice,
        rawCredential: credential,
        isNewDevice: true
      };
    }, { maxWait: 15000, timeout: 30000 });

    // Non-blocking activity recording
    CustomerActivityService.recordEventSafe({
      userId: input.userId,
      eventType: 'DEVICE.LINKED',
      deviceId: result.device.id,
      idempotencyKey: `camera_device_linked_${result.device.id}`,
      metadata: {
        deviceName: result.device.deviceName,
        platform: result.device.platform,
        purpose: 'CAMERA'
      }
    }).catch(() => {});

    // If cameraId was supplied, associate with new device
    if (input.cameraId) {
      await this.associateCameraWithDevice({
        userId: input.userId,
        cameraId: input.cameraId,
        deviceId: result.device.id,
        context: input.context
      });
    }

    return {
      device: result.device,
      deviceCredential: result.rawCredential,
      isNewDevice: result.isNewDevice
    };
  }

  /**
   * Associates a CameraInstance with a verified physical Device belonging to the same user.
   * Verifies account ownership, device eligibility, and non-revocation status.
   */
  public static async associateCameraWithDevice(
    input: AssociateCameraDeviceInput
  ): Promise<CameraInstance> {
    // 1. Verify Camera exists and belongs to the authenticated user (anti-enumeration 404)
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: input.cameraId }
    });

    if (!camera || camera.userId !== input.userId) {
      throw new NotFoundError('Camera instance not found');
    }

    // 2. Resolve target device
    let targetDevice: (Device & { credential?: any }) | null = null;

    if (input.deviceId) {
      targetDevice = await prisma.device.findUnique({
        where: { id: input.deviceId },
        include: { credential: true }
      });
    } else if (input.installationId) {
      const validInstallationId = this.validateInstallationId(input.installationId);
      targetDevice = await prisma.device.findUnique({
        where: {
          userId_installationId: {
            userId: input.userId,
            installationId: validInstallationId
          }
        },
        include: { credential: true }
      });
    } else {
      throw new ValidationError('Either deviceId or installationId must be provided to associate camera');
    }

    if (!targetDevice) {
      throw new NotFoundError('Target device node not found');
    }

    // 3. Enforce device ownership
    if (targetDevice.userId !== input.userId) {
      await CameraService.recordAuditEvent({
        cameraInstanceId: camera.id,
        userId: input.userId,
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'CAMERA_DEVICE_ASSOCIATION_DENIED',
        result: 'DENIED',
        ipAddress: input.context?.ip,
        userAgent: input.context?.userAgent,
        metadata: {
          targetDeviceId: targetDevice.id,
          reason: 'device_belongs_to_different_user'
        }
      });
      throw new ForbiddenError('You do not have permission to associate cameras with this device');
    }

    // 4. Check device revocation status
    if (targetDevice.credential?.revokedAt) {
      throw new ForbiddenError(
        'Cannot associate camera with a revoked device node. Re-authentication required.',
        'DEVICE_REVOKED'
      );
    }

    // 5. Update CameraInstance with deviceId
    const updated = await prisma.$transaction(async (tx) => {
      const cam = await tx.cameraInstance.update({
        where: { id: camera.id },
        data: {
          deviceId: targetDevice!.id
        }
      });

      await CameraService.recordAuditEventWithTx(tx, {
        cameraInstanceId: camera.id,
        userId: input.userId,
        eventType: CameraAuditEventType.CAMERA_CONFIG_UPDATED,
        action: 'CAMERA_DEVICE_ASSOCIATED',
        result: 'SUCCESS',
        ipAddress: input.context?.ip,
        userAgent: input.context?.userAgent,
        metadata: {
          deviceId: targetDevice!.id,
          deviceName: targetDevice!.deviceName,
          previousDeviceId: camera.deviceId
        }
      });

      return cam;
    });

    return updated;
  }

  /**
   * Dissociates a CameraInstance from its Device (deviceId = null).
   * Preserves CameraInstance, Device, and any Storage ServerInstance.
   */
  public static async dissociateCameraFromDevice(
    userId: string,
    cameraId: string,
    context?: { ip?: string; userAgent?: string }
  ): Promise<CameraInstance> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!camera || camera.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    if (!camera.deviceId) {
      return camera; // Already dissociated
    }

    const previousDeviceId = camera.deviceId;

    const updated = await prisma.$transaction(async (tx) => {
      const cam = await tx.cameraInstance.update({
        where: { id: cameraId },
        data: {
          deviceId: null
        }
      });

      await CameraService.recordAuditEventWithTx(tx, {
        cameraInstanceId: cameraId,
        userId,
        eventType: CameraAuditEventType.CAMERA_CONFIG_UPDATED,
        action: 'CAMERA_DEVICE_DISSOCIATED',
        result: 'SUCCESS',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: {
          dissociatedDeviceId: previousDeviceId
        }
      });

      return cam;
    });

    return updated;
  }

  /**
   * Creates an ephemeral pairing challenge for cross-device or QR code device linking.
   * Generates a single-use token (pct_<hex>) with 10-minute TTL and stores only its SHA-256 hash.
   */
  public static async createPairingChallenge(
    userId: string,
    cameraId: string,
    context?: { ip?: string; userAgent?: string }
  ): Promise<PairingChallengeResult> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!camera || camera.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    const rawChallengeToken = `pct_${crypto.randomBytes(24).toString('hex')}`;
    const challengeHash = hashSessionToken(rawChallengeToken);
    const ttlSeconds = 600; // 10 minutes
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const existingMeta = (camera.metadata as Record<string, any>) || {};
    const updatedMeta = {
      ...existingMeta,
      pairingChallenge: {
        challengeHash,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString()
      }
    };

    await prisma.cameraInstance.update({
      where: { id: cameraId },
      data: {
        metadata: updatedMeta
      }
    });

    await CameraService.recordAuditEvent({
      cameraInstanceId: cameraId,
      userId,
      eventType: CameraAuditEventType.CAMERA_CONFIG_UPDATED,
      action: 'PAIRING_CHALLENGE_CREATED',
      result: 'SUCCESS',
      ipAddress: context?.ip,
      userAgent: context?.userAgent,
      metadata: {
        expiresAt: expiresAt.toISOString()
      }
    });

    return {
      pairingChallengeToken: rawChallengeToken,
      expiresIn: ttlSeconds,
      expiresAt: expiresAt.toISOString(),
      cameraId: camera.id
    };
  }

  /**
   * Consumes an ephemeral pairing challenge token presented by an Android client.
   * Atomically links the device to the user, binds the camera to the device,
   * and clears the challenge token (one-time consumption guarantee).
   */
  public static async consumePairingChallenge(
    input: ConsumePairingChallengeInput
  ): Promise<{
    camera: CameraInstance;
    device: Device;
    message: string;
  }> {
    if (!input.rawChallengeToken || !input.rawChallengeToken.startsWith('pct_')) {
      throw new ValidationError('Invalid pairing challenge token format');
    }

    const validInstallationId = this.validateInstallationId(input.installationId);
    const challengeHash = hashSessionToken(input.rawChallengeToken);

    // Find camera with this challenge hash in metadata
    const cameras = await prisma.cameraInstance.findMany({
      where: {
        metadata: {
          path: '$.pairingChallenge.challengeHash',
          equals: challengeHash
        }
      }
    });

    if (cameras.length === 0) {
      throw new ForbiddenError('Pairing challenge token is invalid or already consumed', 'INVALID_PAIRING_TOKEN');
    }

    const camera = cameras[0];
    const meta = (camera.metadata as Record<string, any>) || {};
    const challenge = meta.pairingChallenge;

    if (!challenge || challenge.challengeHash !== challengeHash) {
      throw new ForbiddenError('Pairing challenge token is invalid', 'INVALID_PAIRING_TOKEN');
    }

    const expiresAt = new Date(challenge.expiresAt);
    if (expiresAt <= new Date()) {
      // Clear expired challenge
      delete meta.pairingChallenge;
      await prisma.cameraInstance.update({
        where: { id: camera.id },
        data: { metadata: meta }
      });
      throw new ForbiddenError('Pairing challenge token has expired', 'PAIRING_TOKEN_EXPIRED');
    }

    // Register or resolve device under camera owner's userId
    const { device } = await this.registerOrResolveCameraDevice({
      userId: camera.userId,
      installationId: validInstallationId,
      deviceName: input.deviceName,
      platform: input.platform,
      osVersion: input.osVersion,
      appVersion: input.appVersion,
      context: input.context
    });

    // Atomically link camera to device and clear pairing challenge
    delete meta.pairingChallenge;

    const updatedCamera = await prisma.$transaction(async (tx) => {
      const cam = await tx.cameraInstance.update({
        where: { id: camera.id },
        data: {
          deviceId: device.id,
          metadata: meta
        }
      });

      await CameraService.recordAuditEventWithTx(tx, {
        cameraInstanceId: camera.id,
        userId: camera.userId,
        eventType: CameraAuditEventType.CAMERA_CONFIG_UPDATED,
        action: 'PAIRING_CHALLENGE_CONSUMED',
        result: 'SUCCESS',
        ipAddress: input.context?.ip,
        userAgent: input.context?.userAgent,
        metadata: {
          deviceId: device.id,
          deviceName: device.deviceName
        }
      });

      return cam;
    });

    return {
      camera: updatedCamera,
      device,
      message: 'Device successfully paired with camera.'
    };
  }

  /**
   * Centralized Ownership and Eligibility Assertion:
   * Validates that:
   * 1. Camera belongs to caller account.
   * 2. Referenced Device belongs to caller account.
   * 3. Device credential is not revoked.
   * 4. Camera is actively associated with the specified device.
   */
  public static async assertCameraDeviceOwnership(
    userId: string,
    cameraId: string,
    deviceId?: string
  ): Promise<{
    camera: CameraInstance;
    device: Device;
  }> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!camera || camera.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    if (!camera.deviceId) {
      throw new ForbiddenError(
        'Camera is not associated with any registered physical device node',
        'CAMERA_NOT_LINKED_TO_DEVICE'
      );
    }

    const targetDeviceId = deviceId || camera.deviceId;

    if (camera.deviceId !== targetDeviceId) {
      throw new ForbiddenError(
        'Camera is not linked to the requested device',
        'CAMERA_DEVICE_MISMATCH'
      );
    }

    const device = await prisma.device.findUnique({
      where: { id: targetDeviceId },
      include: { credential: true }
    });

    if (!device || device.userId !== userId) {
      throw new NotFoundError('Associated device node not found');
    }

    if (device.credential?.revokedAt) {
      throw new ForbiddenError(
        'Device node has been revoked. Re-registration required.',
        'DEVICE_REVOKED'
      );
    }

    return { camera, device };
  }

  /**
   * Requests a short-lived, single-use recovery challenge token for an authorized device re-enrollment.
   * Requires fresh account authentication (account password verification) and initiates 2FA email OTP.
   * Enforces verified account status and claim ownership.
   * Generates token rec_<hex> with a 10-minute TTL and stores only its SHA-256 hash.
   */
  public static async requestDeviceReEnrollmentChallenge(
    input: RequestReEnrollChallengeInput
  ): Promise<ReEnrollChallengeResult> {
    const validInstallationId = this.validateInstallationId(input.installationId);

    const user = await prisma.user.findUnique({
      where: { id: input.userId }
    });

    if (!user) {
      throw new NotFoundError('User account not found');
    }

    this.assertVerifiedUser(user);

    // FRESH AUTHENTICATION REQUIREMENT:
    // User must provide valid account password to initiate device re-enrollment
    if (!input.password || typeof input.password !== 'string') {
      throw new UnauthorizedError(
        'Fresh account authentication required. Account password must be provided to initiate device re-enrollment.',
        'FRESH_AUTHENTICATION_REQUIRED'
      );
    }

    if (!user.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          eventType: 'RE_ENROLLMENT_FAILED',
          metadata: {
            reason: 'INVALID_PASSWORD_ON_CHALLENGE_REQUEST',
            installationId: validInstallationId.substring(0, 8) + '...',
            ipAddress: input.context?.ip,
            userAgent: input.context?.userAgent
          }
        }
      }).catch(() => {});

      throw new UnauthorizedError('Invalid account password.', 'INVALID_CREDENTIALS');
    }

    // Resolve installation claim
    const claim = await prisma.deviceInstallationClaim.findUnique({
      where: { installationId: validInstallationId }
    });

    if (claim && claim.userId !== input.userId) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'CROSS_ACCOUNT_RE_ENROLLMENT_DENIED',
          metadata: {
            attemptedInstallationId: validInstallationId.substring(0, 8) + '...',
            reason: 'claim_owned_by_different_user',
            ipAddress: input.context?.ip,
            userAgent: input.context?.userAgent
          }
        }
      }).catch(() => {});

      throw new ForbiddenError(
        'You do not have permission to re-enroll this device installation.',
        'CROSS_ACCOUNT_RE_ENROLLMENT_DENIED'
      );
    }

    // Defense-in-depth: check legacy Device rows
    const device = await prisma.device.findFirst({
      where: { installationId: validInstallationId }
    });

    if (device && device.userId !== input.userId) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'CROSS_ACCOUNT_RE_ENROLLMENT_DENIED',
          metadata: {
            attemptedInstallationId: validInstallationId.substring(0, 8) + '...',
            reason: 'device_owned_by_different_user',
            ipAddress: input.context?.ip,
            userAgent: input.context?.userAgent
          }
        }
      }).catch(() => {});

      throw new ForbiddenError(
        'You do not have permission to re-enroll this device installation.',
        'CROSS_ACCOUNT_RE_ENROLLMENT_DENIED'
      );
    }

    // Dispatch operation-bound, user-bound, installation-bound 6-digit email OTP
    try {
      await issueDeviceReEnrollmentOtp(user.id, user.email, validInstallationId);
    } catch (err: any) {
      if (err?.code !== 'RESEND_COOLDOWN_ACTIVE') {
        throw err;
      }
    }

    const rawRecoveryToken = `rec_${crypto.randomBytes(24).toString('hex')}`;
    const challengeHash = hashSessionToken(rawRecoveryToken);
    const ttlSeconds = 600; // 10 minutes
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const recoveryChallenge = {
      challengeHash,
      expiresAt: expiresAt.toISOString(),
      used: false,
      createdAt: new Date().toISOString()
    };

    if (claim) {
      const existingMeta = (claim.metadata as Record<string, any>) || {};
      await prisma.deviceInstallationClaim.update({
        where: { id: claim.id },
        data: {
          metadata: { ...existingMeta, recoveryChallenge },
          status: 'RECOVERY_PENDING'
        }
      });
    } else {
      await prisma.deviceInstallationClaim.create({
        data: {
          installationId: validInstallationId,
          userId: input.userId,
          deviceId: device?.id || null,
          status: 'RECOVERY_PENDING',
          metadata: { recoveryChallenge }
        }
      });
    }

    // Record accurate security audit event (NOT CAMERA_CONFIG_UPDATED)
    await prisma.auditEvent.create({
      data: {
        userId: input.userId,
        eventType: 'DEVICE_RE_ENROLLMENT_CHALLENGE_ISSUED',
        metadata: {
          installationId: validInstallationId.substring(0, 8) + '...',
          expiresAt: expiresAt.toISOString(),
          ipAddress: input.context?.ip,
          userAgent: input.context?.userAgent
        }
      }
    }).catch(() => {});

    return {
      recoveryToken: rawRecoveryToken,
      expiresIn: ttlSeconds,
      expiresAt: expiresAt.toISOString(),
      installationId: validInstallationId,
      requiresOtp: true,
      emailMasked: maskEmailAddress(user.email)
    };
  }

  /**
   * Explicitly re-enrolls a revoked device installation under an authenticated user.
   * Requires mandatory fresh authentication (operation-bound 6-digit email OTP). Password-only confirmation is disallowed.
   * Validates and atomically consumes single-use recovery challenge token.
   * Rotates device credentials (dst_<hex>), clears revokedAt, marks claim ACTIVE.
   * Sets Device.status = 'OFFLINE' without fabricating heartbeat or lastSeenAt.
   */
  public static async reEnrollRevokedDevice(
    input: ReEnrollDeviceInput
  ): Promise<{
    device: Device;
    deviceCredential: string;
    message: string;
  }> {
    const validInstallationId = this.validateInstallationId(input.installationId);

    const user = await prisma.user.findUnique({
      where: { id: input.userId }
    });

    if (!user) {
      throw new NotFoundError('User account not found');
    }

    this.assertVerifiedUser(user);

    // Resolve claim
    const claim = await prisma.deviceInstallationClaim.findUnique({
      where: { installationId: validInstallationId }
    });

    if (claim && claim.userId !== input.userId) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'CROSS_ACCOUNT_RE_ENROLLMENT_DENIED',
          metadata: {
            attemptedInstallationId: validInstallationId.substring(0, 8) + '...',
            reason: 'claim_owned_by_different_user',
            ipAddress: input.context?.ip,
            userAgent: input.context?.userAgent
          }
        }
      }).catch(() => {});

      throw new ForbiddenError(
        'You do not have permission to re-enroll this device installation.',
        'CROSS_ACCOUNT_RE_ENROLLMENT_DENIED'
      );
    }

    // Check legacy device ownership as defense-in-depth
    const legacyDevice = await prisma.device.findFirst({
      where: { installationId: validInstallationId }
    });

    if (legacyDevice && legacyDevice.userId !== input.userId) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'CROSS_ACCOUNT_RE_ENROLLMENT_DENIED',
          metadata: {
            attemptedInstallationId: validInstallationId.substring(0, 8) + '...',
            reason: 'device_owned_by_different_user',
            ipAddress: input.context?.ip,
            userAgent: input.context?.userAgent
          }
        }
      }).catch(() => {});

      throw new ForbiddenError(
        'You do not have permission to re-enroll this device installation.',
        'CROSS_ACCOUNT_RE_ENROLLMENT_DENIED'
      );
    }

    // 1. Validate recovery token
    if (!input.recoveryToken || typeof input.recoveryToken !== 'string' || !input.recoveryToken.startsWith('rec_')) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'RE_ENROLLMENT_FAILED',
          metadata: {
            reason: 'malformed_recovery_token',
            installationId: validInstallationId.substring(0, 8) + '...'
          }
        }
      }).catch(() => {});
      throw new ValidationError('A valid recovery challenge token (rec_*) is required');
    }

    const tokenHash = hashSessionToken(input.recoveryToken);
    const meta = (claim?.metadata as Record<string, any>) || {};
    const challenge = meta.recoveryChallenge;

    if (!challenge || challenge.challengeHash !== tokenHash) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'RE_ENROLLMENT_FAILED',
          metadata: {
            reason: 'invalid_recovery_token',
            installationId: validInstallationId.substring(0, 8) + '...'
          }
        }
      }).catch(() => {});
      throw new ForbiddenError('Invalid re-enrollment recovery token.', 'INVALID_RECOVERY_TOKEN');
    }

    if (challenge.used === true) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'RE_ENROLLMENT_FAILED',
          metadata: {
            reason: 'recovery_token_already_used',
            installationId: validInstallationId.substring(0, 8) + '...'
          }
        }
      }).catch(() => {});
      throw new ForbiddenError('Re-enrollment recovery token has already been consumed.', 'RECOVERY_TOKEN_ALREADY_USED');
    }

    const expiresAt = new Date(challenge.expiresAt);
    if (expiresAt <= new Date()) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'RE_ENROLLMENT_FAILED',
          metadata: {
            reason: 'recovery_token_expired',
            installationId: validInstallationId.substring(0, 8) + '...'
          }
        }
      }).catch(() => {});
      throw new ForbiddenError('Re-enrollment recovery token has expired.', 'RECOVERY_TOKEN_EXPIRED');
    }

    // 2. MANDATORY FRESH REAUTHENTICATION (EMAIL OTP):
    // Ordinary authenticated session and password-only confirmation are strictly disallowed.
    // The recovery confirmation MUST require a valid 6-digit numeric email OTP.
    if (!input.otp || typeof input.otp !== 'string' || !/^\d{6}$/.test(input.otp.trim())) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'RE_ENROLLMENT_FAILED',
          metadata: {
            reason: 'MANDATORY_OTP_MISSING_OR_MALFORMED',
            installationId: validInstallationId.substring(0, 8) + '...',
            ipAddress: input.context?.ip,
            userAgent: input.context?.userAgent
          }
        }
      }).catch(() => {});

      throw new ValidationError(
        'A valid 6-digit numeric email OTP is mandatory to confirm device re-enrollment.'
      );
    }

    // Verify OTP against operation-bound, user-bound, installation-bound namespace
    // (pre-verification only; consumed atomically inside transaction below)
    const otpResult = await verifyDeviceReEnrollmentOtp(
      user.id,
      user.email,
      validInstallationId,
      input.otp.trim(),
      { consume: false }
    );

    if (!otpResult.valid || !otpResult.otpRecordId) {
      await prisma.auditEvent.create({
        data: {
          userId: input.userId,
          eventType: 'RE_ENROLLMENT_FAILED',
          metadata: {
            reason: otpResult.error || 'INVALID_OTP',
            installationId: validInstallationId.substring(0, 8) + '...',
            ipAddress: input.context?.ip,
            userAgent: input.context?.userAgent
          }
        }
      }).catch(() => {});

      throw new UnauthorizedError(
        otpResult.error === 'EXPIRED_OTP'
          ? 'Verification code has expired. Please request a new recovery challenge.'
          : otpResult.error === 'TOO_MANY_ATTEMPTS'
          ? 'Too many invalid verification attempts. Account locked out from OTP verification.'
          : 'Invalid 6-digit verification code.',
        otpResult.error || 'INVALID_OTP'
      );
    }

    // 3. ATOMIC TRANSACTION:
    // Atomically consume recovery challenge & email OTP, rotate credentials, reset revokedAt, set Device status = OFFLINE
    const result = await prisma.$transaction(async (tx) => {
      // Step A: Atomically consume the verified email OTP within the transaction
      const consumedOtp = await tx.emailOtp.updateMany({
        where: { id: otpResult.otpRecordId, userId: user.id, used: false },
        data: { used: true }
      });

      if (consumedOtp.count !== 1) {
        throw new UnauthorizedError(
          'Verification code has already been consumed or invalidated.',
          'NO_ACTIVE_OTP'
        );
      }

      // Step B: Lock claim row and re-verify single-use recovery challenge inside transaction
      if (claim) {
        await tx.$queryRaw`SELECT id FROM DeviceInstallationClaim WHERE id = ${claim.id} FOR UPDATE`;
        const lockedClaim = await tx.deviceInstallationClaim.findUnique({
          where: { id: claim.id }
        });
        const lockedMeta = (lockedClaim?.metadata as Record<string, any>) || {};
        const lockedChallenge = lockedMeta.recoveryChallenge;

        if (!lockedChallenge || lockedChallenge.challengeHash !== tokenHash) {
          throw new ForbiddenError('Invalid re-enrollment recovery token.', 'INVALID_RECOVERY_TOKEN');
        }
        if (lockedChallenge.used === true) {
          throw new ForbiddenError('Re-enrollment recovery token has already been consumed.', 'RECOVERY_TOKEN_ALREADY_USED');
        }
        if (new Date(lockedChallenge.expiresAt) <= new Date()) {
          throw new ForbiddenError('Re-enrollment recovery token has expired.', 'RECOVERY_TOKEN_EXPIRED');
        }

        const updatedMeta = {
          ...lockedMeta,
          recoveryChallenge: {
            ...lockedChallenge,
            used: true,
            usedAt: new Date().toISOString()
          }
        };

        await tx.deviceInstallationClaim.update({
          where: { id: claim.id },
          data: {
            status: 'ACTIVE',
            metadata: updatedMeta
          }
        });
      } else {
        await tx.deviceInstallationClaim.create({
          data: {
            installationId: validInstallationId,
            userId: input.userId,
            status: 'ACTIVE',
            metadata: {
              recoveryChallenge: {
                challengeHash: tokenHash,
                used: true,
                usedAt: new Date().toISOString()
              }
            }
          }
        });
      }

      // Step C: Resolve Device record.
      // REQUIREMENT 3: Set status = 'OFFLINE'.
      // DO NOT fabricate heartbeat or update lastSeenAt!
      let device = await tx.device.findUnique({
        where: {
          userId_installationId: {
            userId: input.userId,
            installationId: validInstallationId
          }
        }
      });

      if (device) {
        device = await tx.device.update({
          where: { id: device.id },
          data: {
            deviceName: input.deviceName ? input.deviceName.trim() : device.deviceName,
            osVersion: input.osVersion || device.osVersion,
            appVersion: input.appVersion || device.appVersion,
            status: 'OFFLINE'
            // NOTE: lastSeenAt is explicitly preserved as-is. NOT updated to now!
          }
        });
      } else {
        device = await tx.device.create({
          data: {
            userId: input.userId,
            installationId: validInstallationId,
            deviceName: input.deviceName ? input.deviceName.trim() : 'Android Device',
            platform: input.platform || 'Android',
            osVersion: input.osVersion || null,
            appVersion: input.appVersion || null,
            status: 'OFFLINE',
            lastSeenAt: null // Explicitly null for unverified physical node
          }
        });
      }

      // Step D: Credential Rotation - generate fresh persistent device session token (dst_<hex>)
      const freshCredential = `dst_${crypto.randomBytes(24).toString('hex')}`;
      const freshCredentialHash = hashSessionToken(freshCredential);

      await tx.deviceAuthCredential.upsert({
        where: { deviceId: device.id },
        update: {
          credentialHash: freshCredentialHash,
          revokedAt: null, // Revocation cleared strictly after verified authorization
          lastRefreshAt: new Date(),
          lastUsedAt: new Date()
        },
        create: {
          deviceId: device.id,
          userId: input.userId,
          credentialHash: freshCredentialHash,
          revokedAt: null,
          lastRefreshAt: new Date(),
          lastUsedAt: new Date()
        }
      });

      // Step E: Update claim with deviceId
      await tx.deviceInstallationClaim.update({
        where: { installationId: validInstallationId },
        data: { deviceId: device.id }
      });

      // Step F: Record accurate security audit event (NOT CAMERA_CONFIG_UPDATED)
      await tx.auditEvent.create({
        data: {
          userId: input.userId,
          deviceId: device.id,
          eventType: 'DEVICE_RE_ENROLLED',
          metadata: {
            installationId: validInstallationId.substring(0, 8) + '...',
            deviceName: device.deviceName,
            action: 'EXPLICIT_RE_ENROLLMENT_COMPLETED',
            deviceStatus: 'OFFLINE',
            ipAddress: input.context?.ip,
            userAgent: input.context?.userAgent
          }
        }
      });

      return { device, freshCredential };
    }, { maxWait: 15000, timeout: 30000 });

    return {
      device: result.device,
      deviceCredential: result.freshCredential,
      message: 'Device successfully re-enrolled with rotated credentials. Device remains OFFLINE until authenticated connection is established.'
    };
  }

  /**
   * Alias for reEnrollRevokedDevice matching consumer naming.
   */
  public static async completeDeviceReEnrollment(
    input: ReEnrollDeviceInput
  ): Promise<{
    device: Device;
    deviceCredential: string;
    message: string;
  }> {
    return this.reEnrollRevokedDevice(input);
  }
}
