import { prisma } from '../../../../config/database.js';
import {
  BillingInterval,
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingProviderPlanMapping,
  PlanPrice,
  Plan
} from '@prisma/client';
import { config } from '../../../../config/env.js';
import { RazorpayClient } from './razorpay_client.js';
import { RazorpayProviderError } from './razorpay_error.js';
import { NotFoundError, ValidationError } from '../../../../errors/app-error.js';

export interface RazorpayPlanItemResponse {
  id?: string;
  name?: string;
  amount?: number;
  currency?: string;
  description?: string;
  active?: boolean;
}

export interface RazorpayPlanResponse {
  id: string;
  entity?: string;
  interval?: number;
  period?: string;
  item?: RazorpayPlanItemResponse;
  notes?: Record<string, string>;
  created_at?: number;
}

export interface SyncOptions {
  client?: RazorpayClient;
  environment?: PaymentEnvironment;
  logger?: { info: (msg: string, ...args: any[]) => void; warn: (msg: string, ...args: any[]) => void };
}

export class RazorpayPlanCatalogService {
  /**
   * Resolves the current payment environment (TEST or LIVE) from configuration or key prefix.
   */
  public static resolvePaymentEnvironment(keyIdOverride?: string): PaymentEnvironment {
    const keyId = keyIdOverride !== undefined ? keyIdOverride : config.RAZORPAY_KEY_ID;
    if (keyId && keyId.startsWith('rzp_live_')) {
      return PaymentEnvironment.LIVE;
    }
    if (config.NODE_ENV === 'production' && keyId && !keyId.startsWith('rzp_test_')) {
      return PaymentEnvironment.LIVE;
    }
    return PaymentEnvironment.TEST;
  }

  /**
   * Maps internal BillingInterval enum to Razorpay API period string.
   * Rejects FREE tier or unsupported intervals.
   */
  public static getPeriodFromInterval(interval: BillingInterval): 'monthly' | 'yearly' {
    switch (interval) {
      case BillingInterval.MONTHLY:
        return 'monthly';
      case BillingInterval.YEARLY:
        return 'yearly';
      case BillingInterval.FREE:
        throw new RazorpayProviderError(
          'VALIDATION_ERROR',
          'FREE plan tier has no external provider recurring billing period.'
        );
      default:
        throw new RazorpayProviderError(
          'VALIDATION_ERROR',
          `Unsupported billing interval: ${interval}`
        );
    }
  }

  /**
   * Generates deterministic, auditable Razorpay Plan name.
   */
  public static generateProviderPlanName(plan: Plan, planPrice: PlanPrice): string {
    const intervalLabel = plan.interval === BillingInterval.MONTHLY ? 'Monthly' : 'Yearly';
    return `ZdexCloud ${plan.name} ${intervalLabel} ${planPrice.currency} v${planPrice.version}`;
  }

  /**
   * Generates safe, audit-friendly internal notes for Razorpay Plan creation.
   */
  public static generateProviderNotes(
    plan: Plan,
    planPrice: PlanPrice,
    environment: PaymentEnvironment
  ): Record<string, string> {
    return {
      zdexcloud_plan_code: plan.code,
      zdexcloud_plan_price_id: planPrice.id,
      zdexcloud_price_version: String(planPrice.version),
      zdexcloud_currency: planPrice.currency,
      zdexcloud_environment: environment
    };
  }

