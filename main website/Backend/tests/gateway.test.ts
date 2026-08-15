import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import http from 'node:http';
import { WebSocket } from 'ws';
import { GatewayService, TokenValidator } from '../src/gateway/gateway_service.js';
import { loadGatewayConfig } from '../src/gateway/gateway_config.js';

// ---------------------------------------------------------------------------
// In-memory mock: no DB, no TCP — resolves instantly so tests don't stall
// ---------------------------------------------------------------------------
const VALID_TOKEN = 'mock-token-123';
const VALID_DEVICE = 'mock-device-456';
const VALID_CONN_ID = 'mock-conn-id-789';
const VALID_USER_ID = 'user-alice-111';

class MockTokenValidator implements TokenValidator {
  async findConnection(deviceId: string, connectionToken: string) {
    if (deviceId === VALID_DEVICE && connectionToken === VALID_TOKEN) {
      return {
        id: VALID_CONN_ID,
        deviceId,
        userId: VALID_USER_ID,
        remoteEndpoint: 'https://node-mockdevi.remotenode.net'
      };
    }
    return null;
  }
  async markConnected(_connectionId: string, _now: Date) { /* no-op */ }
  async markDisconnected(_connectionId: string, _disconnectedAt: Date) { /* no-op */ }
}

// ---------------------------------------------------------------------------

