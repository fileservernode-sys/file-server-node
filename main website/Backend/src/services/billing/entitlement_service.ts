import { FastifyBaseLogger } from 'fastify';
import { prisma } from '../../config/database.js';
import { EntitlementCode, EntitlementValueType } from '@prisma/client';
import { BillingStateService } from './billing_state_service.js';

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

export const DEFAULT_FREE_ENTITLEMENTS: ResolvedEntitlements = Object.freeze({
  planCode: 'FREE',
  maxServers: 1,
  priorityRelay: false,
  entitlements: Object.freeze({
    MAX_SERVERS: 1,
    PRIORITY_RELAY: false
  })
});

// Transitional registry for testing accounts before ZC-BILLING-1.3 establishes persistent AccountBillingState
const testUserPlanRegistry = new Map<string, string>();

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
   * Resolves effective technical capabilities and limits for an authenticated user account.
   * Production authority is derived from persistent AccountBillingState and active Subscription.
   */
  static async resolveUserEntitlements(userId: string): Promise<ResolvedEntitlements> {
    if (!userId) {
      return { ...DEFAULT_FREE_ENTITLEMENTS };
    }

    // Transitional check for unit test mock override if explicitly set in test context
    const testOverridePlan = testUserPlanRegistry.get(userId);
    if (testOverridePlan) {
      return await this.resolvePlanEntitlements(testOverridePlan);
    }

    // Persistent production authority: resolve from BillingStateService
    const effective = await BillingStateService.getEffectivePlan(userId);
    return await this.resolvePlanEntitlements(effective.planCode);
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