import { config } from '../../config/env.js';
import { StatutoryConfigurationMissingError } from '../../errors/app-error.js';

export interface ValidatedSellerConfig {
  legalName: string;
  tradeName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  stateCode: string; // 2-digit GST state code (e.g. "24")
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2 (e.g. "IN")
  supportEmail: string;
  gstin: string; // 15-character valid GSTIN
  sacCode: string; // Approved SAC code (e.g. "998315")
  invoiceSeriesPrefix: string;
  statutoryInvoicingEnabled: boolean;
  exportInvoicingApproved: boolean;
  exportLutArn: string | null;
}

export interface SellerConfigValidationResult {
  isValid: boolean;
  config: ValidatedSellerConfig | null;
  missingFields: string[];
  validationErrors: string[];
}

/**
 * Statutory Seller Configuration & Fail-Closed Validation Boundary
 *
 * Enforces strict statutory validation under Indian GST Rule 46(a) and 46(b):
 * 1. Fails closed if statutory invoicing is disabled or if mandatory seller details are missing.
 * 2. Never invents placeholder seller details, sample addresses, or mock GSTINs.
 * 3. Enforces that GSTIN matches statutory formatting and the configured supplier state code.
 * 4. Ensures that non-invoice billing (receipts, checkout, webhooks) continues uninterrupted
 *    when statutory invoicing is unconfigured.
 */
export class StatutorySellerConfigService {
  public static readonly GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  public static readonly STATE_CODE_REGEX = /^[0-9]{2}$/;

  /**
   * Validates and evaluates current statutory seller configuration.
   * Does NOT throw: returns structured validation result for safe inspection.
   */
  public static evaluateSellerConfig(): SellerConfigValidationResult {
    const missingFields: string[] = [];
    const validationErrors: string[] = [];

    const statutoryInvoicingEnabled = config.STATUTORY_INVOICING_ENABLED;
    if (!statutoryInvoicingEnabled) {
      validationErrors.push('Statutory invoice issuance is currently disabled by configuration (STATUTORY_INVOICING_ENABLED is false)');
    }

    const legalName = (config.SELLER_LEGAL_NAME || '').trim();
    if (!legalName) {
      missingFields.push('SELLER_LEGAL_NAME');
    } else if (legalName.length < 3) {
      validationErrors.push('SELLER_LEGAL_NAME must be at least 3 characters');
    }

    const addressLine1 = (config.SELLER_ADDRESS_LINE1 || '').trim();
    if (!addressLine1) {
      missingFields.push('SELLER_ADDRESS_LINE1');
    }

    const city = (config.SELLER_CITY || '').trim();
    if (!city) {
      missingFields.push('SELLER_CITY');
    }

    const state = (config.SELLER_STATE || '').trim();
    if (!state) {
      missingFields.push('SELLER_STATE');
    }

    const stateCode = (config.SELLER_STATE_CODE || '').trim();
    if (!stateCode) {
      missingFields.push('SELLER_STATE_CODE');
    } else if (!this.STATE_CODE_REGEX.test(stateCode)) {
      validationErrors.push(`Invalid SELLER_STATE_CODE: must be a 2-digit numeric code (got '${stateCode}')`);
    }

    const postalCode = (config.SELLER_POSTAL_CODE || '').trim();
    if (!postalCode) {
      missingFields.push('SELLER_POSTAL_CODE');
    }

    const country = (config.SELLER_COUNTRY || 'IN').trim().toUpperCase();

    // Seller GSTIN validation
    const rawGstin = (config.SELLER_GSTIN || config.MERCHANT_GSTIN || '').trim().toUpperCase();
    if (!rawGstin) {
      missingFields.push('SELLER_GSTIN');
    } else if (!this.GSTIN_REGEX.test(rawGstin)) {
      validationErrors.push('SELLER_GSTIN has invalid structure: expected 15-character alphanumeric GSTIN format');
    } else if (stateCode && rawGstin.substring(0, 2) !== stateCode) {
      validationErrors.push(`SELLER_GSTIN state prefix '${rawGstin.substring(0, 2)}' does not match configured SELLER_STATE_CODE '${stateCode}'`);
    }

    // Approved SAC classification
    const sacCode = (config.APPROVED_SAC_CODE || '').trim();
    if (!sacCode) {
      missingFields.push('APPROVED_SAC_CODE');
    } else if (!/^[0-9]{6}$/.test(sacCode)) {
      validationErrors.push(`APPROVED_SAC_CODE must be a 6-digit numeric SAC code (got '${sacCode}')`);
    }

    // Invoice series prefix
    const invoiceSeriesPrefix = (config.INVOICE_SERIES_PREFIX || 'ZCI').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(invoiceSeriesPrefix)) {
      validationErrors.push(`INVOICE_SERIES_PREFIX must be 1 to 8 alphanumeric characters (got '${invoiceSeriesPrefix}')`);
    }

    const isValid = missingFields.length === 0 && validationErrors.length === 0;

    let validated: ValidatedSellerConfig | null = null;
    if (isValid) {
      validated = {
        legalName,
        tradeName: config.SELLER_TRADE_NAME ? config.SELLER_TRADE_NAME.trim() : null,
        addressLine1,
        addressLine2: config.SELLER_ADDRESS_LINE2 ? config.SELLER_ADDRESS_LINE2.trim() : null,
        city,
        state,
        stateCode,
        postalCode,
        country,
        supportEmail: config.SELLER_SUPPORT_EMAIL || 'support@zdexcloud.com',
        gstin: rawGstin,
        sacCode,
        invoiceSeriesPrefix,
        statutoryInvoicingEnabled: true,
        exportInvoicingApproved: Boolean(config.EXPORT_INVOICING_APPROVED),
        exportLutArn: config.EXPORT_LUT_ARN ? config.EXPORT_LUT_ARN.trim() : null
      };
    }

    return {
      isValid,
      config: validated,
      missingFields,
      validationErrors
    };
  }

  /**
   * Retrieves authoritative validated seller configuration or fails closed.
   * Throws StatutoryConfigurationMissingError with non-sensitive diagnostic details.
   */
  public static getApprovedSellerConfig(): ValidatedSellerConfig {
    const result = this.evaluateSellerConfig();

    if (!result.isValid || !result.config) {
      const allIssues = [
        ...result.missingFields.map((f) => `Missing mandatory parameter: ${f}`),
        ...result.validationErrors
      ];
      throw new StatutoryConfigurationMissingError(
        `Statutory invoice issuance blocked: seller configuration is incomplete or unapproved (${allIssues.join('; ')})`
      );
    }

    return result.config;
  }
}
