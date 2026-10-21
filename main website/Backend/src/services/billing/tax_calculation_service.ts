import { prisma } from '../../config/database.js';
import {
  CurrencyCode,
  TaxType,
  AuditEventType,
  Prisma,
  BillingPaymentTax
} from '@prisma/client';
import { AppError, ValidationError, NotFoundError } from '../../errors/app-error.js';

export class TaxConfigurationMissingError extends AppError {
  public readonly errorCode = 'TAX_CONFIGURATION_MISSING';
  constructor(message: string) {
    super(message, 422);
    Object.setPrototypeOf(this, TaxConfigurationMissingError.prototype);
  }
}

export interface TaxConfiguration {
  country: string;
  jurisdiction: string;
  taxType: TaxType;
  rateBasisPoints: number;
  isInclusive: boolean;
  currency: CurrencyCode;
  version: number;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  authority: string;
  breakdownRules: {
    component: string;
    rateBasisPoints: number;
  }[];
}

export interface TaxCalculationParams {
  grossAmountMinorUnits: number;
  currency: CurrencyCode;
  billingCountry: string;
  isExclusive?: boolean;
  atDate?: Date;
}

export interface TaxBreakdownComponent {
  component: string; // e.g. 'CGST', 'SGST', 'IGST', 'SALES_TAX'
  rateBasisPoints: number; // e.g. 900 for 9.00%
  amountMinorUnits: number;
}

export interface TaxCalculationResult {
  jurisdiction: string;
  taxType: TaxType;
  isInclusive: boolean;
  taxRateBasisPoints: number;
  taxableAmountMinorUnits: number;
  taxAmountMinorUnits: number;
  grossAmountMinorUnits: number;
  currency: CurrencyCode;
  taxVersion: number;
  authority: string;
  breakdown: TaxBreakdownComponent[];
}

export interface StatutoryTaxCalculationParams {
  amountMinorUnits?: number; // For inclusive: gross amount. For exclusive: net taxable base amount.
  grossAmountMinorUnits?: number; // Backward-compatible alias
  currency: CurrencyCode;
  customerCountry: string;
  customerStateCode?: string | null;
  supplierCountry: string;
  supplierStateCode: string;
  sacCode: string;
  taxRateBasisPoints?: number; // Configurable tax rate basis points (defaults to 1800)
  isExclusive?: boolean;
  isExportApproved?: boolean; // Must be explicitly true for zero-rated export treatment
  exportLutArn?: string | null; // Approved LUT reference if applicable
  atDate?: Date;
}

export interface StatutoryTaxCalculationResult extends TaxCalculationResult {
  supplierStateCode: string;
  customerStateCode: string | null;
  sacCode: string;
  isInterState: boolean;
  ruleExplanation: string;
}

/**
 * Authoritative, Versioned Tax Configuration Registry.
 * Holds legally constituted tax rate policies per country, jurisdiction, and effective period.
 */
export class TaxConfigurationRegistry {
  private static configurations: TaxConfiguration[] = [
    {
      country: 'IN',
      jurisdiction: 'IN',
      taxType: TaxType.GST,
      rateBasisPoints: 1800, // 18.00% GST
      isInclusive: true,
      currency: CurrencyCode.INR,
      version: 1,
      isActive: true,
      effectiveFrom: new Date('2017-07-01T00:00:00.000Z'),
      effectiveTo: null,
      authority: 'IN_GST_SCHEDULE_SERVICES_18_PCT',
      breakdownRules: [
        { component: 'CGST', rateBasisPoints: 900 },
        { component: 'SGST', rateBasisPoints: 900 }
      ]
    },
    {
      country: 'US',
      jurisdiction: 'US',
      taxType: TaxType.NONE,
      rateBasisPoints: 0,
      isInclusive: false,
      currency: CurrencyCode.USD,
      version: 1,
      isActive: true,
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      authority: 'US_CATALOG_DIGITAL_SERVICES_NON_TAXABLE',
      breakdownRules: []
    },
    {
      country: 'GB',
      jurisdiction: 'GB',
      taxType: TaxType.NONE,
      rateBasisPoints: 0,
      isInclusive: false,
      currency: CurrencyCode.USD,
      version: 1,
      isActive: true,
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      authority: 'GLOBAL_CATALOG_DIGITAL_SERVICES_NON_TAXABLE',
      breakdownRules: []
    }
  ];

