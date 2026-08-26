/**
 * RemoteNode Provider Circuit Breaker Engine
 * Track 4 — Batch NT-1.6 Architecture
 */

import { NotificationChannel } from '../types/channel.js';
import { config } from '../../config/env.js';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  channel: NotificationChannel;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  failureThreshold: number;
  cooldownMs: number;
  lastFailureAt: Date | null;
  lastStateChangeAt: Date;
  openedAt: Date | null;
  probeCount: number;
}

export class ProviderCircuitBreaker {
  private failureThreshold: number;
  private cooldownMs: number;
  private maxProbes: number;

  private stateMap: Map<NotificationChannel, {
    state: CircuitBreakerState;
    consecutiveFailures: number;
    lastFailureAt: Date | null;
    lastStateChangeAt: Date;
    openedAt: Date | null;
    probeCount: number;
  }> = new Map();

  constructor(
    failureThreshold: number = config.NOTIFICATION_PROVIDER_FAILURE_THRESHOLD ?? 5,
    cooldownMs: number = config.NOTIFICATION_PROVIDER_COOLDOWN_MS ?? 60000,
    maxProbes: number = config.NOTIFICATION_PROVIDER_HALF_OPEN_MAX_PROBES ?? 1
  ) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.maxProbes = maxProbes;

    this.initChannel(NotificationChannel.PUSH);
    this.initChannel(NotificationChannel.EMAIL);
    this.initChannel(NotificationChannel.IN_APP);
  }

  private initChannel(channel: NotificationChannel) {
    this.stateMap.set(channel, {
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastStateChangeAt: new Date(),
      openedAt: null,
      probeCount: 0
    });
  }

  public getStatus(channel: NotificationChannel): CircuitBreakerStatus {
    const entry = this.stateMap.get(channel) || {
      state: 'CLOSED' as CircuitBreakerState,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastStateChangeAt: new Date(),
      openedAt: null,
      probeCount: 0
    };

    // Auto-evaluate OPEN -> HALF_OPEN if cooldown has elapsed
    if (entry.state === 'OPEN' && entry.openedAt) {
      if (Date.now() - entry.openedAt.getTime() >= this.cooldownMs) {
        entry.state = 'HALF_OPEN';
        entry.lastStateChangeAt = new Date();
        entry.probeCount = 0;
        this.stateMap.set(channel, entry);
      }
    }

    return {
      channel,
      state: entry.state,
      consecutiveFailures: entry.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
      lastFailureAt: entry.lastFailureAt,
      lastStateChangeAt: entry.lastStateChangeAt,
      openedAt: entry.openedAt,
      probeCount: entry.probeCount
    };
  }

  public canExecute(channel: NotificationChannel): boolean {
    const status = this.getStatus(channel);

    if (status.state === 'CLOSED') {
      return true;
    }

    if (status.state === 'OPEN') {
      return false;
    }

    if (status.state === 'HALF_OPEN') {
      const entry = this.stateMap.get(channel)!;
      if (entry.probeCount < this.maxProbes) {
        entry.probeCount++;
        this.stateMap.set(channel, entry);
        return true;
      }
      return false;
    }

    return true;
  }

  public recordSuccess(channel: NotificationChannel): void {
    const entry = this.stateMap.get(channel) || {
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastStateChangeAt: new Date(),
      openedAt: null,
      probeCount: 0
    };

    entry.consecutiveFailures = 0;

    if (entry.state === 'HALF_OPEN' || entry.state === 'OPEN') {
      entry.state = 'CLOSED';
      entry.lastStateChangeAt = new Date();
      entry.openedAt = null;
      entry.probeCount = 0;
      console.log(`[CircuitBreaker] Provider circuit for channel ${channel} recovered to CLOSED.`);
    }

    this.stateMap.set(channel, entry);
  }

  public recordFailure(channel: NotificationChannel): void {
    const entry = this.stateMap.get(channel) || {
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastStateChangeAt: new Date(),
      openedAt: null,
      probeCount: 0
    };

    entry.consecutiveFailures++;
    entry.lastFailureAt = new Date();

    if (entry.state === 'HALF_OPEN') {
      entry.state = 'OPEN';
      entry.openedAt = new Date();
      entry.lastStateChangeAt = new Date();
      entry.probeCount = 0;
      console.warn(`[CircuitBreaker] HALF_OPEN probe failed for channel ${channel}. Re-opening circuit.`);
    } else if (entry.state === 'CLOSED' && entry.consecutiveFailures >= this.failureThreshold) {
      entry.state = 'OPEN';
      entry.openedAt = new Date();
      entry.lastStateChangeAt = new Date();
      entry.probeCount = 0;
      console.warn(`[CircuitBreaker] Failure threshold reached for channel ${channel} (${entry.consecutiveFailures}/${this.failureThreshold}). Circuit OPEN.`);
    }

    this.stateMap.set(channel, entry);
  }

  public reset(channel?: NotificationChannel): void {
    if (channel) {
      this.initChannel(channel);
    } else {
      for (const ch of this.stateMap.keys()) {
        this.initChannel(ch);
      }
    }
  }
}

export const providerCircuitBreaker = new ProviderCircuitBreaker();
