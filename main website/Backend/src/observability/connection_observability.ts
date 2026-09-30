import { appLogger, gatewayLogger, sanitizeLogMetadata } from './logger.js';
import { ErrorIngestionService } from '../services/error_ingestion_service.js';
import { ErrorSeverity } from '@prisma/client';

export type ConnectionComponent =
  | 'android_service'
  | 'android_tunnel'
  | 'network_watcher'
  | 'backend_connection'
  | 'backend_reconciliation'
  | 'gateway';

export type ConnectionOutcome =
  | 'started'
  | 'success'
  | 'failed'
  | 'rejected'
  | 'timeout'
  | 'cancelled'
  | 'coalesced';

export type ConnectionAttemptReason =
  | 'initial_start'
  | 'manual_start'
  | 'network_recovery'
  | 'socket_failure'
  | 'heartbeat_failure'
  | 'gateway_failure'
  | 'gateway_failover'
  | 'registration_drift'
  | 'self_healing'
  | 'reboot_recovery'
  | 'service_recovery';

export type AuthFailureCategory =
  | 'expired_platform_session'
  | 'invalid_connection_token'
  | 'device_not_owned'
  | 'device_unlinked'
  | 'account_suspended'
  | 'gateway_auth_rejected'
  | 'auth_timeout'
  | 'missing_credentials'
  | 'unknown_auth_failure';

export type NetworkTransportType =
  | 'wifi'
  | 'cellular'
  | 'ethernet'
  | 'vpn'
  | 'unknown';

export type TelemetryErrorCategory =
  | 'network_unavailable'
  | 'network_timeout'
  | 'dns_failure'
  | 'socket_failure'
  | 'tls_failure'
  | 'gateway_unavailable'
  | 'gateway_rejected'
  | 'registration_rejected'
  | 'authentication_failed'
  | 'session_expired'
  | 'session_replaced'
  | 'stale_session'
  | 'invalid_state'
  | 'server_error'
  | 'unknown'
  | AuthFailureCategory;

export interface StructuredConnectionEvent {
  event: string;
  component: ConnectionComponent;
  outcome?: ConnectionOutcome;
  reason?: string;
  errorCategory?: TelemetryErrorCategory;
  authFailureCategory?: AuthFailureCategory;
  durationMs?: number;
  connectionGeneration?: number;
  sessionEpoch?: number;
  gatewayNodeId?: string;
  gatewayRegion?: string;
  transport?: NetworkTransportType;
  deviceId?: string;
  connectionId?: string;
  sessionId?: string;
  previousState?: string;
  newState?: string;
  retryAttempt?: number;
  backoffMs?: number;
  metadata?: Record<string, any>;
}

export interface ConnectionMetricsSnapshot {
  connection_attempts_total: number;
  connection_success_total: number;
  connection_failures_total: number;
  reconnect_attempts_total: number;
  reconnect_success_total: number;
  reconnect_failures_total: number;
  heartbeat_misses_total: number;
  heartbeat_timeouts_total: number;
  stale_sessions_total: number;
  auth_failures_total: number;
  network_transitions_total: number;
  gateway_failovers_total: number;
  self_heal_attempts_total: number;
  self_heal_success_total: number;
  self_heal_failures_total: number;
  uptimeSeconds: number;
}

/**
 * Authoritative Connection Observability Engine (Phase 11A Batch 11A.15 / Phase 12.7)
 *
 * Provides structured telemetry, low-cardinality operational metrics, and
 * lifecycle correlation for ZdexCloud gateway and control-plane connections.
 * Ingests meaningful operational failures into ErrorIngestionService.
 *
 * Key Invariants:
 * - Telemetry is strictly observational; failures in telemetry NEVER interrupt connection operations.
 * - Zero secret or token exposure (sessionToken, connectionToken, password, OTP are sanitized).
 * - Distinguishes transport connection from authenticated session.
 * - Enforces bounded metric dimensions to prevent cardinality explosion.
 */
