import { prisma } from '../../config/database.js';
import {
  ProductType,
  BillingStatus,
  AccountProductSubscription,
  Subscription,
  Plan,
  PlanPrice,
  PlanEntitlement,
  EntitlementDefinition,
  Prisma
} from '@prisma/client';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  DeploymentMigrationPendingError
} from '../../errors/app-error.js';
import { PAID_ENTITLED_STATUSES } from './billing_state_service.js';

export type PopulatedProductSlot = AccountProductSubscription & {
  subscription: Subscription & {
    plan: Plan & {
      entitlements?: (PlanEntitlement & {
        entitlementDefinition: EntitlementDefinition;
      })[];
    };
    planPrice: PlanPrice;
  };
};

export interface UpsertProductSlotParams {
  userId: string;
  productType: ProductType;
  subscriptionId: string;
  status?: BillingStatus;
}

export interface ReplaceProductSlotParams {
  userId: string;
  productType: ProductType;
  newSubscriptionId: string;
  expectedCurrentSubscriptionId?: string;
  newStatus?: BillingStatus;
}

export interface UpdateSlotStatusParams {
  subscriptionId: string;
  status: BillingStatus;
  userId?: string;
  productType?: ProductType;
  expectedPreviousStatus?: BillingStatus;
  eventCreatedAt?: Date | number;
  eventPeriodEnd?: Date | number;
}

export interface ExpireProductSlotParams {
  userId: string;
  productType: ProductType;
  subscriptionId: string; // Mandatory: Webhook/lifecycle events must specify target subscription
}

export interface SlotMutationResult {
  success: boolean;
  modified: boolean;
  reason:
    | 'SLOT_UPDATED'
    | 'STALE_EVENT_IGNORED'
    | 'SLOT_NOT_FOUND'
    | 'SUBSCRIPTION_MISMATCH'
    | 'SUPERSEDED_BY_NEWER_PERIOD'
    | 'INVALID_TRANSITION'
    | 'NO_OP';
  slot: AccountProductSubscription | null;
}

/**
 * Classifies Prisma and Database errors into specific failure domains.
 * Uses structured Prisma (P-codes) and MySQL error codes as the primary classification.
 * Prevents misclassifying unique constraint violations (P2002) as missing migrations.
 */
export function classifyPrismaError(
  err: any
): 'CONNECTION_FAILURE' | 'MIGRATION_PENDING' | 'UNIQUE_CONSTRAINT' | 'TRANSACTION_CONFLICT' | 'OTHER' {
  if (!err) return 'OTHER';
  const code = String(err.code || '');
  const msg = String(err.message || '');

  // 1. Genuine database connectivity and infrastructure failures
  if (
    code === 'P1000' || // Authentication failed
    code === 'P1001' || // Can't reach database server
    code === 'P1002' || // Database server timed out
    code === 'P1003' || // Database does not exist
    code === 'P1008' || // Operations timed out
    code === 'P1011' || // TLS error
    code === 'P1017' || // Server closed the connection
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ER_CON_COUNT_ERROR' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('connection timed out') ||
    msg.includes("Can't reach database server")
  ) {
    return 'CONNECTION_FAILURE';
  }

  // 2. Missing migration structures (strictly structured error codes or targeted entity checks)
  if (
    code === 'P2021' || // Table does not exist in Prisma schema/runtime
    code === 'P2022' || // Column does not exist
    code === 'ER_NO_SUCH_TABLE' ||
    code === 'ER_BAD_FIELD_ERROR' ||
    (msg.includes('AccountProductSubscription') && (msg.includes("doesn't exist") || msg.includes('does not exist') || msg.includes('no such table'))) ||
    (msg.includes('Plan.productType') && (msg.includes("doesn't exist") || msg.includes('does not exist') || msg.includes('Unknown column'))) ||
    (msg.includes('productType') && (msg.includes("doesn't exist") || msg.includes('does not exist') || msg.includes('Unknown column')))
  ) {
    return 'MIGRATION_PENDING';
  }

  // 3. Unique constraint violations (P2002) - Must NEVER be classified as MIGRATION_PENDING
  if (code === 'P2002') {
    return 'UNIQUE_CONSTRAINT';
  }

  // 4. Deadlock / Transaction Conflicts (P2034, ER_LOCK_DEADLOCK)
  if (code === 'P2034' || code === 'ER_LOCK_DEADLOCK' || code === '1213' || msg.includes('Deadlock found')) {
    return 'TRANSACTION_CONFLICT';
  }

  return 'OTHER';
}

