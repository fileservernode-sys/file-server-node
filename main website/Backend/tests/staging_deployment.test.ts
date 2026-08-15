import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import http from 'node:http';
import { WebSocket } from 'ws';
import { GatewayService, TokenValidator } from '../src/gateway/gateway_service.js';
import { EndpointService } from '../src/services/endpoint.js';
import { MockDnsProvider } from '../src/services/dns_provider.js';

// ---------------------------------------------------------------------------
// Mock Token Validator for Live Staging End-to-End Test Suite
// ---------------------------------------------------------------------------
const STAGING_DEVICE_ID = 'dev_staging_phone_001';
const STAGING_TOKEN = 'staging_conn_token_xyz987';
const STAGING_CONN_ID = 'conn_staging_active_001';
const STAGING_USER_ID = 'user_staging_alice';
const STAGING_ENDPOINT = 'https://srv_alpha123.viewduration.com';

class StagingMockTokenValidator implements TokenValidator {
  async findConnection(deviceId: string, connectionToken: string) {
    if (deviceId === STAGING_DEVICE_ID && connectionToken === STAGING_TOKEN) {
      return {
        id: STAGING_CONN_ID,
        deviceId,
        userId: STAGING_USER_ID,
        remoteEndpoint: STAGING_ENDPOINT
      };
    }
    return null;
  }
  async markConnected(_connectionId: string, _now: Date) {}
  async markDisconnected(_connectionId: string, _disconnectedAt: Date) {}
}

// ---------------------------------------------------------------------------

