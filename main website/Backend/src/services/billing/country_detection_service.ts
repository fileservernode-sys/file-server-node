import { config } from '../../config/env.js';

export type CountryDetectionSource = 'CLOUDFLARE' | 'DEV_OVERRIDE' | 'UNKNOWN';
export type CountryConfidence = 'IP_ESTIMATE' | 'UNKNOWN';

export interface DetectedCountryResult {
  countryCode: string | null;
  countrySource: CountryDetectionSource;
  confidence: CountryConfidence;
  currency: 'INR' | 'USD';
  countryConfirmed: false;
}

// Set of pseudo-country or special codes returned by Cloudflare that must be treated as UNKNOWN
const CLOUDFLARE_SPECIAL_CODES = new Set([
  'XX', // Unknown country / no geolocation data
  'T1', // Tor network
  'A1', // Anonymous proxy
  'A2', // Satellite provider
  'O1'  // Other country
]);

// ISO 3166-1 alpha-2 validation pattern: exactly two ASCII letters
const ISO_ALPHA2_REGEX = /^[A-Z]{2}$/;

export class CountryDetectionService {
  /**
   * Detects the storefront country from incoming HTTP request headers.
   * 
   * CRITICAL INVARIANTS:
   * 1. This signal is request-scoped, IP-estimated, and NON-AUTHORITATIVE.
   * 2. It is used strictly for initial storefront display currency and region hints.
   * 3. It MUST NOT be persisted into AccountBillingState.billingCountry or mutate user profiles.
   * 4. It MUST NOT be used as the authoritative billing country for checkout or tax calculation.
   * 
   * @param headers HTTP Request headers
   * @returns DetectedCountryResult
   */
  public static detect(headers: Record<string, string | string[] | undefined> = {}): DetectedCountryResult {
    // 1. Development/Testing Override Check (Strictly disabled in production)
    const isNonProduction = config.NODE_ENV === 'development' || config.NODE_ENV === 'test';
    
    if (isNonProduction) {
      const devOverride = this.extractHeader(headers, 'x-dev-country-override');
      if (devOverride) {
        const normalizedDev = this.normalizeCountryCode(devOverride);
        if (normalizedDev) {
          return {
            countryCode: normalizedDev,
            countrySource: 'DEV_OVERRIDE',
            confidence: 'IP_ESTIMATE',
            currency: normalizedDev === 'IN' ? 'INR' : 'USD',
            countryConfirmed: false
          };
        }
      }
    }

    // 2. Primary Signal: Cloudflare CF-IPCountry Header
    const rawCountry = this.extractHeader(headers, 'cf-ipcountry');

    if (!rawCountry) {
      return this.unknownFallback();
    }

    // 3. Normalization and Validation
    const normalizedCountry = this.normalizeCountryCode(rawCountry);

    if (!normalizedCountry) {
      return this.unknownFallback();
    }

    // 4. Storefront Currency Mapping (IN -> INR, all other countries -> USD)
    const currency = normalizedCountry === 'IN' ? 'INR' : 'USD';

    return {
      countryCode: normalizedCountry,
      countrySource: 'CLOUDFLARE',
      confidence: 'IP_ESTIMATE',
      currency,
      countryConfirmed: false
    };
  }

  /**
   * Safely extracts a header value from the headers dictionary.
   */
  private static extractHeader(
    headers: Record<string, string | string[] | undefined>,
    headerName: string
  ): string | null {
    const target = headerName.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === target) {
        const val = headers[key];
        if (Array.isArray(val)) {
          return val.length > 0 ? val[0] : null;
        }
        return typeof val === 'string' ? val : null;
      }
    }
    return null;
  }

  /**
   * Validates and normalizes country string to ISO 3166-1 alpha-2 uppercase.
   * Returns null if invalid or matching Cloudflare special/unknown codes.
   */
  public static normalizeCountryCode(raw: string): string | null {
    if (!raw || typeof raw !== 'string') return null;

    const trimmed = raw.trim().toUpperCase();

    // Must be exactly 2 ASCII uppercase letters
    if (!ISO_ALPHA2_REGEX.test(trimmed)) {
      return null;
    }

    // Reject Cloudflare special pseudo-country codes
    if (CLOUDFLARE_SPECIAL_CODES.has(trimmed)) {
      return null;
    }

    return trimmed;
  }

  /**
   * Safe fallback for missing, invalid, or unknown country detection.
   */
  public static unknownFallback(): DetectedCountryResult {
    return {
      countryCode: null,
      countrySource: 'UNKNOWN',
      confidence: 'UNKNOWN',
      currency: 'USD',
      countryConfirmed: false
    };
  }
}