  public static getActiveConfiguration(
    country: string,
    currency: CurrencyCode,
    atDate: Date = new Date()
  ): TaxConfiguration | null {
    const normalizedCountry = (country || '').toUpperCase();
    const config = this.configurations.find((c) => {
      if (!c.isActive) return false;
      if (c.country !== normalizedCountry) return false;
      if (c.currency !== currency) return false;
      if (c.effectiveFrom > atDate) return false;
      if (c.effectiveTo && c.effectiveTo < atDate) return false;
      return true;
    });

    return config || null;
  }

  public static registerConfiguration(config: TaxConfiguration): void {
    const existingIndex = this.configurations.findIndex(
      (c) => c.country === config.country && c.currency === config.currency && c.version === config.version
    );
    if (existingIndex >= 0) {
      this.configurations[existingIndex] = config;
    } else {
      this.configurations.push(config);
    }
  }

  public static getAllConfigurations(): TaxConfiguration[] {
    return [...this.configurations];
  }
}

export class TaxCalculationService {
  /**
   * Authoritatively calculates customer-facing tax based on confirmed billing country, currency,
   * and the active versioned TaxConfiguration rule.
   *
   * NEVER hard-codes tax rates or assumes 0%/18% without active configuration authority.
   * Enforces exact integer minor-unit arithmetic:
   * taxableAmountMinorUnits + taxAmountMinorUnits === grossAmountMinorUnits (for inclusive pricing).
   */
  public static calculateTax(params: TaxCalculationParams): TaxCalculationResult {
    const { grossAmountMinorUnits, currency, billingCountry, atDate = new Date() } = params;

    if (!Number.isInteger(grossAmountMinorUnits) || grossAmountMinorUnits < 0) {
      throw new ValidationError('grossAmountMinorUnits must be a non-negative integer');
    }

    const country = (billingCountry || '').toUpperCase();
    if (!country) {
      throw new ValidationError('billingCountry is required for tax calculation');
    }

    // 1. Resolve active tax configuration authority
    const taxConfig = TaxConfigurationRegistry.getActiveConfiguration(country, currency, atDate);

    if (!taxConfig) {
      throw new TaxConfigurationMissingError(
        `No active tax configuration found for country '${country}' and currency '${currency}'`
      );
    }

    const rateBasisPoints = taxConfig.rateBasisPoints;
    const isInclusive = params.isExclusive !== undefined ? !params.isExclusive : taxConfig.isInclusive;

    // 2. Calculate tax and taxable amounts
    let taxableAmountMinorUnits: number;
    let taxAmountMinorUnits: number;
    let finalGrossMinorUnits: number;

    if (rateBasisPoints === 0 || taxConfig.taxType === TaxType.NONE) {
      taxableAmountMinorUnits = grossAmountMinorUnits;
      taxAmountMinorUnits = 0;
      finalGrossMinorUnits = grossAmountMinorUnits;
    } else if (isInclusive) {
      // Inclusive formula: tax = Math.round((gross * rate) / (10000 + rate))
      taxAmountMinorUnits = Math.round((grossAmountMinorUnits * rateBasisPoints) / (10000 + rateBasisPoints));
      taxableAmountMinorUnits = grossAmountMinorUnits - taxAmountMinorUnits;
      finalGrossMinorUnits = grossAmountMinorUnits;
    } else {
      // Exclusive formula: tax = Math.round((gross * rate) / 10000)
      taxAmountMinorUnits = Math.round((grossAmountMinorUnits * rateBasisPoints) / 10000);
      taxableAmountMinorUnits = grossAmountMinorUnits;
      finalGrossMinorUnits = grossAmountMinorUnits + taxAmountMinorUnits;
    }

    // 3. Compute component breakdown
    const breakdown: TaxBreakdownComponent[] = [];
    if (taxAmountMinorUnits > 0 && taxConfig.breakdownRules.length > 0) {
      const totalBreakdownPoints = taxConfig.breakdownRules.reduce((sum, r) => sum + r.rateBasisPoints, 0);
      let allocatedTax = 0;

      for (let i = 0; i < taxConfig.breakdownRules.length; i++) {
        const rule = taxConfig.breakdownRules[i];
        const isLast = i === taxConfig.breakdownRules.length - 1;

        if (isLast) {
          // Remainder allocation to guarantee exact sum
          const compAmount = taxAmountMinorUnits - allocatedTax;
          breakdown.push({
            component: rule.component,
            rateBasisPoints: rule.rateBasisPoints,
            amountMinorUnits: compAmount
          });
        } else {
          const compAmount = Math.floor((taxAmountMinorUnits * rule.rateBasisPoints) / (totalBreakdownPoints || 1));
          allocatedTax += compAmount;
          breakdown.push({
            component: rule.component,
            rateBasisPoints: rule.rateBasisPoints,
            amountMinorUnits: compAmount
          });
        }
      }
    }

    return {
      jurisdiction: taxConfig.jurisdiction,
      taxType: taxConfig.taxType,
      isInclusive,
      taxRateBasisPoints: rateBasisPoints,
      taxableAmountMinorUnits,
      taxAmountMinorUnits,
      grossAmountMinorUnits: finalGrossMinorUnits,
      currency,
      taxVersion: taxConfig.version,
      authority: taxConfig.authority,
      breakdown
    };
  }