describe('Phase 2 — Batch 6: Staging Deployment & viewduration.com End-to-End Integration', () => {
  let gateway: GatewayService;
  const gatewayPort = 4002;

  before(async () => {
    EndpointService.setBaseDomain('viewduration.com');
    EndpointService.setDnsProvider(new MockDnsProvider());

    gateway = new GatewayService(
      {
        GATEWAY_PORT: gatewayPort,
        REMOTENODE_BASE_DOMAIN: 'viewduration.com',
        GATEWAY_PUBLIC_BASE_URL: 'https://viewduration.com',
        GATEWAY_PUBLIC_WS_URL: 'wss://viewduration.com',
        GATEWAY_AUTH_TIMEOUT_MS: 800,
        GATEWAY_REQUEST_TIMEOUT_MS: 800,
        NODE_ENV: 'test'
      },
      new StagingMockTokenValidator()
    );

    await gateway.start();
  });

  after(async () => {
    await gateway.stop();
  });

  test('1. EndpointService allocates staging endpoint with viewduration.com domain', () => {
    const hostname = EndpointService.generateHostname('srv_alpha123');
    assert.strictEqual(hostname, 'srv_alpha123.viewduration.com');
    assert.strictEqual(EndpointService.validateHostname(hostname), true);
  });

  test('2. Android connects outbound to Gateway and authenticates with staging endpoint', async () => {
    const androidSocket = new WebSocket(`ws://localhost:${gatewayPort}`);

    let helloReceived = false;
    let authSuccessResponse: any = null;

    await new Promise<void>((resolve, reject) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          helloReceived = true;
          androidSocket.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: STAGING_TOKEN,
              deviceId: STAGING_DEVICE_ID
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          authSuccessResponse = msg;
          resolve();
        } else if (msg.type === 'AUTH_FAILURE') {
          reject(new Error(`Unexpected auth failure: ${msg.reason}`));
        }
      });
      androidSocket.on('error', reject);
    });

    assert.strictEqual(helloReceived, true);
    assert.strictEqual(authSuccessResponse.type, 'AUTH_SUCCESS');
    assert.strictEqual(authSuccessResponse.connectionId, STAGING_CONN_ID);
    assert.strictEqual(authSuccessResponse.remoteEndpoint, STAGING_ENDPOINT);

    androidSocket.close();
  });

  test('3. HTTP reverse proxy routes GET /api/storage for srv_alpha123.viewduration.com', async () => {
    const androidSocket = new WebSocket(`ws://localhost:${gatewayPort}`);

    await new Promise<void>((resolve) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          androidSocket.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: STAGING_TOKEN,
              deviceId: STAGING_DEVICE_ID
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          resolve();
        }
      });
    });

    // Mock Android LocalServerEngine response for STORAGE request
    androidSocket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'FILE_REQUEST' && msg.operation === 'STORAGE') {
        androidSocket.send(
          JSON.stringify({
            type: 'FILE_RESPONSE',
            requestId: msg.requestId,
            success: true,
            data: {
              totalBytes: 128000000000,
              usedBytes: 32000000000,
              freeBytes: 96000000000,
              categories: { photos: 12000000000, videos: 18000000000, documents: 2000000000 }
            }
          })
        );
      }
    });

    // HTTP Client sends request targeting srv_alpha123.viewduration.com
    const res = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
      http.get(`http://localhost:${gatewayPort}/api/storage?endpoint=srv_alpha123.viewduration.com`, (resp) => {
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
    assert.strictEqual(res.data.totalBytes, 128000000000);
    assert.strictEqual(res.data.freeBytes, 96000000000);

    androidSocket.close();
  });

  test('4. HTTP reverse proxy routes GET /api/files/recent for srv_alpha123.viewduration.com', async () => {
    const androidSocket = new WebSocket(`ws://localhost:${gatewayPort}`);

    await new Promise<void>((resolve) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          androidSocket.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: STAGING_TOKEN,
              deviceId: STAGING_DEVICE_ID
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          resolve();
        }
      });
    });

    androidSocket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'FILE_REQUEST' && msg.operation === 'RECENT') {
        androidSocket.send(
          JSON.stringify({
            type: 'FILE_RESPONSE',
            requestId: msg.requestId,
            success: true,
            data: {
              items: [
                { name: 'TripPhoto.jpg', category: 'photos', sizeBytes: 3500000, lastModified: Date.now() },
                { name: 'Notes.pdf', category: 'documents', sizeBytes: 150000, lastModified: Date.now() - 1000 }
              ]
            }
          })
        );
      }
    });

    const res = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
      http.get(`http://localhost:${gatewayPort}/api/files/recent?endpoint=srv_alpha123.viewduration.com`, (resp) => {
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
    assert.strictEqual(res.data.items.length, 2);
    assert.strictEqual(res.data.items[0].name, 'TripPhoto.jpg');

    androidSocket.close();
  });

  test('5. Rejects HTTP requests for unrecognized subdomain with 404 SERVER_NOT_FOUND', async () => {
    const res = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
      http.get(`http://localhost:${gatewayPort}/api/files?endpoint=srv_nonexistent.viewduration.com`, (resp) => {
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

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.data.error.code, 'SERVER_NOT_FOUND');
  });

  test('6. Rejects cross-user routing violations over WebSocket with UNAUTHORIZED_CROSS_USER_ACCESS', async () => {
    const androidSocket = new WebSocket(`ws://localhost:${gatewayPort}`);

    await new Promise<void>((resolve) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          androidSocket.send(
            JSON.stringify({
              type: 'AUTH',
              connectionToken: STAGING_TOKEN,
              deviceId: STAGING_DEVICE_ID
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          resolve();
        }
      });
    });

    const clientSocket = new WebSocket(`ws://localhost:${gatewayPort}`);

    const crossUserResponse = await new Promise<any>((resolve, reject) => {
      clientSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'FILE_RESPONSE' && msg.requestId === 'req_cross_user_staging') {
          resolve(msg);
        }
      });
      clientSocket.on('error', reject);

      setTimeout(() => {
        clientSocket.send(
          JSON.stringify({
            type: 'FILE_REQUEST',
            requestId: 'req_cross_user_staging',
            connectionId: STAGING_CONN_ID,
            authorizedUserId: 'user_different_eve', // Mismatched user
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
});
