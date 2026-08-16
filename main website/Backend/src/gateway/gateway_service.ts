import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '../config/database.js';
import { GatewayConfig, loadGatewayConfig } from './gateway_config.js';

export interface HandshakeMessage {
  type: string;
  version?: string;
  connectionToken?: string;
  deviceId?: string;
  connectionId?: string;
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
  deviceId: string;
  userId?: string;
  hostname?: string;
  socket: WebSocket;
  connectedAt: Date;
  lastHeartbeatAt: Date;
  remoteIp?: string;
}

export interface PendingClientRequest {
  requestId: string;
  connectionId: string;
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

/** Production implementation — validates against the Control Plane DB via Prisma */
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
      const conn = await prisma.deviceConnection.update({
        where: { id: connectionId },
        data: { status: 'CONNECTED', connectedAt: now, lastHeartbeatAt: now },
        include: { device: true }
      });

      if (conn?.deviceId) {
        await prisma.device.update({
          where: { id: conn.deviceId },
          data: { status: 'ONLINE', lastSeenAt: now }
        });

        await prisma.serverInstance.updateMany({
          where: { deviceId: conn.deviceId },
          data: { status: 'RUNNING', startedAt: now, lastHeartbeatAt: now }
        });

        const endpoints = await prisma.serverEndpoint.findMany({
          where: {
            serverInstance: { deviceId: conn.deviceId }
          }
        });

        for (const ep of endpoints) {
          await prisma.serverEndpoint.update({
            where: { id: ep.id },
            data: { status: 'ACTIVE' }
          });
        }

        if (conn.device?.userId) {
          await prisma.auditEvent.create({
            data: {
              userId: conn.device.userId,
              deviceId: conn.deviceId,
              eventType: 'REMOTE_CONNECTION_CONNECTED',
              metadata: { connectionId, remoteEndpoint: conn.remoteEndpoint }
            }
          });
        }
      }
    } catch {
      // Ignore DB errors
    }
  }

  async markDisconnected(connectionId: string, disconnectedAt: Date) {
    try {
      const conn = await prisma.deviceConnection.update({
        where: { id: connectionId },
        data: { status: 'DISCONNECTED', disconnectedAt },
        include: { device: true }
      });

      if (conn?.deviceId) {
        await prisma.device.update({
          where: { id: conn.deviceId },
          data: { status: 'OFFLINE' }
        });

        await prisma.serverInstance.updateMany({
          where: { deviceId: conn.deviceId },
          data: { status: 'STOPPED' }
        });

        const endpoints = await prisma.serverEndpoint.findMany({
          where: {
            serverInstance: { deviceId: conn.deviceId }
          }
        });

        for (const ep of endpoints) {
          await prisma.serverEndpoint.update({
            where: { id: ep.id },
            data: { status: 'INACTIVE' }
          });
        }

        if (conn.device?.userId) {
          await prisma.auditEvent.create({
            data: {
              userId: conn.device.userId,
              deviceId: conn.deviceId,
              eventType: 'REMOTE_CONNECTION_DISCONNECTED',
              metadata: { connectionId }
            }
          });
        }
      }
    } catch {
      // Ignore DB errors during socket cleanup
    }
  }
}

