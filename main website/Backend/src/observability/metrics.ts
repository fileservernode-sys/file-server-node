/**
 * ZDEXCLOUD PRODUCTION METRICS COLLECTOR (Phase 9)
 * Centralized, low-overhead, in-memory metrics aggregator with strict cardinality control.
 */

export interface HttpMetricsSummary {
  totalRequests: number;
  requestsByMethod: Record<string, number>;
  requestsByStatusClass: Record<string, number>; // '2xx', '3xx', '4xx', '5xx'
  errorCount: number;
  averageLatencyMs: number;
}

export interface AuthMetricsSummary {
  adminLoginSuccess: number;
  adminLoginFailure: number;
  adminOtpChallenges: number;
  adminSessionRevoked: number;
  customerAuthFailures: number;
}

export interface AdminOpsMetricsSummary {
  totalOperations: number;
  successCount: number;
  failureCount: number;
  byDomain: {
    users: number;
    devices: number;
    servers: number;
    gateway: number;
    cameras: number;
  };
  byStatusCode: {
    status400: number;
    status401: number;
    status403: number;
    status404: number;
    status409: number;
    status429: number;
    status5xx: number;
  };
}

export interface LatencySummary {
  count: number;
  averageMs: number;
  maxMs: number;
  p95Ms: number;
}

export type CameraLifecycleStatusKey =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'ONLINE'
  | 'STREAMING'
  | 'RECONNECTING'
  | 'ERROR';

export type CameraTransitionFailureCategory =
  | 'INVALID_TRANSITION'
  | 'STALE_REPORT'
  | 'NO_ACTIVE_SESSION'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface CameraMetricsSummary {
  http: {
    totalRequests: number;
    requestsByStatusClass: {
      '2xx': number;
      '3xx': number;
      '4xx': number;
      '5xx': number;
    };
    errorCount: number;
    latency: LatencySummary;
  };
  lifecycle: {
    transitionsTotal: number;
    transitionsByTargetStatus: Record<CameraLifecycleStatusKey, number>;
    transitionsBySource: {
      heartbeat: number;
      report: number;
      reconciliation: number;
      api: number;
    };
    transitionFailuresTotal: number;
    transitionFailuresByCategory: Record<CameraTransitionFailureCategory, number>;
  };
  heartbeat: {
    totalProcessed: number;
    idempotentCount: number;
    rejectedCount: number;
    latency: LatencySummary;
  };
}

const DEFAULT_LATENCY_WINDOW_SIZE = 256;

/**
 * Fixed-capacity circular latency tracker providing bounded memory,
 * cumulative count/avg/max, and sliding-window p95 estimation.
 */
export class BoundedLatencyRecorder {
  private readonly capacity: number;
  private readonly samples: number[] = [];
  private writeIndex = 0;
  private totalCount = 0;
  private totalSumMs = 0;
  private maxObservedMs = 0;

  constructor(capacity = DEFAULT_LATENCY_WINDOW_SIZE) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  public record(latencyMs: number): void {
    const clamped = Number.isFinite(latencyMs) ? Math.max(0, latencyMs) : 0;
    this.totalCount++;
    this.totalSumMs += clamped;
    if (clamped > this.maxObservedMs) {
      this.maxObservedMs = clamped;
    }

    if (this.samples.length < this.capacity) {
      this.samples.push(clamped);
    } else {
      this.samples[this.writeIndex] = clamped;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
    }
  }

  public getSummary(): LatencySummary {
    if (this.totalCount === 0 || this.samples.length === 0) {
      return {
        count: 0,
        averageMs: 0,
        maxMs: 0,
        p95Ms: 0
      };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));

    return {
      count: this.totalCount,
      averageMs: Math.round((this.totalSumMs / this.totalCount) * 100) / 100,
      maxMs: Math.round(this.maxObservedMs * 100) / 100,
      p95Ms: Math.round(sorted[p95Idx] * 100) / 100
    };
  }
}

export interface DatabaseMetricsSummary {
  queryFailures: number;
  transactionFailures: number;
  lastSuccessfulCheckAt: string | null;
  isAvailable: boolean;
}

export interface GatewayMetricsSummary {
  activeConnectionsCount: number;
  totalConnectionsRegistered: number;
  disconnectedCount: number;
  reconnectCount: number;
  duplicateEvictions: number;
  timedOutRequests: number;
  relayErrors: number;
  activeTransfers: number;
  completedTransfers: number;
  failedTransfers: number;
  nodeDrainEvents: number;
  nodeRestoreEvents: number;
}

export interface DeviceLifecycleMetrics {
  onlineCount: number;
  offlineCount: number;
  connectingCount: number;
  reconnectingCount: number;
  disconnectEvents: number;
  reconnectEvents: number;
}

