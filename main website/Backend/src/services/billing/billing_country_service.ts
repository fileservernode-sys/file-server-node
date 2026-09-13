import { prisma } from '../../config/database.js';
import { CurrencyCode, AuditEventType, AccountBillingState } from '@prisma/client';
import { ValidationError, NotFoundError } from '../../errors/app-error.js';

// Complete, standard ISO 3166-1 alpha-2 officially assigned country codes
export const ISO_3166_1_ALPHA_2_CODES = new Set([
  'AF', 'AX', 'AL', 'DZ', 'AS', 'AD', 'AO', 'AI', 'AQ', 'AG', 'AR', 'AM', 'AW', 'AU', 'AT', 'AZ',
  'BS', 'BH', 'BD', 'BB', 'BY', 'BE', 'BZ', 'BJ', 'BM', 'BT', 'BO', 'BQ', 'BA', 'BW', 'BV', 'BR',
  'IO', 'BN', 'BG', 'BF', 'BI', 'CV', 'KH', 'CM', 'CA', 'KY', 'CF', 'TD', 'CL', 'CN', 'CX', 'CC',
  'CO', 'KM', 'CG', 'CD', 'CK', 'CR', 'CI', 'HR', 'CU', 'CW', 'CY', 'CZ', 'DK', 'DJ', 'DM', 'DO',
  'EC', 'EG', 'SV', 'GQ', 'ER', 'EE', 'SZ', 'ET', 'FK', 'FO', 'FJ', 'FI', 'FR', 'GF', 'PF', 'TF',
  'GA', 'GM', 'GE', 'DE', 'GH', 'GI', 'GR', 'GL', 'GD', 'GP', 'GU', 'GT', 'GG', 'GN', 'GW', 'GY',
  'HT', 'HM', 'VA', 'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IM', 'IL', 'IT', 'JM',
  'JP', 'JE', 'JO', 'KZ', 'KE', 'KI', 'KP', 'KR', 'KW', 'KG', 'LA', 'LV', 'LB', 'LS', 'LR', 'LY',
  'LI', 'LT', 'LU', 'MO', 'MG', 'MW', 'MY', 'MV', 'ML', 'MT', 'MH', 'MQ', 'MR', 'MU', 'YT', 'MX',
  'FM', 'MD', 'MC', 'MN', 'ME', 'MS', 'MA', 'MZ', 'MM', 'NA', 'NR', 'NP', 'NL', 'NC', 'NZ', 'NI',
  'NE', 'NG', 'NU', 'NF', 'MK', 'MP', 'NO', 'OM', 'PK', 'PW', 'PS', 'PA', 'PG', 'PY', 'PE', 'PH',
  'PN', 'PL', 'PT', 'PR', 'QA', 'RE', 'RO', 'RU', 'RW', 'BL', 'SH', 'KN', 'LC', 'MF', 'PM', 'VC',
  'WS', 'SM', 'ST', 'SA', 'SN', 'RS', 'SC', 'SL', 'SG', 'SX', 'SK', 'SI', 'SB', 'SO', 'ZA', 'GS',
  'SS', 'ES', 'LK', 'SD', 'SR', 'SJ', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TZ', 'TH', 'TL', 'TG', 'TK',
  'TO', 'TT', 'TN', 'TR', 'TM', 'TC', 'TV', 'UG', 'UA', 'AE', 'GB', 'US', 'UM', 'UY', 'UZ', 'VU',
  'VE', 'VN', 'VG', 'VI', 'WF', 'EH', 'YE', 'ZM', 'ZW'
]);

// Special pseudocountry or Cloudflare-internal codes that MUST NEVER be confirmed as billing countries
export const DISALLOWED_PSEUDO_CODES = new Set(['XX', 'T1', 'A1', 'A2', 'O1']);

export interface ConfirmBillingCountryParams {
  country: string;
  postalCode: string;
}

export interface ConfirmedBillingRegion {
  billingCountry: string;
  billingPostalCode: string;
  currency: CurrencyCode;
  countryConfirmed: boolean;
}

