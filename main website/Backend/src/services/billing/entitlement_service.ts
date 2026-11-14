import { FastifyBaseLogger } from 'fastify';
import { prisma } from '../../config/database.js';
import {
  EntitlementCode,
  EntitlementValueType,
  ProductType,
  BillingStatus
} from '@prisma/client';
import { BillingStateService, PAID_ENTITLED_STATUSES } from './billing_state_service.js';
import {
  AccountProductSubscriptionService,
  PopulatedProductSlot,
  classifyPrismaError
} from './account_product_subscription_service.js';
import {
  NotFoundError,
  ValidationError,
  DatabaseError,
  DeploymentMigrationPendingError
} from '../../errors/app-error.js';

export interface ResolvedEntitlements {
  planCode: string;
  maxServers: number;
  priorityRelay: boolean;
  entitlements: {
    MAX_SERVERS: number;
    PRIORITY_RELAY: boolean;
    [key: string]: number | boolean;
  };
}

export interface StorageEntitlements {
  productType: ProductType;
  planCode: string;
  status: BillingStatus;
  maxServers: number;
  priorityRelay: boolean;
  subscriptionId: string | null;
  source: 'PRODUCT_SLOT' | 'LEGACY_BILLING_STATE' | 'FREE_DEFAULT';
}

export interface CameraEntitlements {
  productType: ProductType;
  planCode: string;
  status: BillingStatus;
  maxCameras: number;
  liveStreamingEnabled: boolean;
  recordingEnabled: boolean;
  subscriptionId: string | null;
  source: 'PRODUCT_SLOT' | 'FREE_DEFAULT' | 'NONE';
}

export interface ApplicableSubscriptionInfo {
  productType: ProductType;
  subscriptionId: string;
  planCode: string;
  status: BillingStatus;
  currentPeriodEnd?: Date;
  source: 'PRODUCT_SLOT' | 'LEGACY_BILLING_STATE';
}

export interface MultiProductResolvedEntitlements extends ResolvedEntitlements {
  userId: string;
  resolvedAt: Date;
  storage: StorageEntitlements;
  camera: CameraEntitlements;
  applicableSubscriptions: ApplicableSubscriptionInfo[];
  activeProducts: ProductType[];
  isMultiProduct: boolean;
}

export const DEFAULT_FREE_ENTITLEMENTS: ResolvedEntitlements = Object.freeze({
  planCode: 'FREE',
  maxServers: 1,
  priorityRelay: false,
  entitlements: Object.freeze({
    MAX_SERVERS: 1,
    PRIORITY_RELAY: false
  })
});

export const DEFAULT_FREE_STORAGE_ENTITLEMENTS: StorageEntitlements = Object.freeze({
  productType: ProductType.STORAGE,
  planCode: 'FREE',
  status: BillingStatus.FREE,
  maxServers: 1,
  priorityRelay: false,
  subscriptionId: null,
  source: 'FREE_DEFAULT'
});

export const DEFAULT_FREE_CAMERA_ENTITLEMENTS: CameraEntitlements = Object.freeze({
  productType: ProductType.CAMERA,
  planCode: 'NONE',
  status: BillingStatus.FREE,
  maxCameras: 0,
  liveStreamingEnabled: false,
  recordingEnabled: false,
  subscriptionId: null,
  source: 'NONE'
});

// Transitional registry for testing accounts before persistent state is established
const testUserPlanRegistry = new Map<string, string>();

/**
 * Builds the canonical free multi-product entitlement payload.
 */
export function buildFreeMultiProductEntitlements(userId = ''): MultiProductResolvedEntitlements {
  return {
    ...DEFAULT_FREE_ENTITLEMENTS,
    entitlements: {
      MAX_SERVERS: 1,
      PRIORITY_RELAY: false,
      MAX_CAMERAS: 0,
      CAMERA_STREAMING: false,
      CAMERA_RECORDING: false
    },
    userId,
    resolvedAt: new Date(),
    storage: { ...DEFAULT_FREE_STORAGE_ENTITLEMENTS },
    camera: { ...DEFAULT_FREE_CAMERA_ENTITLEMENTS },
    applicableSubscriptions: [],
    activeProducts: [ProductType.STORAGE],
    isMultiProduct: false
  };
}