  /**
   * Synchronizes an individual internal PlanPrice with Razorpay.
   * 
   * Strict Invariants:
   * 1. If mapping already exists for (provider, environment, planPriceId), verifies identity and returns it.
   * 2. If conflicting mapping exists, fails closed (MAPPING_CONFLICT) without mutating.
   * 3. Calls POST /v1/plans with exact integer minor units and ISO currency.
   * 4. Validates returned provider payload against expected PlanPrice attributes.
   * 5. Persists mapping transactionally with unique constraint race handling.
   */
  public static async syncPlanPrice(
    planPriceId: string,
    options?: SyncOptions
  ): Promise<BillingProviderPlanMapping> {
    if (!planPriceId) {
      throw new ValidationError('planPriceId is required');
    }

    const planPrice = await prisma.planPrice.findUnique({
      where: { id: planPriceId },
      include: { plan: true }
    });

    if (!planPrice || !planPrice.isActive) {
      throw new NotFoundError(`Active PlanPrice '${planPriceId}' not found`);
    }

    const plan = planPrice.plan;
    if (plan.code === 'FREE' || plan.interval === BillingInterval.FREE) {
      throw new RazorpayProviderError(
        'VALIDATION_ERROR',
        'FREE tier cannot be synchronized with external payment provider'
      );
    }

    const environment = options?.environment || this.resolvePaymentEnvironment();
    const period = this.getPeriodFromInterval(plan.interval);
    const intervalCount = plan.intervalCount || 1;

    // 1. Check if mapping already exists in database
    const existingMapping = await prisma.billingProviderPlanMapping.findUnique({
      where: {
        provider_environment_planPriceId: {
          provider: PaymentProvider.RAZORPAY,
          environment,
          planPriceId: planPrice.id
        }
      }
    });

    if (existingMapping) {
      // Validate existing mapping matches exact immutable attributes
      const isMatch =
        existingMapping.currency === planPrice.currency &&
        existingMapping.amountMinorUnits === planPrice.amountMinorUnits &&
        existingMapping.priceVersion === planPrice.version &&
        existingMapping.period === period &&
        existingMapping.interval === intervalCount;

      if (!isMatch) {
        throw new RazorpayProviderError(
          'MAPPING_CONFLICT',
          `Conflicting mapping detected for planPriceId '${planPrice.id}'. Stored currency=${existingMapping.currency}, amount=${existingMapping.amountMinorUnits}, expected currency=${planPrice.currency}, amount=${planPrice.amountMinorUnits}`
        );
      }

      options?.logger?.info(
        `[RazorpayCatalog] Reusing existing mapping ${existingMapping.providerPlanId} for ${plan.code} (${planPrice.currency}) [${environment}]`
      );
      return existingMapping;
    }

    // 2. Prepare Razorpay client and payload
    const client = options?.client || new RazorpayClient();
    client.assertConfigured();

    const planName = this.generateProviderPlanName(plan, planPrice);
    const notes = this.generateProviderNotes(plan, planPrice, environment);

    const payload = {
      period,
      interval: intervalCount,
      item: {
        name: planName,
        amount: planPrice.amountMinorUnits,
        currency: planPrice.currency,
        description: `ZdexCloud ${plan.name} (${planPrice.currency}) subscription`
      },
      notes
    };

    options?.logger?.info(
      `[RazorpayCatalog] Creating Razorpay Plan for ${plan.code} (${planPrice.currency} ${planPrice.amountMinorUnits}) [${environment}]`
    );

    // 3. Call Razorpay API
    const response = await client.post<RazorpayPlanResponse>('/plans', payload);

    if (!response || !response.id || !response.id.startsWith('plan_')) {
      throw new RazorpayProviderError(
        'INVALID_RESPONSE',
        `Razorpay API returned invalid plan response: missing plan_id`
      );
    }

    // 4. Validate returned provider attributes
    const returnedAmount = response.item?.amount;
    const returnedCurrency = response.item?.currency;
    const returnedPeriod = response.period;
    const returnedInterval = response.interval;

    if (
      returnedAmount !== planPrice.amountMinorUnits ||
      returnedCurrency !== planPrice.currency ||
      returnedPeriod !== period ||
      returnedInterval !== intervalCount
    ) {
      throw new RazorpayProviderError(
        'RESPONSE_MISMATCH',
        `Razorpay Plan creation response mismatch: expected amount=${planPrice.amountMinorUnits} currency=${planPrice.currency} period=${period} interval=${intervalCount}, got amount=${returnedAmount} currency=${returnedCurrency} period=${returnedPeriod} interval=${returnedInterval}`
      );
    }

    // 5. Persist mapping in database
    try {
      const mapping = await prisma.billingProviderPlanMapping.create({
        data: {
          provider: PaymentProvider.RAZORPAY,
          environment,
          planId: plan.id,
          planPriceId: planPrice.id,
          providerPlanId: response.id,
          currency: planPrice.currency,
          amountMinorUnits: planPrice.amountMinorUnits,
          period,
          interval: intervalCount,
          priceVersion: planPrice.version,
          isActive: true
        }
      });

      options?.logger?.info(
        `[RazorpayCatalog] Successfully mapped ${plan.code} (${planPrice.currency}) -> ${response.id} [${environment}]`
      );
      return mapping;
    } catch (err: any) {
      // Handle race condition: check if concurrent request already inserted the mapping
      if (err.code === 'P2002') {
        const raceMapping = await prisma.billingProviderPlanMapping.findUnique({
          where: {
            provider_environment_planPriceId: {
              provider: PaymentProvider.RAZORPAY,
              environment,
              planPriceId: planPrice.id
            }
          }
        });

        if (raceMapping) {
          options?.logger?.warn(
            `[RazorpayCatalog] Concurrent creation detected. Reusing committed mapping ${raceMapping.providerPlanId} for ${plan.code} (${planPrice.currency})`
          );
          return raceMapping;
        }
      }

      throw err;
    }
  }

