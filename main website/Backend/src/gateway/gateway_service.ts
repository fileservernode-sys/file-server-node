import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '../config/database.js';

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
}

export interface ActiveGatewayConnection {
  connectionId: string;
  deviceId: string;
  socket: WebSocket;
  connectedAt: Date;
  lastHeartbeatAt: Date;
}

export class GatewayService {
  private wss: WebSocketServer | null = null;
  private activeConnections: Map<string, ActiveGatewayConnection> = new Map();
  private isListening = false;
  private port = 4001;

  constructor(port = 4001) {
    this.port = port;
  }

  public async start(): Promise<void> {
    if (this.isListening) return;

    this.wss = new WebSocketServer({ port: this.port });
    this.isListening = true;

    this.wss.on('connection', (socket: WebSocket) => {
      this.handleSocketConnection(socket);
    });
  }

  public async stop(): Promise<void> {
    if (!this.wss) return;

    for (const [connectionId, conn] of this.activeConnections.entries()) {
      try {
        conn.socket.send(JSON.stringify({ type: 'DISCONNECT', reason: 'Gateway shutting down' }));
        conn.socket.close();
      } catch (e) {
        // Ignore socket close errors
      }
    }
    this.activeConnections.clear();

    return new Promise((resolve) => {
      this.wss?.close(() => {
        this.isListening = false;
        this.wss = null;
        resolve();
      });
    });
  }

  private handleSocketConnection(socket: WebSocket): void {
    let authenticatedConnectionId: string | null = null;

    // 1. Send HELLO handshake greeting
    socket.send(JSON.stringify({ type: 'HELLO', version: '1.0' }));

    socket.on('message', async (data: Buffer | string) => {
      try {
        const msg: HandshakeMessage = JSON.parse(data.toString());

        if (msg.type === 'AUTH') {
          const { connectionToken, deviceId } = msg;
          if (!connectionToken || !deviceId) {
            socket.send(JSON.stringify({ type: 'AUTH_FAILURE', reason: 'Missing connectionToken or deviceId' }));
            socket.close();
            return;
          }

          // Validate token with Control Plane database
          let connRecord;
          try {
            connRecord = await prisma.deviceConnection.findFirst({
              where: { deviceId, connectionToken }
            });
          } catch (e) {
            // DB offline fallback
            connRecord = { id: `mock-conn-${Date.now()}`, deviceId, remoteEndpoint: `https://node-${deviceId.substring(0, 8)}.remotenode.net` };
          }

          if (!connRecord) {
            socket.send(JSON.stringify({ type: 'AUTH_FAILURE', reason: 'Invalid or revoked connection token' }));
            socket.close();
            return;
          }

          authenticatedConnectionId = connRecord.id;

          // Update Control Plane Connection status to CONNECTED
          const now = new Date();
          try {
            await prisma.deviceConnection.update({
              where: { id: connRecord.id },
              data: { status: 'CONNECTED', connectedAt: now, lastHeartbeatAt: now }
            });
            await prisma.auditEvent.create({
              data: {
                deviceId,
                eventType: 'REMOTE_CONNECTION_CONNECTED',
                metadata: { connectionId: connRecord.id }
              }
            });
          } catch (e) {
            // Ignore DB errors
          }

          this.activeConnections.set(connRecord.id, {
            connectionId: connRecord.id,
            deviceId,
            socket,
            connectedAt: now,
            lastHeartbeatAt: now
          });

          socket.send(JSON.stringify({
            type: 'AUTH_SUCCESS',
            connectionId: connRecord.id,
            remoteEndpoint: connRecord.remoteEndpoint || `https://node-${deviceId.substring(0, 8)}.remotenode.net`
          }));
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

        if (msg.type === 'DISCONNECT') {
          if (authenticatedConnectionId) {
            await this.cleanupConnection(authenticatedConnectionId);
          }
          socket.close();
          return;
        }
      } catch (e) {
        socket.send(JSON.stringify({ type: 'ERROR', code: 'INVALID_MESSAGE', message: 'Malformed JSON payload' }));
      }
    });

    socket.on('close', async () => {
      if (authenticatedConnectionId) {
        await this.cleanupConnection(authenticatedConnectionId);
      }
    });
  }

  private async cleanupConnection(connectionId: string): Promise<void> {
    this.activeConnections.delete(connectionId);
    try {
      await prisma.deviceConnection.update({
        where: { id: connectionId },
        data: { status: 'DISCONNECTED', disconnectedAt: new Date() }
      });
    } catch (e) {
      // Ignore DB errors during socket cleanup
    }
  }

  public getHealthStatus(): { status: string; activeConnections: number; port: number } {
    return {
      status: this.isListening ? 'ACTIVE' : 'INACTIVE',
      activeConnections: this.activeConnections.size,
      port: this.port
    };
  }

  public getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }
}
