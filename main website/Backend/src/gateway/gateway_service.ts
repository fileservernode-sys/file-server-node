import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '../config/database.js';
import { GatewayConfig, loadGatewayConfig } from './gateway_config.js';

export interface HandshakeMessage {
  type: string;
  version?: string;
  connectionToken?: string;
  deviceId?: string;
  connectionId?: string;
  remoteEndpoint?: string;
  reason?: string;
  code?: string;
  message?: string;
  requestId?: string;
  operation?: string;
  path?: string;
  name?: string;
  oldPath?: string;
  newName?: string;
  success?: boolean;
  data?: any;
  error?: any;
  chunkIndex?: number;
  dataBase64?: string;
}

export interface ActiveGatewayConnection {
  connectionId: string;
  deviceId: string;
  socket: WebSocket;
  connectedAt: Date;
  lastHeartbeatAt: Date;
}

/**
 * Abstraction for token-to-connection-record validation.
 * Default implementation uses Prisma; tests inject a mock to avoid DB I/O.
 */
export interface TokenValidator {
  findConnection(
    deviceId: string,
    connectionToken: string
  ): Promise<{ id: string; deviceId: string; remoteEndpoint?: string | null } | null>;
  markConnected(connectionId: string, now: Date): Promise<void>;
  markDisconnected(connectionId: string, disconnectedAt: Date): Promise<void>;
}

/** Production implementation — validates against the Control Plane DB via Prisma */
export class PrismaTokenValidator implements TokenValidator {
  async findConnection(deviceId: string, connectionToken: string) {
    try {
      return await prisma.deviceConnection.findFirst({ where: { deviceId, connectionToken } });
    } catch {
      // DB offline — surface as null so gateway rejects auth cleanly in production
      return null;
    }
  }

  async markConnected(connectionId: string, now: Date) {
    try {
      await prisma.deviceConnection.update({
        where: { id: connectionId },
        data: { status: 'CONNECTED', connectedAt: now, lastHeartbeatAt: now }
      });
    } catch {
      // Ignore DB errors
    }
  }