  /**
   * Synchronizes all active paid plans in the ZdexCloud commercial catalog.
   * Fails closed (CATALOG_INCOMPLETE) if any of the 4 required paid PlanPrice records are missing.
   */
  public static async syncAllPaidPlans(options?: SyncOptions): Promise<BillingProviderPlanMapping[]> {
    const activePrices = await prisma.planPrice.findMany({
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

    // Required commercial matrix:
    // PRO_MONTHLY INR v1, PRO_MONTHLY USD v1, PRO_YEARLY INR v1, PRO_YEARLY USD v1
    const requiredKeys = new Set([
      'PRO_MONTHLY:INR',
      'PRO_MONTHLY:USD',
      'PRO_YEARLY:INR',
      'PRO_YEARLY:USD'
    ]);

    const foundKeys = new Set(activePrices.map((p) => `${p.plan.code}:${p.currency}`));
    const missing: string[] = [];

    for (const req of requiredKeys) {
      if (!foundKeys.has(req)) {
        missing.push(req);
      }
    }

    if (missing.length > 0) {
      throw new RazorpayProviderError(
        'CATALOG_INCOMPLETE',
        `Internal PlanPrice catalog is missing required commercial entries: ${missing.join(', ')}`
      );
    }

    const mappings: BillingProviderPlanMapping[] = [];
    for (const price of activePrices) {
      const mapping = await this.syncPlanPrice(price.id, options);
      mappings.push(mapping);
    }

    return mappings;
  }

  /**
   * Verifies whether all 4 required paid plan prices have active mappings in the given environment.
   */
  public static async verifyCatalogMappings(
    environment?: PaymentEnvironment
  ): Promise<{ complete: boolean; missing: string[]; mappings: BillingProviderPlanMapping[] }> {
    const env = environment || this.resolvePaymentEnvironment();

    const activePrices = await prisma.planPrice.findMany({
      where: {
        isActive: true,
        plan: {
          isActive: true,
          code: { not: 'FREE' }
        }
      },
      include: { plan: true }
    });

    const mappings = await prisma.billingProviderPlanMapping.findMany({
      where: {
        provider: PaymentProvider.RAZORPAY,
        environment: env,
        isActive: true
      }
    });

    const mappedPriceIds = new Set(mappings.map((m) => m.planPriceId));
    const missing: string[] = [];

    for (const p of activePrices) {
      if (!mappedPriceIds.has(p.id)) {
        missing.push(`${p.plan.code} (${p.currency} v${p.version})`);
      }
    }

    return {
      complete: missing.length === 0,
      missing,
      mappings
    };
  }

  /**
   * Resolves the authoritative Razorpay plan_id for a given plan code, currency, and version.
   * Throws NotFoundError if the mapping does not exist for the current environment.
   */
  public static async resolveProviderPlanId(
    planCode: string,
    currency: CurrencyCode,
    priceVersion = 1,
    environment?: PaymentEnvironment
  ): Promise<string> {
    if (!planCode || planCode === 'FREE') {
      throw new ValidationError('FREE plan tier has no external provider plan ID');
    }

    const env = environment || this.resolvePaymentEnvironment();

    const planPrice = await prisma.planPrice.findFirst({
      where: {
        currency,
        version: priceVersion,
        isActive: true,
        plan: { code: planCode, isActive: true }
      }
    });

    if (!planPrice) {
      throw new NotFoundError(
        `PlanPrice not found for plan '${planCode}' currency '${currency}' version ${priceVersion}`
      );
    }

    const mapping = await prisma.billingProviderPlanMapping.findUnique({
      where: {
        provider_environment_planPriceId: {
          provider: PaymentProvider.RAZORPAY,
          environment: env,
          planPriceId: planPrice.id
        }
      }
    });

    if (!mapping || !mapping.providerPlanId) {
      throw new NotFoundError(
        `Razorpay plan mapping not found for '${planCode}' (${currency} v${priceVersion}) in environment '${env}'. Please run catalog synchronization.`
      );
    }

    return mapping.providerPlanId;
  }

  /**
   * Retrieves mapping for an internal PlanPrice ID in the specified environment.
   */
  public static async getMappingForPlanPrice(
    planPriceId: string,
    environment?: PaymentEnvironment
  ): Promise<BillingProviderPlanMapping | null> {
    const env = environment || this.resolvePaymentEnvironment();
    return await prisma.billingProviderPlanMapping.findUnique({
      where: {
        provider_environment_planPriceId: {
          provider: PaymentProvider.RAZORPAY,
          environment: env,
          planPriceId
        }
      }
    });
  }
}