  /**
   * Calculates statutory tax for invoice issuance based on confirmed supplier location,
   * customer place of supply, approved SAC classification, and versioned statutory tax rules.
   *
   * Enforces strict fail-closed validation:
   * 1. If customerCountry === 'IN', requires valid customerStateCode and INR currency.
   * 2. Branches dynamically between Intra-state (CGST 9% + SGST 9%) and Inter-state (IGST 18%).
   * 3. For foreign customers, applies export of services zero-rated / non-taxable rule.
   * 4. Enforces integer minor-unit arithmetic and checks MySQL 32-bit integer storage bounds.
   */
  public static calculateStatutoryInvoiceTax(
    params: StatutoryTaxCalculationParams
  ): StatutoryTaxCalculationResult {
    const rawAmount = params.amountMinorUnits !== undefined ? params.amountMinorUnits : params.grossAmountMinorUnits;
    if (rawAmount === undefined || !Number.isInteger(rawAmount) || rawAmount < 0 || rawAmount > 2147483647) {
      throw new ValidationError('amountMinorUnits must be a non-negative integer within 32-bit limits (0 to 2147483647)');
    }

    const {
      currency,
      customerCountry,
      customerStateCode,
      supplierCountry,
      supplierStateCode,
      sacCode,
      isExclusive = false,
      isExportApproved = false,
      exportLutArn = null
    } = params;

    if (!supplierCountry || supplierCountry.trim().toUpperCase() !== 'IN') {
      throw new ValidationError(`Unsupported supplierCountry '${supplierCountry}': expected 'IN'`);
    }

    if (!supplierStateCode || !/^[0-9]{2}$/.test(supplierStateCode.trim())) {
      throw new ValidationError(`Invalid supplierStateCode '${supplierStateCode}': must be a 2-digit numeric code`);
    }

    if (!sacCode || !/^[0-9]{6}$/.test(sacCode.trim())) {
      throw new ValidationError(`Invalid sacCode '${sacCode}': must be a 6-digit numeric SAC code`);
    }

    const normCustomerCountry = (customerCountry || '').trim().toUpperCase();
    if (!normCustomerCountry) {
      throw new ValidationError('customerCountry is required for statutory tax calculation');
    }

    const normSupplierState = supplierStateCode.trim();
    const isIndianCustomer = normCustomerCountry === 'IN';

    let jurisdiction: string;
    let taxType: TaxType;
    let isInclusive: boolean;
    let taxRateBasisPoints: number;
    let taxableAmountMinorUnits: number;
    let taxAmountMinorUnits: number;
    let finalGrossMinorUnits: number;
    let authority: string;
    let isInterState: boolean;
    let ruleExplanation: string;
    const breakdown: TaxBreakdownComponent[] = [];

    if (isIndianCustomer) {
      if (currency !== CurrencyCode.INR) {
        throw new ValidationError(`Invalid currency '${currency}' for domestic Indian GST invoice: must be INR`);
      }

      const normCustomerState = (customerStateCode || '').trim();
      if (!normCustomerState || !/^[0-9]{2}$/.test(normCustomerState)) {
        throw new TaxConfigurationMissingError(
          `Place of supply determination requires a valid 2-digit numeric customerStateCode for Indian GST (got '${customerStateCode}')`
        );
      }

      jurisdiction = 'IN';
      taxType = TaxType.GST;
      taxRateBasisPoints = params.taxRateBasisPoints !== undefined ? params.taxRateBasisPoints : 1800;
      if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) {
        throw new ValidationError(`Invalid taxRateBasisPoints '${taxRateBasisPoints}': must be between 0 and 10000`);
      }

      isInclusive = !isExclusive;

      if (isInclusive) {
        // Inclusive formula: tax derived from gross total
        taxAmountMinorUnits = Math.round((rawAmount * taxRateBasisPoints) / (10000 + taxRateBasisPoints));
        taxableAmountMinorUnits = rawAmount - taxAmountMinorUnits;
        finalGrossMinorUnits = rawAmount;
      } else {
        // Exclusive formula: rawAmount is net taxable base; tax added to arrive at gross
        const maxSafeBase = Math.floor(2147483647 / (1 + taxRateBasisPoints / 10000));
        if (rawAmount > maxSafeBase) {
          throw new ValidationError('Net taxable amount would overflow 32-bit integer limits once tax is added');
        }
        taxAmountMinorUnits = Math.round((rawAmount * taxRateBasisPoints) / 10000);
        taxableAmountMinorUnits = rawAmount;
        finalGrossMinorUnits = taxableAmountMinorUnits + taxAmountMinorUnits;
      }

      if (normSupplierState === normCustomerState) {
        // Intra-State Supply: Split into equal CGST and SGST
        isInterState = false;
        authority = 'IN_GST_INTRA_STATE_CGST_SGST_18_PCT';
        ruleExplanation = `Intra-state supply within state code ${normSupplierState}: CGST ${(taxRateBasisPoints / 200).toFixed(1)}% + SGST ${(taxRateBasisPoints / 200).toFixed(1)}% under SAC ${sacCode}`;

        const halfRate = Math.floor(taxRateBasisPoints / 2);
        const cgstAmount = Math.floor(taxAmountMinorUnits / 2);
        const sgstAmount = taxAmountMinorUnits - cgstAmount; // Remainder allocation for exact integer sum

        breakdown.push({ component: 'CGST', rateBasisPoints: halfRate, amountMinorUnits: cgstAmount });
        breakdown.push({ component: 'SGST', rateBasisPoints: taxRateBasisPoints - halfRate, amountMinorUnits: sgstAmount });
      } else {
        // Inter-State Supply: Entire tax levied as IGST
        isInterState = true;
        authority = 'IN_GST_INTER_STATE_IGST_18_PCT';
        ruleExplanation = `Inter-state supply from supplier state ${normSupplierState} to customer state ${normCustomerState}: IGST ${(taxRateBasisPoints / 100).toFixed(1)}% under SAC ${sacCode}`;

        breakdown.push({ component: 'IGST', rateBasisPoints: taxRateBasisPoints, amountMinorUnits: taxAmountMinorUnits });
      }
    } else {
      // Export / International Supply: Fail closed unless export rules are approved
      if (!isExportApproved) {
        throw new StatutoryConfigurationMissingError(
          `Statutory invoice issuance for cross-border export to country '${normCustomerCountry}' is blocked: zero-rated export eligibility, LUT filing, and foreign currency remittance verification are unapproved`
        );
      }

      jurisdiction = normCustomerCountry;
      taxType = TaxType.NONE;
      taxRateBasisPoints = 0;
      isInclusive = false;
      taxAmountMinorUnits = 0;
      taxableAmountMinorUnits = rawAmount;
      finalGrossMinorUnits = rawAmount;
      isInterState = false;
      authority = exportLutArn ? `EXPORT_UNDER_LUT_${exportLutArn}` : 'EXPORT_OF_SERVICES_ZERO_RATED';
      ruleExplanation = `Cross-border export of digital services to customer in country ${normCustomerCountry} under approved zero-rated rules`;
    }

