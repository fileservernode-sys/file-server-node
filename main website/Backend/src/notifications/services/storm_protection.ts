/**
 * RemoteNode Notification Storm Protection & Rate Limiting Engine
 * Track 4 — Batch NT-1.1 Architecture
 */

import { NotificationType } from '../types/type_registry.js';
import { NotificationEvent } from '../types/event.js';

export interface StormProtectionRule {
  eventType: NotificationType;
  cooldownWindowMs: number;
  maxPerWindow: number;
}

export class NotificationStormProtection {
  private eventHistory: Map<string, Date[]> = new Map();
  private defaultCooldownMs: number;

  constructor(defaultCooldownSeconds: number = 300) { // 5 minutes default cooldown
    this.defaultCooldownMs = defaultCooldownSeconds * 1000;
  }

  /**
   * Generates a rate limit key based on user, event type, and target device/server
   */
  private buildKey(event: NotificationEvent): string {
    return `${event.userId}:${event.eventType}:${event.deviceId || 'nodev'}:${event.serverId || 'nosrv'}`;
  }

  /**
   * Checks whether an event should be suppressed due to rapid notification storming
   */
  public shouldSuppress(event: NotificationEvent, cooldownMs?: number): boolean {
    const key = this.buildKey(event);
    const windowMs = cooldownMs ?? this.defaultCooldownMs;
    const now = event.occurredAt || new Date();

    const timestamps = this.eventHistory.get(key) || [];
    const validTimestamps = timestamps.filter(ts => (now.getTime() - ts.getTime()) < windowMs);

    if (validTimestamps.length > 0) {
      // Cooldown active: suppress rapid repeated alert for same target entity
      return true;
    }

    validTimestamps.push(now);
    this.eventHistory.set(key, validTimestamps);
    return false;
  }

  public recordEvent(event: NotificationEvent): void {
    const key = this.buildKey(event);
    const timestamps = this.eventHistory.get(key) || [];
    timestamps.push(event.occurredAt || new Date());
    this.eventHistory.set(key, timestamps);
  }

  public reset(): void {
    this.eventHistory.clear();
  }
}

export const defaultStormProtection = new NotificationStormProtection();
