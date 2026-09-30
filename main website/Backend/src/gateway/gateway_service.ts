import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '../config/database.js';
import { GatewayConfig, loadGatewayConfig } from './gateway_config.js';
import { deviceEventProducer } from '../notifications/producers/device_producer.js';
import { gatewayEventProducer } from '../notifications/producers/gateway_producer.js';
import { serverEventProducer } from '../notifications/producers/server_producer.js';
import { StateReconciliationService } from '../observability/state_reconciliation.js';
import { ConnectionObservability } from '../observability/connection_observability.js';

export interface HandshakeMessage {
  type: string;
  version?: string;
  connectionToken?: string;
  deviceId?: string;
  connectionId?: string;
  sessionId?: string;
  userId?: string;
  authorizedUserId?: string;
  remoteEndpoint?: string;
  reason?: string;
  code?: string;
  message?: string;
  requestId?: string;
  transferId?: string;
  operation?: string;
  path?: string;
  name?: string;
  oldPath?: string;
  newName?: string;
  success?: boolean;
  data?: any;
  error?: any;
  chunkIndex?: number;
  totalChunks?: number;
  totalBytes?: number;
  bytesTransferred?: number;
  dataBase64?: string;
}

export interface ActiveGatewayConnection {
  connectionId: string;
  sessionId: string;
  sessionEpoch: number;
  deviceId: string;
  userId?: string;
  hostname?: string;
  gatewayNodeId?: string;
  socket: WebSocket;
  connectedAt: Date;
  lastHeartbeatAt: Date;
  remoteIp?: string;
  isAuthoritative: boolean;
  isEvicted: boolean;
  isClosed: boolean;
}

export interface PendingClientRequest {
  requestId: string;
  connectionId: string;
  sessionId?: string;
  sessionEpoch?: number;
  operation?: string;
  clientSocket?: WebSocket;
  httpResolver?: (response: any) => void;
  createdAt: number;
  timer: NodeJS.Timeout;
}

export interface ActiveFileTransfer {
  transferId: string;
  requestId: string;
  connectionId: string;
  sessionId?: string;
  sessionEpoch?: number;
  clientSocket: WebSocket;
  hostSocket: WebSocket;
  bytesTransferred: number;
  totalBytes?: number;
  startedAt: number;
  timer: NodeJS.Timeout;
}

/**
 * Abstraction for token-to-connection-record validation.
 * Default implementation uses Prisma; tests inject a mock to avoid DB I/O.
 */
export interface TokenValidator {
  findConnection(
    deviceId: string,
    connectionToken: string
  ): Promise<{ id: string; deviceId: string; userId?: string; remoteEndpoint?: string | null } | null>;
  markConnected(connectionId: string, now: Date): Promise<void>;
  markDisconnected(connectionId: string, disconnectedAt: Date): Promise<void>;
}

import { ConnectionStateMachine } from '../services/connection_state_machine.js';
import { ConnectionStatus } from '@prisma/client';

export class PrismaTokenValidator implements TokenValidator {
  async findConnection(deviceId: string, connectionToken: string) {
    try {
      const record = await prisma.deviceConnection.findFirst({
        where: { deviceId, connectionToken },
        include: { device: true }
      });
      if (!record) return null;
      return {
        id: record.id,
        deviceId: record.deviceId,
        userId: record.device?.userId,
        remoteEndpoint: record.remoteEndpoint
      };
    } catch {
      return null;
    }
  }

  async markConnected(connectionId: string, now: Date) {
    try {
      await ConnectionStateMachine.transition({
        connectionId,
        nextStatus: ConnectionStatus.CONNECTED,
        eventSource: 'AUTH_SUCCESS',
        timestamp: now
      });
    } catch {
      // Ignore DB errors during state transition
    }
  }

  async markDisconnected(connectionId: string, disconnectedAt: Date) {
    try {
      await ConnectionStateMachine.transition({
        connectionId,
        nextStatus: ConnectionStatus.DISCONNECTED,
        eventSource: 'DISCONNECT_TRANSPORT',
        timestamp: disconnectedAt
      });
    } catch {
      // Ignore DB errors during socket cleanup
    }
  }
}

/**
 * Production Gateway Service — Transport & Proxy Layer for RemoteNode Personal File Servers
 * (Strictly routes messages without storing user files or owning filesystem data)
 *
 * Batch 11A.13 Hardened In-Memory Runtime Maps & Registries:
 * - Deterministic, identity-aware ownership for activeConnections, deviceToConnectionMap, hostnameToConnectionMap.
 * - Monotonic session epoch dominance preventing stale socket takeover or accidental cleanup of newer sessions.
 * - Atomic session handover with explicit eviction of superseded sessions.
 * - Strict isolation of pending requests and active file transfers bound to owning session identity.
 * - Idempotent, re-entrant cleanup routines with zero cross-tenant contamination.
 */
export class GatewayService {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private activeConnections: Map<string, ActiveGatewayConnection> = new Map(); // connectionId -> ActiveGatewayConnection
  private deviceToConnectionMap: Map<string, string> = new Map(); // deviceId -> connectionId
  private hostnameToConnectionMap: Map<string, string> = new Map(); // hostname -> connectionId
  private pendingRequests: Map<string, PendingClientRequest> = new Map(); // requestId -> PendingClientRequest
  private activeTransfers: Map<string, ActiveFileTransfer> = new Map(); // transferId -> ActiveFileTransfer
  private rateLimitTracker: Map<string, { count: number; resetAt: number }> = new Map(); // ip -> { count, resetAt }
  private idempotencyCache: Map<string, { response: any; expiresAt: number }> = new Map(); // requestId -> { response, expiresAt }
  private deviceEpochMap: Map<string, number> = new Map(); // deviceId -> monotonic epoch counter
  
  // Observability Counters
  private failedAuthCount = 0;
  private reconnectCount = 0;
  private rateLimitEvents = 0;
  private timedOutRequests = 0;
  private completedTransfersCount = 0;
  private failedTransfersCount = 0;
  private sessionReplacedCount = 0;
  private staleClosesIgnoredCount = 0;
  
  private isListening = false;
  private startTime = Date.now();
  private config: GatewayConfig;
  private tokenValidator: TokenValidator;
  private heartbeatReaperTimer: NodeJS.Timeout | null = null;
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private heartbeatBatchTimer: NodeJS.Timeout | null = null;
  private memoryPruneTimer: NodeJS.Timeout | null = null;

  constructor(configOverrides: Partial<GatewayConfig> = {}, tokenValidator?: TokenValidator) {
    this.config = loadGatewayConfig(configOverrides);
    this.tokenValidator = tokenValidator ?? new PrismaTokenValidator();
  }

  public getConfig(): GatewayConfig {
    return this.config;
  }