export class EntitlementService {
  /**
   * Idempotently seeds initial entitlement definitions and plan allocations into the database.
   */
  static async seedInitialEntitlements(logger?: FastifyBaseLogger): Promise<void> {
    const definitions = [
      {
        code: 'MAX_SERVERS' as EntitlementCode,
        name: 'Maximum Active Servers',
        description: 'Maximum number of concurrent active server instances allowed per account.',
        valueType: 'INTEGER' as EntitlementValueType
      },
      {
        code: 'PRIORITY_RELAY' as EntitlementCode,
        name: 'Priority Relay Routing',
        description: 'Enables high-throughput priority tunnel routing over the relay gateway network.',
        valueType: 'BOOLEAN' as EntitlementValueType
      }
    ];

    const defMap = new Map<string, string>();

    for (const def of definitions) {
      const record = await prisma.entitlementDefinition.upsert({
        where: { code: def.code },
        update: {
          name: def.name,
          description: def.description,
          valueType: def.valueType
        },
        create: {
          code: def.code,
          name: def.name,
          description: def.description,
          valueType: def.valueType
        }
      });
      defMap.set(def.code, record.id);
    }

    // Ensure plans exist in DB
    const plans = await prisma.plan.findMany();
    const planByCode = new Map(plans.map((p) => [p.code, p]));

    const allocations: Array<{
      planCode: string;
      allocations: Array<{
        code: EntitlementCode;
        intValue?: number | null;
        boolValue?: boolean | null;
      }>;
    }> = [
      {
        planCode: 'FREE',
        allocations: [
          { code: 'MAX_SERVERS' as EntitlementCode, intValue: 1, boolValue: null },
          { code: 'PRIORITY_RELAY' as EntitlementCode, intValue: null, boolValue: false }
        ]
      },
      {
        planCode: 'PRO_MONTHLY',
        allocations: [
          { code: 'MAX_SERVERS' as EntitlementCode, intValue: 5, boolValue: null },
          { code: 'PRIORITY_RELAY' as EntitlementCode, intValue: null, boolValue: true }
        ]
      },
      {
        planCode: 'PRO_YEARLY',
        allocations: [
          { code: 'MAX_SERVERS' as EntitlementCode, intValue: 5, boolValue: null },
          { code: 'PRIORITY_RELAY' as EntitlementCode, intValue: null, boolValue: true }
        ]
      }
    ];

    for (const item of allocations) {
      const plan = planByCode.get(item.planCode);
      if (!plan) continue;

      for (const alloc of item.allocations) {
        const defId = defMap.get(alloc.code);
        if (!defId) continue;

        await prisma.planEntitlement.upsert({
          where: {
            planId_entitlementDefinitionId: {
              planId: plan.id,
              entitlementDefinitionId: defId
            }
          },
          update: {
            intValue: alloc.intValue !== undefined ? alloc.intValue : null,
            boolValue: alloc.boolValue !== undefined ? alloc.boolValue : null
          },
          create: {
            planId: plan.id,
            entitlementDefinitionId: defId,
            intValue: alloc.intValue !== undefined ? alloc.intValue : null,
            boolValue: alloc.boolValue !== undefined ? alloc.boolValue : null
          }
        });
      }
    }

    if (logger) {
      logger.info('Authoritative entitlement catalog successfully initialized');
    }
  }

  /**
   * Resolves the authoritative technical capabilities and limits for a specific commercial plan code.
   * Preserved for 100% backward compatibility with single-plan callers.
   */
  static async resolvePlanEntitlements(planCode: string): Promise<ResolvedEntitlements> {
    const normalizedCode = planCode?.trim()?.toUpperCase();

    const plan = await prisma.plan.findUnique({
      where: { code: normalizedCode },
      include: {
        entitlements: {
          include: {
            entitlementDefinition: true
          }
        }
      }
    });

    if (!plan || !plan.isActive) {
      return { ...DEFAULT_FREE_ENTITLEMENTS };
    }

    let maxServers = plan.serverLimit ?? 1;
    let priorityRelay = plan.priorityRelay ?? false;
    const rawEntitlements: Record<string, number | boolean> = {
      MAX_SERVERS: maxServers,
      PRIORITY_RELAY: priorityRelay
    };

    for (const ent of plan.entitlements) {
      const code = ent.entitlementDefinition.code;
      if (code === 'MAX_SERVERS' && ent.intValue !== null && ent.intValue !== undefined) {
        maxServers = ent.intValue;
        rawEntitlements.MAX_SERVERS = ent.intValue;
      } else if (code === 'PRIORITY_RELAY' && ent.boolValue !== null && ent.boolValue !== undefined) {
        priorityRelay = ent.boolValue;
        rawEntitlements.PRIORITY_RELAY = ent.boolValue;
      }
    }

    return {
      planCode: plan.code,
      maxServers,
      priorityRelay,
      entitlements: {
        MAX_SERVERS: maxServers,
        PRIORITY_RELAY: priorityRelay,
        ...rawEntitlements
      }
    };
  }

