/**
 * Types & Interfaces for Admin Background Jobs & Operations Control Plane
 * Phase 17 Batch 17.6 — Background Jobs & Operations
 */

export type NormalizedJobStatus = 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'RETRYING';

export type JobCategory = 'NOTIFICATION' | 'EMAIL' | 'BILLING' | 'MAINTENANCE';

export interface BackgroundJobsMetrics {
  totalQueued: number;
  totalActive: number;
  totalRetrying: number;
  totalFailed24h: number;
  totalCompleted24h: number;
  activeWorkersCount: number;
  totalWorkersCount: number;
  oldestQueuedJobAgeSeconds: number | null;
  failureRatePercent24h: number;
  queuesSummary: BackgroundQueueSummary[];
}

export interface BackgroundQueueSummary {
  name: string;
  category: JobCategory;
  displayName: string;
  status: 'HEALTHY' | 'DEGRADED' | 'PAUSED' | 'IDLE';
  queuedCount: number;
  activeCount: number;
  retryingCount: number;
  failedCount24h: number;
  completedCount24h: number;
  oldestJobCreatedAt: string | null;
  latencyEstimateMs: number;
}

export interface BackgroundWorkerStatus {
  workerId: string;
  name: string;
  category: JobCategory;
  scope: 'LOCAL_DAEMON' | 'CLUSTER';
  processId: number;
  hostname: string;
  status: 'RUNNING' | 'IDLE' | 'STARTING' | 'STOPPED' | 'DEGRADED';
  enabled: boolean;
  assignedQueues: string[];
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastPollAt: string | null;
  isHeartbeatStale: boolean;
  currentProcessingCount: number;
  totalProcessedCount: number;
  totalDeliveredCount: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  telemetry: Record<string, unknown>;
}

export interface BackgroundJobListItem {
  id: string;
  category: JobCategory;
  jobType: string;
  queueName: string;
  status: NormalizedJobStatus;
  rawStatus: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  durationMs: number | null;
  workerId: string | null;
  nextRetryAt: string | null;
  failureReason: string | null;
  userId: string | null;
  deviceId: string | null;
}

export interface BackgroundJobDetail extends BackgroundJobListItem {
  payloadSummary: Record<string, unknown>;
  sanitizedErrorMessage: string | null;
  retryPolicy: {
    maxAttempts: number;
    backoffStrategy: string;
    isRetryable: boolean;
  };
  linkedEntities: {
    user: { id: string; email: string; fullName: string | null } | null;
    device: { id: string; deviceName: string; platform: string } | null;
    notificationRecordId?: string | null;
    emailMessageId?: string | null;
  };
  history: Array<{
    timestamp: string;
    status: string;
    workerId: string | null;
    note: string | null;
  }>;
}

export interface BackgroundJobQuery {
  page: number;
  pageSize: number;
  search?: string;
  queueName?: string;
  category?: JobCategory;
  status?: NormalizedJobStatus;
  userId?: string;
  deviceId?: string;
  workerId?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'createdAt' | 'startedAt' | 'completedAt' | 'attemptCount' | 'status';
  sortOrder: 'asc' | 'desc';
}

export interface FailedJobQuery {
  page: number;
  pageSize: number;
  search?: string;
  queueName?: string;
  category?: JobCategory;
  workerId?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'createdAt' | 'lastAttemptAt' | 'attemptCount';
  sortOrder: 'asc' | 'desc';
}

export interface BackgroundJobsExportQuery {
  format: 'csv' | 'json';
  category?: JobCategory;
  queueName?: string;
  status?: NormalizedJobStatus;
  startDate?: string;
  endDate?: string;
  maxLimit?: number;
}