export class BillingCountryService {
  /**
   * Validates and normalizes an ISO 3166-1 alpha-2 country code.
   * Throws ValidationError if invalid, pseudocountry, or malformed.
   */
  static validateAndNormalizeCountry(rawCountry: unknown): string {
    if (typeof rawCountry !== 'string') {
      throw new ValidationError('Country code must be a string');
    }

    const trimmed = rawCountry.trim().toUpperCase();

    if (!trimmed || trimmed.length !== 2) {
      throw new ValidationError(`Invalid country code '${rawCountry}'. Must be a 2-letter ISO 3166-1 alpha-2 code`);
    }

    if (DISALLOWED_PSEUDO_CODES.has(trimmed)) {
      throw new ValidationError(`Country code '${trimmed}' is a reserved/pseudocountry code and cannot be used for billing`);
    }

    if (!ISO_3166_1_ALPHA_2_CODES.has(trimmed)) {
      throw new ValidationError(`Unknown or unsupported ISO 3166-1 alpha-2 country code '${trimmed}'`);
    }

    return trimmed;
  }

  /**
   * Validates and sanitizes a customer-provided postal code.
   * Enforces reasonable length (2 to 20 characters), non-emptiness, and standard international formats.
   */
  static validateAndNormalizePostalCode(rawPostalCode: unknown): string {
    if (typeof rawPostalCode !== 'string') {
      throw new ValidationError('Postal code must be a string');
    }

    const trimmed = rawPostalCode.trim();

    if (!trimmed) {
      throw new ValidationError('Postal code cannot be empty');
    }

    if (trimmed.length < 2 || trimmed.length > 20) {
      throw new ValidationError('Postal code must be between 2 and 20 characters in length');
    }

    // Accepts letters, numbers, spaces, and hyphens (standard worldwide postal formats e.g. SW1A 1AA, 392001, 90210-1234, K1A 0B1)
    const postalRegex = /^[a-zA-Z0-9\s\-]+$/;
    if (!postalRegex.test(trimmed)) {
      throw new ValidationError('Postal code contains invalid characters');
    }

    return trimmed;
  }

  /**
   * Derives authoritative billing currency exclusively from the confirmed country code.
   * IN -> INR, all other valid countries -> USD.
   */
  static deriveBillingCurrency(countryCode: string): CurrencyCode {
    const normalized = countryCode.trim().toUpperCase();
    if (normalized === 'IN') {
      return CurrencyCode.INR;
    }
    return CurrencyCode.USD;
  }

  /**
   * Confirms and persists the customer's authoritative billing country and postal code.
   * Atomically derives currency, updates AccountBillingState, records an audit event,
   * and preserves existing subscription terms without mutation.
   */
  static async confirmBillingCountry(
    userId: string,
    params: ConfirmBillingCountryParams
  ): Promise<ConfirmedBillingRegion> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    // 1. Validate & normalize inputs
    const normalizedCountry = this.validateAndNormalizeCountry(params.country);
    const normalizedPostalCode = this.validateAndNormalizePostalCode(params.postalCode);
    const derivedCurrency = this.deriveBillingCurrency(normalizedCountry);

    // 2. Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('User account not found');
    }

    // 3. Atomic transaction with row locking
    return await prisma.$transaction(async (tx) => {
      // Row-lock User record to serialize concurrent billing state updates
      await tx.$executeRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', user.id);

      // Fetch or lazily initialize AccountBillingState
      let billingState = await tx.accountBillingState.findUnique({
        where: { userId: user.id }
      });

      const oldCountry = billingState?.billingCountry || null;
      const oldCurrency = billingState?.currency || CurrencyCode.INR;

      if (!billingState) {
        billingState = await tx.accountBillingState.create({
          data: {
            userId: user.id,
            billingCountry: normalizedCountry,
            billingPostalCode: normalizedPostalCode,
            currency: derivedCurrency
          }
        });
      } else {
        billingState = await tx.accountBillingState.update({
          where: { id: billingState.id },
          data: {
            billingCountry: normalizedCountry,
            billingPostalCode: normalizedPostalCode,
            currency: derivedCurrency
          }
        });
      }

      // Record Audit Event for billing state update
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          eventType: AuditEventType.BILLING_STATE_UPDATED,
          metadata: {
            action: 'CONFIRM_BILLING_COUNTRY',
            oldCountry,
            newCountry: normalizedCountry,
            oldCurrency,
            newCurrency: derivedCurrency,
            postalCode: normalizedPostalCode
          }
        }
      });

      return {
        billingCountry: billingState.billingCountry!,
        billingPostalCode: billingState.billingPostalCode!,
        currency: derivedCurrency,
        countryConfirmed: true
      };
    }, { maxWait: 15000, timeout: 30000 });
  }
}
