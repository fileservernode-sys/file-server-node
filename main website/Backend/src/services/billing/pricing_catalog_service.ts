import { prisma } from '../../config/database.js';
import { Plan, PlanPrice, BillingInterval, CurrencyCode } from '@prisma/client';
import { CountryDetectionService, DetectedCountryResult } from './country_detection_service.js';
import { EntitlementService } from './entitlement_service.js';
import { ValidationError, NotFoundError } from '../../errors/app-error.js';
import { config } from '../../config/env.js';

export interface RegionalPlanDTO {
  id?: string;
  code: string;
  name: string;
  description: string | null;
  interval: BillingInterval;
  intervalCount: number;
  amountMinorUnits: number;
  currency: CurrencyCode;
  priceVersion: number;
  formattedPrice: string;
  serverLimit: number;
  priorityRelay: boolean;
  prices: {
    id?: string;
    currency: CurrencyCode;
    amountMinorUnits: number;
    version: number;
  }[];
  entitlements: {
    maxServers: number;
    priorityRelay: boolean;
    [key: string]: number | boolean;
  };
}

export interface StorefrontPricingResponseDTO {
  countryCode: string | null;
  currency: CurrencyCode;
  countryConfirmed: false;
  plans: RegionalPlanDTO[];
  count: number;
  timestamp: string;
}

export class PriceFormatter {
  /**
   * Formats minor units into display-ready strings without floating point arithmetic errors.
   */
  public static format(amountMinorUnits: number, currency: CurrencyCode): string {
    if (!Number.isInteger(amountMinorUnits) || amountMinorUnits < 0) {
      amountMinorUnits = 0;
    }

    if (currency === CurrencyCode.INR) {
      if (amountMinorUnits === 0) return '₹0';
      if (amountMinorUnits % 100 === 0) {
        return `₹${amountMinorUnits / 100}`;
      }
      return `₹${(amountMinorUnits / 100).toFixed(2)}`;
    }

    if (currency === CurrencyCode.USD) {
      if (amountMinorUnits === 0) return '$0';
      const dollars = amountMinorUnits / 100;
      return `$${dollars.toFixed(2)}`;
    }

    return `${amountMinorUnits / 100} ${currency}`;
  }
}

export class PricingCatalogService {
  /**
   * Resolves the storefront currency from a detected country code.
   * IN -> INR
   * non-IN -> USD
   * null/unknown -> USD
   */
  public static resolveStorefrontCurrency(countryCode: string | null): CurrencyCode {
    if (countryCode && countryCode.toUpperCase() === 'IN') {
      return CurrencyCode.INR;
    }
    return CurrencyCode.USD;
  }

