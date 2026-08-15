import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { WebSocket } from 'ws';
import { GatewayService } from '../src/gateway/gateway_service.js';

describe('Development Gateway Transport Service (ws://localhost:4001)', () => {
  let gateway: GatewayService;
  const testPort = 4001;

  before(async () => {
    gateway = new GatewayService(testPort);
    await gateway.start();
  });

  after(async () => {
    await gateway.stop();
  });

  test('Gateway reports active health status', () => {
    const health = gateway.getHealthStatus();
    assert.strictEqual(health.status, 'ACTIVE');
    assert.strictEqual(health.port, testPort);
    assert.strictEqual(health.activeConnections, 0);
  });

  test('Gateway sends HELLO handshake on client connection', async () => {
    const socket = new WebSocket(`ws://localhost:${testPort}`);

    const received: string[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        received.push(msg.type);
        if (msg.type === 'HELLO') {
          socket.close();
          resolve();
        }
      });
      socket.on('error', reject);
    });

    assert.ok(received.includes('HELLO'));
  });

  test('Gateway handles AUTH handshake and ping/pong transport heartbeat', async () => {
    const socket = new WebSocket(`ws://localhost:${testPort}`);
    let connectionId = '';

    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'HELLO') {
          // Send AUTH message
          socket.send(JSON.stringify({
            type: 'AUTH',
            connectionToken: 'mock-token-123',
            deviceId: 'mock-device-456'
          }));
        } else if (msg.type === 'AUTH_SUCCESS') {
          connectionId = msg.connectionId;
          assert.ok(msg.remoteEndpoint);
          // Send PING message
          socket.send(JSON.stringify({ type: 'PING' }));
        } else if (msg.type === 'PONG') {
          socket.send(JSON.stringify({ type: 'DISCONNECT' }));
          socket.close();
          resolve();
        }
      });

      socket.on('error', reject);
    });

    assert.ok(connectionId);
  });

  test('Gateway rejects invalid AUTH payload gracefully', async () => {
    const socket = new WebSocket(`ws://localhost:${testPort}`);

    const received: string[] = [];
    await new Promise<void>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        received.push(msg.type);
        if (msg.type === 'HELLO') {
          socket.send(JSON.stringify({ type: 'AUTH', connectionToken: '' }));
        } else if (msg.type === 'AUTH_FAILURE') {
          socket.close();
          resolve();
        }
      });
    });

    assert.ok(received.includes('AUTH_FAILURE'));
  });
});