/**
 * AccountProductSubscriptionService
 *
 * Authoritative management service for AccountProductSubscription slots.
 * Implements strict lifecycle safety, subscription-specific conditional updates,
 * stale event filtering, and product classification integrity.
 */
export class AccountProductSubscriptionService {
  /**
   * Retrieves all populated product subscription slots for an account.
   * Catches unmigrated table state gracefully, while re-throwing database connectivity outages.
   */
  static async getProductSlots(
    userId: string,
    tx?: Prisma.TransactionClient
  ): Promise<PopulatedProductSlot[]> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const client = tx || prisma;

    try {
      const slots = await client.accountProductSubscription.findMany({
        where: { userId },
        include: {
          subscription: {
            include: {
              plan: {
                include: {
                  entitlements: {
                    include: {
                      entitlementDefinition: true
                    }
                  }
                }
              },
              planPrice: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      return slots as PopulatedProductSlot[];
    } catch (err: any) {
      const classification = classifyPrismaError(err);
      if (classification === 'CONNECTION_FAILURE') {
        throw new DatabaseError(
          `Database connection unavailable while retrieving product slots for user '${userId}'`
        );
      }
      if (classification === 'MIGRATION_PENDING') {
        // Table does not exist yet on connected database
        return [];
      }
      throw err;
    }
  }

  /**
   * Retrieves a specific product slot for an account.
   */
  static async getProductSlot(
    userId: string,
    productType: ProductType,
    tx?: Prisma.TransactionClient
  ): Promise<PopulatedProductSlot | null> {
    if (!userId) throw new ValidationError('userId is required');
    if (!productType) throw new ValidationError('productType is required');

    const client = tx || prisma;

    try {
      const slot = await client.accountProductSubscription.findUnique({
        where: {
          userId_productType: {
            userId,
            productType
          }
        },
        include: {
          subscription: {
            include: {
              plan: {
                include: {
                  entitlements: {
                    include: {
                      entitlementDefinition: true
                    }
                  }
                }
              },
              planPrice: true
            }
          }
        }
      });

      return slot as PopulatedProductSlot | null;
    } catch (err: any) {
      const classification = classifyPrismaError(err);
      if (classification === 'CONNECTION_FAILURE') {
        throw new DatabaseError(
          `Database connection unavailable while retrieving ${productType} slot for user '${userId}'`
        );
      }
      if (classification === 'MIGRATION_PENDING') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Transactionally creates or updates a product subscription slot for an account.
   * Enforces strict product classification:
   * - STORAGE plan -> STORAGE slot only
   * - CAMERA plan -> CAMERA slot only
   * - UNIFIED_PRO plan -> UNIFIED_PRO slot only
   */
  static async upsertProductSlot(
    params: UpsertProductSlotParams,
    externalTx?: Prisma.TransactionClient
  ): Promise<AccountProductSubscription> {
    const { userId, productType, subscriptionId, status } = params;

    if (!userId) throw new ValidationError('userId is required');
    if (!productType) throw new ValidationError('productType is required');
    if (!subscriptionId) throw new ValidationError('subscriptionId is required');

    const execute = async (tx: Prisma.TransactionClient) => {
      // 1. Verify User exists and acquire row-lock to serialize concurrent slot updates
      const userExists: any = await tx.$queryRawUnsafe(
        'SELECT id FROM `User` WHERE id = ? FOR UPDATE',
        userId
      );
      if (!userExists || userExists.length === 0) {
        throw new NotFoundError(`User account '${userId}' not found`);
      }

      // 2. Verify Subscription exists and belongs to the user
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true }
      });

      if (!subscription) {
        throw new NotFoundError(`Subscription '${subscriptionId}' not found`);
      }
      if (subscription.userId !== userId) {
        throw new ConflictError(
          `Subscription '${subscriptionId}' does not belong to user '${userId}'`
        );
      }

      // 3. Strict Product Classification Validation
      const planProductType = subscription.plan.productType;
      if (productType === ProductType.STORAGE && planProductType !== ProductType.STORAGE) {
        throw new ValidationError(
          `Plan '${subscription.plan.code}' with productType '${planProductType}' cannot be slotted into STORAGE`
        );
      }
      if (productType === ProductType.CAMERA && planProductType !== ProductType.CAMERA) {
        throw new ValidationError(
          `Plan '${subscription.plan.code}' with productType '${planProductType}' cannot be slotted into CAMERA`
        );
      }
      if (productType === ProductType.UNIFIED_PRO && planProductType !== ProductType.UNIFIED_PRO) {
        throw new ValidationError(
          `Plan '${subscription.plan.code}' with productType '${planProductType}' cannot be slotted into UNIFIED_PRO`
        );
      }

      // 4. Ensure subscriptionId is not bound to another slot (scalar uniqueness safeguard)
      const existingSlotForSub = await tx.accountProductSubscription.findUnique({
        where: { subscriptionId }
      });

      if (
        existingSlotForSub &&
        (existingSlotForSub.userId !== userId || existingSlotForSub.productType !== productType)
      ) {
        throw new ConflictError(
          `Subscription '${subscriptionId}' is already assigned to ${existingSlotForSub.productType} slot for user '${existingSlotForSub.userId}'`
        );
      }

      // 5. Upsert product slot
      const effectiveStatus = status ?? subscription.status;

      return await tx.accountProductSubscription.upsert({
        where: {
          userId_productType: {
            userId,
            productType
          }
        },
        update: {
          subscriptionId,
          status: effectiveStatus,
          updatedAt: new Date()
        },
        create: {
          userId,
          productType,
          subscriptionId,
          status: effectiveStatus
        }
      });
    };

    try {
      if (externalTx) {
        return await execute(externalTx);
      } else {
        return await prisma.$transaction(execute);
      }
    } catch (err: any) {
      const classification = classifyPrismaError(err);
      if (classification === 'CONNECTION_FAILURE') {
        throw new DatabaseError(`Database connection unavailable during slot upsert`);
      }
      throw err;
    }
  }

  /**
   * Atomically replaces an existing product slot's subscription reference.
   *
   * Safeguards:
   * 1. Preserves old Subscription record in the database historical ledger.
   * 2. Supports optimistic concurrency check via expectedCurrentSubscriptionId.
   * 3. Row-locks user account to eliminate concurrent replacement race conditions.
   */
  static async replaceProductSlotSubscription(
    params: ReplaceProductSlotParams,
    externalTx?: Prisma.TransactionClient
  ): Promise<AccountProductSubscription> {
    const { userId, productType, newSubscriptionId, expectedCurrentSubscriptionId, newStatus } = params;

    if (!userId) throw new ValidationError('userId is required');
    if (!productType) throw new ValidationError('productType is required');
    if (!newSubscriptionId) throw new ValidationError('newSubscriptionId is required');

    const execute = async (tx: Prisma.TransactionClient) => {
      // Row-lock user to serialize replacements via $queryRawUnsafe (SELECT ... FOR UPDATE)
      await tx.$queryRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', userId);

      // Verify current slot if optimistic locking requested
      if (expectedCurrentSubscriptionId) {
        const currentSlot = await tx.accountProductSubscription.findUnique({
          where: {
            userId_productType: { userId, productType }
          }
        });

        if (currentSlot && currentSlot.subscriptionId !== expectedCurrentSubscriptionId) {
          throw new ConflictError(
            `Concurrent replacement conflict: slot currently references '${currentSlot.subscriptionId}', expected '${expectedCurrentSubscriptionId}'`
          );
        }
      }

      return await this.upsertProductSlot(
        {
          userId,
          productType,
          subscriptionId: newSubscriptionId,
          status: newStatus
        },
        tx
      );
    };

    if (externalTx) {
      return await execute(externalTx);
    } else {
      return await prisma.$transaction(execute);
    }
  }

  /**
   * Subscription-specific conditional status update.
   *
   * Critical Safeguards:
   * 1. Requires mandatory subscriptionId.
   * 2. Acquires row-lock (SELECT ... FOR UPDATE) on User inside transaction.
   * 3. Verifies subscription ownership (belongs to user) and product classification (plan matches slot).
   * 4. Out-of-Order Event Protection (Task B):
   *    - Billing Period Ordering: Events with older currentPeriodEnd cannot downgrade newer periods.
   *    - Timestamp Ordering: Events older than subscription.updatedAt cannot downgrade ACTIVE status.
   *    - Terminal Status Protection: EXPIRED/REFUNDED cannot be reverted by stale transient errors.
   * 5. Mutates slot ONLY if slot points to the exact subscriptionId generating the event.
   */
  static async updateSlotStatus(
    params: UpdateSlotStatusParams,
    externalTx?: Prisma.TransactionClient
  ): Promise<SlotMutationResult> {
    const {
      subscriptionId,
      status,
      userId,
      productType,
      expectedPreviousStatus,
      eventCreatedAt,
      eventPeriodEnd
    } = params;

    if (!subscriptionId) {
      throw new ValidationError('subscriptionId is required for conditional slot status update');
    }
    if (!status) {
      throw new ValidationError('status is required');
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      // Find slot currently referencing this subscriptionId
      let slot = await tx.accountProductSubscription.findUnique({
        where: { subscriptionId }
      });

      // If no slot points to this subscription, check if user/product slot is already pointing to another subscription
      if (!slot && userId && productType) {
        const userSlot = await tx.accountProductSubscription.findUnique({
          where: {
            userId_productType: { userId, productType }
          }
        });
        if (userSlot && userSlot.subscriptionId !== subscriptionId) {
          return {
            success: true,
            modified: false,
            reason: 'SUBSCRIPTION_MISMATCH' as const,
            slot: userSlot
          };
        }
      }

      // If no slot points to this subscription, this is a stale or detached subscription event
      if (!slot) {
        return {
          success: true,
          modified: false,
          reason: 'SLOT_NOT_FOUND' as const,
          slot: null
        };
      }

      const targetUserId = slot.userId;

      // Row-lock user to serialize slot updates via $queryRawUnsafe (SELECT ... FOR UPDATE)
      await tx.$queryRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', targetUserId);

      // Verify account ownership if provided
      if (userId && slot.userId !== userId) {
        throw new ConflictError(
          `Account mismatch: subscription slot belongs to '${slot.userId}', but update requested for '${userId}'`
        );
      }

      // Verify product type if provided
      if (productType && slot.productType !== productType) {
        throw new ConflictError(
          `Product type mismatch: slot is '${slot.productType}', update requested for '${productType}'`
        );
      }

      // Verify subscription record and ownership
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true }
      });

      if (subscription) {
        if (subscription.userId !== targetUserId) {
          throw new ConflictError(
            `Subscription '${subscriptionId}' belongs to '${subscription.userId}', but slot belongs to '${targetUserId}'`
          );
        }

        // Product classification integrity check
        if (subscription.plan) {
          const planProductType = subscription.plan.productType;
          if (slot.productType === ProductType.STORAGE && planProductType !== ProductType.STORAGE) {
            throw new ValidationError(
              `Plan '${subscription.plan.code}' with productType '${planProductType}' cannot update STORAGE slot`
            );
          }
          if (slot.productType === ProductType.CAMERA && planProductType !== ProductType.CAMERA) {
            throw new ValidationError(
              `Plan '${subscription.plan.code}' with productType '${planProductType}' cannot update CAMERA slot`
            );
          }
          if (slot.productType === ProductType.UNIFIED_PRO && planProductType !== ProductType.UNIFIED_PRO) {
            throw new ValidationError(
              `Plan '${subscription.plan.code}' with productType '${planProductType}' cannot update UNIFIED_PRO slot`
            );
          }
        }

        // --- TASK B: EVENT ORDERING SAFEGUARDS FOR THE SAME SUBSCRIPTION ---

        // Safeguard B1: Billing Period Ordering
        // An event from an older billing period cannot downgrade a newer billing period
        if (eventPeriodEnd && subscription.currentPeriodEnd) {
          const evEnd = new Date(eventPeriodEnd);
          if (subscription.currentPeriodEnd.getTime() > evEnd.getTime() && status !== BillingStatus.ACTIVE) {
            return {
              success: true,
              modified: false,
              reason: 'SUPERSEDED_BY_NEWER_PERIOD' as const,
              slot
            };
          }
        }

        // Safeguard B2: Event Creation Timestamp Ordering
        // A delayed degrading event (e.g. payment.failed, cancelled) created before the latest confirmation
        // cannot revert a confirmed ACTIVE status.
        if (eventCreatedAt && subscription.updatedAt) {
          const evTime = new Date(eventCreatedAt);
          const isDegrading =
            status === BillingStatus.PAST_DUE ||
            status === BillingStatus.GRACE_PERIOD ||
            status === BillingStatus.CANCELLING ||
            status === BillingStatus.EXPIRED;
          const isCurrentlyActive =
            subscription.status === BillingStatus.ACTIVE || slot.status === BillingStatus.ACTIVE;

          if (evTime.getTime() < subscription.updatedAt.getTime() && isCurrentlyActive && isDegrading) {
            return {
              success: true,
              modified: false,
              reason: 'STALE_EVENT_IGNORED' as const,
              slot
            };
          }
        }

        // Safeguard B3: Terminal Status Protection
        // EXPIRED or REFUNDED subscriptions cannot be modified by delayed transient failure events
        const isTerminal =
          slot.status === BillingStatus.EXPIRED || subscription.status === BillingStatus.EXPIRED;
        if (
          isTerminal &&
          (status === BillingStatus.PAST_DUE ||
            status === BillingStatus.GRACE_PERIOD ||
            status === BillingStatus.CANCELLING)
        ) {
          return {
            success: true,
            modified: false,
            reason: 'INVALID_TRANSITION' as const,
            slot
          };
        }
      }

      // Verify expected previous status if provided (optimistic concurrency)
      if (expectedPreviousStatus && slot.status !== expectedPreviousStatus) {
        if (slot.status === status) {
          return {
            success: true,
            modified: false,
            reason: 'NO_OP' as const,
            slot
          };
        }
        return {
          success: true,
          modified: false,
          reason: 'STALE_EVENT_IGNORED' as const,
          slot
        };
      }

      // If already at target status, avoid redundant DB writes (Idempotency)
      if (slot.status === status) {
        return {
          success: true,
          modified: false,
          reason: 'NO_OP' as const,
          slot
        };
      }

      // Update slot status
      const updatedSlot = await tx.accountProductSubscription.update({
        where: { id: slot.id },
        data: { status, updatedAt: new Date() }
      });

      return {
        success: true,
        modified: true,
        reason: 'SLOT_UPDATED' as const,
        slot: updatedSlot
      };
    };

    try {
      if (externalTx) {
        return await execute(externalTx);
      } else {
        return await prisma.$transaction(execute);
      }
    } catch (err: any) {
      const classification = classifyPrismaError(err);
      if (classification === 'CONNECTION_FAILURE') {
        throw new DatabaseError(`Database connection unavailable during slot status update`);
      }
      if (classification === 'TRANSACTION_CONFLICT') {
        throw new ConflictError(`Database deadlock or write conflict detected during slot status update`);
      }
      if (classification === 'MIGRATION_PENDING') {
        return {
          success: false,
          modified: false,
          reason: 'SLOT_NOT_FOUND' as const,
          slot: null
        };
      }
      throw err;
    }
  }

