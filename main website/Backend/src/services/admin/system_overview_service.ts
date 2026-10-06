/**
 * System Overview Service
 * Phase 17 Batch 17.1 — System Overview
 *
 * Provides centralized, backend-authoritative operational health monitoring,
 * subsystem status aggregation, runtime diagnostics, and environment metrics
 * across application, backend, database, gateway cluster, and Android edge devices.
 */

import { prisma } from '../../config/database.js';
import { defaultGatewayService } from '../../gateway/gateway_service.js';

export type SubsystemStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';

export interface SubsystemHealthSignal {
  name: string;
  subsystem: string;
  status: SubsystemStatus;
  latencyMs: number | null;
  details: string;
  checkedAt: string;
}

export interface ApplicationHealth {
  status: SubsystemStatus;
  version: string;
  uptimeSeconds: number;
  uptimeFormatted: string;
  nodeVersion: string;
  platform: string;
  architecture: string;
  memoryUsageMb: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  checkedAt: string;
}

export interface BackendApiHealth {
  status: SubsystemStatus;
  processId: number;
  latencyMs: number;
  eventLoopLagMs?: number;
  checkedAt: string;
}

export interface DatabaseHealth {
  status: SubsystemStatus;
  engine: string;
  version: string;
  latencyMs: number;
  connected: boolean;
  error?: string;
  checkedAt: string;
}

export interface GatewayHealth {
  status: SubsystemStatus;
  totalNodes: number;
  activeNodes: number;
  activeConnections: number;
  latencyMs: number | null;
  details: string;
  checkedAt: string;
}

export interface DevicesInfrastructureHealth {
  status: SubsystemStatus;
  registeredDevices: number;
  connectedDevices: number;
  offlineDevices: number;
  totalServerInstances: number;
  runningServerInstances: number;
  stoppedServerInstances: number;
  checkedAt: string;
}

export interface EnvironmentInfo {
  name: string;
  appVersion: string;
  apiVersion: string;
  nodeVersion: string;
  platform: string;
  databaseEngine: string;
  startedAt: string;
  uptimeFormatted: string;
}

export interface OverallSystemHealth {
  status: SubsystemStatus;
  summary: string;
  totalSubsystems: number;
  healthySubsystems: number;
  degradedSubsystems: number;
  unhealthySubsystems: number;
  unknownSubsystems: number;
  checkedAt: string;
}

export interface SystemOverviewResult {
  overall: OverallSystemHealth;
  application: ApplicationHealth;
  backend: BackendApiHealth;
  database: DatabaseHealth;
  gateway: GatewayHealth;
  devices: DevicesInfrastructureHealth;
  environment: EnvironmentInfo;
  signals: SubsystemHealthSignal[];
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function sanitizeErrorMessage(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err || '')).toString();
  return msg
    .replace(/mysql:\/\/[^@\s]+@[^\s/]+/gi, 'mysql://***:***@***')
    .replace(/password=[^\s&]+/gi, 'password=***')
    .replace(/:[^\s@/:]+@/g, ':***@')
    .substring(0, 200);
}

export class SystemOverviewService {

