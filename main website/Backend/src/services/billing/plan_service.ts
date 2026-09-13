import { prisma } from '../../config/database.js';
import { Plan, PlanPrice, BillingInterval, CurrencyCode, Prisma } from '@prisma/client';
import { EntitlementService, ResolvedEntitlements } from './entitlement_service.js';

export interface PlanPriceDTO {
  id: string;
  currency: CurrencyCode;
  amountMinorUnits: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  version: number;
}

export interface PlanDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  interval: BillingInterval;
  intervalCount: number;
  serverLimit: number;
  priorityRelay: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  prices: PlanPriceDTO[];
  entitlements?: {
    maxServers: number;
    priorityRelay: boolean;
    [key: string]: number | boolean;
  };
}

export interface InitialCatalogPlan {
  code: string;
  name: string;
  description: string;
  interval: BillingInterval;
  intervalCount: number;
  serverLimit: number;
  priorityRelay: boolean;
  prices: {
    currency: CurrencyCode;
    amountMinorUnits: number;
  }[];
}

export const APPROVED_INITIAL_CATALOG: InitialCatalogPlan[] = [
  {
    code: 'FREE',
    name: 'Free',
    description: 'Start with one Android phone for free. Zero recurring storage fees.',
    interval: BillingInterval.FREE,
    intervalCount: 1,
    serverLimit: 1,
    priorityRelay: false,
    prices: [
      { currency: CurrencyCode.INR, amountMinorUnits: 0 },
      { currency: CurrencyCode.USD, amountMinorUnits: 0 }
    ]
  },
  {
    code: 'PRO_MONTHLY',
    name: 'Pro Monthly',
    description: 'Multi-server personal cloud with flexible month-to-month billing. Manage up to 5 Android storage nodes.',
    interval: BillingInterval.MONTHLY,
    intervalCount: 1,
    serverLimit: 5,
    priorityRelay: true,
    prices: [
      { currency: CurrencyCode.INR, amountMinorUnits: 4900 },
      { currency: CurrencyCode.USD, amountMinorUnits: 99 }
    ]
  },
  {
    code: 'PRO_YEARLY',
    name: 'Pro Yearly',
    description: 'Annual plan with substantial savings. Best value for managing up to 5 Android storage nodes year-round.',
    interval: BillingInterval.YEARLY,
    intervalCount: 1,
    serverLimit: 5,
    priorityRelay: true,
    prices: [
      { currency: CurrencyCode.INR, amountMinorUnits: 50000 },
      { currency: CurrencyCode.USD, amountMinorUnits: 999 }
    ]
  }
];

export class PlanService {
  /**
   * Idempotently seeds the approved commercial catalog (Free, Pro Monthly, Pro Yearly with INR and USD prices)
   * and seeds the authoritative entitlement definitions and mappings.
   * Safe to run repeatedly at startup or via CLI.
   */
  static async seedInitialCatalog(logger?: { info: (msg: string) => void; warn: (msg: string) => void }): Promise<void> {
    for (const item of APPROVED_INITIAL_CATALOG) {
      // 1. Upsert Plan
      const plan = await prisma.plan.upsert({
        where: { code: item.code },
        update: {
          name: item.name,
          description: item.description,
          interval: item.interval,
          intervalCount: item.intervalCount,
          serverLimit: item.serverLimit,
          priorityRelay: item.priorityRelay,
          isActive: true
        },
        create: {
          code: item.code,
          name: item.name,
          description: item.description,
          interval: item.interval,
          intervalCount: item.intervalCount,
          serverLimit: item.serverLimit,
          priorityRelay: item.priorityRelay,
          isActive: true
        }
      });

      // 2. Upsert initial prices for each currency
      for (const priceItem of item.prices) {
        const existingPrice = await prisma.planPrice.findFirst({
          where: {
            planId: plan.id,
            currency: priceItem.currency,
            version: 1
          }
        });

        if (!existingPrice) {
          await prisma.planPrice.create({
            data: {
              planId: plan.id,
              currency: priceItem.currency,
              amountMinorUnits: priceItem.amountMinorUnits,
              version: 1,
              isActive: true,
              effectiveFrom: new Date('2026-09-01T00:00:00.000Z')
            }
          });
        }
      }
    }

    // 3. Seed Entitlement definitions and mappings
    await EntitlementService.seedInitialEntitlements(logger as any);

    logger?.info('📦 Authoritative Plan Catalog and Entitlements initialized / verified successfully.');
  }

