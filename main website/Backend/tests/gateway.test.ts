import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { WebSocket } from 'ws';
import { GatewayService } from '../src/gateway/gateway_service.js';

describe('Development Gateway Transport & Data Plane Routing (ws://localhost:4001)', () => {
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

  test('Gateway routes FILE_REQUEST from client socket to target Android host socket', async () => {
    // 1. Android Host Socket connects and authenticates
    const androidSocket = new WebSocket(`ws://localhost:${testPort}`);
    let connectionId = '';

    await new Promise<void>((resolve) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          androidSocket.send(JSON.stringify({
            type: 'AUTH',
            connectionToken: 'mock-token-123',
            deviceId: 'mock-device-456'
          }));
        } else if (msg.type === 'AUTH_SUCCESS') {
          connectionId = msg.connectionId;
          resolve();
        }
      });
    });

    assert.ok(connectionId);

    // Setup listener on Android socket to respond to FILE_REQUEST
    androidSocket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'FILE_REQUEST') {
        androidSocket.send(JSON.stringify({
          type: 'FILE_RESPONSE',
          requestId: msg.requestId,
          success: true,
          data: { items: [{ name: 'Documents', isDir: true }] }
        }));
      }
    });

    // 2. Client socket sends FILE_REQUEST targetting connectionId
    const clientSocket = new WebSocket(`ws://localhost:${testPort}`);

    const response = await new Promise<any>((resolve) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_RESPONSE') {
          resolve(msg);
        }
      });

      // Wait for HELLO before sending request
      setTimeout(() => {
        clientSocket.send(JSON.stringify({
          type: 'FILE_REQUEST',
          requestId: 'req-test-777',
          connectionId,
          operation: 'LIST',
          path: '/'
        }));
      }, 50);
    });

    assert.strictEqual(response.type, 'FILE_RESPONSE');
    assert.strictEqual(response.requestId, 'req-test-777');
    assert.strictEqual(response.success, true);
    assert.ok(response.data.items);

    androidSocket.close();
    clientSocket.close();
  });

  test('Gateway rejects FILE_REQUEST targetting offline or nonexistent connection ID', async () => {
    const clientSocket = new WebSocket(`ws://localhost:${testPort}`);

    const response = await new Promise<any>((resolve) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_RESPONSE') {
          resolve(msg);
        }
      });

      setTimeout(() => {
        clientSocket.send(JSON.stringify({
          type: 'FILE_REQUEST',
          requestId: 'req-test-offline',
          connectionId: 'nonexistent-conn-id',
          operation: 'LIST',
          path: '/'
        }));
      }, 50);
    });

    assert.strictEqual(response.type, 'FILE_RESPONSE');
    assert.strictEqual(response.requestId, 'req-test-offline');
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.error.code, 'DEVICE_OFFLINE');

    clientSocket.close();
  });
});
