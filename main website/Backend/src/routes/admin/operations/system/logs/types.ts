/**
 * Types & Interfaces for Admin System Logs & Diagnostics Operations
 * Phase 17 Batch 17.5 — System Logs & Diagnostics
 */

import { ErrorSeverity, IncidentStatus, AuditEventType, ConnectionStatus, GatewayStatus } from '@prisma/client';

export interface SystemLogsMetrics {
  totalErrors24h: number;
  totalErrors7d: number;
  criticalErrors24h: number;
  openIncidentsCount: number;
  acknowledgedIncidentsCount: number;
  gatewayDisconnects24h: number;
  operationalEvents24h: number;
  topComponents: Array<{
    component: string;
    count: number;
  }>;
  topErrorCodes: Array<{
    errorCode: string;
    count: number;
  }>;
}

export interface SystemErrorListItem {
  id: string;
  fingerprintId: string;
  fingerprintHash: string;
  incidentId: string | null;
  occurredAt: string;
  component: string;
  severity: ErrorSeverity;
  errorCode: string | null;
  errorType: string | null;
  message: string;
  httpMethod: string | null;
  httpPath: string | null;
  httpStatus: number | null;
  requestId: string | null;
  userId: string | null;
  deviceId: string | null;
  serverInstanceId: string | null;
  gatewayNodeId: string | null;
  incidentStatus?: IncidentStatus;
}

export interface SystemErrorDetail extends SystemErrorListItem {
  stackTrace: string | null;
  connectionId: string | null;
  sessionId: string | null;
  metadata: Record<string, unknown> | null;
  linkedEntities: {
    user: { id: string; email: string; fullName: string | null } | null;
    device: { id: string; deviceName: string; platform: string; appVersion: string | null } | null;
    serverInstance: { id: string; serverName: string | null; status: string } | null;
    gatewayNode: { id: string; hostname: string; region: string | null } | null;
  };
  fingerprintMetadata: {
    id: string;
    totalOccurrences: number;
    firstSeenAt: string;
    lastSeenAt: string;
    status: IncidentStatus;
  } | null;
  incidentMetadata: {
    id: string;
    status: IncidentStatus;
    title: string | null;
    summary: string | null;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
    resolutionNotes: string | null;
  } | null;
}

export interface SystemEventListItem {
  id: string;
  source: 'CUSTOMER_AUDIT' | 'ADMIN_AUDIT';
  occurredAt: string;
  eventType: string;
  status: string;
  actor: {
    type: 'USER' | 'ADMIN' | 'SYSTEM';
    id: string | null;
    identifier: string | null;
  };
  targetEntity: {
    type: string | null;
    id: string | null;
  };
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

export interface GatewayDiagnosticListItem {
  id: string;
  gatewayNodeId: string | null;
  gatewayHostname: string | null;
  gatewayRegion: string | null;
  deviceId: string;
  deviceName: string | null;
  devicePlatform: string | null;
  userId: string | null;
  userEmail: string | null;
  connectionStatus: ConnectionStatus;
  remoteEndpoint: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastHeartbeatAt: string | null;
  durationSeconds: number | null;
}

export interface SystemIncidentListItem {
  id: string;
  fingerprintId: string;
  fingerprintHash: string;
  component: string;
  errorCode: string | null;
  errorType: string | null;
  severity: ErrorSeverity;
  status: IncidentStatus;
  title: string | null;
  summary: string | null;
  totalOccurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemErrorQuery {
  page: number;
  pageSize: number;
  search?: string;
  severity?: ErrorSeverity;
  component?: string;
  errorCode?: string;
  status?: IncidentStatus;
  requestId?: string;
  userId?: string;
  deviceId?: string;
  serverInstanceId?: string;
  gatewayNodeId?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'occurredAt' | 'severity' | 'component' | 'errorCode' | 'httpStatus';
  sortOrder: 'asc' | 'desc';
}

export interface SystemEventQuery {
  page: number;
  pageSize: number;
  search?: string;
  source?: 'CUSTOMER_AUDIT' | 'ADMIN_AUDIT';
  eventType?: string;
  userId?: string;
  adminId?: string;
  deviceId?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'createdAt' | 'eventType';
  sortOrder: 'asc' | 'desc';
}

export interface GatewayDiagnosticsQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: ConnectionStatus;
  gatewayNodeId?: string;
  deviceId?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'connectedAt' | 'disconnectedAt' | 'lastHeartbeatAt' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}

export interface SystemIncidentQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: IncidentStatus;
  severity?: ErrorSeverity;
  component?: string;
  errorCode?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'lastSeenAt' | 'firstSeenAt' | 'totalOccurrences' | 'severity' | 'status' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

export interface SystemLogsExportQuery {
  format: 'csv' | 'json';
  category: 'errors' | 'events' | 'gateway';
  search?: string;
  severity?: ErrorSeverity;
  component?: string;
  startDate?: string;
  endDate?: string;
  maxLimit?: number;
}
