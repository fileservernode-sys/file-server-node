/**
 * Centralized Email Failure & Retry Classifier
 * Phase 13.10 Architecture
 */

import { EmailMessageStatus } from '@prisma/client';

export enum EmailFailureDisposition {
  RETRYABLE = 'RETRYABLE',
  PERMANENT = 'PERMANENT',
  ALREADY_DELIVERED = 'ALREADY_DELIVERED',
  BLOCKED = 'BLOCKED',
  SPAM = 'SPAM',
  EXHAUSTED = 'EXHAUSTED',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN'
}

export interface EmailFailureClassificationInput {
  errorMessage?: string | null;
  providerResponseCode?: string | number | null;
  providerEvent?: string | null;
  httpStatusCode?: number | null;
  attemptCount: number;
  maxAttempts?: number;
  currentStatus?: EmailMessageStatus | null;
  isCircuitOpen?: boolean;
}

export interface EmailFailureClassificationResult {
  disposition: EmailFailureDisposition;
  shouldRetry: boolean;
  terminalStatus?: EmailMessageStatus;
  recommendedDelayMs: number;
  nextRetryAt?: Date;
  normalizedReason: string;
  isTerminal: boolean;
}

export interface EmailRetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  maxJitterMs: number;
}

export const DEFAULT_EMAIL_RETRY_CONFIG: EmailRetryConfig = Object.freeze({
  maxAttempts: 5,
  initialDelayMs: 60000,   // 1 minute
  backoffFactor: 2,        // Exponential x2
  maxDelayMs: 3600000,     // Max 1 hour
  maxJitterMs: 1000        // Bounded 1s jitter
});

// Regex patterns for permanent vs transient failures
const PERMANENT_PATTERNS = [
  /invalid recipient/i,
  /invalid email/i,
  /user not found/i,
  /recipient rejected/i,
  /invalid_address/i,
  /auth failure/i,
  /invalid credentials/i,
  /unauthorized/i,
  /invalid_api_key/i,
  /bad request/i,
  /hard.?bounce/i,
  /unregistered/i,
  /blocked/i,
  /spam/i
];

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /etimedout/i,
  /econnreset/i,
  /econnrefused/i,
  /network error/i,
  /rate limit/i,
  /too many requests/i,
  /quota exceeded/i,
  /service unavailable/i,
  /deferred/i,
  /soft.?bounce/i
];

import { sanitizeFailureReason } from '../utils/email_sanitizer.js';
export { sanitizeFailureReason };

/**
 * Calculates exponential backoff date with bounded jitter
 */
export function calculateNextRetryDate(
  attemptNumber: number,
  customDelayMs?: number,
  config: EmailRetryConfig = DEFAULT_EMAIL_RETRY_CONFIG
): Date {
  if (customDelayMs && customDelayMs > 0) {
    const jitter = config.maxJitterMs > 0 ? Math.floor(Math.random() * config.maxJitterMs) : 0;
    return new Date(Date.now() + customDelayMs + jitter);
  }

  const rawDelay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffFactor, Math.max(0, attemptNumber - 1)),
    config.maxDelayMs
  );
  const jitter = config.maxJitterMs > 0 ? Math.floor(Math.random() * config.maxJitterMs) : 0;
  return new Date(Date.now() + rawDelay + jitter);
}

/**
 * Authoritative single classification function for email delivery failures and retry decisions.
 */
