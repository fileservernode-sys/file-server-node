import { prisma } from '../../../../config/database.js';
import {
  PaymentProvider,
  PaymentEnvironment,
  BillingProviderPlanMapping,
  PlanPrice,
  Plan
} from '@prisma/client';
import { RazorpayClient } from './razorpay_client.js';
import { RazorpayPlanCatalogService, RazorpayPlanResponse } from './razorpay_plan_catalog_service.js';
import { RazorpayProviderError } from './razorpay_error.js';
import { NotFoundError, ValidationError } from '../../../../errors/app-error.js';

export type ReconciliationStatus =
  | 'VERIFIED'
  | 'MISSING_PROVIDER_PLAN'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'PERIOD_MISMATCH'
  | 'INTERVAL_MISMATCH'
  | 'PLAN_ID_MISMATCH'
  | 'ENVIRONMENT_MISMATCH'
  | 'LOCAL_MAPPING_CONFLICT'
  | 'CATALOG_INCOMPLETE'
  | 'ORPHAN_PROVIDER_PLAN'
  | 'UNRELATED_PROVIDER_PLAN';

export interface MappingVerificationResult {
  status: ReconciliationStatus;
  isVerified: boolean;
  mappingId?: string;
  planPriceId?: string;
  providerPlanId?: string;
  environment: PaymentEnvironment;
  discrepancies: string[];
  localState?: {
    planCode: string;
    currency: string;
    amountMinorUnits: number;
    period: string;
    interval: number;
    priceVersion: number;
  };
  providerState?: {
    id: string;
    currency?: string;
    amount?: number;
    period?: string;
    interval?: number;
    notes?: Record<string, string>;
  };
  checkedAt: Date;
}

export interface CatalogReconciliationResult {
  environment: PaymentEnvironment;
  isClean: boolean;
  totalLocalPrices: number;
  totalLocalMappings: number;
  totalProviderPlans: number;
  verifiedCount: number;
  mismatchedCount: number;
  missingCount: number;
  orphanCount: number;
  unrelatedCount: number;
  verifications: MappingVerificationResult[];
  orphans: {
    providerPlanId: string;
    notes?: Record<string, string>;
    item?: any;
    period?: string;
    interval?: number;
  }[];
  unrelatedPlans: {
    providerPlanId: string;
  }[];
  missingLocalMappings: string[];
  reconciledAt: Date;
}