describe('Production Gateway Infrastructure & Transport Service', () => {
  let gateway: GatewayService;
  const testPort = 4001;

  before(async () => {
    gateway = new GatewayService(
      {
        GATEWAY_PORT: testPort,
        GATEWAY_AUTH_TIMEOUT_MS: 500,
        GATEWAY_REQUEST_TIMEOUT_MS: 500,
        GATEWAY_MAX_MESSAGE_SIZE_BYTES: 1024 * 1024,
        GATEWAY_RATE_LIMIT_RPM: 100,
        NODE_ENV: 'test'
      },
      new MockTokenValidator()
    );
    await gateway.start();
  });

  after(async () => {
    await gateway.stop();
  });

  test('Gateway configuration loads with valid defaults and overrides', () => {
    const customConfig = loadGatewayConfig({
      GATEWAY_PORT: 5000,
      GATEWAY_MAX_CONNECTIONS: 200,
      GATEWAY_WS_URL: 'wss://gateway.remotenode.net',
      NODE_ENV: 'production'
    });
    assert.strictEqual(customConfig.GATEWAY_PORT, 5000);
    assert.strictEqual(customConfig.GATEWAY_MAX_CONNECTIONS, 200);
    assert.strictEqual(customConfig.NODE_ENV, 'production');
  });

  test('Gateway configuration rejects insecure ws:// protocol in production mode', () => {
    assert.throws(
      () => {
        loadGatewayConfig({
          GATEWAY_WS_URL: 'ws://insecure-gateway.remotenode.net',
          NODE_ENV: 'production'
        });
      },
      (err: Error) => err.message.includes('Insecure ws:// protocol is strictly forbidden in production mode')
    );
  });

  test('GET /health returns 200 OK and enhanced metrics', async () => {
    const res = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
      http.get(`http://localhost:${testPort}/health`, (resp) => {
        let raw = '';
        resp.on('data', (c) => (raw += c));
        resp.on('end', () => {
          resolve({
            statusCode: resp.statusCode || 0,
            data: JSON.parse(raw)
          });
        });
      }).on('error', reject);
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.status, 'ok');
    assert.strictEqual(res.data.gateway, 'ACTIVE');
    assert.strictEqual(typeof res.data.activeConnections, 'number');
    assert.strictEqual(typeof res.data.connectedDevices, 'number');
    assert.strictEqual(typeof res.data.failedAuthCount, 'number');
    assert.strictEqual(typeof res.data.activeTransfersCount, 'number');
  });

  test('GET /ready returns 200 OK and readiness metrics', async () => {
    const res = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
      http.get(`http://localhost:${testPort}/ready`, (resp) => {
        let raw = '';
        resp.on('data', (c) => (raw += c));
        resp.on('end', () => {
          resolve({
            statusCode: resp.statusCode || 0,
            data: JSON.parse(raw)
          });
        });
      }).on('error', reject);
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.status, 'ready');
    assert.strictEqual(res.data.controlPlaneConnected, true);
  });

  test('Gateway sends HELLO handshake greeting on client connection', async () => {
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

  test('Gateway terminates unauthenticated socket after auth timeout', async () => {
    const socket = new WebSocket(`ws://localhost:${testPort}`);

    const failure = await new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AUTH_FAILURE') {
          resolve(msg);
        }
      });
    });

    assert.strictEqual(failure.type, 'AUTH_FAILURE');
    assert.strictEqual(failure.reason, 'Authentication timeout');
  });

  test('Gateway evicts duplicate connection sessions gracefully', async () => {
    const socket1 = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise<void>((resolve) => {
      socket1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          socket1.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: VALID_TOKEN,
              deviceId: VALID_DEVICE
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          resolve();
        }
      });
    });

    const socket2 = new WebSocket(`ws://localhost:${testPort}`);
    const socket1DisconnectPromise = new Promise<any>((resolve) => {
      socket1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'DISCONNECT') {
          resolve(msg);
        }
      });
    });

    await new Promise<void>((resolve) => {
      socket2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          socket2.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: VALID_TOKEN,
              deviceId: VALID_DEVICE
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          resolve();
        }
      });
    });

    const disconnectMsg = await socket1DisconnectPromise;
    assert.strictEqual(disconnectMsg.type, 'DISCONNECT');

    socket2.close();
  });

  test('Gateway routes FILE_REQUEST and prevents cross-user routing violations', async () => {
    const androidSocket = new WebSocket(`ws://localhost:${testPort}`);
    let connectionId = '';

    await new Promise<void>((resolve, reject) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          androidSocket.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: VALID_TOKEN,
              deviceId: VALID_DEVICE
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          connectionId = msg.connectionId;
          resolve();
        } else if (msg.type === 'AUTH_FAILURE') {
          reject(new Error(`Unexpected AUTH_FAILURE: ${msg.reason}`));
        }
      });
      androidSocket.on('error', reject);
    });

    assert.strictEqual(connectionId, VALID_CONN_ID);

    androidSocket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'FILE_REQUEST') {
        androidSocket.send(
          JSON.stringify({
            type: 'FILE_RESPONSE',
            requestId: msg.requestId,
            success: true,
            data: { items: [{ name: 'Documents', isDir: true }] }
          })
        );
      }
    });

    const clientSocket = new WebSocket(`ws://localhost:${testPort}`);

    // 1. Legitimate request with matching authorized user
    const response = await new Promise<any>((resolve, reject) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_RESPONSE' && msg.requestId === 'req-authorized-user') {
          resolve(msg);
        }
      });
      clientSocket.on('error', reject);

      setTimeout(() => {
        clientSocket.send(
          JSON.stringify({
            type: 'FILE_REQUEST',
            requestId: 'req-authorized-user',
            connectionId,
            authorizedUserId: VALID_USER_ID,
            operation: 'LIST',
            path: '/'
          })
        );
      }, 50);
    });

    assert.strictEqual(response.success, true);
    assert.ok(response.data.items);

    // 2. Cross-user violation attempt with different user ID
    const crossUserResponse = await new Promise<any>((resolve, reject) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_RESPONSE' && msg.requestId === 'req-cross-user') {
          resolve(msg);
        }
      });
      clientSocket.on('error', reject);

      setTimeout(() => {
        clientSocket.send(
          JSON.stringify({
            type: 'FILE_REQUEST',
            requestId: 'req-cross-user',
            connectionId,
            authorizedUserId: 'unauthorized-user-bob-999',
            operation: 'LIST',
            path: '/'
          })
        );
      }, 50);
    });

    assert.strictEqual(crossUserResponse.success, false);
    assert.strictEqual(crossUserResponse.error.code, 'UNAUTHORIZED_CROSS_USER_ACCESS');

    androidSocket.close();
    clientSocket.close();
  });

  test('Gateway caches and returns idempotent responses for duplicate mutating requests', async () => {
    const androidSocket = new WebSocket(`ws://localhost:${testPort}`);
    let connectionId = '';

    await new Promise<void>((resolve) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          androidSocket.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: VALID_TOKEN,
              deviceId: VALID_DEVICE
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          connectionId = msg.connectionId;
          resolve();
        }
      });
    });

    let androidReceivedCount = 0;
    androidSocket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'FILE_REQUEST' && msg.requestId === 'req-idempotent-create') {
        androidReceivedCount++;
        androidSocket.send(
          JSON.stringify({
            type: 'FILE_RESPONSE',
            requestId: msg.requestId,
            success: true,
            data: { created: true }
          })
        );
      }
    });

    const clientSocket = new WebSocket(`ws://localhost:${testPort}`);

    // First request
    await new Promise<void>((resolve) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_RESPONSE' && msg.requestId === 'req-idempotent-create') {
          resolve();
        }
      });
      setTimeout(() => {
        clientSocket.send(
          JSON.stringify({
            type: 'FILE_REQUEST',
            requestId: 'req-idempotent-create',
            connectionId,
            operation: 'CREATE_FOLDER',
            path: '/',
            name: 'NewFolder'
          })
        );
      }, 50);
    });

    assert.strictEqual(androidReceivedCount, 1);

    // Second request with same requestId
    const secondResponse = await new Promise<any>((resolve) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_RESPONSE' && msg.requestId === 'req-idempotent-create') {
          resolve(msg);
        }
      });
      setTimeout(() => {
        clientSocket.send(
          JSON.stringify({
            type: 'FILE_REQUEST',
            requestId: 'req-idempotent-create',
            connectionId,
            operation: 'CREATE_FOLDER',
            path: '/',
            name: 'NewFolder'
          })
        );
      }, 50);
    });

    assert.strictEqual(secondResponse.success, true);
    assert.strictEqual(androidReceivedCount, 1); // Not sent to Android second time

    androidSocket.close();
    clientSocket.close();
  });

  test('Gateway handles streaming transfer lifecycle and cancellation cleanly', async () => {
    const androidSocket = new WebSocket(`ws://localhost:${testPort}`);
    let connectionId = '';

    await new Promise<void>((resolve) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          androidSocket.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: VALID_TOKEN,
              deviceId: VALID_DEVICE
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          connectionId = msg.connectionId;
          resolve();
        }
      });
    });

    const clientSocket = new WebSocket(`ws://localhost:${testPort}`);

    const cancelReceivedPromise = new Promise<any>((resolve) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_STREAM_CANCEL') {
          resolve(msg);
        }
      });
    });

    androidSocket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'FILE_REQUEST' && msg.operation === 'STREAM_TEST') {
        androidSocket.send(
          JSON.stringify({
            type: 'FILE_STREAM_START',
            transferId: 'transfer-999',
            requestId: msg.requestId,
            connectionId,
            totalBytes: 5000000
          })
        );

        setTimeout(() => {
          androidSocket.send(
            JSON.stringify({
              type: 'FILE_STREAM_CHUNK',
              transferId: 'transfer-999',
              chunkIndex: 0,
              dataBase64: 'SGVsbG8gV29ybGQ='
            })
          );

          setTimeout(() => {
            androidSocket.send(
              JSON.stringify({
                type: 'FILE_STREAM_CANCEL',
                transferId: 'transfer-999',
                reason: 'Cancelled by storage host'
              })
            );
          }, 20);
        }, 20);
      }
    });

    setTimeout(() => {
      clientSocket.send(
        JSON.stringify({
          type: 'FILE_REQUEST',
          requestId: 'req-stream-1',
          connectionId,
          operation: 'STREAM_TEST'
        })
      );
    }, 50);

    const cancelMsg = await cancelReceivedPromise;
    assert.strictEqual(cancelMsg.type, 'FILE_STREAM_CANCEL');
    assert.strictEqual(cancelMsg.transferId, 'transfer-999');

    androidSocket.close();
    clientSocket.close();
  });

  test('Gateway rejects FILE_REQUEST targeting offline connection ID', async () => {
    const clientSocket = new WebSocket(`ws://localhost:${testPort}`);

    const response = await new Promise<any>((resolve, reject) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_RESPONSE') {
          resolve(msg);
        }
      });
      clientSocket.on('error', reject);

      setTimeout(() => {
        clientSocket.send(
          JSON.stringify({
            type: 'FILE_REQUEST',
            requestId: 'req-test-offline',
            connectionId: 'nonexistent-conn-id',
            operation: 'LIST',
            path: '/'
          })
        );
      }, 50);
    });

    assert.strictEqual(response.type, 'FILE_RESPONSE');
    assert.strictEqual(response.requestId, 'req-test-offline');
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.error.code, 'DEVICE_OFFLINE');

    clientSocket.close();
  });

  test('Gateway handles unknown message types cleanly with ERROR message', async () => {
    const socket = new WebSocket(`ws://localhost:${testPort}`);

    const errorMsg = await new Promise<any>((resolve, reject) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ERROR') {
          resolve(msg);
        }
      });
      socket.on('error', reject);

      setTimeout(() => {
        socket.send(JSON.stringify({ type: 'UNSUPPORTED_TYPE_XYZ' }));
      }, 50);
    });

    assert.strictEqual(errorMsg.type, 'ERROR');
    assert.strictEqual(errorMsg.code, 'UNKNOWN_MESSAGE_TYPE');
    socket.close();
  });
});