  /**
   * Retrieves the active regional pricing catalog for the specified currency.
   * Validates that all active plans possess an active PlanPrice for the requested currency.
   */
  public static async getRegionalCatalog(currency: CurrencyCode): Promise<RegionalPlanDTO[]> {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { serverLimit: 'asc' },
      include: {
        prices: {
          where: {
            isActive: true,
            currency: currency
          },
          orderBy: { version: 'desc' },
          take: 1
        },
        entitlements: {
          include: {
            entitlementDefinition: true
          }
        }
      }
    });

    const now = new Date();
    const result: RegionalPlanDTO[] = [];

    for (const p of plans) {
      // Find latest active price valid for current timestamp
      const activePrice = p.prices.find(pr => {
        const isEffective = pr.effectiveFrom <= now;
        const notExpired = pr.effectiveTo === null || pr.effectiveTo > now;
        return pr.isActive && isEffective && notExpired;
      }) || p.prices[0];

      if (!activePrice) {
        throw new Error(
          `Catalog integrity error: Plan '${p.code}' is missing an active price for currency '${currency}'.`
        );
      }

      // Resolve technical entitlements
      let maxServers = p.serverLimit ?? 1;
      let priorityRelay = p.priorityRelay ?? false;
      const rawEntitlements: Record<string, number | boolean> = {
        MAX_SERVERS: maxServers,
        PRIORITY_RELAY: priorityRelay
      };

      for (const ent of p.entitlements || []) {
        const entCode = ent.entitlementDefinition.code;
        if (entCode === 'MAX_SERVERS' && ent.intValue !== null && ent.intValue !== undefined) {
          maxServers = ent.intValue;
          rawEntitlements.MAX_SERVERS = ent.intValue;
        } else if (entCode === 'PRIORITY_RELAY' && ent.boolValue !== null && ent.boolValue !== undefined) {
          priorityRelay = ent.boolValue;
          rawEntitlements.PRIORITY_RELAY = ent.boolValue;
        }
      }

      result.push({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        interval: p.interval,
        intervalCount: p.intervalCount,
        amountMinorUnits: activePrice.amountMinorUnits,
        currency: activePrice.currency,
        priceVersion: activePrice.version,
        formattedPrice: PriceFormatter.format(activePrice.amountMinorUnits, activePrice.currency),
        serverLimit: maxServers,
        priorityRelay,
        prices: [
          {
            id: activePrice.id,
            currency: activePrice.currency,
            amountMinorUnits: activePrice.amountMinorUnits,
            version: activePrice.version
          }
        ],
        entitlements: {
          maxServers,
          priorityRelay,
          ...rawEntitlements
        }
      });
    }

    return result;
  }

  /**
   * Retrieves a single active plan formatted with the active price for the specified currency.
   */
  public static async getRegionalPlan(planCode: string, currency: CurrencyCode): Promise<RegionalPlanDTO | null> {
    const plan = await prisma.plan.findUnique({
      where: { code: planCode },
      include: {
        prices: {
          where: {
            isActive: true,
            currency: currency
          },
          orderBy: { version: 'desc' },
          take: 1
        },
        entitlements: {
          include: {
            entitlementDefinition: true
          }
        }
      }
    });

    if (!plan || !plan.isActive) {
      return null;
    }

    const now = new Date();
    const activePrice = plan.prices.find(pr => {
      const isEffective = pr.effectiveFrom <= now;
      const notExpired = pr.effectiveTo === null || pr.effectiveTo > now;
      return pr.isActive && isEffective && notExpired;
    }) || plan.prices[0];

    if (!activePrice) {
      throw new Error(
        `Catalog integrity error: Plan '${plan.code}' is missing an active price for currency '${currency}'.`
      );
    }

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
      amountMinorUnits: activePrice.amountMinorUnits,
      currency: activePrice.currency,
      priceVersion: activePrice.version,
      formattedPrice: PriceFormatter.format(activePrice.amountMinorUnits, activePrice.currency),
      serverLimit: maxServers,
      priorityRelay,
      prices: [
        {
          id: activePrice.id,
          currency: activePrice.currency,
          amountMinorUnits: activePrice.amountMinorUnits,
          version: activePrice.version
        }
      ],
      entitlements: {
        maxServers,
        priorityRelay,
        ...rawEntitlements
      }
    };
  }

  /**
   * Resolves the full storefront pricing response using CountryDetectionService.
   * Defends against client currency spoofing.
   */
  public static async getStorefrontPricing(
    headers: Record<string, string | string[] | undefined> = {},
    requestedCurrency?: string
  ): Promise<StorefrontPricingResponseDTO> {
    // 1. Detect request-scoped storefront country & derive storefront currency
    const detected: DetectedCountryResult = CountryDetectionService.detect(headers);
    let resolvedCurrency = this.resolveStorefrontCurrency(detected.countryCode);

    // 2. Client Currency Spoof Defense
    if (requestedCurrency) {
      const normalizedReq = requestedCurrency.trim().toUpperCase();
      if (normalizedReq !== 'INR' && normalizedReq !== 'USD') {
        throw new ValidationError(`Invalid currency parameter '${requestedCurrency}'. Must be INR or USD.`);
      }

      // If country is detected via Cloudflare or dev override, reject spoofing attempts that differ
      if (detected.countrySource === 'CLOUDFLARE' || detected.countrySource === 'DEV_OVERRIDE') {
        if (normalizedReq !== resolvedCurrency) {
          throw new ValidationError(
            `Requested currency '${normalizedReq}' does not match detected regional storefront currency '${resolvedCurrency}'.`
          );
        }
      } else {
        // Unknown source (e.g. local test without headers)
        resolvedCurrency = normalizedReq as CurrencyCode;
      }
    }

    // 3. Resolve regional catalog for the detected currency
    const plans = await this.getRegionalCatalog(resolvedCurrency);

    return {
      countryCode: detected.countryCode,
      currency: resolvedCurrency,
      countryConfirmed: false,
      plans,
      count: plans.length,
      timestamp: new Date().toISOString()
    };
  }
}
