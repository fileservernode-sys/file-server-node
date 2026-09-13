import { config } from './env.js';
import { RazorpayProviderError } from '../services/billing/providers/razorpay/razorpay_error.js';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  baseUrl: string;
  timeoutMs: number;
  isConfigured: boolean;
  isComplete: boolean;
}

/**
 * Returns structured Razorpay configuration.
 * Allows passing optional custom environment overrides for unit tests.
 */
export function getRazorpayConfig(customEnv?: {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  baseUrl?: string;
  timeoutMs?: number;
}): RazorpayConfig {
  const keyId = customEnv?.keyId !== undefined ? customEnv.keyId : config.RAZORPAY_KEY_ID;
  const keySecret = customEnv?.keySecret !== undefined ? customEnv.keySecret : config.RAZORPAY_KEY_SECRET;
  const webhookSecret = customEnv?.webhookSecret !== undefined ? customEnv.webhookSecret : config.RAZORPAY_WEBHOOK_SECRET;
  const baseUrl = customEnv?.baseUrl || config.RAZORPAY_BASE_URL || 'https://api.razorpay.com/v1';
  const timeoutMs = customEnv?.timeoutMs || config.RAZORPAY_REQUEST_TIMEOUT_MS || 10000;

  const hasKeyId = Boolean(keyId && keyId.trim().length > 0);
  const hasKeySecret = Boolean(keySecret && keySecret.trim().length > 0);

  const isConfigured = hasKeyId || hasKeySecret;
  const isComplete = hasKeyId && hasKeySecret;

  return {
    keyId: keyId ? keyId.trim() : '',
    keySecret: keySecret ? keySecret.trim() : '',
    webhookSecret: webhookSecret ? webhookSecret.trim() : '',
    baseUrl: baseUrl.trim(),
    timeoutMs,
    isConfigured,
    isComplete
  };
}

/**
 * Check if Razorpay is fully configured and ready for API operations.
 */
export function isRazorpayConfigured(customEnv?: {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}): boolean {
  const cfg = getRazorpayConfig(customEnv);
  return cfg.isComplete;
}

/**
 * Asserts that Razorpay is fully and correctly configured.
 * Throws a sanitized RazorpayProviderError if unconfigured or partially configured.
 */
export function assertRazorpayConfigured(customEnv?: {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}): RazorpayConfig {
  const cfg = getRazorpayConfig(customEnv);

  if (!cfg.isConfigured) {
    throw new RazorpayProviderError(
      'NOT_CONFIGURED',
      'Razorpay payment gateway is not configured. Missing RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
    );
  }

  if (!cfg.isComplete) {
    if (!cfg.keyId) {
      throw new RazorpayProviderError(
        'PARTIAL_CONFIG',
        'Razorpay configuration is incomplete: RAZORPAY_KEY_ID is missing.'
      );
    }
    if (!cfg.keySecret) {
      throw new RazorpayProviderError(
        'PARTIAL_CONFIG',
        'Razorpay configuration is incomplete: RAZORPAY_KEY_SECRET is missing.'
      );
    }
  }

  return cfg;
}

/**
 * Asserts that the Razorpay webhook secret is configured.
 */
export function assertRazorpayWebhookConfigured(customEnv?: {
  webhookSecret?: string;
}): string {
  const cfg = getRazorpayConfig(customEnv);
  if (!cfg.webhookSecret) {
    throw new RazorpayProviderError(
      'WEBHOOK_SECRET_MISSING',
      'Razorpay webhook secret is not configured. Missing RAZORPAY_WEBHOOK_SECRET.'
    );
  }
  return cfg.webhookSecret;
}