  /**
   * Redacts sensitive tokens and credentials from log payloads.
   */
  private redact(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map((i) => this.redact(i));

    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (
        k.toLowerCase().includes('token') ||
        k.toLowerCase().includes('password') ||
        k.toLowerCase().includes('secret') ||
        k.toLowerCase().includes('otp') ||
        k.toLowerCase().includes('authorization')
      ) {
        sanitized[k] = '[REDACTED]';
      } else if (k === 'dataBase64') {
        sanitized[k] = `[BINARY_PAYLOAD_${typeof v === 'string' ? v.length : 0}_BYTES]`;
      } else if (typeof v === 'object') {
        sanitized[k] = this.redact(v);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, meta: Record<string, any> = {}) {
    if (this.config.NODE_ENV === 'test') return;
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({
      timestamp,
      level,
      service: 'gateway',
      message,
      ...this.redact(meta)
    });
    if (level === 'error') {
      console.error(payload);
    } else if (level === 'warn') {
      console.warn(payload);
    } else {
      console.log(payload);
    }
  }

  /**
   * Sliding window rate limiter per remote IP
   */
  private checkRateLimit(remoteIp: string): boolean {
    const now = Date.now();
    const tracker = this.rateLimitTracker.get(remoteIp);

    if (!tracker || now > tracker.resetAt) {
      this.rateLimitTracker.set(remoteIp, { count: 1, resetAt: now + 60000 });
      return true;
    }

    if (tracker.count >= this.config.GATEWAY_RATE_LIMIT_RPM) {
      this.rateLimitEvents++;
      return false;
    }

    tracker.count++;
    return true;
  }

  /**
   * Disconnects active WebSocket connections and unbinds proxy hostname routes for a deleted device.
   * Identity-aware: ensures old cleanup never removes a replacement connection.
   */
  public evictDeviceSession(deviceId: string, reason: string = 'Server node deleted by owner'): void {
    const connId = this.deviceToConnectionMap.get(deviceId);
    if (connId && this.activeConnections.has(connId)) {
      const conn = this.activeConnections.get(connId)!;
      this.evictStaleSession(conn, reason, false);
      
      // Identity-aware hostname unbinding
      if (conn.hostname) {
        const lowerHost = conn.hostname.toLowerCase();
        if (this.hostnameToConnectionMap.get(lowerHost) === connId) {
          this.hostnameToConnectionMap.delete(lowerHost);
        }
      }
      
      // Identity-aware activeConnections unbinding
      if (this.activeConnections.get(connId)?.sessionId === conn.sessionId) {
        this.activeConnections.delete(connId);
      }
    }
    
    // Identity-aware deviceToConnectionMap unbinding
    if (this.deviceToConnectionMap.get(deviceId) === connId) {
      this.deviceToConnectionMap.delete(deviceId);
    }

    this.log('info', 'Evicted gateway session and unbound routing for deleted device', {
      event: 'SESSION_EVICTED',
      deviceId,
      reason
    });
  }

  /**
   * Fast stale socket eviction & session replacement handler.
   * Ensures superseded session resources (pending requests, active transfers) are cleanly terminated
   * without mutating or deleting mappings belonging to the authoritative replacement session.
   */
  private evictStaleSession(conn: ActiveGatewayConnection, reason: string, isSuperseded: boolean): void {
    conn.isAuthoritative = false;
    conn.isEvicted = true;
    conn.isClosed = true;

    if (isSuperseded) {
      this.sessionReplacedCount++;
    }

    this.log('info', 'Evicting stale gateway connection session', {
      event: isSuperseded ? 'SESSION_REPLACED' : 'SESSION_EVICTED',
      connectionId: conn.connectionId,
      sessionId: conn.sessionId,
      sessionEpoch: conn.sessionEpoch,
      deviceId: conn.deviceId,
      reason
    });

    // 1. Notify and close old socket promptly
    try {
      if (conn.socket.readyState === WebSocket.OPEN || conn.socket.readyState === WebSocket.CONNECTING) {
        conn.socket.send(JSON.stringify({ type: 'DISCONNECT', reason }));
        conn.socket.close(1000, reason);
      }
    } catch {}

    // 2. Terminate pending requests strictly targeting this evicted session
    for (const [reqId, pending] of Array.from(this.pendingRequests.entries())) {
      if (pending.sessionId === conn.sessionId || (pending.connectionId === conn.connectionId && !pending.sessionId)) {
        clearTimeout(pending.timer);
        this.timedOutRequests++;
        if (pending.clientSocket && pending.clientSocket.readyState === WebSocket.OPEN) {
          pending.clientSocket.send(
            JSON.stringify({
              type: 'FILE_RESPONSE',
              requestId: reqId,
              success: false,
              error: {
                code: 'SESSION_REPLACED',
                message: 'Host connection session was replaced by a newer session.'
              }
            })
          );
        } else if (pending.httpResolver) {
          pending.httpResolver({
            type: 'FILE_RESPONSE',
            requestId: reqId,
            success: false,
            error: {
              code: 'SESSION_REPLACED',
              message: 'Host connection session was replaced by a newer session.'
            }
          });
        }
        this.pendingRequests.delete(reqId);
      }
    }

    // 3. Terminate active transfers strictly targeting this evicted session
    for (const [transferId, transfer] of Array.from(this.activeTransfers.entries())) {
      if (transfer.sessionId === conn.sessionId || (transfer.connectionId === conn.connectionId && !transfer.sessionId)) {
        clearTimeout(transfer.timer);
        this.failedTransfersCount++;
        const cancelPayload = JSON.stringify({
          type: 'FILE_STREAM_CANCEL',
          transferId,
          reason: 'Host connection session was replaced or evicted'
        });
        try {
          if (transfer.clientSocket && transfer.clientSocket.readyState === WebSocket.OPEN) {
            transfer.clientSocket.send(cancelPayload);
          }
        } catch {}
        this.activeTransfers.delete(transferId);
      }
    }

    // 4. Identity-aware activeConnections deletion: Only delete if map still points to THIS session
    if (this.activeConnections.get(conn.connectionId)?.sessionId === conn.sessionId) {
      this.activeConnections.delete(conn.connectionId);
    }
  }

  public async start(): Promise<void> {
    if (this.isListening) return;

    this.httpServer = http.createServer(async (req, res) => {
      // Inject Production Web Hardening & Security Headers
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'none';"
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

      const rawUrl = req.url || '';
      const parsedUrl = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (pathname === '/health' && req.method === 'GET') {
        const health = this.getHealthStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
        return;
      }

      if (pathname === '/ready' && req.method === 'GET') {
        const ready = this.getReadinessStatus();
        res.writeHead(ready.status === 'ready' ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ready));
        return;
      }

      // =======================================================================
      // HTTP REVERSE PROXY ROUTING FOR *.remotenode.net SUBDOMAINS
      // =======================================================================
      const hostHeader = (req.headers.host || '').split(':')[0].toLowerCase();
      const endpointQuery = parsedUrl.searchParams.get('endpoint');
      const connectionIdHeader = req.headers['x-connection-id'] as string | undefined;

      const targetHostname = endpointQuery || hostHeader;
      const resolvedConnId =
        this.hostnameToConnectionMap.get(targetHostname) ||
        (connectionIdHeader && this.activeConnections.has(connectionIdHeader) ? connectionIdHeader : null);

      if (pathname.startsWith('/api/')) {
        const targetConn = resolvedConnId ? this.activeConnections.get(resolvedConnId) : null;
        if (!targetConn || !targetConn.isAuthoritative || targetConn.isEvicted || targetConn.isClosed || targetConn.socket.readyState !== WebSocket.OPEN) {
          const isUnknown = !this.hostnameToConnectionMap.has(targetHostname);
          res.writeHead(isUnknown ? 404 : 503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: isUnknown ? 'SERVER_NOT_FOUND' : 'SERVER_OFFLINE',
                message: isUnknown
                  ? `Server endpoint '${targetHostname}' is not recognized.`
                  : 'Android file server host is offline or disconnected.'
              }
            })
          );
          return;
        }

        const requestId = 'http-req-' + Math.random().toString(36).substring(2, 10);
        const targetSessionId = targetConn.sessionId;
        const targetEpoch = targetConn.sessionEpoch;

        // Read body if POST/PUT/DELETE
        let bodyPayload: any = {};
        if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
          const bodyBuffers: Buffer[] = [];
          for await (const chunk of req) {
            bodyBuffers.push(chunk);
          }
          const rawBody = Buffer.concat(bodyBuffers).toString();
          if (rawBody) {
            try {
              bodyPayload = JSON.parse(rawBody);
            } catch {
              bodyPayload = {};
            }
          }
        }