export class ConnectionObservability {
  private static startTime = Date.now();

  // Low-cardinality metric counters
  private static metrics: ConnectionMetricsSnapshot = {
    connection_attempts_total: 0,
    connection_success_total: 0,
    connection_failures_total: 0,
    reconnect_attempts_total: 0,
    reconnect_success_total: 0,
    reconnect_failures_total: 0,
    heartbeat_misses_total: 0,
    heartbeat_timeouts_total: 0,
    stale_sessions_total: 0,
    auth_failures_total: 0,
    network_transitions_total: 0,
    gateway_failovers_total: 0,
    self_heal_attempts_total: 0,
    self_heal_success_total: 0,
    self_heal_failures_total: 0,
    uptimeSeconds: 0
  };

  /**
   * Emits a structured connection event safely with guaranteed error boundary.
   */
  public static emit(event: StructuredConnectionEvent): void {
    try {
      // 1. Update internal aggregate counters based on event type
      this.updateCounters(event);

      // 2. Build sanitized structured log payload
      const logContext = {
        operation: event.event,
        event: event.event,
        deviceId: event.deviceId,
        gatewayNodeId: event.gatewayNodeId,
        durationMs: event.durationMs,
        metadata: sanitizeLogMetadata({
          component: event.component,
          outcome: event.outcome,
          reason: event.reason,
          errorCategory: event.errorCategory,
          connectionGeneration: event.connectionGeneration,
          sessionEpoch: event.sessionEpoch,
          gatewayRegion: event.gatewayRegion,
          transport: event.transport,
          connectionId: event.connectionId,
          sessionId: event.sessionId,
          previousState: event.previousState,
          newState: event.newState,
          retryAttempt: event.retryAttempt,
          backoffMs: event.backoffMs,
          ...event.metadata
        })
      };

      const message = `[OBSERVABILITY] ${event.component} -> ${event.event} (${event.outcome || 'ok'})`;

      if (event.outcome === 'failed' || event.errorCategory) {
        gatewayLogger.warn(message, logContext);
      } else {
        gatewayLogger.info(message, logContext);
      }

      // 3. Ingest meaningful operational failures into Central ErrorIngestionService (Phase 12.7)
      this.ingestOperationalFailure(event).catch(() => {});
    } catch {
      // Hard Invariant: Telemetry failure must never break reliability!
    }
  }