export function classifyEmailFailure(
  input: EmailFailureClassificationInput,
  retryConfig: EmailRetryConfig = DEFAULT_EMAIL_RETRY_CONFIG
): EmailFailureClassificationResult {
  const maxAttempts = input.maxAttempts || retryConfig.maxAttempts;
  const safeMessage = sanitizeFailureReason(input.errorMessage);
  const providerEvent = (input.providerEvent || '').toLowerCase().trim();
  const rawCode = String(input.providerResponseCode || input.httpStatusCode || '').trim();

  // 1. Terminal Check: Message already delivered
  if (input.currentStatus === EmailMessageStatus.DELIVERED || providerEvent === 'delivered') {
    return {
      disposition: EmailFailureDisposition.ALREADY_DELIVERED,
      shouldRetry: false,
      terminalStatus: EmailMessageStatus.DELIVERED,
      recommendedDelayMs: 0,
      normalizedReason: 'Message is already delivered',
      isTerminal: true
    };
  }

  // 2. Circuit Breaker Guard: Circuit is open
  if (input.isCircuitOpen) {
    const nextRetryAt = calculateNextRetryDate(input.attemptCount, 60000, retryConfig);
    return {
      disposition: EmailFailureDisposition.CIRCUIT_OPEN,
      shouldRetry: true,
      recommendedDelayMs: 60000,
      nextRetryAt,
      normalizedReason: 'Transport provider circuit breaker is OPEN',
      isTerminal: false
    };
  }

  // 3. Provider Event Classification
  if (providerEvent === 'hard_bounce' || providerEvent === 'invalid_email' || providerEvent === 'invalid') {
    return {
      disposition: EmailFailureDisposition.PERMANENT,
      shouldRetry: false,
      terminalStatus: EmailMessageStatus.BOUNCED,
      recommendedDelayMs: 0,
      normalizedReason: `Hard bounce reported by provider: ${safeMessage}`,
      isTerminal: true
    };
  }

  if (providerEvent === 'blocked') {
    return {
      disposition: EmailFailureDisposition.BLOCKED,
      shouldRetry: false,
      terminalStatus: EmailMessageStatus.BLOCKED,
      recommendedDelayMs: 0,
      normalizedReason: `Suppressed/blocked by provider: ${safeMessage}`,
      isTerminal: true
    };
  }

  if (providerEvent === 'spam') {
    return {
      disposition: EmailFailureDisposition.SPAM,
      shouldRetry: false,
      terminalStatus: EmailMessageStatus.SPAM,
      recommendedDelayMs: 0,
      normalizedReason: `Spam complaint registered: ${safeMessage}`,
      isTerminal: true
    };
  }

  if (providerEvent === 'soft_bounce' || providerEvent === 'deferred') {
    if (input.attemptCount >= maxAttempts) {
      return {
        disposition: EmailFailureDisposition.EXHAUSTED,
        shouldRetry: false,
        terminalStatus: EmailMessageStatus.PERMANENTLY_FAILED,
        recommendedDelayMs: 0,
        normalizedReason: `Retry attempts exhausted (${input.attemptCount}/${maxAttempts}) following provider ${providerEvent}: ${safeMessage}`,
        isTerminal: true
      };
    }

    const delayMs = providerEvent === 'deferred' ? 120000 : 60000;
    const nextRetryAt = calculateNextRetryDate(input.attemptCount, delayMs, retryConfig);
    return {
      disposition: EmailFailureDisposition.RETRYABLE,
      shouldRetry: true,
      recommendedDelayMs: delayMs,
      nextRetryAt,
      normalizedReason: `Temporary provider ${providerEvent}: ${safeMessage}`,
      isTerminal: false
    };
  }

  // 4. HTTP Status Code Classification
  if (rawCode === '401' || rawCode === '403') {
    return {
      disposition: EmailFailureDisposition.PERMANENT,
      shouldRetry: false,
      terminalStatus: EmailMessageStatus.FAILED,
      recommendedDelayMs: 0,
      normalizedReason: `Provider authentication error (${rawCode}): ${safeMessage}`,
      isTerminal: true
    };
  }

  if (rawCode === '400' || rawCode === '404' || rawCode === '422') {
    return {
      disposition: EmailFailureDisposition.PERMANENT,
      shouldRetry: false,
      terminalStatus: EmailMessageStatus.FAILED,
      recommendedDelayMs: 0,
      normalizedReason: `Unrecoverable request error (${rawCode}): ${safeMessage}`,
      isTerminal: true
    };
  }

  if (rawCode === '429') {
    if (input.attemptCount >= maxAttempts) {
      return {
        disposition: EmailFailureDisposition.EXHAUSTED,
        shouldRetry: false,
        terminalStatus: EmailMessageStatus.PERMANENTLY_FAILED,
        recommendedDelayMs: 0,
        normalizedReason: `Retry attempts exhausted on rate limit (${input.attemptCount}/${maxAttempts})`,
        isTerminal: true
      };
    }
    const delayMs = 120000; // 2 minutes backoff on 429
    const nextRetryAt = calculateNextRetryDate(input.attemptCount, delayMs, retryConfig);
    return {
      disposition: EmailFailureDisposition.RETRYABLE,
      shouldRetry: true,
      recommendedDelayMs: delayMs,
      nextRetryAt,
      normalizedReason: `Provider rate limited (429): ${safeMessage}`,
      isTerminal: false
    };
  }

  if (rawCode === '500' || rawCode === '502' || rawCode === '503' || rawCode === '504' || rawCode === '408') {
    if (input.attemptCount >= maxAttempts) {
      return {
        disposition: EmailFailureDisposition.EXHAUSTED,
        shouldRetry: false,
        terminalStatus: EmailMessageStatus.PERMANENTLY_FAILED,
        recommendedDelayMs: 0,
        normalizedReason: `Retry attempts exhausted on server error (${rawCode}): ${safeMessage}`,
        isTerminal: true
      };
    }
    const nextRetryAt = calculateNextRetryDate(input.attemptCount, undefined, retryConfig);
    return {
      disposition: EmailFailureDisposition.RETRYABLE,
      shouldRetry: true,
      recommendedDelayMs: 60000,
      nextRetryAt,
      normalizedReason: `Transient provider server error (${rawCode}): ${safeMessage}`,
      isTerminal: false
    };
  }

  // 5. Pattern Match on Error Message
  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(safeMessage)) {
      return {
        disposition: EmailFailureDisposition.PERMANENT,
        shouldRetry: false,
        terminalStatus: EmailMessageStatus.FAILED,
        recommendedDelayMs: 0,
        normalizedReason: `Permanent delivery rejection: ${safeMessage}`,
        isTerminal: true
      };
    }
  }

  // 6. Attempt Count Exhaustion Check
  if (input.attemptCount >= maxAttempts) {
    return {
      disposition: EmailFailureDisposition.EXHAUSTED,
      shouldRetry: false,
      terminalStatus: EmailMessageStatus.PERMANENTLY_FAILED,
      recommendedDelayMs: 0,
      normalizedReason: `Maximum retry attempts exceeded (${input.attemptCount}/${maxAttempts}): ${safeMessage}`,
      isTerminal: true
    };
  }

  // 7. Default Transient Failure with Exponential Backoff
  const nextRetryAt = calculateNextRetryDate(input.attemptCount, undefined, retryConfig);
  return {
    disposition: EmailFailureDisposition.RETRYABLE,
    shouldRetry: true,
    recommendedDelayMs: 60000,
    nextRetryAt,
    normalizedReason: `Transient delivery failure: ${safeMessage}`,
    isTerminal: false
  };
}