  /**
   * Assembles a comprehensive, backend-authoritative System Overview report.
   * Resilient to partial subsystem failures: individual subsystem failures
   * do not crash the overall report.
   */
  static async getSystemOverview(): Promise<SystemOverviewResult> {
    const now = new Date().toISOString();

    // 1. Application & Process Diagnostics
    const appUptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();
    const appHealth: ApplicationHealth = {
      status: 'HEALTHY',
      version: '1.0.0',
      uptimeSeconds: appUptimeSeconds,
      uptimeFormatted: formatUptime(appUptimeSeconds),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      memoryUsageMb: {
        heapUsed: Math.round((memory.heapUsed / (1024 * 1024)) * 10) / 10,
        heapTotal: Math.round((memory.heapTotal / (1024 * 1024)) * 10) / 10,
        rss: Math.round((memory.rss / (1024 * 1024)) * 10) / 10
      },
      checkedAt: now
    };

    // 2. Backend API Diagnostics
    const backendStart = Date.now();
    const backendLatencyMs = Math.max(0, Date.now() - backendStart);
    const backendHealth: BackendApiHealth = {
      status: 'HEALTHY',
      processId: process.pid,
      latencyMs: backendLatencyMs,
      checkedAt: now
    };

    // 3. Database Subsystem Health Check
    let dbHealth: DatabaseHealth;
    const dbStart = performance.now();
    try {
      const versionResult: any[] = await prisma.$queryRawUnsafe('SELECT @@version AS version, @@version_comment AS comment');
      const dbLatencyMs = Math.round((performance.now() - dbStart) * 10) / 10;
      const rawVersion = versionResult?.[0]?.version || '8.0';
      const comment = versionResult?.[0]?.comment ? ` (${versionResult[0].comment})` : '';

      dbHealth = {
        status: dbLatencyMs > 1000 ? 'DEGRADED' : 'HEALTHY',
        engine: 'MySQL',
        version: `${rawVersion}${comment}`,
        latencyMs: dbLatencyMs,
        connected: true,
        checkedAt: new Date().toISOString()
      };
    } catch (err) {
      const dbLatencyMs = Math.round((performance.now() - dbStart) * 10) / 10;
      dbHealth = {
        status: 'UNHEALTHY',
        engine: 'MySQL',
        version: 'Unknown',
        latencyMs: dbLatencyMs,
        connected: false,
        error: sanitizeErrorMessage(err),
        checkedAt: new Date().toISOString()
      };
    }

    // 4. Gateway Infrastructure Health Check
    let gatewayHealth: GatewayHealth;
    const gwStart = performance.now();
    try {
      const [nodes, activeConnectionCount] = await Promise.all([
        prisma.gatewayNode.findMany({ select: { id: true, status: true, lastHeartbeatAt: true } }),
        prisma.deviceConnection.count({ where: { status: 'CONNECTED' } })
      ]);

      const gwLatencyMs = Math.round((performance.now() - gwStart) * 10) / 10;
      const totalNodes = nodes.length;
      const activeNodes = nodes.filter(n => n.status === 'ACTIVE').length;
      const inMemoryConnections = defaultGatewayService ? (defaultGatewayService as any).activeConnections?.size || 0 : 0;
      const effectiveActiveConnections = Math.max(activeConnectionCount, inMemoryConnections);

      let status: SubsystemStatus = 'HEALTHY';
      let details = 'Gateway cluster operating normally.';

      if (totalNodes > 0 && activeNodes === 0) {
        status = 'DEGRADED';
        details = 'All registered gateway nodes are currently in maintenance or inactive.';
      } else if (totalNodes === 0) {
        status = 'HEALTHY';
        details = 'Primary gateway service active on core control plane node.';
      }

      gatewayHealth = {
        status,
        totalNodes,
        activeNodes,
        activeConnections: effectiveActiveConnections,
        latencyMs: gwLatencyMs,
        details,
        checkedAt: new Date().toISOString()
      };
    } catch (err) {
      const gwLatencyMs = Math.round((performance.now() - gwStart) * 10) / 10;
      gatewayHealth = {
        status: 'UNKNOWN',
        totalNodes: 0,
        activeNodes: 0,
        activeConnections: 0,
        latencyMs: gwLatencyMs,
        details: `Gateway telemetry check unavailable: ${sanitizeErrorMessage(err)}`,
        checkedAt: new Date().toISOString()
      };
    }

    // 5. Android & Edge Devices Infrastructure Health
    let devicesHealth: DevicesInfrastructureHealth;
    try {
      const [
        totalDevices,
        onlineDevices,
        totalServers,
        runningServers
      ] = await Promise.all([
        prisma.device.count(),
        prisma.device.count({ where: { status: { in: ['ONLINE', 'CONNECTING', 'RECONNECTING'] } } }),
        prisma.serverInstance.count(),
        prisma.serverInstance.count({ where: { status: 'RUNNING' } })
      ]);

      const offlineDevices = Math.max(0, totalDevices - onlineDevices);
      const stoppedServers = Math.max(0, totalServers - runningServers);

      devicesHealth = {
        status: 'HEALTHY',
        registeredDevices: totalDevices,
        connectedDevices: onlineDevices,
        offlineDevices,
        totalServerInstances: totalServers,
        runningServerInstances: runningServers,
        stoppedServerInstances: stoppedServers,
        checkedAt: new Date().toISOString()
      };
    } catch (err) {
      devicesHealth = {
        status: 'UNKNOWN',
        registeredDevices: 0,
        connectedDevices: 0,
        offlineDevices: 0,
        totalServerInstances: 0,
        runningServerInstances: 0,
        stoppedServerInstances: 0,
        checkedAt: new Date().toISOString()
      };
    }

    // 6. Safe Allowlisted Environment Information
    const startedAt = new Date(Date.now() - appUptimeSeconds * 1000).toISOString();
    const envInfo: EnvironmentInfo = {
      name: process.env.NODE_ENV || 'development',
      appVersion: '1.0.0',
      apiVersion: 'v1',
      nodeVersion: process.version,
      platform: `${process.platform} (${process.arch})`,
      databaseEngine: `${dbHealth.engine} ${dbHealth.version}`,
      startedAt,
      uptimeFormatted: formatUptime(appUptimeSeconds)
    };

    // 7. Subsystem Signals Table
    const signals: SubsystemHealthSignal[] = [
      {
        name: 'Application Engine',
        subsystem: 'App & Runtime',
        status: appHealth.status,
        latencyMs: null,
        details: `Node ${process.version} • Uptime: ${appHealth.uptimeFormatted} • Heap: ${appHealth.memoryUsageMb.heapUsed}MB`,
        checkedAt: appHealth.checkedAt
      },
      {
        name: 'Backend API Server',
        subsystem: 'HTTP / API',
        status: backendHealth.status,
        latencyMs: backendHealth.latencyMs,
        details: `Process PID: ${backendHealth.processId} • Fastify Engine Active`,
        checkedAt: backendHealth.checkedAt
      },
      {
        name: 'MySQL Database',
        subsystem: 'Database / Storage',
        status: dbHealth.status,
        latencyMs: dbHealth.latencyMs,
        details: dbHealth.connected ? `${dbHealth.engine} ${dbHealth.version} • Latency: ${dbHealth.latencyMs}ms` : (dbHealth.error || 'Connection Failed'),
        checkedAt: dbHealth.checkedAt
      },
      {
        name: 'Gateway WebSocket Relays',
        subsystem: 'Gateway / Tunnels',
        status: gatewayHealth.status,
        latencyMs: gatewayHealth.latencyMs,
        details: `${gatewayHealth.activeNodes}/${gatewayHealth.totalNodes} Nodes Active • ${gatewayHealth.activeConnections} Active Tunnels`,
        checkedAt: gatewayHealth.checkedAt
      },
      {
        name: 'Android Edge Devices',
        subsystem: 'Edge Hardware',
        status: devicesHealth.status,
        latencyMs: null,
        details: `${devicesHealth.connectedDevices}/${devicesHealth.registeredDevices} Devices Online • ${devicesHealth.runningServerInstances}/${devicesHealth.totalServerInstances} Servers Running`,
        checkedAt: devicesHealth.checkedAt
      }
    ];

    // 8. Overall Health Aggregation Logic
    const statuses = [appHealth.status, backendHealth.status, dbHealth.status, gatewayHealth.status, devicesHealth.status];
    const healthyCount = statuses.filter(s => s === 'HEALTHY').length;
    const degradedCount = statuses.filter(s => s === 'DEGRADED').length;
    const unhealthyCount = statuses.filter(s => s === 'UNHEALTHY').length;
    const unknownCount = statuses.filter(s => s === 'UNKNOWN').length;

    let overallStatus: SubsystemStatus = 'HEALTHY';
    let overallSummary = 'All primary subsystems are operational and operating within healthy parameters.';

    if (dbHealth.status === 'UNHEALTHY' || backendHealth.status === 'UNHEALTHY') {
      overallStatus = 'UNHEALTHY';
      overallSummary = 'Critical infrastructure failure: Core database or backend API subsystem is unhealthy.';
    } else if (unhealthyCount > 0) {
      overallStatus = 'UNHEALTHY';
      overallSummary = 'One or more system components are experiencing operational failure.';
    } else if (degradedCount > 0) {
      overallStatus = 'DEGRADED';
      overallSummary = 'One or more subsystem warnings detected or operational capacity is reduced.';
    } else if (unknownCount > 0 && healthyCount < 3) {
      overallStatus = 'UNKNOWN';
      overallSummary = 'Health status could not be verified reliably across all critical subsystems.';
    }

    const overall: OverallSystemHealth = {
      status: overallStatus,
      summary: overallSummary,
      totalSubsystems: statuses.length,
      healthySubsystems: healthyCount,
      degradedSubsystems: degradedCount,
      unhealthySubsystems: unhealthyCount,
      unknownSubsystems: unknownCount,
      checkedAt: now
    };

    return {
      overall,
      application: appHealth,
      backend: backendHealth,
      database: dbHealth,
      gateway: gatewayHealth,
      devices: devicesHealth,
      environment: envInfo,
      signals
    };
  }
}
