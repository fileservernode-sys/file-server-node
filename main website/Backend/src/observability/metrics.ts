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
  private adminOpsByDomain = { users: 0, devices: 0, servers: 0, gateway: 0 };
  private adminOpsByStatus = {
    status400: 0,
    status401: 0,
    status403: 0,
    status404: 0,
    status409: 0,
    status429: 0,
    status5xx: 0
  };

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
  public recordAdminOperation(domain: 'users' | 'devices' | 'servers' | 'gateway', statusCode: number): void {
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
      }
    };
  }
}

export const metricsCollector = MetricsCollector.getInstance();
