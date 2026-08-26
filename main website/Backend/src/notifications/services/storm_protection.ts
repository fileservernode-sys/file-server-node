import { NotificationType } from '../types/type_registry.js';
import { NotificationEvent } from '../types/event.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';

export interface StormProtectionRule {
  eventType: NotificationType;
  cooldownWindowMs: number;
  maxPerWindow: number;
}

const STATE_COMPLEMENT_MAP: Record<string, string> = {
  [NotificationType.DEVICE_ONLINE]: NotificationType.DEVICE_OFFLINE,
  [NotificationType.DEVICE_OFFLINE]: NotificationType.DEVICE_ONLINE,
  [NotificationType.GATEWAY_CONNECTED]: NotificationType.GATEWAY_DISCONNECTED,
  [NotificationType.GATEWAY_DISCONNECTED]: NotificationType.GATEWAY_CONNECTED,
  [NotificationType.SERVER_STARTED]: NotificationType.SERVER_STOPPED,
  [NotificationType.SERVER_STOPPED]: NotificationType.SERVER_STARTED,
  [NotificationType.SERVER_UNAVAILABLE]: NotificationType.SERVER_RECOVERED,
  [NotificationType.SERVER_RECOVERED]: NotificationType.SERVER_UNAVAILABLE,
  [NotificationType.STORAGE_WARNING]: NotificationType.STORAGE_RECOVERED,
  [NotificationType.STORAGE_CRITICAL]: NotificationType.STORAGE_RECOVERED,
  [NotificationType.STORAGE_RECOVERED]: NotificationType.STORAGE_WARNING
};

export class NotificationStormProtection {
  private eventHistory: Map<string, Date[]> = new Map();
  private stateChangeHistory: Map<string, { eventType: NotificationType; occurredAt: Date }> = new Map();
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

  private buildEntityKey(event: NotificationEvent): string {
    return `${event.userId}:${event.deviceId || 'nodev'}:${event.serverId || 'nosrv'}`;
  }

  /**
   * Evaluates if a rapid state flip (e.g. OFFLINE -> ONLINE -> OFFLINE) should be coalesced within stabilityWindowMs (default 10s)
   */
  public shouldCoalesceStateFlip(event: NotificationEvent, stabilityWindowMs: number = 10000): boolean {
    // SECURITY events MUST NEVER be coalesced!
    if (
      event.category === NotificationCategory.ACCOUNT_SECURITY ||
      event.severity === NotificationSeverity.SECURITY
    ) {
      return false;
    }

    const complementType = STATE_COMPLEMENT_MAP[event.eventType];
    if (!complementType) return false;

    const entityKey = this.buildEntityKey(event);
    const lastChange = this.stateChangeHistory.get(entityKey);
    const now = event.occurredAt || new Date();

    if (lastChange && lastChange.eventType === complementType) {
      const elapsed = now.getTime() - lastChange.occurredAt.getTime();
      if (elapsed < stabilityWindowMs) {
        // Rapid flip within stability window -> coalesce!
        return true;
      }
    }

    this.stateChangeHistory.set(entityKey, { eventType: event.eventType, occurredAt: now });
    return false;
  }

  /**
   * Checks whether an event should be suppressed due to rapid notification storming
   */
  public shouldSuppress(event: NotificationEvent, cooldownMs?: number): boolean {
    // SECURITY & ACCOUNT_SECURITY events MUST NEVER be suppressed by storm protection!
    if (
      event.category === NotificationCategory.ACCOUNT_SECURITY ||
      event.severity === NotificationSeverity.SECURITY
    ) {
      return false;
    }

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
    const now = event.occurredAt || new Date();
    timestamps.push(now);
    this.eventHistory.set(key, timestamps);

    if (STATE_COMPLEMENT_MAP[event.eventType]) {
      this.stateChangeHistory.set(this.buildEntityKey(event), { eventType: event.eventType, occurredAt: now });
    }
  }

  public reset(): void {
    this.eventHistory.clear();
    this.stateChangeHistory.clear();
  }
}

export const defaultStormProtection = new NotificationStormProtection();
