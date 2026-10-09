import { prisma } from '../../config/database.js';
import { CurrencyCode, AuditEventType } from '@prisma/client';
import { ValidationError, NotFoundError } from '../../errors/app-error.js';
import { BillingCountryService } from './billing_country_service.js';

export interface UpdateBillingProfileParams {
  fullName: string;
  country: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  companyName?: string | null;
  taxId?: string | null;
}

export interface BillingProfileData {
  fullName: string;
  email: string;
  companyName: string | null;
  taxId: string | null;
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
   * Validates and normalizes personal full legal name.
   */
  static validateFullName(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new ValidationError('Full legal name must be a string');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new ValidationError('Full legal name is required');
    }
    if (trimmed.length > 150) {
      throw new ValidationError('Full legal name cannot exceed 150 characters');
    }
    return trimmed;
  }

  /**
   * Validates and normalizes optional company or business entity name.
   */
  static validateCompanyName(raw: unknown): string | null {
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    if (typeof raw !== 'string') {
      throw new ValidationError('Company name must be a string');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.length > 150) {
      throw new ValidationError('Company name cannot exceed 150 characters');
    }
    return trimmed;
  }

  /**
   * Validates and normalizes optional tax identifier or GSTIN.
   * Enforces 15-character alphanumeric GSTIN formatting for Indian billing addresses.
   */
  static validateTaxId(raw: unknown, countryCode?: string): string | null {
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    if (typeof raw !== 'string') {
      throw new ValidationError('Tax ID must be a string');
    }
    const trimmed = raw.trim().toUpperCase();
    if (!trimmed) {
      return null;
    }
    if (trimmed.length > 50) {
      throw new ValidationError('Tax ID cannot exceed 50 characters');
    }

    if (countryCode && countryCode.trim().toUpperCase() === 'IN') {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstinRegex.test(trimmed)) {
        throw new ValidationError('Invalid GSTIN format. Expected 15-character alphanumeric GSTIN (e.g. 24AAAAA0000A1Z5)');
      }
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
   * Validates and normalizes city or locality name.
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
   * Validates and normalizes state / province / region with country awareness.
   */
  static validateState(raw: unknown, countryCode?: string): string {
    if (typeof raw !== 'string' && raw !== null && raw !== undefined) {
      throw new ValidationError('State/Province/Region must be a string');
    }
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) {
      if (countryCode && !BillingCountryService.isStateRequired(countryCode)) {
        return '';
      }
      throw new ValidationError('State/Province/Region is required for the selected country');
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

    let companyName: string | null = null;
    let taxId: string | null = null;

    try {
      const latestAudit = await prisma.auditEvent.findFirst({
        where: {
          userId: user.id,
          eventType: AuditEventType.BILLING_STATE_UPDATED
        },
        orderBy: { createdAt: 'desc' }
      });
      if (latestAudit && latestAudit.metadata && typeof latestAudit.metadata === 'object') {
        const meta = latestAudit.metadata as Record<string, unknown>;
        if (typeof meta.companyName === 'string') companyName = meta.companyName;
        if (typeof meta.taxId === 'string') taxId = meta.taxId;
      }
    } catch {
      // Non-blocking fallback
    }

    return {
      fullName: bs?.billingName || user.fullName || '',
      email: user.email,
      companyName,
      taxId,
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

    // 1. Strict Country-Aware Validation & Normalization
    const country = BillingCountryService.validateAndNormalizeCountry(params.country);
    const fullName = this.validateFullName(params.fullName);
    const companyName = this.validateCompanyName(params.companyName);
    const taxId = this.validateTaxId(params.taxId, country);
    const addressLine1 = this.validateAddressLine1(params.addressLine1);
    const addressLine2 = this.validateAddressLine2(params.addressLine2);
    const city = this.validateCity(params.city);
    const state = this.validateState(params.state, country);
    const postalCode = BillingCountryService.validateAndNormalizePostalCode(params.postalCode, country);
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
            companyName,
            taxId,
            city,
            state,
            postalCode
          }
        }
      });

      return {
        fullName: billingState.billingName || fullName,
        email: user.email,
        companyName,
        taxId,
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
