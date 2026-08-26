/**
 * RemoteNode Notification Retry Policy and Error Classification
 * Track 4 — Batch NT-1.1 Architecture
 */

import { DeliveryStatus } from '../types/lifecycle.js';

export enum DeliveryFailureCategory {
  TEMPORARY = 'TEMPORARY',
  PERMANENT = 'PERMANENT'
}

export interface RetryDecision {
  nextStatus: DeliveryStatus;
  failureCategory: DeliveryFailureCategory;
  shouldRetry: boolean;
  nextAttemptAt?: Date;
  attemptCount: number;
}

export interface RetryPolicyOptions {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryPolicyOptions = Object.freeze({
  maxAttempts: 5,
  initialDelayMs: 60000, // 1 minute
  backoffFactor: 2,
  maxDelayMs: 3600000 // 1 hour
});

const PERMANENT_ERROR_PATTERNS = [
  /invalid recipient/i,
  /user not found/i,
  /invalid email/i,
  /invalid push token/i,
  /unregistered device/i,
  /not_found/i,
  /recipient rejected/i
];

export function classifyDeliveryError(errorMessage: string): DeliveryFailureCategory {
  if (!errorMessage) return DeliveryFailureCategory.TEMPORARY;

  for (const pattern of PERMANENT_ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return DeliveryFailureCategory.PERMANENT;
    }
  }

  return DeliveryFailureCategory.TEMPORARY;
}

export function calculateRetryDecision(
  currentAttempt: number,
  errorMessage: string,
  options: Partial<RetryPolicyOptions> = {}
): RetryDecision {
  const opts: RetryPolicyOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const failureCategory = classifyDeliveryError(errorMessage);

  if (failureCategory === DeliveryFailureCategory.PERMANENT) {
    return {
      nextStatus: DeliveryStatus.PERMANENTLY_FAILED,
      failureCategory,
      shouldRetry: false,
      attemptCount: currentAttempt
    };
  }

  if (currentAttempt >= opts.maxAttempts) {
    return {
      nextStatus: DeliveryStatus.PERMANENTLY_FAILED,
      failureCategory,
      shouldRetry: false,
      attemptCount: currentAttempt
    };
  }

  // Calculate exponential backoff delay
  const delayMs = Math.min(
    opts.initialDelayMs * Math.pow(opts.backoffFactor, currentAttempt - 1),
    opts.maxDelayMs
  );
  const nextAttemptAt = new Date(Date.now() + delayMs);

  return {
    nextStatus: DeliveryStatus.RETRYING,
    failureCategory,
    shouldRetry: true,
    nextAttemptAt,
    attemptCount: currentAttempt
  };
}