  async markDisconnected(connectionId: string, disconnectedAt: Date) {
    try {
      await prisma.deviceConnection.update({
        where: { id: connectionId },
        data: { status: 'DISCONNECTED', disconnectedAt }
      });
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
  private activeConnections: Map<string, ActiveGatewayConnection> = new Map();
  private pendingRequests: Map<string, WebSocket> = new Map(); // requestId -> clientSocket
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

  public async start(): Promise<void> {
    if (this.isListening) return;

    this.httpServer = http.createServer((req, res) => {
      const url = req.url || '';

      if (url === '/health' && req.method === 'GET') {
        const health = this.getHealthStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
        return;
      }

      if (url === '/ready' && req.method === 'GET') {
        const ready = this.getReadinessStatus();
        res.writeHead(ready.status === 'ready' ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ready));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: this.config.GATEWAY_MAX_MESSAGE_SIZE_BYTES
    });

    this.wss.on('connection', (socket: WebSocket) => {
      this.handleSocketConnection(socket);
    });

    return new Promise((resolve) => {
      this.httpServer?.listen(this.config.GATEWAY_PORT, this.config.GATEWAY_HOST, () => {
        this.isListening = true;
        this.startTime = Date.now();
        this.log('info', `Production Gateway listening on ${this.config.GATEWAY_HOST}:${this.config.GATEWAY_PORT}`, {
          wsUrl: this.config.GATEWAY_WS_URL,
          maxConnections: this.config.GATEWAY_MAX_CONNECTIONS
        });
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isListening) return;

    this.log('info', 'Initiating graceful Gateway shutdown');

    for (const [connectionId, conn] of this.activeConnections.entries()) {
      try {
        conn.socket.send(JSON.stringify({ type: 'DISCONNECT', reason: 'Gateway shutting down' }));
        conn.socket.close();
      } catch (e) {
        // Ignore socket close errors during shutdown
      }
    }
    this.activeConnections.clear();
    this.pendingRequests.clear();

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

  private handleSocketConnection(socket: WebSocket): void {
    // Capacity Limit Guard
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

    // Authentication Timeout Guard
    const authTimeoutTimer = setTimeout(() => {
      if (!authenticatedConnectionId && socket.readyState === WebSocket.OPEN) {
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

    // Send HELLO handshake greeting
    socket.send(JSON.stringify({ type: 'HELLO', version: '2.0' }));

    socket.on('message', async (data: Buffer | string) => {
      // Message Size Guard
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

        if (msg.type === 'AUTH') {
          const { connectionToken, deviceId } = msg;
          if (!connectionToken || !deviceId) {
            authFailureCount++;
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

          // Validate token via injected TokenValidator (production: Prisma; tests: mock)
          const connRecord = await this.tokenValidator.findConnection(deviceId, connectionToken);

          if (!connRecord) {
            authFailureCount++;
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
          authenticatedConnectionId = connRecord.id;

          const now = new Date();
          await this.tokenValidator.markConnected(connRecord.id, now);

          this.activeConnections.set(connRecord.id, {
            connectionId: connRecord.id,
            deviceId,
            socket,
            connectedAt: now,
            lastHeartbeatAt: now
          });

          this.log('info', 'Android storage node authenticated successfully', {
            connectionId: connRecord.id,
            deviceId
          });

          socket.send(
            JSON.stringify({
              type: 'AUTH_SUCCESS',
              connectionId: connRecord.id,
              remoteEndpoint:
                connRecord.remoteEndpoint ||
                `https://node-${deviceId.substring(0, 8)}.remotenode.net`
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
        // REMOTE FILE DATA PLANE ROUTING ENGINE
        // =====================================================================
        if (msg.type === 'FILE_REQUEST') {
          const { requestId, connectionId } = msg;
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

          // Register client socket waiting for response with request timeout cleanup
          this.pendingRequests.set(requestId, socket);
          setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
              this.pendingRequests.delete(requestId);
            }
          }, this.config.GATEWAY_REQUEST_TIMEOUT_MS);

          // Forward request to target Android host socket
          targetConn.socket.send(JSON.stringify(msg));
          return;
        }

        if (
          msg.type === 'FILE_RESPONSE' ||
          msg.type === 'FILE_STREAM_START' ||
          msg.type === 'FILE_STREAM_CHUNK' ||
          msg.type === 'FILE_STREAM_END' ||
          msg.type === 'FILE_ERROR'
        ) {
          const { requestId } = msg;
          if (requestId && this.pendingRequests.has(requestId)) {
            const clientSocket = this.pendingRequests.get(requestId)!;
            if (clientSocket.readyState === WebSocket.OPEN) {
              clientSocket.send(JSON.stringify(msg));
            }
            if (
              msg.type === 'FILE_RESPONSE' ||
              msg.type === 'FILE_STREAM_END' ||
              msg.type === 'FILE_ERROR'
            ) {
              this.pendingRequests.delete(requestId);
            }
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
    this.activeConnections.delete(connectionId);
    await this.tokenValidator.markDisconnected(connectionId, new Date());
  }

  public getHealthStatus(): {
    status: string;
    gateway: string;
    activeConnections: number;
    port: number;
    uptimeSeconds: number;
  } {
    return {
      status: this.isListening ? 'ok' : 'stopped',
      gateway: this.isListening ? 'ACTIVE' : 'INACTIVE',
      activeConnections: this.activeConnections.size,
      port: this.config.GATEWAY_PORT,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }

  public getReadinessStatus(): {
    status: string;
    controlPlaneConnected: boolean;
    activeConnections: number;
  } {
    return {
      status: this.isListening ? 'ready' : 'not_ready',
      controlPlaneConnected: true,
      activeConnections: this.activeConnections.size
    };
  }

  public getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }
}