  /**
   * Subscription-specific conditional expiration.
   *
   * Critical Safeguards:
   * 1. Requires MANDATORY subscriptionId (Task A).
   * 2. Acquires row-lock (SELECT ... FOR UPDATE) on User inside transaction (Task C).
   * 3. Verifies subscription ownership and plan classification (Task E).
   * 4. Expired ONLY if the slot currently references that exact subscription.
   *    A delayed expiration event for superseded subscription A will NEVER expire replacement subscription B.
   */
  static async expireProductSlot(
    params: ExpireProductSlotParams,
    externalTx?: Prisma.TransactionClient
  ): Promise<SlotMutationResult> {
    const { userId, productType, subscriptionId } = params;

    if (!subscriptionId) {
      throw new ValidationError('subscriptionId is required to expire a product slot');
    }
    if (!userId) {
      throw new ValidationError('userId is required');
    }
    if (!productType) {
      throw new ValidationError('productType is required');
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      // Row-lock user to serialize lifecycle updates via $queryRawUnsafe (SELECT ... FOR UPDATE)
      await tx.$queryRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', userId);

      const slot = await tx.accountProductSubscription.findUnique({
        where: {
          userId_productType: { userId, productType }
        }
      });

      if (!slot) {
        return {
          success: true,
          modified: false,
          reason: 'SLOT_NOT_FOUND' as const,
          slot: null
        };
      }

      // Stale Event Guard:
      // Verify that the slot still points to that exact incoming subscription.
      if (slot.subscriptionId !== subscriptionId) {
        return {
          success: true,
          modified: false,
          reason: 'STALE_EVENT_IGNORED' as const,
          slot
        };
      }

      // Subscription ownership & classification verification
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true }
      });

      if (subscription) {
        if (subscription.userId !== userId) {
          throw new ConflictError(
            `Subscription '${subscriptionId}' belongs to '${subscription.userId}', but expiration requested for '${userId}'`
          );
        }
        if (subscription.plan) {
          const planProductType = subscription.plan.productType;
          if (productType === ProductType.STORAGE && planProductType !== ProductType.STORAGE) {
            throw new ValidationError(
              `Subscription '${subscriptionId}' plan productType '${planProductType}' cannot expire STORAGE slot`
            );
          }
          if (productType === ProductType.CAMERA && planProductType !== ProductType.CAMERA) {
            throw new ValidationError(
              `Subscription '${subscriptionId}' plan productType '${planProductType}' cannot expire CAMERA slot`
            );
          }
          if (productType === ProductType.UNIFIED_PRO && planProductType !== ProductType.UNIFIED_PRO) {
            throw new ValidationError(
              `Subscription '${subscriptionId}' plan productType '${planProductType}' cannot expire UNIFIED_PRO slot`
            );
          }
        }
      }

      // If already expired, return no-op (Idempotency)
      if (slot.status === BillingStatus.EXPIRED) {
        return {
          success: true,
          modified: false,
          reason: 'NO_OP' as const,
          slot
        };
      }

      const updatedSlot = await tx.accountProductSubscription.update({
        where: { id: slot.id },
        data: {
          status: BillingStatus.EXPIRED,
          updatedAt: new Date()
        }
      });

      return {
        success: true,
        modified: true,
        reason: 'SLOT_UPDATED' as const,
        slot: updatedSlot
      };
    };

    try {
      if (externalTx) {
        return await execute(externalTx);
      } else {
        return await prisma.$transaction(execute);
      }
    } catch (err: any) {
      const classification = classifyPrismaError(err);
      if (classification === 'CONNECTION_FAILURE') {
        throw new DatabaseError(`Database connection unavailable during slot expiration`);
      }
      if (classification === 'TRANSACTION_CONFLICT') {
        throw new ConflictError(`Database deadlock or write conflict detected during slot expiration`);
      }
      if (classification === 'MIGRATION_PENDING') {
        return {
          success: false,
          modified: false,
          reason: 'SLOT_NOT_FOUND' as const,
          slot: null
        };
      }
      throw err;
    }
  }

  /**
   * Reconciles product slots against authoritative Subscription records and legacy AccountBillingState.
   *
   * Safeguards:
   * 1. Acquires row-lock (SELECT ... FOR UPDATE) on User inside transaction.
   * 2. Synchronizes slot status with underlying Subscription status to eliminate status drift.
   * 3. Enforces subscription ownership and product classification (mismatched subscriptions cannot be validated).
   * 4. Idempotently backfills STORAGE slot from AccountBillingState if no STORAGE slot exists.
   * 5. Ignores Camera plans during legacy backfill (Camera plans never populate Storage slots).
   */
  static async reconcileProductSlots(
    userId: string,
    externalTx?: Prisma.TransactionClient
  ): Promise<{
    slots: AccountProductSubscription[];
    legacyBackfilled: boolean;
    staleSlotsReconciled: number;
  }> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      // Row-lock user to serialize reconciliation via $queryRawUnsafe (SELECT ... FOR UPDATE)
      await tx.$queryRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', userId);

      let existingSlots: AccountProductSubscription[] = [];
      try {
        existingSlots = await tx.accountProductSubscription.findMany({
          where: { userId }
        });
      } catch (err: any) {
        const classification = classifyPrismaError(err);
        if (classification === 'MIGRATION_PENDING') {
          return { slots: [], legacyBackfilled: false, staleSlotsReconciled: 0 };
        }
        throw err;
      }

      let staleSlotsReconciled = 0;

      // 1. Audit status drift across all current slots
      for (const slot of existingSlots) {
        const sub = await tx.subscription.findUnique({
          where: { id: slot.subscriptionId },
          include: { plan: true }
        });

        if (!sub) {
          continue;
        }

        // Ownership and product classification integrity checks
        if (sub.userId !== userId) {
          continue; // Mismatched user ownership
        }
        if (sub.plan) {
          const planType = sub.plan.productType;
          if (slot.productType === ProductType.STORAGE && planType !== ProductType.STORAGE) {
            continue; // Mismatched plan productType
          }
          if (slot.productType === ProductType.CAMERA && planType !== ProductType.CAMERA) {
            continue; // Mismatched plan productType
          }
          if (slot.productType === ProductType.UNIFIED_PRO && planType !== ProductType.UNIFIED_PRO) {
            continue; // Mismatched plan productType
          }
        }

        if (sub.status !== slot.status) {
          await tx.accountProductSubscription.update({
            where: { id: slot.id },
            data: { status: sub.status, updatedAt: new Date() }
          });
          slot.status = sub.status;
          staleSlotsReconciled++;
        }
      }

      // 2. Check if STORAGE slot is missing and eligible for legacy backfill
      const hasStorageSlot = existingSlots.some((s) => s.productType === ProductType.STORAGE);
      if (hasStorageSlot) {
        return { slots: existingSlots, legacyBackfilled: false, staleSlotsReconciled };
      }

      // Check legacy AccountBillingState
      const billingState = await tx.accountBillingState.findUnique({
        where: { userId },
        include: { activeSubscription: { include: { plan: true } } }
      });

      if (!billingState || !billingState.activeSubscriptionId || !billingState.activeSubscription) {
        return { slots: existingSlots, legacyBackfilled: false, staleSlotsReconciled };
      }

      const legacySub = billingState.activeSubscription;

      // Ownership and product classification safeguards
      if (legacySub.userId !== userId) {
        return { slots: existingSlots, legacyBackfilled: false, staleSlotsReconciled };
      }

      // Camera and Unified Pro plans must NEVER populate legacy Storage slots
      if (
        legacySub.plan.productType === ProductType.CAMERA ||
        legacySub.plan.productType === ProductType.UNIFIED_PRO
      ) {
        return { slots: existingSlots, legacyBackfilled: false, staleSlotsReconciled };
      }

      // Ensure the subscription is not already assigned to another slot
      const alreadyAssigned = await tx.accountProductSubscription.findUnique({
        where: { subscriptionId: legacySub.id }
      });
      if (alreadyAssigned) {
        return { slots: existingSlots, legacyBackfilled: false, staleSlotsReconciled };
      }

      // Backfill STORAGE slot
      const newSlot = await tx.accountProductSubscription.create({
        data: {
          userId,
          productType: ProductType.STORAGE,
          subscriptionId: legacySub.id,
          status: legacySub.status
        }
      });

      return {
        slots: [...existingSlots, newSlot],
        legacyBackfilled: true,
        staleSlotsReconciled
      };
    };

    try {
      if (externalTx) {
        return await execute(externalTx);
      } else {
        return await prisma.$transaction(execute);
      }
    } catch (err: any) {
      const classification = classifyPrismaError(err);
      if (classification === 'CONNECTION_FAILURE') {
        throw new DatabaseError(`Database connection unavailable during product slot reconciliation`);
      }
      if (classification === 'TRANSACTION_CONFLICT') {
        throw new ConflictError(`Database deadlock or write conflict detected during product slot reconciliation`);
      }
      throw err;
    }
  }
}