  /**
   * Resolves authoritative multi-product technical capabilities and limits for an account.
   *
   * Features:
   * 1. Multi-Product Entitlement Resolution: Resolves Storage and Camera domains independently.
   * 2. Union-Max Aggregation:
   *    - Numeric quotas: effective quota = Math.max(eligible values)
   *    - Boolean capabilities: effective capability = logical OR
   *    - Missing Camera configuration strictly defaults to 0 cameras / disabled (never unlimited).
   * 3. Product Isolation:
   *    - Storage plans cannot increase Camera quotas.
   *    - Camera plans cannot increase Storage server limits.
   *    - Unified Pro contributes to both product domains according to its configured entitlements.
   * 4. Legacy Compatibility Fallback:
   *    - If no Storage slot is found in AccountProductSubscription, falls back to AccountBillingState.activeSubscriptionId.
   *    - Ensures existing customers with legacy subscriptions retain full Storage entitlements.
   *    - Deduplicates subscriptions so none are counted twice.
   * 5. Top-Level Backward Compatibility:
   *    - Exposes legacy fields (planCode, maxServers, priorityRelay, entitlements) so existing
   *      callers (device.ts, server.ts, billing.ts) continue functioning seamlessly without modification.
   */
  static async resolveUserEntitlements(userId: string): Promise<MultiProductResolvedEntitlements> {
    if (!userId) {
      return buildFreeMultiProductEntitlements('');
    }

    // 1. Check transitional unit test mock override
    const testOverridePlan = testUserPlanRegistry.get(userId);
    if (testOverridePlan) {
      const planEnt = await this.resolvePlanEntitlements(testOverridePlan);
      const isPro = testOverridePlan.startsWith('PRO');
      return {
        ...planEnt,
        userId,
        resolvedAt: new Date(),
        storage: {
          productType: ProductType.STORAGE,
          planCode: planEnt.planCode,
          status: isPro ? BillingStatus.ACTIVE : BillingStatus.FREE,
          maxServers: planEnt.maxServers,
          priorityRelay: planEnt.priorityRelay,
          subscriptionId: null,
          source: isPro ? 'PRODUCT_SLOT' : 'FREE_DEFAULT'
        },
        camera: { ...DEFAULT_FREE_CAMERA_ENTITLEMENTS },
        applicableSubscriptions: isPro
          ? [
              {
                productType: ProductType.STORAGE,
                subscriptionId: 'mock_test_sub',
                planCode: planEnt.planCode,
                status: BillingStatus.ACTIVE,
                source: 'PRODUCT_SLOT'
              }
            ]
          : [],
        activeProducts: isPro ? [ProductType.STORAGE] : [],
        isMultiProduct: false
      };
    }

    // 2. Retrieve multi-product subscription slots
    const productSlots: PopulatedProductSlot[] =
      await AccountProductSubscriptionService.getProductSlots(userId);

    // Track deduplicated subscription IDs to ensure zero double-counting
    const evaluatedSubscriptionIds = new Set<string>();
    const applicableSubscriptions: ApplicableSubscriptionInfo[] = [];

    // Candidate collections
    interface CandidateSubscription {
      productType: ProductType;
      subscription: any;
      plan: any;
      source: 'PRODUCT_SLOT' | 'LEGACY_BILLING_STATE';
    }

    const storageCandidates: CandidateSubscription[] = [];
    const cameraCandidates: CandidateSubscription[] = [];

    // 3. Process modern product slots
    for (const slot of productSlots) {
      if (!slot.subscription || !slot.subscription.plan) continue;

      const sub = slot.subscription;
      const plan = sub.plan;

      // Only consider subscriptions in paid entitled statuses
      if (!PAID_ENTITLED_STATUSES.has(sub.status)) {
        continue;
      }

      if (evaluatedSubscriptionIds.has(sub.id)) {
        continue;
      }
      evaluatedSubscriptionIds.add(sub.id);

      applicableSubscriptions.push({
        productType: slot.productType,
        subscriptionId: sub.id,
        planCode: plan.code,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        source: 'PRODUCT_SLOT'
      });

      if (slot.productType === ProductType.STORAGE) {
        storageCandidates.push({
          productType: ProductType.STORAGE,
          subscription: sub,
          plan,
          source: 'PRODUCT_SLOT'
        });
      } else if (slot.productType === ProductType.CAMERA) {
        cameraCandidates.push({
          productType: ProductType.CAMERA,
          subscription: sub,
          plan,
          source: 'PRODUCT_SLOT'
        });
      } else if (slot.productType === ProductType.UNIFIED_PRO) {
        // Unified Pro contributes to both product domains
        storageCandidates.push({
          productType: ProductType.UNIFIED_PRO,
          subscription: sub,
          plan,
          source: 'PRODUCT_SLOT'
        });
        cameraCandidates.push({
          productType: ProductType.UNIFIED_PRO,
          subscription: sub,
          plan,
          source: 'PRODUCT_SLOT'
        });
      }
    }

    // 4. Legacy Compatibility Fallback:
    // If no Storage slot was populated from modern slots, check legacy AccountBillingState
    const hasActiveStorageCandidate = storageCandidates.length > 0;
    if (!hasActiveStorageCandidate) {
      try {
        const legacyActiveSub = await BillingStateService.getActiveSubscription(userId);
        if (legacyActiveSub && legacyActiveSub.plan) {
          // Verify that this subscription wasn't already evaluated
          if (!evaluatedSubscriptionIds.has(legacyActiveSub.id)) {
            evaluatedSubscriptionIds.add(legacyActiveSub.id);

            // Camera subscriptions must never be populated into the legacy Storage pointer
            if (legacyActiveSub.plan.productType !== ProductType.CAMERA) {
              applicableSubscriptions.push({
                productType: ProductType.STORAGE,
                subscriptionId: legacyActiveSub.id,
                planCode: legacyActiveSub.plan.code,
                status: legacyActiveSub.status,
                currentPeriodEnd: legacyActiveSub.currentPeriodEnd,
                source: 'LEGACY_BILLING_STATE'
              });

              storageCandidates.push({
                productType: ProductType.STORAGE,
                subscription: legacyActiveSub,
                plan: legacyActiveSub.plan,
                source: 'LEGACY_BILLING_STATE'
              });
            }
          }
        }
      } catch (e: any) {
        const classification = classifyPrismaError(e);
        if (classification === 'CONNECTION_FAILURE') {
          throw new DatabaseError(
            `Database connection unavailable while retrieving legacy billing state for user '${userId}'`
          );
        }
        if (classification === 'MIGRATION_PENDING') {
          throw new DeploymentMigrationPendingError(
            `Database migration pending: table or column missing while retrieving legacy billing state for user '${userId}'`
          );
        }
        throw e;
      }
    }

    // 4.5 Zero-Subscription State Validation:
    // If no active subscriptions were found in modern slots or legacy state, verify user exists in database
    // to distinguish valid free users from non-existent accounts or database connectivity failures.
    if (storageCandidates.length === 0 && cameraCandidates.length === 0) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true }
        });
        if (!user) {
          throw new NotFoundError(`User with ID '${userId}' not found`);
        }
      } catch (err: any) {
        if (err instanceof NotFoundError) {
          throw err;
        }
        const classification = classifyPrismaError(err);
        if (classification === 'CONNECTION_FAILURE') {
          throw new DatabaseError(
            `Database connection unavailable while verifying account for user '${userId}'`
          );
        }
        if (classification === 'MIGRATION_PENDING') {
          throw new DeploymentMigrationPendingError(
            `Database migration pending while verifying account for user '${userId}'`
          );
        }
        throw err;
      }
    }

    // 5. Aggregate Storage Entitlements (Union-Max Rule)
    let maxServers = 1; // Free default
    let priorityRelay = false;
    let storagePlanCode = 'FREE';
    let storageStatus = BillingStatus.FREE;
    let storageSubId: string | null = null;
    let storageSource: StorageEntitlements['source'] = 'FREE_DEFAULT';

    if (storageCandidates.length > 0) {
      for (const candidate of storageCandidates) {
        const p = candidate.plan;
        const sub = candidate.subscription;

        // Numeric quota: max of server limits
        let candidateServerLimit = p.serverLimit ?? 1;
        if (p.entitlements) {
          for (const ent of p.entitlements) {
            const code = ent.entitlementDefinition?.code || ent.code;
            if (code === 'MAX_SERVERS' && ent.intValue != null) {
              candidateServerLimit = Math.max(candidateServerLimit, ent.intValue);
            }
          }
        }
        maxServers = Math.max(maxServers, candidateServerLimit);

        // Boolean capability: logical OR
        let candidateRelay = p.priorityRelay ?? false;
        if (p.entitlements) {
          for (const ent of p.entitlements) {
            const code = ent.entitlementDefinition?.code || ent.code;
            if (code === 'PRIORITY_RELAY' && ent.boolValue != null) {
              candidateRelay = candidateRelay || ent.boolValue;
            }
          }
        }
        priorityRelay = priorityRelay || candidateRelay;

        storagePlanCode = p.code;
        storageStatus = sub.status;
        storageSubId = sub.id;
        storageSource = candidate.source;
      }
    }

    const storageEntitlements: StorageEntitlements = {
      productType: ProductType.STORAGE,
      planCode: storagePlanCode,
      status: storageStatus,
      maxServers,
      priorityRelay,
      subscriptionId: storageSubId,
      source: storageSource
    };

    // 6. Aggregate Camera Entitlements (Union-Max Rule)
    // Note: Missing Camera configuration strictly defaults to 0 cameras / disabled (never unlimited)
    let maxCameras = 0;
    let liveStreamingEnabled = false;
    let recordingEnabled = false;
    let cameraPlanCode = 'NONE';
    let cameraStatus = BillingStatus.FREE;
    let cameraSubId: string | null = null;
    let cameraSource: CameraEntitlements['source'] = 'NONE';

    if (cameraCandidates.length > 0) {
      for (const candidate of cameraCandidates) {
        const p = candidate.plan;
        const sub = candidate.subscription;

        let candidateCamQuota = 0;
        let candidateLiveStream = false;
        let candidateRecording = false;

        if (p.entitlements) {
          for (const ent of p.entitlements) {
            const code = ent.entitlementDefinition?.code || ent.code;
            if (code === 'MAX_CAMERAS' && ent.intValue != null) {
              candidateCamQuota = Math.max(candidateCamQuota, ent.intValue);
            } else if (code === 'CAMERA_STREAMING' && ent.boolValue != null) {
              candidateLiveStream = candidateLiveStream || ent.boolValue;
            } else if (code === 'CAMERA_RECORDING' && ent.boolValue != null) {
              candidateRecording = candidateRecording || ent.boolValue;
            }
          }
        }

        // Authoritative: Camera entitlements MUST come strictly from configured PlanEntitlement data.
        // Storage serverLimit must NEVER be interpreted as a Camera limit, and unapproved commercial
        // defaults must never be invented. If unconfigured, quota remains strictly 0.

        maxCameras = Math.max(maxCameras, candidateCamQuota);
        liveStreamingEnabled = liveStreamingEnabled || candidateLiveStream;
        recordingEnabled = recordingEnabled || candidateRecording;

        cameraPlanCode = p.code;
        cameraStatus = sub.status;
        cameraSubId = sub.id;
        cameraSource = 'PRODUCT_SLOT';
      }
    }

    const cameraEntitlements: CameraEntitlements = {
      productType: ProductType.CAMERA,
      planCode: cameraPlanCode,
      status: cameraStatus,
      maxCameras,
      liveStreamingEnabled,
      recordingEnabled,
      subscriptionId: cameraSubId,
      source: cameraSource
    };

    // 7. Active Products determination
    const activeProducts: ProductType[] = [];
    if (storageEntitlements.status !== BillingStatus.FREE) {
      activeProducts.push(ProductType.STORAGE);
    }
    if (cameraEntitlements.status !== BillingStatus.FREE) {
      activeProducts.push(ProductType.CAMERA);
    }

    // 8. Build canonical MultiProductResolvedEntitlements
    // Preserves legacy top-level properties (planCode, maxServers, priorityRelay, entitlements)
    return {
      planCode: storagePlanCode !== 'FREE' ? storagePlanCode : (cameraPlanCode !== 'NONE' ? cameraPlanCode : 'FREE'),
      maxServers: storageEntitlements.maxServers,
      priorityRelay: storageEntitlements.priorityRelay,
      entitlements: {
        MAX_SERVERS: storageEntitlements.maxServers,
        PRIORITY_RELAY: storageEntitlements.priorityRelay,
        MAX_CAMERAS: cameraEntitlements.maxCameras,
        CAMERA_STREAMING: cameraEntitlements.liveStreamingEnabled,
        CAMERA_RECORDING: cameraEntitlements.recordingEnabled
      },
      userId,
      resolvedAt: new Date(),
      storage: storageEntitlements,
      camera: cameraEntitlements,
      applicableSubscriptions,
      activeProducts,
      isMultiProduct: activeProducts.length > 1
    };
  }

  /**
   * Transitional test helper to assign a plan to a user account for testing purposes.
   */
  static setTestUserPlan(userId: string, planCode: string): void {
    testUserPlanRegistry.set(userId, planCode);
  }

  /**
   * Clears transitional test user plan registry.
   */
  static clearTestUserPlans(): void {
    testUserPlanRegistry.clear();
  }
}