export interface ServerLifecycleMetrics {
  runningCount: number;
  startingCount: number;
  stoppedCount: number;
  errorCount: number;
  startEvents: number;
  stopEvents: number;
  restartEvents: number;
  transitionErrors: number;
}

export class MetricsCollector {
  private static instance: MetricsCollector;

  // Process & HTTP
  private startTime = Date.now();
  private totalHttpRequests = 0;
  private httpRequestsByMethod: Record<string, number> = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OPTIONS: 0 };
  private httpRequestsByStatusClass: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  private totalHttpLatencyMs = 0;

  // Authentication
  private adminLoginSuccess = 0;
  private adminLoginFailure = 0;
  private adminOtpChallenges = 0;
  private adminSessionRevoked = 0;
  private customerAuthFailures = 0;

  // Admin Operations
  private adminOpsTotal = 0;
  private adminOpsSuccess = 0;
  private adminOpsFailure = 0;
  private adminOpsByDomain = { users: 0, devices: 0, servers: 0, gateway: 0, cameras: 0 };
  private adminOpsByStatus = {
    status400: 0,
    status401: 0,
    status403: 0,
    status404: 0,
    status409: 0,
    status429: 0,
    status5xx: 0
  };

  // Camera Operations (Bounded Cardinality)
  private cameraHttpTotal = 0;
  private cameraHttpByStatusClass: { '2xx': number; '3xx': number; '4xx': number; '5xx': number } = {
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0
  };
  private cameraHttpLatency = new BoundedLatencyRecorder(DEFAULT_LATENCY_WINDOW_SIZE);

  private cameraTransitionsTotal = 0;
  private cameraTransitionsByTargetStatus: Record<CameraLifecycleStatusKey, number> = {
    OFFLINE: 0,
    CONNECTING: 0,
    ONLINE: 0,
    STREAMING: 0,
    RECONNECTING: 0,
    ERROR: 0
  };
  private cameraTransitionsBySource = {
    heartbeat: 0,
    report: 0,
    reconciliation: 0,
    api: 0
  };
  private cameraTransitionFailuresTotal = 0;
  private cameraTransitionFailuresByCategory: Record<CameraTransitionFailureCategory, number> = {
    INVALID_TRANSITION: 0,
    STALE_REPORT: 0,
    NO_ACTIVE_SESSION: 0,
    UNAUTHORIZED: 0,
    VALIDATION_ERROR: 0,
    INTERNAL_ERROR: 0
  };

  private cameraHeartbeatsProcessed = 0;
  private cameraHeartbeatsIdempotent = 0;
  private cameraHeartbeatsRejected = 0;
  private cameraHeartbeatLatency = new BoundedLatencyRecorder(DEFAULT_LATENCY_WINDOW_SIZE);

  // Database
  private dbQueryFailures = 0;
  private dbTransactionFailures = 0;
  private dbAvailable = true;
  private dbLastCheckAt: string | null = null;

  // Gateway
  private gwTotalRegistered = 0;
  private gwDisconnected = 0;
  private gwReconnects = 0;
  private gwDuplicateEvictions = 0;
  private gwTimedOutRequests = 0;
  private gwRelayErrors = 0;
  private gwActiveTransfers = 0;
  private gwCompletedTransfers = 0;
  private gwFailedTransfers = 0;
  private gwNodeDrainEvents = 0;
  private gwNodeRestoreEvents = 0;

  // Device & Server Lifecycle
  private deviceDisconnectEvents = 0;
  private deviceReconnectEvents = 0;
  private serverStartEvents = 0;
  private serverStopEvents = 0;
  private serverRestartEvents = 0;
  private serverTransitionErrors = 0;

  private constructor() {}

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  // --- HTTP Methods ---
  public recordHttpRequest(method: string, statusCode: number, latencyMs: number): void {
    this.totalHttpRequests++;
    const upperMethod = (method || 'GET').toUpperCase();
    this.httpRequestsByMethod[upperMethod] = (this.httpRequestsByMethod[upperMethod] || 0) + 1;

    const statusClass = statusCode >= 500 ? '5xx'
      : statusCode >= 400 ? '4xx'
      : statusCode >= 300 ? '3xx'
      : '2xx';
    this.httpRequestsByStatusClass[statusClass] = (this.httpRequestsByStatusClass[statusClass] || 0) + 1;

    this.totalHttpLatencyMs += Math.max(0, latencyMs);
  }

  // --- Auth Methods ---
  public recordAdminAuth(event: 'login_success' | 'login_failure' | 'otp_challenge' | 'session_revoked'): void {
    if (event === 'login_success') this.adminLoginSuccess++;
    else if (event === 'login_failure') this.adminLoginFailure++;
    else if (event === 'otp_challenge') this.adminOtpChallenges++;
    else if (event === 'session_revoked') this.adminSessionRevoked++;
  }

  public recordCustomerAuthFailure(): void {
    this.customerAuthFailures++;
  }

  // --- Admin Operations ---
  public recordAdminOperation(domain: 'users' | 'devices' | 'servers' | 'gateway' | 'cameras', statusCode: number): void {
    this.adminOpsTotal++;
    if (this.adminOpsByDomain[domain] !== undefined) {
      this.adminOpsByDomain[domain]++;
    }

    if (statusCode >= 200 && statusCode < 400) {
      this.adminOpsSuccess++;
    } else {
      this.adminOpsFailure++;
    }

    if (statusCode === 400) this.adminOpsByStatus.status400++;
    else if (statusCode === 401) this.adminOpsByStatus.status401++;
    else if (statusCode === 403) this.adminOpsByStatus.status403++;
    else if (statusCode === 404) this.adminOpsByStatus.status404++;
    else if (statusCode === 409) this.adminOpsByStatus.status409++;
    else if (statusCode === 429) this.adminOpsByStatus.status429++;
    else if (statusCode >= 500) this.adminOpsByStatus.status5xx++;
  }

  // --- Database Methods ---
  public recordDbFailure(isTransaction = false): void {
    if (isTransaction) this.dbTransactionFailures++;
    else this.dbQueryFailures++;
    this.dbAvailable = false;
  }

  public recordDbSuccess(): void {
    this.dbAvailable = true;
    this.dbLastCheckAt = new Date().toISOString();
  }

  // --- Gateway Methods ---
  public recordGatewayConnection(): void {
    this.gwTotalRegistered++;
  }

  public recordGatewayDisconnect(): void {
    this.gwDisconnected++;
  }

  public recordGatewayReconnect(): void {
    this.gwReconnects++;
  }

  public recordGatewayEviction(): void {
    this.gwDuplicateEvictions++;
  }

  public recordGatewayTimeout(): void {
    this.gwTimedOutRequests++;
  }

  public recordGatewayRelayError(): void {
    this.gwRelayErrors++;
  }

  public recordGatewayTransfer(event: 'start' | 'complete' | 'fail'): void {
    if (event === 'start') this.gwActiveTransfers++;
    else if (event === 'complete') {
      this.gwActiveTransfers = Math.max(0, this.gwActiveTransfers - 1);
      this.gwCompletedTransfers++;
    } else if (event === 'fail') {
      this.gwActiveTransfers = Math.max(0, this.gwActiveTransfers - 1);
      this.gwFailedTransfers++;
    }
  }

  public recordGatewayNodeDrain(): void {
    this.gwNodeDrainEvents++;
  }

  public recordGatewayNodeRestore(): void {
    this.gwNodeRestoreEvents++;
  }

  // --- Device & Server Methods ---
  public recordDeviceLifecycle(event: 'disconnect' | 'reconnect'): void {
    if (event === 'disconnect') this.deviceDisconnectEvents++;
    else if (event === 'reconnect') this.deviceReconnectEvents++;
  }

  public recordServerPower(action: 'start' | 'stop' | 'restart' | 'error'): void {
    if (action === 'start') this.serverStartEvents++;
    else if (action === 'stop') this.serverStopEvents++;
    else if (action === 'restart') this.serverRestartEvents++;
    else if (action === 'error') this.serverTransitionErrors++;
  }

  // --- Camera Operations ---
  public recordCameraHttpRequest(statusCode: number, latencyMs: number): void {
    this.cameraHttpTotal++;
    const statusClass: '2xx' | '3xx' | '4xx' | '5xx' =
      statusCode >= 500
        ? '5xx'
        : statusCode >= 400
        ? '4xx'
        : statusCode >= 300
        ? '3xx'
        : '2xx';
    this.cameraHttpByStatusClass[statusClass]++;
    this.cameraHttpLatency.record(latencyMs);
  }

  public recordCameraLifecycleTransition(
    targetStatus: string,
    source: 'heartbeat' | 'report' | 'reconciliation' | 'api' = 'report'
  ): void {
    this.cameraTransitionsTotal++;
    const upper = String(targetStatus || '').toUpperCase() as CameraLifecycleStatusKey;
    if (upper in this.cameraTransitionsByTargetStatus) {
      this.cameraTransitionsByTargetStatus[upper]++;
    }
    if (source in this.cameraTransitionsBySource) {
      this.cameraTransitionsBySource[source]++;
    }
  }

  public recordCameraLifecycleTransitionFailure(category: CameraTransitionFailureCategory): void {
    this.cameraTransitionFailuresTotal++;
    if (category in this.cameraTransitionFailuresByCategory) {
      this.cameraTransitionFailuresByCategory[category]++;
    }
  }

  public recordCameraHeartbeatLatency(
    latencyMs: number,
    outcome: 'processed' | 'idempotent' | 'rejected' = 'processed'
  ): void {
    this.cameraHeartbeatLatency.record(latencyMs);
    if (outcome === 'rejected') {
      this.cameraHeartbeatsRejected++;
    } else {
      this.cameraHeartbeatsProcessed++;
      if (outcome === 'idempotent') {
        this.cameraHeartbeatsIdempotent++;
      }
    }
  }

  // --- Snapshot Generation ---
  public getSnapshot(): {
    process: { uptimeSeconds: number; memoryUsage: NodeJS.MemoryUsage };
    http: HttpMetricsSummary;
    auth: AuthMetricsSummary;
    adminOperations: AdminOpsMetricsSummary;
    database: DatabaseMetricsSummary;
    gateway: GatewayMetricsSummary;
    lifecycle: {
      devices: { disconnectEvents: number; reconnectEvents: number };
      servers: { startEvents: number; stopEvents: number; restartEvents: number; errors: number };
    };
    camera: CameraMetricsSummary;
  } {
    const avgLatency = this.totalHttpRequests > 0
      ? Math.round((this.totalHttpLatencyMs / this.totalHttpRequests) * 100) / 100
      : 0;

    return {
      process: {
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        memoryUsage: process.memoryUsage()
      },
      http: {
        totalRequests: this.totalHttpRequests,
        requestsByMethod: { ...this.httpRequestsByMethod },
        requestsByStatusClass: { ...this.httpRequestsByStatusClass },
        errorCount: (this.httpRequestsByStatusClass['4xx'] || 0) + (this.httpRequestsByStatusClass['5xx'] || 0),
        averageLatencyMs: avgLatency
      },
      auth: {
        adminLoginSuccess: this.adminLoginSuccess,
        adminLoginFailure: this.adminLoginFailure,
        adminOtpChallenges: this.adminOtpChallenges,
        adminSessionRevoked: this.adminSessionRevoked,
        customerAuthFailures: this.customerAuthFailures
      },
      adminOperations: {
        totalOperations: this.adminOpsTotal,
        successCount: this.adminOpsSuccess,
        failureCount: this.adminOpsFailure,
        byDomain: { ...this.adminOpsByDomain },
        byStatusCode: { ...this.adminOpsByStatus }
      },
      database: {
        queryFailures: this.dbQueryFailures,
        transactionFailures: this.dbTransactionFailures,
        lastSuccessfulCheckAt: this.dbLastCheckAt,
        isAvailable: this.dbAvailable
      },
      gateway: {
        activeConnectionsCount: Math.max(0, this.gwTotalRegistered - this.gwDisconnected),
        totalConnectionsRegistered: this.gwTotalRegistered,
        disconnectedCount: this.gwDisconnected,
        reconnectCount: this.gwReconnects,
        duplicateEvictions: this.gwDuplicateEvictions,
        timedOutRequests: this.gwTimedOutRequests,
        relayErrors: this.gwRelayErrors,
        activeTransfers: this.gwActiveTransfers,
        completedTransfers: this.gwCompletedTransfers,
        failedTransfers: this.gwFailedTransfers,
        nodeDrainEvents: this.gwNodeDrainEvents,
        nodeRestoreEvents: this.gwNodeRestoreEvents
      },
      lifecycle: {
        devices: {
          disconnectEvents: this.deviceDisconnectEvents,
          reconnectEvents: this.deviceReconnectEvents
        },
        servers: {
          startEvents: this.serverStartEvents,
          stopEvents: this.serverStopEvents,
          restartEvents: this.serverRestartEvents,
          errors: this.serverTransitionErrors
        }
      },
      camera: {
        http: {
          totalRequests: this.cameraHttpTotal,
          requestsByStatusClass: { ...this.cameraHttpByStatusClass },
          errorCount:
            this.cameraHttpByStatusClass['4xx'] + this.cameraHttpByStatusClass['5xx'],
          latency: this.cameraHttpLatency.getSummary()
        },
        lifecycle: {
          transitionsTotal: this.cameraTransitionsTotal,
          transitionsByTargetStatus: { ...this.cameraTransitionsByTargetStatus },
          transitionsBySource: { ...this.cameraTransitionsBySource },
          transitionFailuresTotal: this.cameraTransitionFailuresTotal,
          transitionFailuresByCategory: { ...this.cameraTransitionFailuresByCategory }
        },
        heartbeat: {
          totalProcessed: this.cameraHeartbeatsProcessed,
          idempotentCount: this.cameraHeartbeatsIdempotent,
          rejectedCount: this.cameraHeartbeatsRejected,
          latency: this.cameraHeartbeatLatency.getSummary()
        }
      }
    };
  }
}

export const metricsCollector = MetricsCollector.getInstance();