  /**
   * Retrieves all active plans with their current active price records and resolved entitlements.
   */
  static async getActivePlans(currency?: CurrencyCode): Promise<PlanDTO[]> {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { serverLimit: 'asc' },
      include: {
        prices: {
          where: {
            isActive: true,
            ...(currency ? { currency } : {})
          },
          orderBy: { version: 'desc' }
        },
        entitlements: {
          include: {
            entitlementDefinition: true
          }
        }
      }
    });

    return plans.map(p => {
      let maxServers = p.serverLimit ?? 1;
      let priorityRelay = p.priorityRelay ?? false;
      const rawEntitlements: Record<string, number | boolean> = {
        MAX_SERVERS: maxServers,
        PRIORITY_RELAY: priorityRelay
      };

      for (const ent of p.entitlements || []) {
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
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        interval: p.interval,
        intervalCount: p.intervalCount,
        serverLimit: p.serverLimit,
        priorityRelay: p.priorityRelay,
        isActive: p.isActive,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        prices: p.prices.map(pr => ({
          id: pr.id,
          currency: pr.currency,
          amountMinorUnits: pr.amountMinorUnits,
          effectiveFrom: pr.effectiveFrom,
          effectiveTo: pr.effectiveTo,
          isActive: pr.isActive,
          version: pr.version
        })),
        entitlements: {
          maxServers,
          priorityRelay,
          ...rawEntitlements
        }
      };
    });
  }

  /**
   * Retrieves a specific plan by unique code (e.g. FREE, PRO_MONTHLY, PRO_YEARLY) with resolved entitlements.
   */
  static async getPlanByCode(code: string, currency?: CurrencyCode): Promise<PlanDTO | null> {
    const plan = await prisma.plan.findUnique({
      where: { code },
      include: {
        prices: {
          where: {
            isActive: true,
            ...(currency ? { currency } : {})
          },
          orderBy: { version: 'desc' }
        },
        entitlements: {
          include: {
            entitlementDefinition: true
          }
        }
      }
    });

    if (!plan) return null;

    let maxServers = plan.serverLimit ?? 1;
    let priorityRelay = plan.priorityRelay ?? false;
    const rawEntitlements: Record<string, number | boolean> = {
      MAX_SERVERS: maxServers,
      PRIORITY_RELAY: priorityRelay
    };

    for (const ent of plan.entitlements || []) {
      const entCode = ent.entitlementDefinition.code;
      if (entCode === 'MAX_SERVERS' && ent.intValue !== null && ent.intValue !== undefined) {
        maxServers = ent.intValue;
        rawEntitlements.MAX_SERVERS = ent.intValue;
      } else if (entCode === 'PRIORITY_RELAY' && ent.boolValue !== null && ent.boolValue !== undefined) {
        priorityRelay = ent.boolValue;
        rawEntitlements.PRIORITY_RELAY = ent.boolValue;
      }
    }

    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      interval: plan.interval,
      intervalCount: plan.intervalCount,
      serverLimit: plan.serverLimit,
      priorityRelay: plan.priorityRelay,
      isActive: plan.isActive,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      prices: plan.prices.map(pr => ({
        id: pr.id,
        currency: pr.currency,
        amountMinorUnits: pr.amountMinorUnits,
        effectiveFrom: pr.effectiveFrom,
        effectiveTo: pr.effectiveTo,
        isActive: pr.isActive,
        version: pr.version
      })),
      entitlements: {
        maxServers,
        priorityRelay,
        ...rawEntitlements
      }
    };
  }


  /**
   * Introduces a new immutable PlanPrice version without mutating historical price records.
   */
  static async createPriceVersion(
    planId: string,
    currency: CurrencyCode,
    amountMinorUnits: number,
    effectiveFrom: Date = new Date()
  ): Promise<PlanPriceDTO> {
    if (!Number.isInteger(amountMinorUnits) || amountMinorUnits < 0) {
      throw new Error('Invalid monetary amount: amountMinorUnits must be a non-negative integer.');
    }

    return await prisma.$transaction(async (tx) => {
      // Find latest version for this plan + currency
      const latestPrice = await tx.planPrice.findFirst({
        where: { planId, currency },
        orderBy: { version: 'desc' }
      });

      const nextVersion = (latestPrice?.version || 0) + 1;

      // Close previous active price validity window
      if (latestPrice && latestPrice.isActive) {
        await tx.planPrice.update({
          where: { id: latestPrice.id },
          data: {
            isActive: false,
            effectiveTo: effectiveFrom
          }
        });
      }

      // Create new immutable price version
      const newPrice = await tx.planPrice.create({
        data: {
          planId,
          currency,
          amountMinorUnits,
          version: nextVersion,
          effectiveFrom,
          isActive: true
        }
      });

      return {
        id: newPrice.id,
        currency: newPrice.currency,
        amountMinorUnits: newPrice.amountMinorUnits,
        effectiveFrom: newPrice.effectiveFrom,
        effectiveTo: newPrice.effectiveTo,
        isActive: newPrice.isActive,
        version: newPrice.version
      };
    });
  }

  /**
   * Non-destructively deactivates a plan.
   */
  static async deactivatePlan(code: string): Promise<void> {
    await prisma.plan.update({
      where: { code },
      data: { isActive: false }
    });
  }
}