  /**
   * Evaluates if a connection event represents a meaningful operational failure
   * and dispatches it to ErrorIngestionService asynchronously.
   */
  private static async ingestOperationalFailure(event: StructuredConnectionEvent): Promise<void> {
    try {
      const isFailureEvent =
        event.outcome === 'failed' ||
        event.outcome === 'rejected' ||
        event.outcome === 'timeout' ||
        event.event === 'auth_failed' ||
        event.event === 'connection_failed' ||
        event.event === 'heartbeat_timeout' ||
        event.event === 'session_stale' ||
        event.event === 'self_heal_failed' ||
        event.event === 'gateway_failover_started' ||
        event.event === 'registration_failed' ||
        Boolean(event.errorCategory && event.errorCategory !== 'unknown' && event.outcome !== 'success');

      // Filter out healthy / normal lifecycle events
      if (!isFailureEvent) return;

      let component = 'GATEWAY';
      if (event.component === 'android_tunnel' || event.component === 'android_service' || event.component === 'network_watcher') {
        component = 'ANDROID';
      } else if (event.component === 'backend_connection' || event.component === 'backend_reconciliation') {
        component = 'BACKEND';
      }

      const errorCode = (
        event.authFailureCategory ||
        event.errorCategory ||
        `GATEWAY_${event.event.toUpperCase()}`
      ).toUpperCase();

      let severity: ErrorSeverity = ErrorSeverity.WARNING;
      if (
        event.event === 'auth_failed' ||
        event.errorCategory === 'account_suspended' ||
        event.errorCategory === 'device_not_owned' ||
        event.event === 'gateway_startup_failed' ||
        event.event === 'gateway_shutdown_failed' ||
        event.event === 'self_heal_failed'
      ) {
        severity = ErrorSeverity.ERROR;
      } else if (
        event.event === 'heartbeat_timeout' ||
        event.event === 'session_stale' ||
        event.event === 'gateway_failover_started'
      ) {
        severity = ErrorSeverity.WARNING;
      }

      const rawMessage =
        event.metadata?.errorMessage ||
        event.reason ||
        `Operational connection event '${event.event}' resulted in ${event.outcome || 'failure'} (category: ${event.errorCategory || event.authFailureCategory || 'none'})`;

      await ErrorIngestionService.getInstance().ingest({
        component,
        severity,
        errorCode,
        errorType: event.authFailureCategory ? 'AuthenticationFailure' : 'ConnectionLifecycleError',
        message: String(rawMessage),
        deviceId: event.deviceId,
        gatewayNodeId: event.gatewayNodeId,
        connectionId: event.connectionId,
        sessionId: event.sessionId,
        metadata: {
          event: event.event,
          outcome: event.outcome,
          reason: event.reason,
          errorCategory: event.errorCategory,
          authFailureCategory: event.authFailureCategory,
          durationMs: event.durationMs,
          connectionGeneration: event.connectionGeneration,
          sessionEpoch: event.sessionEpoch,
          gatewayRegion: event.gatewayRegion,
          transport: event.transport,
          previousState: event.previousState,
          newState: event.newState,
          retryAttempt: event.retryAttempt,
          ...event.metadata
        }
      });
    } catch {
      // Invariant: Failures in error ingestion MUST NEVER interrupt connection lifecycle
    }
  }

  private static updateCounters(event: StructuredConnectionEvent): void {
    switch (event.event) {
      case 'connection_attempt':
        this.metrics.connection_attempts_total++;
        break;
      case 'session_authenticated':
        this.metrics.connection_success_total++;
        break;
      case 'connection_failed':
        this.metrics.connection_failures_total++;
        break;
      case 'reconnect_scheduled':
      case 'reconnect_started':
        this.metrics.reconnect_attempts_total++;
        break;
      case 'reconnect_succeeded':
        this.metrics.reconnect_success_total++;
        break;
      case 'reconnect_failed':
        this.metrics.reconnect_failures_total++;
        break;
      case 'heartbeat_missed':
        this.metrics.heartbeat_misses_total++;
        break;
      case 'heartbeat_timeout':
        this.metrics.heartbeat_timeouts_total++;
        break;
      case 'session_stale':
        this.metrics.stale_sessions_total++;
        break;
      case 'auth_failed':
        this.metrics.auth_failures_total++;
        break;
      case 'network_transition':
        this.metrics.network_transitions_total++;
        break;
      case 'gateway_failover_started':
      case 'gateway_failover_succeeded':
        this.metrics.gateway_failovers_total++;
        break;
      case 'self_heal_started':
        this.metrics.self_heal_attempts_total++;
        break;
      case 'self_heal_succeeded':
        this.metrics.self_heal_success_total++;
        break;
      case 'self_heal_failed':
        this.metrics.self_heal_failures_total++;
        break;
    }
  }

  /**
   * Retrieves low-cardinality aggregated connection telemetry metrics.
   */
  public static getMetrics(): ConnectionMetricsSnapshot {
    return {
      ...this.metrics,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }

  /**
   * Helper to measure execution duration of an asynchronous connection operation.
   */
  public static async measure<T>(
    event: Omit<StructuredConnectionEvent, 'durationMs' | 'outcome'>,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      this.emit({ ...event, outcome: 'started' });
      const result = await fn();
      const durationMs = Date.now() - start;
      this.emit({ ...event, durationMs, outcome: 'success' });
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      this.emit({
        ...event,
        durationMs,
        outcome: 'failed',
        errorCategory: 'unknown',
        metadata: { errorMessage: err?.message }
      });
      throw err;
    }
  }
}
