import { prisma } from '../../config/database.js';
import { CurrencyCode, AuditEventType } from '@prisma/client';
import { ValidationError, NotFoundError } from '../../errors/app-error.js';
import { BillingCountryService } from './billing_country_service.js';

export interface UpdateBillingProfileParams {
  fullName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface BillingProfileData {
  fullName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  currency: CurrencyCode | null;
  countryConfirmed: boolean;
}

export class BillingProfileService {
  /**
   * Validates and normalizes full name.
   */
  static validateFullName(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new ValidationError('Full name must be a string');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new ValidationError('Full name is required');
    }
    if (trimmed.length > 150) {
      throw new ValidationError('Full name cannot exceed 150 characters');
    }
    return trimmed;
  }

  /**
   * Validates and normalizes street address line 1.
   */
  static validateAddressLine1(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new ValidationError('Address line 1 must be a string');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new ValidationError('Address line 1 is required');
    }
    if (trimmed.length > 255) {
      throw new ValidationError('Address line 1 cannot exceed 255 characters');
    }
    return trimmed;
  }

  /**
   * Validates and normalizes optional street address line 2.
   */
  static validateAddressLine2(raw: unknown): string | null {
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    if (typeof raw !== 'string') {
      throw new ValidationError('Address line 2 must be a string');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.length > 255) {
      throw new ValidationError('Address line 2 cannot exceed 255 characters');
    }
    return trimmed;
  }

  /**
   * Validates and normalizes city name.
   */
  static validateCity(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new ValidationError('City must be a string');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new ValidationError('City is required');
    }
    if (trimmed.length > 100) {
      throw new ValidationError('City cannot exceed 100 characters');
    }
    return trimmed;
  }

  /**
   * Validates and normalizes state / province / region.
   */
  static validateState(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new ValidationError('State/Province/Region must be a string');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new ValidationError('State/Province/Region is required');
    }
    if (trimmed.length > 100) {
      throw new ValidationError('State/Province/Region cannot exceed 100 characters');
    }
    return trimmed;
  }

  /**
   * Retrieves the authoritative billing profile for an authenticated user.
   */
  static async getBillingProfile(userId: string): Promise<BillingProfileData> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        billingState: true
      }
    });

    if (!user) {
      throw new NotFoundError('User account not found');
    }

    const bs = user.billingState;

    return {
      fullName: bs?.billingName || user.fullName || '',
      addressLine1: bs?.billingAddress1 || '',
      addressLine2: bs?.billingAddress2 || null,
      city: bs?.billingCity || '',
      state: bs?.billingState || '',
      postalCode: bs?.billingPostalCode || '',
      country: bs?.billingCountry || '',
      currency: bs?.currency || (bs?.billingCountry ? BillingCountryService.deriveBillingCurrency(bs.billingCountry) : null),
      countryConfirmed: Boolean(bs?.billingCountry)
    };
  }

  /**
   * Atomically validates, normalizes, and persists the customer's authoritative billing profile.
   */
  static async updateBillingProfile(
    userId: string,
    params: UpdateBillingProfileParams
  ): Promise<BillingProfileData> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    // 1. Strict Validation & Normalization
    const fullName = this.validateFullName(params.fullName);
    const addressLine1 = this.validateAddressLine1(params.addressLine1);
    const addressLine2 = this.validateAddressLine2(params.addressLine2);
    const city = this.validateCity(params.city);
    const state = this.validateState(params.state);
    const postalCode = BillingCountryService.validateAndNormalizePostalCode(params.postalCode);
    const country = BillingCountryService.validateAndNormalizeCountry(params.country);
    const derivedCurrency = BillingCountryService.deriveBillingCurrency(country);

    // 2. Verify User Exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User account not found');
    }

    // 3. Atomic Transaction with Row Locking
    return await prisma.$transaction(async (tx) => {
      // Row-lock User record to prevent concurrent race conditions
      await tx.$executeRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', user.id);

      // Fetch or create AccountBillingState
      let billingState = await tx.accountBillingState.findUnique({
        where: { userId: user.id }
      });

      const oldCountry = billingState?.billingCountry || null;
      const oldCurrency = billingState?.currency || null;

      if (!billingState) {
        billingState = await tx.accountBillingState.create({
          data: {
            userId: user.id,
            billingName: fullName,
            billingAddress1: addressLine1,
            billingAddress2: addressLine2,
            billingCity: city,
            billingState: state,
            billingPostalCode: postalCode,
            billingCountry: country,
            currency: derivedCurrency
          }
        });
      } else {
        billingState = await tx.accountBillingState.update({
          where: { id: billingState.id },
          data: {
            billingName: fullName,
            billingAddress1: addressLine1,
            billingAddress2: addressLine2,
            billingCity: city,
            billingState: state,
            billingPostalCode: postalCode,
            billingCountry: country,
            currency: derivedCurrency
          }
        });
      }

      // Sync user.fullName if empty or previously unset
      if (!user.fullName) {
        await tx.user.update({
          where: { id: user.id },
          data: { fullName }
        });
      }

      // Record Audit Event for billing profile modification
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          eventType: AuditEventType.BILLING_STATE_UPDATED,
          metadata: {
            action: 'UPDATE_BILLING_PROFILE',
            oldCountry,
            newCountry: country,
            oldCurrency,
            newCurrency: derivedCurrency,
            fullName,
            city,
            state,
            postalCode
          }
        }
      });

      return {
        fullName: billingState.billingName || fullName,
        addressLine1: billingState.billingAddress1 || addressLine1,
        addressLine2: billingState.billingAddress2,
        city: billingState.billingCity || city,
        state: billingState.billingState || state,
        postalCode: billingState.billingPostalCode || postalCode,
        country: billingState.billingCountry || country,
        currency: derivedCurrency,
        countryConfirmed: true
      };
    }, { maxWait: 15000, timeout: 30000 });
  }
}