    // Exact reconciliation check
    if (taxableAmountMinorUnits + taxAmountMinorUnits !== finalGrossMinorUnits) {
      throw new ValidationError('Internal tax calculation reconciliation error: taxable amount plus tax does not equal gross total');
    }

    // Storage range checks
    if (taxableAmountMinorUnits > 2147483647 || taxAmountMinorUnits > 2147483647 || finalGrossMinorUnits > 2147483647) {
      throw new ValidationError('Computed tax or total amount exceeds MySQL 32-bit integer limits');
    }

    return {
      jurisdiction,
      taxType,
      isInclusive,
      taxRateBasisPoints,
      taxableAmountMinorUnits,
      taxAmountMinorUnits,
      grossAmountMinorUnits: finalGrossMinorUnits,
      currency,
      taxVersion: 1,
      authority,
      breakdown,
      supplierStateCode: normSupplierState,
      customerStateCode: isIndianCustomer ? (customerStateCode || '').trim() : null,
      sacCode,
      isInterState,
      ruleExplanation
    };
  }

  /**
   * Calculates and persists an authoritative immutable BillingPaymentTax snapshot for a payment.
   * Idempotent: returns existing tax record if already calculated.
   */
  public static async recordPaymentTax(
    paymentId: string,
    options?: { billingCountry?: string; tx?: Prisma.TransactionClient }
  ): Promise<BillingPaymentTax> {
    const client = options?.tx || prisma;

    // Check if tax snapshot already exists
    const existing = await client.billingPaymentTax.findUnique({
      where: { paymentId }
    });

    if (existing) {
      return existing;
    }

    const payment = await client.billingPayment.findUnique({
      where: { id: paymentId },
      include: {
        user: {
          include: {
            billingState: true
          }
        }
      }
    });

    if (!payment) {
      throw new NotFoundError(`BillingPayment ${paymentId} not found`);
    }

    const billingCountry = options?.billingCountry || payment.user?.billingState?.billingCountry || 'IN';

    let calculation: TaxCalculationResult;
    try {
      calculation = this.calculateTax({
        grossAmountMinorUnits: payment.amountMinorUnits,
        currency: payment.currency,
        billingCountry,
        atDate: payment.chargedAt || payment.createdAt
      });
    } catch (err: any) {
      if (err instanceof TaxConfigurationMissingError) {
        try {
          await client.auditEvent.create({
            data: {
              userId: payment.userId,
              eventType: AuditEventType.TAX_CONFIGURATION_MISSING,
              metadata: {
                paymentId: payment.id,
                billingCountry,
                currency: payment.currency,
                error: err.message
              }
            }
          });
        } catch {
          // Non-blocking
        }
      }
      throw err;
    }

    const taxRecord = await client.billingPaymentTax.create({
      data: {
        paymentId: payment.id,
        userId: payment.userId,
        jurisdiction: calculation.jurisdiction,
        taxType: calculation.taxType,
        isInclusive: calculation.isInclusive,
        taxRateBasisPoints: calculation.taxRateBasisPoints,
        taxableAmountMinorUnits: calculation.taxableAmountMinorUnits,
        taxAmountMinorUnits: calculation.taxAmountMinorUnits,
        grossAmountMinorUnits: calculation.grossAmountMinorUnits,
        currency: calculation.currency,
        taxVersion: calculation.taxVersion,
        breakdown: calculation.breakdown as any,
        metadata: {
          calculatedAt: new Date().toISOString(),
          billingCountry,
          authority: calculation.authority
        }
      }
    });

    // Record audit event
    try {
      await client.auditEvent.create({
        data: {
          userId: payment.userId,
          eventType: AuditEventType.TAX_CALCULATED,
          metadata: {
            paymentId: payment.id,
            jurisdiction: calculation.jurisdiction,
            taxType: calculation.taxType,
            taxRateBasisPoints: calculation.taxRateBasisPoints,
            taxAmountMinorUnits: calculation.taxAmountMinorUnits,
            taxableAmountMinorUnits: calculation.taxableAmountMinorUnits,
            grossAmountMinorUnits: calculation.grossAmountMinorUnits,
            currency: calculation.currency,
            taxVersion: calculation.taxVersion,
            authority: calculation.authority
          }
        }
      });
    } catch {
      // Non-blocking audit
    }

    return taxRecord;
  }
}
