/**
 * RemoteNode Operational Observability & Notification Metrics
 * Track 4 — Batch NT-1.6 Architecture
 */

import { NotificationChannel } from '../types/channel.js';

export type ProviderHealthState = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface ProviderHealth {
  channel: NotificationChannel;
  status: ProviderHealthState;
  consecutiveFailures: number;
  totalDeliveries: number;
  totalFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastErrorMessage: string | null;
}

export interface LatencyMetric {
  queueLatencyMs: number;    // createdAt -> lastAttemptAt
  deliveryLatencyMs: number; // lastAttemptAt -> deliveredAt
  totalLatencyMs: number;    // createdAt -> deliveredAt
}

export interface NotificationMetricsSnapshot {
  timestamp: Date;
  counters: {
    dispatchedEvents: number;
    deliveredCount: number;
    retryingCount: number;
    permanentlyFailedCount: number;
    stormSuppressedCount: number;
    duplicateSuppressedCount: number;
    coalescedEventsCount: number;
    rateLimitThrottledCount: number;
    circuitBreakerBlockedCount: number;
    circuitBreakerTripsCount: number;
    jobsClaimedCount: number;
    staleClaimsRecoveredCount: number;
    pollingCyclesCount: number;
  };
  latency: {
    sampleCount: number;
    avgQueueLatencyMs: number;
    avgDeliveryLatencyMs: number;
    avgTotalLatencyMs: number;
  };
  providers: Record<string, ProviderHealth>;
}

export class NotificationMetricsService {
  private dispatchedEvents = 0;
  private deliveredCount = 0;
  private retryingCount = 0;
  private permanentlyFailedCount = 0;
  private stormSuppressedCount = 0;
  private duplicateSuppressedCount = 0;
  private coalescedEventsCount = 0;
  private rateLimitThrottledCount = 0;
  private circuitBreakerBlockedCount = 0;
  private circuitBreakerTripsCount = 0;
  private jobsClaimedCount = 0;
  private staleClaimsRecoveredCount = 0;
  private pollingCyclesCount = 0;

  private totalQueueLatencyMs = 0;
  private totalDeliveryLatencyMs = 0;
  private totalTotalLatencyMs = 0;
  private latencySampleCount = 0;

  private providerHealthMap: Map<string, ProviderHealth> = new Map();

  constructor() {
    this.resetProviderHealth(NotificationChannel.PUSH);
    this.resetProviderHealth(NotificationChannel.EMAIL);
    this.resetProviderHealth(NotificationChannel.IN_APP);
  }

  private resetProviderHealth(channel: NotificationChannel) {
    this.providerHealthMap.set(channel, {
      channel,
      status: 'HEALTHY',
      consecutiveFailures: 0,
      totalDeliveries: 0,
      totalFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorMessage: null
    });
  }

  public recordDispatchedEvent() {
    this.dispatchedEvents++;
  }

  public recordStormSuppression() {
    this.stormSuppressedCount++;
  }

  public recordDuplicateSuppression() {
    this.duplicateSuppressedCount++;
  }

  public recordEventCoalesced() {
    this.coalescedEventsCount++;
  }

  public recordRateLimitThrottled() {
    this.rateLimitThrottledCount++;
  }

  public recordCircuitBreakerBlocked() {
    this.circuitBreakerBlockedCount++;
  }

  public recordCircuitBreakerTrip() {
    this.circuitBreakerTripsCount++;
  }

  public recordJobClaim(count: number = 1) {
    this.jobsClaimedCount += count;
  }

  public recordStaleClaimRecovery(count: number = 1) {
    this.staleClaimsRecoveredCount += count;
  }

  public recordPollingCycle() {
    this.pollingCyclesCount++;
  }