export interface ReconciliationOptions {
  client?: RazorpayClient;
  environment?: PaymentEnvironment;
  fetchRemotePlans?: boolean;
  logger?: {
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

export class RazorpayCatalogReconciliationService {
  /**
   * Verifies an individual local mapping record against the live Razorpay API.
   * 
   * Strict Read-Only Invariant:
   * Performs ZERO mutations to the database and ZERO mutations/creations on Razorpay.
   */
  public static async verifyMapping(
    mappingOrId: BillingProviderPlanMapping | string,
    options?: ReconciliationOptions
  ): Promise<MappingVerificationResult> {
    const environment = options?.environment || RazorpayPlanCatalogService.resolvePaymentEnvironment();
    const client = options?.client || new RazorpayClient();

    let mapping: (BillingProviderPlanMapping & { plan?: Plan; planPrice?: PlanPrice }) | null = null;

    if (typeof mappingOrId === 'string') {
      mapping = await prisma.billingProviderPlanMapping.findFirst({
        where: {
          OR: [
            { id: mappingOrId },
            { providerPlanId: mappingOrId }
          ]
        },
        include: { plan: true, planPrice: true }
      });
    } else {
      mapping = await prisma.billingProviderPlanMapping.findUnique({
        where: { id: mappingOrId.id },
        include: { plan: true, planPrice: true }
      });
    }

    if (!mapping) {
      return {
        status: 'LOCAL_MAPPING_CONFLICT',
        isVerified: false,
        environment,
        discrepancies: ['Local mapping record not found in database'],
        checkedAt: new Date()
      };
    }

    const localPlanPrice = mapping.planPrice || (await prisma.planPrice.findUnique({
      where: { id: mapping.planPriceId },
      include: { plan: true }
    }));

    if (!localPlanPrice) {
      return {
        status: 'LOCAL_MAPPING_CONFLICT',
        isVerified: false,
        mappingId: mapping.id,
        planPriceId: mapping.planPriceId,
        providerPlanId: mapping.providerPlanId,
        environment: mapping.environment,
        discrepancies: [`Referenced local PlanPrice '${mapping.planPriceId}' not found`],
        checkedAt: new Date()
      };
    }

    const planCode = (localPlanPrice as any).plan?.code || mapping.plan?.code || 'UNKNOWN';

    const localState = {
      planCode,
      currency: localPlanPrice.currency,
      amountMinorUnits: localPlanPrice.amountMinorUnits,
      period: mapping.period,
      interval: mapping.interval,
      priceVersion: localPlanPrice.version
    };

    // 1. Check local consistency between mapping and PlanPrice
    const localDiscrepancies: string[] = [];
    if (mapping.currency !== localPlanPrice.currency) {
      localDiscrepancies.push(
        `Mapping currency '${mapping.currency}' does not match PlanPrice currency '${localPlanPrice.currency}'`
      );
    }
    if (mapping.amountMinorUnits !== localPlanPrice.amountMinorUnits) {
      localDiscrepancies.push(
        `Mapping amount '${mapping.amountMinorUnits}' does not match PlanPrice amount '${localPlanPrice.amountMinorUnits}'`
      );
    }
    if (mapping.priceVersion !== localPlanPrice.version) {
      localDiscrepancies.push(
        `Mapping priceVersion '${mapping.priceVersion}' does not match PlanPrice version '${localPlanPrice.version}'`
      );
    }

    if (localDiscrepancies.length > 0) {
      return {
        status: 'LOCAL_MAPPING_CONFLICT',
        isVerified: false,
        mappingId: mapping.id,
        planPriceId: mapping.planPriceId,
        providerPlanId: mapping.providerPlanId,
        environment: mapping.environment,
        discrepancies: localDiscrepancies,
        localState,
        checkedAt: new Date()
      };
    }

    // 2. Fetch remote Razorpay plan
    let providerPlan: RazorpayPlanResponse | null = null;
    try {
      providerPlan = await client.fetchPlan(mapping.providerPlanId);
    } catch (err: any) {
      if (err instanceof RazorpayProviderError && (err.statusCode === 404 || err.message.includes('404'))) {
        return {
          status: 'MISSING_PROVIDER_PLAN',
          isVerified: false,
          mappingId: mapping.id,
          planPriceId: mapping.planPriceId,
          providerPlanId: mapping.providerPlanId,
          environment: mapping.environment,
          discrepancies: [`Provider plan '${mapping.providerPlanId}' does not exist on Razorpay (404 Not Found)`],
          localState,
          checkedAt: new Date()
        };
      }
      throw err;
    }

    if (!providerPlan || !providerPlan.id) {
      return {
        status: 'MISSING_PROVIDER_PLAN',
        isVerified: false,
        mappingId: mapping.id,
        planPriceId: mapping.planPriceId,
        providerPlanId: mapping.providerPlanId,
        environment: mapping.environment,
        discrepancies: [`Provider plan response missing valid ID`],
        localState,
        checkedAt: new Date()
      };
    }

    const providerState = {
      id: providerPlan.id,
      currency: providerPlan.item?.currency,
      amount: providerPlan.item?.amount,
      period: providerPlan.period,
      interval: providerPlan.interval,
      notes: providerPlan.notes
    };

    // 3. Reconcile provider attributes against local authoritative state
    const discrepancies: string[] = [];
    let mismatchStatus: ReconciliationStatus | null = null;

    if (providerPlan.id !== mapping.providerPlanId) {
      discrepancies.push(`Provider plan ID '${providerPlan.id}' does not match mapped ID '${mapping.providerPlanId}'`);
      if (!mismatchStatus) mismatchStatus = 'PLAN_ID_MISMATCH';
    }

    if (providerPlan.item?.currency !== localPlanPrice.currency) {
      discrepancies.push(`Currency mismatch: provider has '${providerPlan.item?.currency}', expected '${localPlanPrice.currency}'`);
      if (!mismatchStatus) mismatchStatus = 'CURRENCY_MISMATCH';
    }

    if (providerPlan.item?.amount !== localPlanPrice.amountMinorUnits) {
      discrepancies.push(`Amount mismatch: provider has ${providerPlan.item?.amount}, expected ${localPlanPrice.amountMinorUnits}`);
      if (!mismatchStatus) mismatchStatus = 'AMOUNT_MISMATCH';
    }

    if (providerPlan.period !== mapping.period) {
      discrepancies.push(`Period mismatch: provider has '${providerPlan.period}', expected '${mapping.period}'`);
      if (!mismatchStatus) mismatchStatus = 'PERIOD_MISMATCH';
    }

    if (providerPlan.interval !== mapping.interval) {
      discrepancies.push(`Interval mismatch: provider has ${providerPlan.interval}, expected ${mapping.interval}`);
      if (!mismatchStatus) mismatchStatus = 'INTERVAL_MISMATCH';
    }

    if (discrepancies.length > 0) {
      return {
        status: mismatchStatus || 'AMOUNT_MISMATCH',
        isVerified: false,
        mappingId: mapping.id,
        planPriceId: mapping.planPriceId,
        providerPlanId: mapping.providerPlanId,
        environment: mapping.environment,
        discrepancies,
        localState,
        providerState,
        checkedAt: new Date()
      };
    }

    return {
      status: 'VERIFIED',
      isVerified: true,
      mappingId: mapping.id,
      planPriceId: mapping.planPriceId,
      providerPlanId: mapping.providerPlanId,
      environment: mapping.environment,
      discrepancies: [],
      localState,
      providerState,
      checkedAt: new Date()
    };
  }

  /**
   * Verifies an internal PlanPrice against its mapped Razorpay Plan.
   */
  public static async verifyPlanPrice(
    planPriceId: string,
    options?: ReconciliationOptions
  ): Promise<MappingVerificationResult> {
    if (!planPriceId) {
      throw new ValidationError('planPriceId is required');
    }

    const planPrice = await prisma.planPrice.findUnique({
      where: { id: planPriceId },
      include: { plan: true }
    });

    if (!planPrice) {
      throw new NotFoundError(`PlanPrice '${planPriceId}' not found`);
    }

    if (planPrice.plan.code === 'FREE') {
      throw new ValidationError('FREE plan tier has no external provider mapping');
    }

    const environment = options?.environment || RazorpayPlanCatalogService.resolvePaymentEnvironment();

    const mapping = await prisma.billingProviderPlanMapping.findUnique({
      where: {
        provider_environment_planPriceId: {
          provider: PaymentProvider.RAZORPAY,
          environment,
          planPriceId: planPrice.id
        }
      },
      include: { plan: true, planPrice: true }
    });

    if (!mapping) {
      return {
        status: 'CATALOG_INCOMPLETE',
        isVerified: false,
        planPriceId: planPrice.id,
        environment,
        discrepancies: [`No local Razorpay mapping found for PlanPrice '${planPrice.id}' (${planPrice.plan.code} ${planPrice.currency}) in environment '${environment}'`],
        localState: {
          planCode: planPrice.plan.code,
          currency: planPrice.currency,
          amountMinorUnits: planPrice.amountMinorUnits,
          period: RazorpayPlanCatalogService.getPeriodFromInterval(planPrice.plan.interval),
          interval: planPrice.plan.intervalCount || 1,
          priceVersion: planPrice.version
        },
        checkedAt: new Date()
      };
    }

    return this.verifyMapping(mapping, options);
  }

  /**
   * Full catalog reconciliation between ZdexCloud internal catalog and Razorpay.
   * 
   * Strict Invariant:
   * Read-only. Does NOT alter database or mutate Razorpay plans.
   */
  public static async reconcileCatalog(
    environment?: PaymentEnvironment,
    options?: ReconciliationOptions
  ): Promise<CatalogReconciliationResult> {
    const env = environment || options?.environment || RazorpayPlanCatalogService.resolvePaymentEnvironment();
    const client = options?.client || new RazorpayClient();

    // 1. Fetch all local active paid PlanPrices
    const localPrices = await prisma.planPrice.findMany({
      where: {
        isActive: true,
        plan: {
          isActive: true,
          code: { not: 'FREE' }
        }
      },
      include: { plan: true },
      orderBy: [{ plan: { code: 'asc' } }, { currency: 'asc' }]
    });

    // 2. Fetch all local mappings for Razorpay + environment
    const localMappings = await prisma.billingProviderPlanMapping.findMany({
      where: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        isActive: true
      },
      include: { plan: true, planPrice: true }
    });

    const mappedPriceIdSet = new Set(localMappings.map((m) => m.planPriceId));
    const missingLocalMappings: string[] = [];

    for (const price of localPrices) {
      if (!mappedPriceIdSet.has(price.id)) {
        missingLocalMappings.push(`${price.plan.code} (${price.currency} v${price.version})`);
      }
    }

    // 3. Verify each local mapping
    const verifications: MappingVerificationResult[] = [];
    let verifiedCount = 0;
    let mismatchedCount = 0;
    let missingCount = 0;

    for (const mapping of localMappings) {
      const result = await this.verifyMapping(mapping, { ...options, client, environment: env });
      verifications.push(result);

      if (result.isVerified) {
        verifiedCount++;
      } else if (result.status === 'MISSING_PROVIDER_PLAN') {
        missingCount++;
      } else {
        mismatchedCount++;
      }
    }

    // 4. Remote scan for orphan and unrelated plans (if remote fetch enabled)
    const orphans: CatalogReconciliationResult['orphans'] = [];
    const unrelatedPlans: CatalogReconciliationResult['unrelatedPlans'] = [];
    let totalProviderPlans = 0;

    if (options?.fetchRemotePlans !== false) {
      try {
        const remotePlans = await client.fetchAllPlans();
        totalProviderPlans = remotePlans.length;

        const localProviderPlanIds = new Set(localMappings.map((m) => m.providerPlanId));

        for (const rPlan of remotePlans) {
          const notes = rPlan.notes || {};
          const isZdexCloudPlan = Boolean(
            notes.zdexcloud_plan_price_id ||
            notes.zdexcloud_plan_code ||
            notes.zdexcloud_environment ||
            (rPlan.item?.name && rPlan.item.name.startsWith('ZdexCloud'))
          );

          if (!isZdexCloudPlan) {
            unrelatedPlans.push({ providerPlanId: rPlan.id });
            continue;
          }

          // It is a ZdexCloud-tagged plan. Check if we know it locally in this environment.
          if (!localProviderPlanIds.has(rPlan.id)) {
            orphans.push({
              providerPlanId: rPlan.id,
              notes: rPlan.notes,
              item: rPlan.item,
              period: rPlan.period,
              interval: rPlan.interval
            });
          }
        }
      } catch (err: any) {
        options?.logger?.warn(`[RazorpayReconciliation] Failed to fetch remote plans collection: ${err.message}`);
      }
    }

    const isClean =
      missingLocalMappings.length === 0 &&
      mismatchedCount === 0 &&
      missingCount === 0 &&
      orphans.length === 0 &&
      verifiedCount === localPrices.length;

    return {
      environment: env,
      isClean,
      totalLocalPrices: localPrices.length,
      totalLocalMappings: localMappings.length,
      totalProviderPlans,
      verifiedCount,
      mismatchedCount,
      missingCount,
      orphanCount: orphans.length,
      unrelatedCount: unrelatedPlans.length,
      verifications,
      orphans,
      unrelatedPlans,
      missingLocalMappings,
      reconciledAt: new Date()
    };
  }
}