/**
 * Production Gateway Service — Transport & Proxy Layer for RemoteNode Personal File Servers
 * (Strictly routes messages without storing user files or owning filesystem data)
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
  
  // Observability Counters
  private failedAuthCount = 0;
  private reconnectCount = 0;
  private rateLimitEvents = 0;
  private timedOutRequests = 0;
  private completedTransfersCount = 0;
  private failedTransfersCount = 0;
  
  private isListening = false;
  private startTime = Date.now();
  private config: GatewayConfig;
  private tokenValidator: TokenValidator;

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
        if (!resolvedConnId || !this.activeConnections.has(resolvedConnId)) {
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

        const targetConn = this.activeConnections.get(resolvedConnId)!;
        const requestId = 'http-req-' + Math.random().toString(36).substring(2, 10);

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
          connectionId: resolvedConnId,
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
            connectionId: resolvedConnId,
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
      this.httpServer?.listen(this.config.GATEWAY_PORT, this.config.GATEWAY_HOST, () => {
        this.isListening = true;
        this.startTime = Date.now();
        this.log('info', `Production Gateway listening on ${this.config.GATEWAY_HOST}:${this.config.GATEWAY_PORT}`, {
          wsUrl: this.config.GATEWAY_WS_URL,
          maxConnections: this.config.GATEWAY_MAX_CONNECTIONS,
          rateLimitRpm: this.config.GATEWAY_RATE_LIMIT_RPM
        });
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isListening) return;

    this.log('info', 'Initiating graceful Gateway shutdown');

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

    // Disconnect active connections
    for (const [, conn] of this.activeConnections.entries()) {
      try {
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
    // 1. Capacity Limit Guard
    if (this.activeConnections.size >= this.config.GATEWAY_MAX_CONNECTIONS) {
      this.log('warn', 'Connection rejected: gateway capacity reached', {
        activeConnections: this.activeConnections.size,
        max: this.config.GATEWAY_MAX_CONNECTIONS
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
    let authFailureCount = 0;

    // 2. Authentication Timeout Guard
    const authTimeoutTimer = setTimeout(() => {
      if (!authenticatedConnectionId && socket.readyState === WebSocket.OPEN) {
        this.failedAuthCount++;
        this.log('warn', 'Socket authentication timed out');
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
        // AUTHENTICATION & DUPLICATE SESSION EVICTION
        // =====================================================================
        if (msg.type === 'AUTH') {
          const { connectionToken, deviceId } = msg;
          if (!connectionToken || !deviceId) {
            authFailureCount++;
            this.failedAuthCount++;
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

          // Duplicate Session Eviction: if same connectionId or deviceId is already active, close old socket
          const existingConnId = connRecord.id;
          if (this.activeConnections.has(existingConnId)) {
            this.reconnectCount++;
            const oldConn = this.activeConnections.get(existingConnId)!;
            try {
              oldConn.socket.send(
                JSON.stringify({ type: 'DISCONNECT', reason: 'Replaced by newer connection session' })
              );
              oldConn.socket.close();
            } catch {}
            this.activeConnections.delete(existingConnId);
          }

          if (this.deviceToConnectionMap.has(deviceId)) {
            this.reconnectCount++;
            const oldConnId = this.deviceToConnectionMap.get(deviceId)!;
            if (this.activeConnections.has(oldConnId)) {
              const oldConn = this.activeConnections.get(oldConnId)!;
              try {
                oldConn.socket.send(
                  JSON.stringify({ type: 'DISCONNECT', reason: 'Device reconnected with new session' })
                );
                oldConn.socket.close();
              } catch {}
              this.activeConnections.delete(oldConnId);
            }
          }

          authenticatedConnectionId = connRecord.id;
          const now = new Date();
          await this.tokenValidator.markConnected(connRecord.id, now);

          const remoteEndpoint =
            connRecord.remoteEndpoint ||
            `https://node-${deviceId.substring(0, 8)}.remotenode.net`;
          const hostname = remoteEndpoint.replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase();

          this.activeConnections.set(connRecord.id, {
            connectionId: connRecord.id,
            deviceId,
            userId: connRecord.userId,
            hostname,
            socket,
            connectedAt: now,
            lastHeartbeatAt: now,
            remoteIp
          });
          this.deviceToConnectionMap.set(deviceId, connRecord.id);
          this.hostnameToConnectionMap.set(hostname, connRecord.id);

          this.log('info', 'Android storage node authenticated successfully', {
            connectionId: connRecord.id,
            deviceId,
            userId: connRecord.userId,
            hostname
          });

          socket.send(
            JSON.stringify({
              type: 'AUTH_SUCCESS',
              connectionId: connRecord.id,
              remoteEndpoint
            })
          );
          return;
        }

        if (msg.type === 'PING') {
          if (authenticatedConnectionId && this.activeConnections.has(authenticatedConnectionId)) {
            const conn = this.activeConnections.get(authenticatedConnectionId)!;
            conn.lastHeartbeatAt = new Date();
          }
          socket.send(JSON.stringify({ type: 'PONG' }));
          return;
        }

        if (msg.type === 'PONG') {
          if (authenticatedConnectionId && this.activeConnections.has(authenticatedConnectionId)) {
            const conn = this.activeConnections.get(authenticatedConnectionId)!;
            conn.lastHeartbeatAt = new Date();
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
          if (!targetConn || targetConn.socket.readyState !== WebSocket.OPEN) {
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

          const transferTimer = setTimeout(() => {
            if (this.activeTransfers.has(transferId)) {
              this.failedTransfersCount++;
              this.activeTransfers.delete(transferId);
            }
          }, this.config.GATEWAY_TRANSFER_TIMEOUT_MS);

          this.activeTransfers.set(transferId, {
            transferId,
            requestId,
            connectionId: connectionId || '',
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
            clearTimeout(transfer.timer);
            this.failedTransfersCount++;
            this.activeTransfers.delete(transferId);
          }
          if (requestId && this.pendingRequests.has(requestId)) {
            const pending = this.pendingRequests.get(requestId)!;
            clearTimeout(pending.timer);
            if (pending.clientSocket && pending.clientSocket.readyState === WebSocket.OPEN) {
              pending.clientSocket.send(JSON.stringify(msg));
            }
            this.pendingRequests.delete(requestId);
          }
          return;
        }

        if (msg.type === 'DISCONNECT') {
          if (authenticatedConnectionId) {
            await this.cleanupConnection(authenticatedConnectionId);
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
      if (authenticatedConnectionId) {
        await this.cleanupConnection(authenticatedConnectionId);
      }
    });
  }

  private async cleanupConnection(connectionId: string): Promise<void> {
    const conn = this.activeConnections.get(connectionId);
    if (conn) {
      this.deviceToConnectionMap.delete(conn.deviceId);
      if (conn.hostname) {
        this.hostnameToConnectionMap.delete(conn.hostname);
      }
    }
    this.activeConnections.delete(connectionId);

    // Cancel transfers associated with this connection
    for (const [transferId, transfer] of this.activeTransfers.entries()) {
      if (transfer.connectionId === connectionId) {
        clearTimeout(transfer.timer);
        this.failedTransfersCount++;
        try {
          transfer.clientSocket.send(
            JSON.stringify({
              type: 'FILE_STREAM_CANCEL',
              transferId,
              reason: 'Host device disconnected during transfer'
            })
          );
        } catch {}
        this.activeTransfers.delete(transferId);
      }
    }

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
    port: number;
    uptimeSeconds: number;
    gatewayMode: string;
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
      port: this.config.GATEWAY_PORT,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      gatewayMode: this.config.NODE_ENV
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
    } else if (this.activeConnections.size === 1) {
      resolvedConnId = Array.from(this.activeConnections.keys())[0];
    }

    const targetHostname = endpointQuery || hostHeader;

    if (!resolvedConnId || !this.activeConnections.has(resolvedConnId)) {
      const isUnknown = !this.hostnameToConnectionMap.has(targetHostname) && this.activeConnections.size === 0;
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

    const targetConn = this.activeConnections.get(resolvedConnId)!;
    const requestId = 'http-req-' + Math.random().toString(36).substring(2, 10);
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
      connectionId: resolvedConnId,
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
}

export const defaultGatewayService = new GatewayService();