  public recordDeliverySuccess(
    channel: NotificationChannel,
    latency?: LatencyMetric
  ) {
    this.deliveredCount++;

    const health = this.providerHealthMap.get(channel) || {
      channel,
      status: 'HEALTHY',
      consecutiveFailures: 0,
      totalDeliveries: 0,
      totalFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorMessage: null
    };

    health.totalDeliveries++;
    health.consecutiveFailures = 0;
    health.lastSuccessAt = new Date();
    health.status = 'HEALTHY';
    this.providerHealthMap.set(channel, health);

    if (latency) {
      this.totalQueueLatencyMs += latency.queueLatencyMs;
      this.totalDeliveryLatencyMs += latency.deliveryLatencyMs;
      this.totalTotalLatencyMs += latency.totalLatencyMs;
      this.latencySampleCount++;
    }
  }

  public recordDeliveryFailure(
    channel: NotificationChannel,
    isPermanent: boolean,
    errorMessage: string
  ) {
    if (isPermanent) {
      this.permanentlyFailedCount++;
    } else {
      this.retryingCount++;
    }

    const health = this.providerHealthMap.get(channel) || {
      channel,
      status: 'HEALTHY',
      consecutiveFailures: 0,
      totalDeliveries: 0,
      totalFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorMessage: null
    };

    health.totalFailures++;
    health.consecutiveFailures++;
    health.lastFailureAt = new Date();
    health.lastErrorMessage = errorMessage;

    if (health.consecutiveFailures >= 5) {
      health.status = 'UNHEALTHY';
    } else if (health.consecutiveFailures >= 2) {
      health.status = 'DEGRADED';
    }

    this.providerHealthMap.set(channel, health);
  }

  public getSnapshot(): NotificationMetricsSnapshot {
    const providersObj: Record<string, ProviderHealth> = {};
    for (const [key, val] of this.providerHealthMap.entries()) {
      providersObj[key] = { ...val };
    }

    return {
      timestamp: new Date(),
      counters: {
        dispatchedEvents: this.dispatchedEvents,
        deliveredCount: this.deliveredCount,
        retryingCount: this.retryingCount,
        permanentlyFailedCount: this.permanentlyFailedCount,
        stormSuppressedCount: this.stormSuppressedCount,
        duplicateSuppressedCount: this.duplicateSuppressedCount,
        coalescedEventsCount: this.coalescedEventsCount,
        rateLimitThrottledCount: this.rateLimitThrottledCount,
        circuitBreakerBlockedCount: this.circuitBreakerBlockedCount,
        circuitBreakerTripsCount: this.circuitBreakerTripsCount,
        jobsClaimedCount: this.jobsClaimedCount,
        staleClaimsRecoveredCount: this.staleClaimsRecoveredCount,
        pollingCyclesCount: this.pollingCyclesCount
      },
      latency: {
        sampleCount: this.latencySampleCount,
        avgQueueLatencyMs: this.latencySampleCount > 0 ? Math.round(this.totalQueueLatencyMs / this.latencySampleCount) : 0,
        avgDeliveryLatencyMs: this.latencySampleCount > 0 ? Math.round(this.totalDeliveryLatencyMs / this.latencySampleCount) : 0,
        avgTotalLatencyMs: this.latencySampleCount > 0 ? Math.round(this.totalTotalLatencyMs / this.latencySampleCount) : 0
      },
      providers: providersObj
    };
  }

  public resetMetrics() {
    this.dispatchedEvents = 0;
    this.deliveredCount = 0;
    this.retryingCount = 0;
    this.permanentlyFailedCount = 0;
    this.stormSuppressedCount = 0;
    this.duplicateSuppressedCount = 0;
    this.coalescedEventsCount = 0;
    this.rateLimitThrottledCount = 0;
    this.circuitBreakerBlockedCount = 0;
    this.circuitBreakerTripsCount = 0;
    this.jobsClaimedCount = 0;
    this.staleClaimsRecoveredCount = 0;
    this.pollingCyclesCount = 0;
    this.totalQueueLatencyMs = 0;
    this.totalDeliveryLatencyMs = 0;
    this.totalTotalLatencyMs = 0;
    this.latencySampleCount = 0;
    for (const key of this.providerHealthMap.keys()) {
      this.resetProviderHealth(key as NotificationChannel);
    }
  }
}

export const notificationMetrics = new NotificationMetricsService();