        // Map HTTP route to operation
        let operation = 'HEALTH';
        if (pathname === '/api/storage') operation = 'STORAGE';
        else if (pathname === '/api/files/recent') operation = 'RECENT';
        else if (pathname === '/api/files' && req.method === 'GET') operation = 'LIST';
        else if (pathname === '/api/folders' && req.method === 'POST') operation = 'CREATE_FOLDER';
        else if (pathname === '/api/rename' && req.method === 'POST') operation = 'RENAME';
        else if (pathname === '/api/files' && req.method === 'DELETE') operation = 'DELETE';

        const fileRequestMsg: HandshakeMessage = {
          type: 'FILE_REQUEST',
          requestId,
          connectionId: resolvedConnId!,
          sessionId: targetSessionId,
          operation,
          path: parsedUrl.searchParams.get('path') || bodyPayload.path || '/',
          name: parsedUrl.searchParams.get('name') || bodyPayload.name,
          oldPath: bodyPayload.oldPath,
          newName: bodyPayload.newName
        };

        const responsePromise = new Promise<any>((resolve) => {
          const timer = setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
              this.timedOutRequests++;
              this.pendingRequests.delete(requestId);
              resolve({
                type: 'FILE_RESPONSE',
                requestId,
                success: false,
                error: { code: 'REQUEST_TIMEOUT', message: 'Storage host request timed out.' }
              });
            }
          }, this.config.GATEWAY_REQUEST_TIMEOUT_MS);

          this.pendingRequests.set(requestId, {
            requestId,
            connectionId: resolvedConnId!,
            sessionId: targetSessionId,
            sessionEpoch: targetEpoch,
            operation,
            httpResolver: (resp) => {
              clearTimeout(timer);
              resolve(resp);
            },
            createdAt: Date.now(),
            timer
          });
        });

        // Forward over host socket
        targetConn.socket.send(JSON.stringify(fileRequestMsg));

        const response = await responsePromise;
        const statusCode = response.success ? 200 : 400;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response.data || response));
        return;
      }

      // =======================================================================
      // STATIC FILE MANAGER WEB APP SERVING
      // =======================================================================
      let relativeFilePath = pathname === '/' ? '/index.html' : pathname;
      const webDir = path.resolve(__dirname, 'web');
      const resolvedFilePath = path.normalize(path.join(webDir, relativeFilePath));

      if (resolvedFilePath.startsWith(webDir) && fs.existsSync(resolvedFilePath) && fs.statSync(resolvedFilePath).isFile()) {
        const ext = path.extname(resolvedFilePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(resolvedFilePath).pipe(res);
        return;
      }

      // Fallback for root or SPA paths to index.html if available
      const indexPath = path.join(webDir, 'index.html');
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: this.config.GATEWAY_MAX_MESSAGE_SIZE_BYTES
    });

    this.wss.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
      const remoteIp = req.socket.remoteAddress || '127.0.0.1';
      this.handleSocketConnection(socket, remoteIp);
    });

    return new Promise((resolve) => {
      this.httpServer?.listen(this.config.GATEWAY_PORT, this.config.GATEWAY_HOST, async () => {
        this.isListening = true;
        this.startTime = Date.now();
        this.log('info', `Production Gateway listening on ${this.config.GATEWAY_HOST}:${this.config.GATEWAY_PORT}`, {
          wsUrl: this.config.GATEWAY_WS_URL,
          maxConnections: this.config.GATEWAY_MAX_CONNECTIONS,
          rateLimitRpm: this.config.GATEWAY_RATE_LIMIT_RPM,
          gatewayNodeId: this.config.GATEWAY_NODE_ID
        });

        // 1. Startup State Reconciliation: Prune local & dead-node orphans safely
        if (this.config.NODE_ENV !== 'test') {
          try {
            await StateReconciliationService.reconcileOnStartup(
              this.config.GATEWAY_NODE_ID,
              this.config.GATEWAY_NODE_HOSTNAME,
              this.config.GATEWAY_NODE_REGION,
              this.config.GATEWAY_NODE_STALE_THRESHOLD_MS
            );
          } catch (err: any) {
            this.log('error', 'Startup reconciliation encountered non-fatal error', { error: err.message });
          }
        }

        // 2. Periodic Liveness Reaper: prune silent host sockets and send ping frames
        this.heartbeatReaperTimer = setInterval(async () => {
          const now = Date.now();
          const deadThresholdMs = 60000; // 60 seconds of complete silence
          for (const [connId, conn] of Array.from(this.activeConnections.entries())) {
            if (now - conn.lastHeartbeatAt.getTime() > deadThresholdMs) {
              this.log('warn', 'Reaping dead/silent host WebSocket connection', {
                event: 'SESSION_HEARTBEAT_TIMEOUT',
                connectionId: connId,
                sessionId: conn.sessionId,
                sessionEpoch: conn.sessionEpoch,
                deviceId: conn.deviceId,
                lastHeartbeatAgeMs: now - conn.lastHeartbeatAt.getTime()
              });
              try {
                conn.socket.terminate();
              } catch {}
              await this.cleanupConnection(connId, conn.sessionId);
            } else if (conn.socket.readyState === WebSocket.OPEN && conn.isAuthoritative && !conn.isEvicted && !conn.isClosed) {
              try {
                conn.socket.ping();
              } catch {}
            }
          }
        }, this.config.GATEWAY_HEARTBEAT_INTERVAL_MS);

        // 3. Periodic Control Plane Reconciliation Engine (Batch 11A.5)
        if (this.config.NODE_ENV !== 'test') {
          this.reconciliationTimer = setInterval(async () => {
            const activeIds = new Set<string>(this.activeConnections.keys());
            try {
              await StateReconciliationService.runReconciliationCycle(
                this.config.GATEWAY_NODE_ID,
                activeIds,
                this.config.GATEWAY_NODE_HOSTNAME,
                this.config.GATEWAY_NODE_STALE_THRESHOLD_MS,
                this.config.GATEWAY_CONNECTION_STALE_THRESHOLD_MS
              );
            } catch (err: any) {
              this.log('warn', 'Periodic reconciliation error', { error: err.message });
            }
          }, this.config.GATEWAY_RECONCILIATION_INTERVAL_MS);
        }

        // 4. Batched Heartbeat Persistence: Flush active connection heartbeats in batches
        if (this.config.NODE_ENV !== 'test') {
          this.heartbeatBatchTimer = setInterval(async () => {
            const updates: Array<{ connectionId: string; lastHeartbeatAt: Date }> = [];
            for (const [connId, conn] of this.activeConnections.entries()) {
              if (conn.isAuthoritative && !conn.isEvicted && !conn.isClosed) {
                updates.push({ connectionId: connId, lastHeartbeatAt: conn.lastHeartbeatAt });
              }
            }
            if (updates.length > 0) {
              await StateReconciliationService.flushBatchedConnectionHeartbeats(updates);
            }
          }, this.config.GATEWAY_HEARTBEAT_BATCH_FLUSH_INTERVAL_MS);
        }

        // 5. Periodic Memory/Cache Pruner: Cleans expired rate limit and idempotency entries
        this.memoryPruneTimer = setInterval(() => {
          const now = Date.now();
          for (const [ip, entry] of this.rateLimitTracker.entries()) {
            if (now > entry.resetAt) {
              this.rateLimitTracker.delete(ip);
            }
          }
          for (const [reqId, entry] of this.idempotencyCache.entries()) {
            if (now > entry.expiresAt) {
              this.idempotencyCache.delete(reqId);
            }
          }
        }, 120000);

        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isListening) return;

    this.log('info', 'Initiating graceful Gateway shutdown');

    if (this.heartbeatReaperTimer) {
      clearInterval(this.heartbeatReaperTimer);
      this.heartbeatReaperTimer = null;
    }

    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }

    if (this.heartbeatBatchTimer) {
      clearInterval(this.heartbeatBatchTimer);
      this.heartbeatBatchTimer = null;
    }

    if (this.memoryPruneTimer) {
      clearInterval(this.memoryPruneTimer);
      this.memoryPruneTimer = null;
    }

    // Cancel all active transfers
    for (const [transferId, transfer] of this.activeTransfers.entries()) {
      clearTimeout(transfer.timer);
      try {
        transfer.clientSocket.send(
          JSON.stringify({ type: 'FILE_STREAM_CANCEL', transferId, reason: 'Gateway shutting down' })
        );
      } catch {}
    }
    this.activeTransfers.clear();

    // Clear pending requests
    for (const [, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
    }
    this.pendingRequests.clear();
    this.idempotencyCache.clear();
    this.rateLimitTracker.clear();

    // Disconnect active connections
    for (const [, conn] of this.activeConnections.entries()) {
      try {
        conn.isClosed = true;
        conn.isAuthoritative = false;
        conn.isEvicted = true;
        conn.socket.send(JSON.stringify({ type: 'DISCONNECT', reason: 'Gateway shutting down' }));
        conn.socket.close();
      } catch {}
    }
    this.activeConnections.clear();
    this.deviceToConnectionMap.clear();
    this.hostnameToConnectionMap.clear();

    return new Promise((resolve) => {
      this.wss?.close(() => {
        this.httpServer?.close(() => {
          this.isListening = false;
          this.wss = null;
          this.httpServer = null;
          this.log('info', 'Gateway shutdown completed cleanly');
          resolve();
        });
      });
    });
  }

  private handleSocketConnection(socket: WebSocket, remoteIp: string): void {
    ConnectionObservability.emit({
      event: 'transport_connected',
      component: 'gateway',
      outcome: 'success',
      gatewayNodeId: this.config.GATEWAY_NODE_ID
    });

    // 1. Capacity Limit Guard
    if (this.activeConnections.size >= this.config.GATEWAY_MAX_CONNECTIONS) {
      this.log('warn', 'Connection rejected: gateway capacity reached', {
        activeConnections: this.activeConnections.size,
        max: this.config.GATEWAY_MAX_CONNECTIONS
      });

      ConnectionObservability.emit({
        event: 'connection_failed',
        component: 'gateway',
        outcome: 'rejected',
        errorCategory: 'gateway_rejected',
        reason: 'capacity_reached',
        gatewayNodeId: this.config.GATEWAY_NODE_ID
      });

      socket.send(
        JSON.stringify({
          type: 'ERROR',
          code: 'GATEWAY_CAPACITY_REACHED',
          message: 'Maximum gateway connection capacity reached'
        })
      );
      socket.close();
      return;
    }

    let authenticatedConnectionId: string | null = null;
    let authenticatedSessionId: string | null = null;
    let authenticatedEpoch: number = 0;
    let authFailureCount = 0;

    // 2. Authentication Timeout Guard
    const authTimeoutTimer = setTimeout(() => {
      if (!authenticatedConnectionId && socket.readyState === WebSocket.OPEN) {
        this.failedAuthCount++;
        this.log('warn', 'Socket authentication timed out');

        ConnectionObservability.emit({
          event: 'auth_failed',
          component: 'gateway',
          outcome: 'timeout',
          errorCategory: 'auth_timeout',
          gatewayNodeId: this.config.GATEWAY_NODE_ID
        });

        socket.send(
          JSON.stringify({
            type: 'AUTH_FAILURE',
            reason: 'Authentication timeout'
          })
        );
        socket.close();
      }
    }, this.config.GATEWAY_AUTH_TIMEOUT_MS);

    // 3. Send HELLO handshake greeting
    socket.send(JSON.stringify({ type: 'HELLO', version: '2.0' }));

    socket.on('message', async (data: Buffer | string) => {
      // 4. Rate Limiting Guard
      if (!this.checkRateLimit(remoteIp)) {
        socket.send(
          JSON.stringify({
            type: 'ERROR',
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Rate limit exceeded. Please throttle requests.'
          })
        );
        return;
      }

      // 5. Message Size Guard
      const byteLength = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
      if (byteLength > this.config.GATEWAY_MAX_MESSAGE_SIZE_BYTES) {
        this.log('warn', 'Message rejected: payload too large', { byteLength });
        socket.send(
          JSON.stringify({
            type: 'ERROR',
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Message exceeds maximum allowable size'
          })
        );
        return;
      }

      try {
        const msg: HandshakeMessage = JSON.parse(data.toString());

        // =====================================================================
        // AUTHENTICATION & CLEAN SESSION HANDOVER
        // =====================================================================
        if (msg.type === 'AUTH') {
          const { connectionToken, deviceId } = msg;
          if (!connectionToken || !deviceId) {
            authFailureCount++;
            this.failedAuthCount++;

            ConnectionObservability.emit({
              event: 'auth_failed',
              component: 'gateway',
              outcome: 'failed',
              errorCategory: 'missing_credentials',
              deviceId: deviceId || undefined,
              gatewayNodeId: this.config.GATEWAY_NODE_ID
            });

            socket.send(
              JSON.stringify({
                type: 'AUTH_FAILURE',
                reason: 'Missing connectionToken or deviceId'
              })
            );
            if (authFailureCount >= this.config.GATEWAY_MAX_AUTH_FAILURES) {
              socket.close();
            }
            return;
          }

          // Validate token via injected TokenValidator
          const connRecord = await this.tokenValidator.findConnection(deviceId, connectionToken);

          if (!connRecord) {
            authFailureCount++;
            this.failedAuthCount++;
            this.log('warn', 'Authentication failed: invalid token', { deviceId });

            ConnectionObservability.emit({
              event: 'auth_failed',
              component: 'gateway',
              outcome: 'failed',
              errorCategory: 'invalid_connection_token',
              deviceId,
              gatewayNodeId: this.config.GATEWAY_NODE_ID
            });

            socket.send(
              JSON.stringify({
                type: 'AUTH_FAILURE',
                reason: 'Invalid or revoked connection token'
              })
            );
            if (authFailureCount >= this.config.GATEWAY_MAX_AUTH_FAILURES) {
              socket.close();
            }
            return;
          }

          // Clear auth timeout on success
          clearTimeout(authTimeoutTimer);

          // Increment device monotonic session epoch
          const nextEpoch = (this.deviceEpochMap.get(deviceId) || 0) + 1;
          this.deviceEpochMap.set(deviceId, nextEpoch);
          const newSessionId = `${connRecord.id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

          // 1. Clean Handover / Fast Stale Socket Eviction
          // If the same connectionId or deviceId has an active session, evict it immediately
          const existingConnById = this.activeConnections.get(connRecord.id);
          const existingConnIdByDev = this.deviceToConnectionMap.get(deviceId);

          if (existingConnById) {
            this.reconnectCount++;
            this.evictStaleSession(existingConnById, 'Replaced by newer connection session (id match)', true);
          } else if (existingConnIdByDev && this.activeConnections.has(existingConnIdByDev)) {
            this.reconnectCount++;
            const oldConn = this.activeConnections.get(existingConnIdByDev)!;
            this.evictStaleSession(oldConn, 'Replaced by newer connection session (device match)', true);
          }

          authenticatedConnectionId = connRecord.id;
          authenticatedSessionId = newSessionId;
          authenticatedEpoch = nextEpoch;

          const now = new Date();
          await this.tokenValidator.markConnected(connRecord.id, now);

          const remoteEndpoint =
            connRecord.remoteEndpoint ||
            `https://node-${deviceId.substring(0, 8)}.remotenode.net`;
          const hostname = remoteEndpoint.replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase();

          const activeConn: ActiveGatewayConnection = {
            connectionId: connRecord.id,
            sessionId: newSessionId,
            sessionEpoch: nextEpoch,
            deviceId,
            userId: connRecord.userId,
            hostname,
            gatewayNodeId: this.config.GATEWAY_NODE_ID,
            socket,
            connectedAt: now,
            lastHeartbeatAt: now,
            remoteIp,
            isAuthoritative: true,
            isEvicted: false,
            isClosed: false
          };

          this.activeConnections.set(connRecord.id, activeConn);
          this.deviceToConnectionMap.set(deviceId, connRecord.id);
          this.hostnameToConnectionMap.set(hostname, connRecord.id);

          this.log('info', 'Android storage node authenticated successfully and registered as authoritative session', {
            event: 'SESSION_AUTHENTICATED',
            connectionId: connRecord.id,
            sessionId: newSessionId,
            sessionEpoch: nextEpoch,
            deviceId,
            userId: connRecord.userId,
            hostname
          });

          ConnectionObservability.emit({
            event: 'session_authenticated',
            component: 'gateway',
            outcome: 'success',
            connectionId: connRecord.id,
            sessionId: newSessionId,
            sessionEpoch: nextEpoch,
            deviceId,
            gatewayNodeId: this.config.GATEWAY_NODE_ID
          });

          socket.send(
            JSON.stringify({
              type: 'AUTH_SUCCESS',
              connectionId: connRecord.id,
              sessionId: newSessionId,
              remoteEndpoint
            })
          );
          return;
        }

        // Check if socket was authenticated and is still authoritative
        if (authenticatedConnectionId && authenticatedSessionId) {
          const currentConn = this.activeConnections.get(authenticatedConnectionId);
          if (!currentConn || currentConn.sessionId !== authenticatedSessionId || currentConn.isEvicted || currentConn.isClosed) {
            // Stale socket attempted to communicate — reject / ignore
            this.log('warn', 'Rejected frame from evicted/stale socket session', {
              type: msg.type,
              connectionId: authenticatedConnectionId,
              staleSessionId: authenticatedSessionId
            });
            return;
          }
        }

        if (msg.type === 'PING') {
          if (authenticatedConnectionId && authenticatedSessionId && this.activeConnections.has(authenticatedConnectionId)) {
            const conn = this.activeConnections.get(authenticatedConnectionId)!;
            if (conn.sessionId === authenticatedSessionId && conn.isAuthoritative && !conn.isEvicted && !conn.isClosed) {
              conn.lastHeartbeatAt = new Date();
            }
          }
          socket.send(JSON.stringify({ type: 'PONG' }));
          return;
        }

        if (msg.type === 'PONG') {
          if (authenticatedConnectionId && authenticatedSessionId && this.activeConnections.has(authenticatedConnectionId)) {
            const conn = this.activeConnections.get(authenticatedConnectionId)!;
            if (conn.sessionId === authenticatedSessionId && conn.isAuthoritative && !conn.isEvicted && !conn.isClosed) {
              conn.lastHeartbeatAt = new Date();
            }
          }
          return;
        }

        // =====================================================================
        // REQUEST ROUTING, AUTHORIZATION & IDEMPOTENCY
        // =====================================================================
        if (msg.type === 'FILE_REQUEST') {
          const { requestId, connectionId, operation, authorizedUserId } = msg;
          if (!requestId || !connectionId) {
            socket.send(
              JSON.stringify({
                type: 'FILE_RESPONSE',
                requestId: requestId || 'unknown',
                success: false,
                error: { code: 'INVALID_REQUEST', message: 'Missing requestId or connectionId' }
              })
            );
            return;
          }

          const targetConn = this.activeConnections.get(connectionId);
          if (!targetConn || !targetConn.isAuthoritative || targetConn.isEvicted || targetConn.isClosed || targetConn.socket.readyState !== WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'FILE_RESPONSE',
                requestId,
                success: false,
                error: {
                  code: 'DEVICE_OFFLINE',
                  message: 'Android file server host is offline or disconnected.'
                }
              })
            );
            return;
          }

          // Cross-User Routing Authorization Guard: if authorizedUserId is supplied, verify ownership
          if (authorizedUserId && targetConn.userId && targetConn.userId !== authorizedUserId) {
            socket.send(
              JSON.stringify({
                type: 'FILE_RESPONSE',
                requestId,
                success: false,
                error: {
                  code: 'UNAUTHORIZED_CROSS_USER_ACCESS',
                  message: 'Cross-user connection routing forbidden.'
                }
              })
            );
            return;
          }

          // Request Idempotency Check for mutating operations
          const isMutating = operation === 'UPLOAD' || operation === 'DELETE' || operation === 'RENAME' || operation === 'CREATE_FOLDER';
          if (isMutating && this.idempotencyCache.has(requestId)) {
            const cached = this.idempotencyCache.get(requestId)!;
            if (Date.now() < cached.expiresAt) {
              socket.send(JSON.stringify(cached.response));
              return;
            } else {
              this.idempotencyCache.delete(requestId);
            }
          }

          // Register pending request with request timeout cleanup
          const reqTimer = setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
              this.timedOutRequests++;
              this.pendingRequests.delete(requestId);
            }
          }, this.config.GATEWAY_REQUEST_TIMEOUT_MS);

          this.pendingRequests.set(requestId, {
            requestId,
            connectionId,
            sessionId: targetConn.sessionId,
            sessionEpoch: targetConn.sessionEpoch,
            operation,
            clientSocket: socket,
            createdAt: Date.now(),
            timer: reqTimer
          });

          // Forward request to target Android host socket
          targetConn.socket.send(JSON.stringify(msg));
          return;
        }

        if (msg.type === 'FILE_RESPONSE') {
          const { requestId } = msg;
          if (requestId && this.pendingRequests.has(requestId)) {
            const pending = this.pendingRequests.get(requestId)!;
            
            // Stale session validation: If response came from a socket that does not match pending sessionId
            if (authenticatedSessionId && pending.sessionId && pending.sessionId !== authenticatedSessionId) {
              this.log('warn', 'Ignoring FILE_RESPONSE from non-matching or stale session', {
                requestId,
                expectedSessionId: pending.sessionId,
                actualSessionId: authenticatedSessionId
              });
              return;
            }

            clearTimeout(pending.timer);

            if (pending.clientSocket && pending.clientSocket.readyState === WebSocket.OPEN) {
              pending.clientSocket.send(JSON.stringify(msg));
            } else if (pending.httpResolver) {
              pending.httpResolver(msg);
            }

            // Cache response for idempotent retries (30s TTL)
            const isMutating = pending.operation === 'UPLOAD' || pending.operation === 'DELETE' || pending.operation === 'RENAME' || pending.operation === 'CREATE_FOLDER';
            if (isMutating) {
              this.idempotencyCache.set(requestId, {
                response: msg,
                expiresAt: Date.now() + 30000
              });
            }

            this.pendingRequests.delete(requestId);
          }
          return;
        }

        // =====================================================================
        // LARGE FILE STREAMING DATA PLANE & CANCELLATION
        // =====================================================================
        if (msg.type === 'FILE_STREAM_START') {
          const { transferId, requestId, connectionId } = msg;
          if (!transferId || !requestId) return;

          const pending = this.pendingRequests.get(requestId);
          const targetConn = connectionId ? this.activeConnections.get(connectionId) : null;
          const owningSessionId = authenticatedSessionId || targetConn?.sessionId;
          const owningEpoch = authenticatedEpoch || targetConn?.sessionEpoch || 0;

          const transferTimer = setTimeout(() => {
            if (this.activeTransfers.has(transferId)) {
              this.failedTransfersCount++;
              this.activeTransfers.delete(transferId);
            }
          }, this.config.GATEWAY_TRANSFER_TIMEOUT_MS);

          this.activeTransfers.set(transferId, {
            transferId,
            requestId,
            connectionId: connectionId || targetConn?.connectionId || '',
            sessionId: owningSessionId,
            sessionEpoch: owningEpoch,
            clientSocket: pending && pending.clientSocket ? pending.clientSocket : socket,
            hostSocket: targetConn ? targetConn.socket : socket,
            bytesTransferred: 0,
            totalBytes: msg.totalBytes,
            startedAt: Date.now(),
            timer: transferTimer
          });

          if (pending && pending.clientSocket && pending.clientSocket.readyState === WebSocket.OPEN) {
            pending.clientSocket.send(JSON.stringify(msg));
          }
          return;
        }

        if (msg.type === 'FILE_STREAM_CHUNK') {
          const { transferId } = msg;
          if (transferId && this.activeTransfers.has(transferId)) {
            const transfer = this.activeTransfers.get(transferId)!;
            
            // Verify session match strictly
            if (authenticatedSessionId && transfer.sessionId && transfer.sessionId !== authenticatedSessionId) {
              this.log('warn', 'Ignoring FILE_STREAM_CHUNK from stale/non-matching session', {
                transferId,
                expectedSessionId: transfer.sessionId,
                actualSessionId: authenticatedSessionId
              });
              return;
            }

            if (msg.dataBase64) {
              transfer.bytesTransferred += Buffer.byteLength(msg.dataBase64);
            }
            if (transfer.clientSocket.readyState === WebSocket.OPEN) {
              transfer.clientSocket.send(JSON.stringify(msg));
            }
          }
          return;
        }

        if (msg.type === 'FILE_STREAM_END') {
          const { transferId, requestId } = msg;
          if (transferId && this.activeTransfers.has(transferId)) {
            const transfer = this.activeTransfers.get(transferId)!;
            
            if (authenticatedSessionId && transfer.sessionId && transfer.sessionId !== authenticatedSessionId) {
              this.log('warn', 'Ignoring FILE_STREAM_END from stale/non-matching session', {
                transferId,
                expectedSessionId: transfer.sessionId,
                actualSessionId: authenticatedSessionId
              });
              return;
            }

            clearTimeout(transfer.timer);
            this.completedTransfersCount++;
            if (transfer.clientSocket.readyState === WebSocket.OPEN) {
              transfer.clientSocket.send(JSON.stringify(msg));
            }
            this.activeTransfers.delete(transferId);
          }
          if (requestId && this.pendingRequests.has(requestId)) {
            const pending = this.pendingRequests.get(requestId)!;
            clearTimeout(pending.timer);
            this.pendingRequests.delete(requestId);
          }
          return;
        }

        if (msg.type === 'FILE_STREAM_CANCEL') {
          const { transferId, reason } = msg;
          if (transferId && this.activeTransfers.has(transferId)) {
            const transfer = this.activeTransfers.get(transferId)!;

            if (authenticatedSessionId && transfer.sessionId && transfer.sessionId !== authenticatedSessionId) {
              this.log('warn', 'Ignoring FILE_STREAM_CANCEL from stale/non-matching session', {
                transferId,
                expectedSessionId: transfer.sessionId,
                actualSessionId: authenticatedSessionId
              });
              return;
            }

            clearTimeout(transfer.timer);
            this.failedTransfersCount++;

            const cancelPayload = JSON.stringify({
              type: 'FILE_STREAM_CANCEL',
              transferId,
              reason: reason || 'Transfer cancelled by peer'
            });

            try {
              if (transfer.clientSocket.readyState === WebSocket.OPEN) {
                transfer.clientSocket.send(cancelPayload);
              }
              if (transfer.hostSocket.readyState === WebSocket.OPEN) {
                transfer.hostSocket.send(cancelPayload);
              }
            } catch {}

            this.activeTransfers.delete(transferId);
          }
          return;
        }

        if (msg.type === 'FILE_ERROR') {
          const { requestId, transferId } = msg;
          if (transferId && this.activeTransfers.has(transferId)) {
            const transfer = this.activeTransfers.get(transferId)!;
            if (!authenticatedSessionId || !transfer.sessionId || transfer.sessionId === authenticatedSessionId) {
              clearTimeout(transfer.timer);
              this.failedTransfersCount++;
              this.activeTransfers.delete(transferId);
            }
          }
          if (requestId && this.pendingRequests.has(requestId)) {
            const pending = this.pendingRequests.get(requestId)!;
            if (!authenticatedSessionId || !pending.sessionId || pending.sessionId === authenticatedSessionId) {
              clearTimeout(pending.timer);
              if (pending.clientSocket && pending.clientSocket.readyState === WebSocket.OPEN) {
                pending.clientSocket.send(JSON.stringify(msg));
              }
              this.pendingRequests.delete(requestId);
            }
          }
          return;
        }

        if (msg.type === 'DISCONNECT') {
          if (authenticatedConnectionId && authenticatedSessionId) {
            await this.handleSocketClose(authenticatedConnectionId, authenticatedSessionId, authenticatedEpoch);
          }
          socket.close();
          return;
        }

        // Unknown protocol message handling
        socket.send(
          JSON.stringify({
            type: 'ERROR',
            code: 'UNKNOWN_MESSAGE_TYPE',
            message: `Unsupported message type: ${msg.type}`
          })
        );
      } catch (e) {
        socket.send(
          JSON.stringify({
            type: 'ERROR',
            code: 'INVALID_MESSAGE',
            message: 'Malformed JSON payload'
          })
        );
      }
    });

    socket.on('close', async () => {
      clearTimeout(authTimeoutTimer);
      if (authenticatedConnectionId && authenticatedSessionId) {
        await this.handleSocketClose(authenticatedConnectionId, authenticatedSessionId, authenticatedEpoch);
      }
    });
  }

  /**
   * Close event handler with epoch & session verification.
   * Prevents a stale/superseded socket from wiping a replacement session.
   */
  private async handleSocketClose(
    connectionId: string,
    sessionId: string,
    sessionEpoch: number
  ): Promise<void> {
    const currentConn = this.activeConnections.get(connectionId);

    // CRITICAL GUARD: Verify that this closing socket is STILL the authoritative session
    if (!currentConn || currentConn.sessionId !== sessionId) {
      this.staleClosesIgnoredCount++;
      this.log('info', 'Ignoring close event from stale/superseded socket session', {
        event: 'SESSION_CLOSE_IGNORED_STALE',
        connectionId,
        closedSessionId: sessionId,
        closedEpoch: sessionEpoch,
        currentSessionId: currentConn?.sessionId,
        currentEpoch: currentConn?.sessionEpoch
      });
      return;
    }

    await this.cleanupConnection(connectionId, sessionId);
  }

  /**
   * Cleans up runtime maps and synchronizes database status atomically.
   * Enforces identity-aware deletion so that closing session A never deletes maps belonging to session B.
   */
  private async cleanupConnection(connectionId: string, sessionId?: string): Promise<void> {
    const conn = this.activeConnections.get(connectionId);

    // If a specific sessionId was requested, verify that the active session matches
    if (sessionId && conn && conn.sessionId !== sessionId) {
      this.staleClosesIgnoredCount++;
      this.log('info', 'Ignoring cleanupConnection for non-matching sessionId', {
        connectionId,
        targetSessionId: sessionId,
        currentSessionId: conn.sessionId
      });
      return;
    }

    if (conn) {
      // Identity-aware device map cleanup: Only delete from device map if it points to THIS connectionId AND this session
      if (
        this.deviceToConnectionMap.get(conn.deviceId) === connectionId &&
        this.activeConnections.get(connectionId)?.sessionId === conn.sessionId
      ) {
        this.deviceToConnectionMap.delete(conn.deviceId);
      }

      // Identity-aware hostname map cleanup: Only delete from hostname map if it points to THIS connectionId AND this session
      if (conn.hostname) {
        const lowerHost = conn.hostname.toLowerCase();
        if (
          this.hostnameToConnectionMap.get(lowerHost) === connectionId &&
          this.activeConnections.get(connectionId)?.sessionId === conn.sessionId
        ) {
          this.hostnameToConnectionMap.delete(lowerHost);
        }
      }

      conn.isAuthoritative = false;
      conn.isEvicted = true;
      conn.isClosed = true;
    }

    // Identity-aware activeConnections cleanup: Only delete from activeConnections if it matches conn sessionId
    if (conn && this.activeConnections.get(connectionId)?.sessionId === conn.sessionId) {
      this.activeConnections.delete(connectionId);
    } else if (!conn && connectionId) {
      // If already missing from activeConnections, ensure clean state
      this.activeConnections.delete(connectionId);
    }

    // Cancel pending requests associated with this specific connection/session
    for (const [reqId, pending] of Array.from(this.pendingRequests.entries())) {
      if (
        (conn && pending.sessionId === conn.sessionId) ||
        (!pending.sessionId && pending.connectionId === connectionId)
      ) {
        clearTimeout(pending.timer);
        this.timedOutRequests++;
        if (pending.clientSocket && pending.clientSocket.readyState === WebSocket.OPEN) {
          pending.clientSocket.send(
            JSON.stringify({
              type: 'FILE_RESPONSE',
              requestId: reqId,
              success: false,
              error: {
                code: 'DEVICE_OFFLINE',
                message: 'Android file server host disconnected.'
              }
            })
          );
        } else if (pending.httpResolver) {
          pending.httpResolver({
            type: 'FILE_RESPONSE',
            requestId: reqId,
            success: false,
            error: {
              code: 'DEVICE_OFFLINE',
              message: 'Android file server host disconnected.'
            }
          });
        }
        this.pendingRequests.delete(reqId);
      }
    }

    // Cancel active transfers associated with this specific connection/session
    for (const [transferId, transfer] of Array.from(this.activeTransfers.entries())) {
      if (
        (conn && transfer.sessionId === conn.sessionId) ||
        (!transfer.sessionId && transfer.connectionId === connectionId)
      ) {
        clearTimeout(transfer.timer);
        this.failedTransfersCount++;
        try {
          if (transfer.clientSocket && transfer.clientSocket.readyState === WebSocket.OPEN) {
            transfer.clientSocket.send(
              JSON.stringify({
                type: 'FILE_STREAM_CANCEL',
                transferId,
                reason: 'Host device disconnected during transfer'
              })
            );
          }
        } catch {}
        this.activeTransfers.delete(transferId);
      }
    }

    this.log('info', 'Cleaned up gateway connection session', {
      event: 'SESSION_CLEANED',
      connectionId,
      sessionId: conn?.sessionId,
      deviceId: conn?.deviceId
    });

    await this.tokenValidator.markDisconnected(connectionId, new Date());
  }

  public getHealthStatus(): {
    status: string;
    gateway: string;
    activeConnections: number;
    authenticatedConnections: number;
    connectedDevices: number;
    reconnectCount: number;
    rateLimitEvents: number;
    timedOutRequests: number;
    failedAuthCount: number;
    pendingRequestsCount: number;
    activeTransfersCount: number;
    completedTransfersCount: number;
    failedTransfersCount: number;
    sessionReplacedCount: number;
    staleClosesIgnoredCount: number;
    port: number;
    uptimeSeconds: number;
    gatewayMode: string;
    gatewayNodeId: string;
    reconciliation?: any;
    observability?: any;
  } {
    return {
      status: this.isListening ? 'ok' : 'stopped',
      gateway: this.isListening ? 'ACTIVE' : 'INACTIVE',
      activeConnections: this.activeConnections.size,
      authenticatedConnections: this.activeConnections.size,
      connectedDevices: this.deviceToConnectionMap.size,
      reconnectCount: this.reconnectCount,
      rateLimitEvents: this.rateLimitEvents,
      timedOutRequests: this.timedOutRequests,
      failedAuthCount: this.failedAuthCount,
      pendingRequestsCount: this.pendingRequests.size,
      activeTransfersCount: this.activeTransfers.size,
      completedTransfersCount: this.completedTransfersCount,
      failedTransfersCount: this.failedTransfersCount,
      sessionReplacedCount: this.sessionReplacedCount,
      staleClosesIgnoredCount: this.staleClosesIgnoredCount,
      port: this.config.GATEWAY_PORT,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      gatewayMode: this.config.NODE_ENV,
      gatewayNodeId: this.config.GATEWAY_NODE_ID,
      reconciliation: StateReconciliationService.getReconciliationMetrics(),
      observability: ConnectionObservability.getMetrics()
    };
  }

  public getReadinessStatus(): {
    status: string;
    controlPlaneConnected: boolean;
    activeConnections: number;
    connectedDevices: number;
    activeTransfers: number;
  } {
    return {
      status: this.isListening ? 'ready' : 'not_ready',
      controlPlaneConnected: true,
      activeConnections: this.activeConnections.size,
      connectedDevices: this.deviceToConnectionMap.size,
      activeTransfers: this.activeTransfers.size
    };
  }

  public getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }

  public getActiveTransferCount(): number {
    return this.activeTransfers.size;
  }

  public attachToHttpServer(httpServer: http.Server): void {
    if (this.wss) return;

    this.httpServer = httpServer;
    this.wss = new WebSocketServer({
      server: httpServer,
      maxPayload: this.config.GATEWAY_MAX_MESSAGE_SIZE_BYTES
    });

    this.wss.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
      const remoteIp = req.socket.remoteAddress || '127.0.0.1';
      this.handleSocketConnection(socket, remoteIp);
    });

    this.isListening = true;
    this.startTime = Date.now();
    this.log('info', 'Gateway WebSocket attached to main HTTP server', {
      maxConnections: this.config.GATEWAY_MAX_CONNECTIONS
    });
  }

  public async handleFastifyStorageRequest(request: any, reply: any): Promise<void> {
    const rawUrl = request.raw.url || request.url || '';
    const parsedUrl = new URL(rawUrl, `http://${request.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const hostHeader = (request.headers.host || '').split(':')[0].toLowerCase();
    const endpointQuery = parsedUrl.searchParams.get('endpoint');
    const deviceIdQuery = parsedUrl.searchParams.get('deviceId');
    const connectionIdHeader = request.headers['x-connection-id'] as string | undefined;

    let resolvedConnId: string | null = null;

    if (deviceIdQuery && this.deviceToConnectionMap.has(deviceIdQuery)) {
      resolvedConnId = this.deviceToConnectionMap.get(deviceIdQuery) || null;
    } else if (endpointQuery && this.hostnameToConnectionMap.has(endpointQuery)) {
      resolvedConnId = this.hostnameToConnectionMap.get(endpointQuery) || null;
    } else if (this.hostnameToConnectionMap.has(hostHeader)) {
      resolvedConnId = this.hostnameToConnectionMap.get(hostHeader) || null;
    } else if (connectionIdHeader && this.activeConnections.has(connectionIdHeader)) {
      resolvedConnId = connectionIdHeader;
    }

    const targetHostname = endpointQuery || hostHeader;
    const targetConn = resolvedConnId ? this.activeConnections.get(resolvedConnId) : null;

    if (!targetConn || !targetConn.isAuthoritative || targetConn.isEvicted || targetConn.isClosed || targetConn.socket.readyState !== WebSocket.OPEN) {
      const isUnknown = !this.hostnameToConnectionMap.has(targetHostname) && !this.deviceToConnectionMap.has(deviceIdQuery || '');
      return reply.status(isUnknown ? 404 : 503).send({
        success: false,
        error: {
          code: isUnknown ? 'SERVER_NOT_FOUND' : 'SERVER_OFFLINE',
          message: isUnknown
            ? `Server endpoint '${targetHostname}' is not recognized.`
            : 'Android file server host is offline or disconnected.'
        }
      });
    }

    const requestId = 'http-req-' + Math.random().toString(36).substring(2, 10);
    const targetSessionId = targetConn.sessionId;
    const targetEpoch = targetConn.sessionEpoch;
    const bodyPayload = (request.body && typeof request.body === 'object') ? request.body : {};

    let operation = 'HEALTH';
    if (pathname === '/api/storage') operation = 'STORAGE';
    else if (pathname === '/api/files/recent') operation = 'RECENT';
    else if (pathname === '/api/files' && request.method === 'GET') operation = 'LIST';
    else if (pathname === '/api/folders' && request.method === 'POST') operation = 'CREATE_FOLDER';
    else if (pathname === '/api/rename' && request.method === 'POST') operation = 'RENAME';
    else if (pathname === '/api/files' && request.method === 'DELETE') operation = 'DELETE';

    const fileRequestMsg: HandshakeMessage = {
      type: 'FILE_REQUEST',
      requestId,
      connectionId: resolvedConnId!,
      sessionId: targetSessionId,
      operation,
      path: (request.query as any)?.path || bodyPayload.path || '/',
      name: (request.query as any)?.name || bodyPayload.name,
      oldPath: bodyPayload.oldPath,
      newName: bodyPayload.newName
    };

    const responsePromise = new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.timedOutRequests++;
          this.pendingRequests.delete(requestId);
          resolve({
            type: 'FILE_RESPONSE',
            requestId,
            success: false,
            error: { code: 'REQUEST_TIMEOUT', message: 'Storage host request timed out.' }
          });
        }
      }, this.config.GATEWAY_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        requestId,
        connectionId: resolvedConnId!,
        sessionId: targetSessionId,
        sessionEpoch: targetEpoch,
        operation,
        httpResolver: (resp) => {
          clearTimeout(timer);
          resolve(resp);
        },
        createdAt: Date.now(),
        timer
      });
    });

    targetConn.socket.send(JSON.stringify(fileRequestMsg));

    const response = await responsePromise;
    const statusCode = response.success ? 200 : 400;
    return reply.status(statusCode).send(response.data || response);
  }

  /**
   * Check if the gateway has an active live WebSocket connection for a given device.
   * Used by the file-manager proxy routes to verify real connectivity before proxying.
   */
  public hasActiveConnectionForDevice(deviceId: string): boolean {
    const connId = this.deviceToConnectionMap.get(deviceId);
    if (!connId) return false;
    const conn = this.activeConnections.get(connId);
    return !!(conn && conn.isAuthoritative && !conn.isEvicted && !conn.isClosed && conn.socket.readyState === WebSocket.OPEN);
  }

  /**
   * Retrieves active authoritative session metadata for a given device.
   * Used for evaluating customer status remote availability and liveness.
   */
  public getActiveSessionForDevice(deviceId: string): {
    connectionId: string;
    sessionId: string;
    sessionEpoch: number;
    isAuthoritative: boolean;
    lastHeartbeatAt: Date;
    connectedAt: Date;
    remoteIp?: string;
  } | null {
    const connId = this.deviceToConnectionMap.get(deviceId);
    if (!connId) return null;
    const conn = this.activeConnections.get(connId);
    if (!conn || !conn.isAuthoritative || conn.isEvicted || conn.isClosed || conn.socket.readyState !== WebSocket.OPEN) {
      return null;
    }
    return {
      connectionId: conn.connectionId,
      sessionId: conn.sessionId,
      sessionEpoch: conn.sessionEpoch,
      isAuthoritative: conn.isAuthoritative,
      lastHeartbeatAt: conn.lastHeartbeatAt,
      connectedAt: conn.connectedAt,
      remoteIp: conn.remoteIp
    };
  }

  /**
   * Proxy a file-manager operation to an Android device identified by deviceId.
   * Resolves the active WebSocket connection via deviceToConnectionMap,
   * sends the FILE_REQUEST message, and awaits the FILE_RESPONSE.
   * This is the server-side equivalent of what handleFastifyStorageRequest does
   * via hostname, but uses deviceId directly for ZdexCloud-authenticated requests.
   */
  public async handleProxiedFileRequestByDeviceId(
    deviceId: string,
    operation: string,
    params: {
      path?: string;
      name?: string;
      oldPath?: string;
      newName?: string;
      dataBase64?: string;
    } = {}
  ): Promise<any> {
    const connId = this.deviceToConnectionMap.get(deviceId);
    if (!connId || !this.activeConnections.has(connId)) {
      this.log('warn', `[FILE_MANAGER] device offline deviceId=${deviceId}`);
      return {
        success: false,
        error: {
          code: 'DEVICE_OFFLINE',
          message: 'Android file server host is offline or disconnected.'
        }
      };
    }

    const targetConn = this.activeConnections.get(connId)!;
    if (!targetConn.isAuthoritative || targetConn.isEvicted || targetConn.isClosed || targetConn.socket.readyState !== WebSocket.OPEN) {
      this.log('warn', `[FILE_MANAGER] device session not authoritative or closed deviceId=${deviceId}`);
      return {
        success: false,
        error: {
          code: 'DEVICE_OFFLINE',
          message: 'Android file server host connection is not ready or closing.'
        }
      };
    }

    const requestId = 'fm-' + Math.random().toString(36).substring(2, 12);
    const targetSessionId = targetConn.sessionId;
    const targetEpoch = targetConn.sessionEpoch;

    this.log('info', `[FILE_MANAGER] request deviceId=${deviceId} connectionId=${connId} sessionId=${targetSessionId} operation=${operation} requestId=${requestId}`);

    const fileRequestMsg: any = {
      type: 'FILE_REQUEST',
      requestId,
      connectionId: connId,
      sessionId: targetSessionId,
      operation,
      path: params.path || '/',
      name: params.name,
      oldPath: params.oldPath,
      newName: params.newName,
      dataBase64: params.dataBase64
    };

    const timeoutMs = (operation === 'DOWNLOAD' || operation === 'UPLOAD')
      ? Math.max(this.config.GATEWAY_REQUEST_TIMEOUT_MS, 120000)
      : this.config.GATEWAY_REQUEST_TIMEOUT_MS;

    const responsePromise = new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.timedOutRequests++;
          this.pendingRequests.delete(requestId);
          this.log('error', `[FILE_MANAGER] timeout deviceId=${deviceId} requestId=${requestId} operation=${operation}`);
          resolve({
            success: false,
            error: { code: 'REQUEST_TIMEOUT', message: 'Storage host request timed out.' }
          });
        }
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        requestId,
        connectionId: connId,
        sessionId: targetSessionId,
        sessionEpoch: targetEpoch,
        operation,
        httpResolver: (resp) => {
          clearTimeout(timer);
          this.log('info', `[GATEWAY] Android response received requestId=${requestId} success=${resp?.success !== false}`);
          resolve(resp);
        },
        createdAt: Date.now(),
        timer
      });
    });

    this.log('info', `[FILE_MANAGER] sending ${operation} request to Android requestId=${requestId}`);
    targetConn.socket.send(JSON.stringify(fileRequestMsg));
    return responsePromise;
  }
}

export const defaultGatewayService = new GatewayService();

