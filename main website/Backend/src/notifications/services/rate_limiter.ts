/**
 * RemoteNode Multi-Tier Notification Rate Limiter
 * Track 4 — Batch NT-1.6 Architecture
 */

import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';
import { NotificationChannel } from '../types/channel.js';
import { config } from '../../config/env.js';

export interface RateLimitCheckParams {
  userId?: string;
  deviceId?: string;
  eventType?: string;
  channel?: NotificationChannel;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  tier?: 'USER' | 'DEVICE' | 'TYPE' | 'PROVIDER' | 'GLOBAL';
  currentCount?: number;
  limit?: number;
}

export class NotificationRateLimiter {
  private userLimit: number;
  private deviceLimit: number;
  private typeLimit: number;
  private providerLimit: number;
  private globalLimit: number;

  private userTimestamps: Map<string, number[]> = new Map();
  private deviceTimestamps: Map<string, number[]> = new Map();
  private typeTimestamps: Map<string, number[]> = new Map();
  private providerTimestamps: Map<string, number[]> = new Map();
  private globalTimestamps: number[] = [];

  constructor(
    userLimit: number = config.NOTIFICATION_RATE_LIMIT_USER_PER_MINUTE ?? 30,
    deviceLimit: number = config.NOTIFICATION_RATE_LIMIT_DEVICE_PER_MINUTE ?? 20,
    typeLimit: number = config.NOTIFICATION_RATE_LIMIT_TYPE_PER_MINUTE ?? 15,
    providerLimit: number = config.NOTIFICATION_RATE_LIMIT_PROVIDER_PER_MINUTE ?? 60,
    globalLimit: number = config.NOTIFICATION_RATE_LIMIT_GLOBAL_PER_MINUTE ?? 300
  ) {
    this.userLimit = userLimit;
    this.deviceLimit = deviceLimit;
    this.typeLimit = typeLimit;
    this.providerLimit = providerLimit;
    this.globalLimit = globalLimit;
  }

  /**
   * Evaluates sliding window timestamps within 60 seconds (60,000ms).
   */
  private filterSlidingWindow(timestamps: number[], now: number, windowMs: number = 60000): number[] {
    const cutoff = now - windowMs;
    return timestamps.filter((t) => t > cutoff);
  }

  public checkRateLimit(params: RateLimitCheckParams): RateLimitCheckResult {
    // 1. SECURITY & CRITICAL events bypass ALL rate limits!
    if (
      params.category === NotificationCategory.ACCOUNT_SECURITY ||
      params.category === ('SECURITY' as any) ||
      params.severity === NotificationSeverity.SECURITY ||
      params.severity === NotificationSeverity.CRITICAL
    ) {
      return { allowed: true };
    }

    const now = Date.now();

    // 2. User Level Check
    if (params.userId) {
      const existing = this.filterSlidingWindow(this.userTimestamps.get(params.userId) || [], now);
      if (existing.length >= this.userLimit) {
        return { allowed: false, tier: 'USER', currentCount: existing.length, limit: this.userLimit };
      }
    }

    // 3. Device Level Check
    if (params.deviceId) {
      const existing = this.filterSlidingWindow(this.deviceTimestamps.get(params.deviceId) || [], now);
      if (existing.length >= this.deviceLimit) {
        return { allowed: false, tier: 'DEVICE', currentCount: existing.length, limit: this.deviceLimit };
      }
    }

    // 4. Type Level Check
    if (params.eventType) {
      const existing = this.filterSlidingWindow(this.typeTimestamps.get(params.eventType) || [], now);
      if (existing.length >= this.typeLimit) {
        return { allowed: false, tier: 'TYPE', currentCount: existing.length, limit: this.typeLimit };
      }
    }

    // 5. Provider Level Check
    if (params.channel) {
      const existing = this.filterSlidingWindow(this.providerTimestamps.get(params.channel) || [], now);
      if (existing.length >= this.providerLimit) {
        return { allowed: false, tier: 'PROVIDER', currentCount: existing.length, limit: this.providerLimit };
      }
    }

    // 6. Global Level Check
    const globalExisting = this.filterSlidingWindow(this.globalTimestamps, now);
    if (globalExisting.length >= this.globalLimit) {
      return { allowed: false, tier: 'GLOBAL', currentCount: globalExisting.length, limit: this.globalLimit };
    }

    return { allowed: true };
  }

  public recordEvent(params: RateLimitCheckParams): void {
    const now = Date.now();

    if (params.userId) {
      const list = this.filterSlidingWindow(this.userTimestamps.get(params.userId) || [], now);
      list.push(now);
      this.userTimestamps.set(params.userId, list);
    }

    if (params.deviceId) {
      const list = this.filterSlidingWindow(this.deviceTimestamps.get(params.deviceId) || [], now);
      list.push(now);
      this.deviceTimestamps.set(params.deviceId, list);
    }

    if (params.eventType) {
      const list = this.filterSlidingWindow(this.typeTimestamps.get(params.eventType) || [], now);
      list.push(now);
      this.typeTimestamps.set(params.eventType, list);
    }

    if (params.channel) {
      const list = this.filterSlidingWindow(this.providerTimestamps.get(params.channel) || [], now);
      list.push(now);
      this.providerTimestamps.set(params.channel, list);
    }

    this.globalTimestamps = this.filterSlidingWindow(this.globalTimestamps, now);
    this.globalTimestamps.push(now);
  }

  public reset(): void {
    this.userTimestamps.clear();
    this.deviceTimestamps.clear();
    this.typeTimestamps.clear();
    this.providerTimestamps.clear();
    this.globalTimestamps = [];
  }
}

export const notificationRateLimiter = new NotificationRateLimiter();
