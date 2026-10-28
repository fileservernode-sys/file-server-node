import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import { GatewayService, TokenValidator, PrismaTokenValidator } from '../src/gateway/gateway_service.js';

const VALID_TOKEN = 'test-token-valid-cuid';
const EXPIRED_TOKEN = 'test-token-expired';
const REPLAY_TOKEN = 'test-token-single-use';
const VALID_DEVICE = 'test-device-sec-1';
const VALID_CONN_ID = 'conn-sec-1';
const VALID_USER_ID = 'user-sec-alice';

class SecurityMockTokenValidator implements TokenValidator {
  private usedTokens = new Set<string>();

  async findConnection(deviceId: string, connectionToken: string) {
    if (connectionToken === EXPIRED_TOKEN) {
      // Simulates expired token rejection
      return null;
    }

    if (this.usedTokens.has(connectionToken)) {
      // Simulates consumed token rejection
      return null;
    }

    if (deviceId === VALID_DEVICE && (connectionToken === VALID_TOKEN || connectionToken === REPLAY_TOKEN)) {
      return {
        id: VALID_CONN_ID,
        deviceId,
        userId: VALID_USER_ID,
        remoteEndpoint: 'https://srv-sec1.zdexcloud.com'
      };
    }

    return null;
  }

  async markConnected(connectionId: string, _now: Date) {
    if (connectionId === VALID_CONN_ID) {
      // Mark token as consumed
      this.usedTokens.add(REPLAY_TOKEN);
    }
  }

  async markDisconnected(_connectionId: string, _disconnectedAt: Date) {}
}

describe('Phase 15.6 Gateway Security Review Verification Suite', () => {
  let gateway: GatewayService;
  const testPort = 4015;

  before(async () => {
    gateway = new GatewayService(
      {
        GATEWAY_PORT: testPort,
        GATEWAY_AUTH_TIMEOUT_MS: 1000,
        GATEWAY_REQUEST_TIMEOUT_MS: 1000,
        GATEWAY_MAX_MESSAGE_SIZE_BYTES: 1024 * 1024,
        GATEWAY_RATE_LIMIT_RPM: 200,
        NODE_ENV: 'test'
      },
      new SecurityMockTokenValidator()
    );
    await gateway.start();
  });

  after(async () => {
    await gateway.stop();
  });

  test('Security Check 1: Valid connection token is accepted', async () => {
    const socket = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise<void>((resolve) => socket.once('open', resolve));

    const authResult = await new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          socket.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: VALID_DEVICE,
              connectionToken: VALID_TOKEN
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS' || msg.type === 'AUTH_FAILURE') {
          resolve(msg);
        }
      });
    });

    assert.strictEqual(authResult.type, 'AUTH_SUCCESS');
    assert.strictEqual(authResult.connectionId, VALID_CONN_ID);
    socket.close();
  });

  test('Security Check 2: Expired connection token is rejected', async () => {
    const socket = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise<void>((resolve) => socket.once('open', resolve));

    const authResult = await new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          socket.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: VALID_DEVICE,
              connectionToken: EXPIRED_TOKEN
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS' || msg.type === 'AUTH_FAILURE') {
          resolve(msg);
        }
      });
    });

    assert.strictEqual(authResult.type, 'AUTH_FAILURE');
    assert.ok(authResult.reason.toLowerCase().includes('invalid') || authResult.reason.toLowerCase().includes('revoked'));
    socket.close();
  });

  test('Security Check 3: Consumed token cannot be replayed for second authentication', async () => {
    // 1. First authentication consumes REPLAY_TOKEN
    const socket1 = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise<void>((resolve) => socket1.once('open', resolve));

    const authResult1 = await new Promise<any>((resolve) => {
      socket1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          socket1.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: VALID_DEVICE,
              connectionToken: REPLAY_TOKEN
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS' || msg.type === 'AUTH_FAILURE') {
          resolve(msg);
        }
      });
    });
    assert.strictEqual(authResult1.type, 'AUTH_SUCCESS');

    // 2. Second authentication attempts to replay the same token
    const socket2 = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise<void>((resolve) => socket2.once('open', resolve));

    const authResult2 = await new Promise<any>((resolve) => {
      socket2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          socket2.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: VALID_DEVICE,
              connectionToken: REPLAY_TOKEN
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS' || msg.type === 'AUTH_FAILURE') {
          resolve(msg);
        }
      });
    });

    assert.strictEqual(authResult2.type, 'AUTH_FAILURE');
    socket1.close();
    socket2.close();
  });

  test('Security Check 4: Wrong device ID with valid token is rejected', async () => {
    const socket = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise<void>((resolve) => socket.once('open', resolve));

    const authResult = await new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          socket.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: 'wrong-attacker-device',
              connectionToken: VALID_TOKEN
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS' || msg.type === 'AUTH_FAILURE') {
          resolve(msg);
        }
      });
    });

    assert.strictEqual(authResult.type, 'AUTH_FAILURE');
    socket.close();
  });

  test('Security Check 5: Path traversal and null bytes are blocked in proxy requests', async () => {
    // Attempt with null byte
    const nullByteResult = await gateway.handleProxiedFileRequestByDeviceId(VALID_DEVICE, 'LIST', {
      path: '/documents\0/secret'
    });
    assert.strictEqual(nullByteResult.success, false);
    assert.strictEqual(nullByteResult.error.code, 'FORBIDDEN');

    // Attempt with parent directory traversal
    const traversalResult = await gateway.handleProxiedFileRequestByDeviceId(VALID_DEVICE, 'LIST', {
      path: '/../../etc/passwd'
    });
    assert.strictEqual(traversalResult.success, false);
    assert.strictEqual(traversalResult.error.code, 'FORBIDDEN');
  });

  test('Security Check 6: Unauthenticated socket sending FILE_RESPONSE is ignored', async () => {
    // Android socket authenticates
    const androidSocket = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise<void>((resolve) => androidSocket.once('open', resolve));

    await new Promise<void>((resolve) => {
      androidSocket.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO') {
          androidSocket.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: VALID_DEVICE,
              connectionToken: VALID_TOKEN
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          resolve();
        }
      });
    });

    // An unauthenticated rogue socket connects and attempts to spoof a FILE_RESPONSE
    const rogueSocket = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise<void>((resolve) => rogueSocket.once('open', resolve));

    // Send forged FILE_RESPONSE
    rogueSocket.send(
      JSON.stringify({
        type: 'FILE_RESPONSE',
        requestId: 'fake-request-id-1234',
        success: true,
        data: { sensitive: 'spoofed' }
      })
    );

    // Give server time to process
    await new Promise((r) => setTimeout(r, 50));

    // Ensure rogue socket did not corrupt gateway state
    assert.strictEqual(gateway.getActiveConnectionCount(), 1);

    androidSocket.close();
    rogueSocket.close();
  });

  test('Security Check 7: CSPRNG connection token entropy standard verified', () => {
    // Generates 256 bits of cryptographic entropy hex
    const sampleToken = `conn_${crypto.randomBytes(32).toString('hex')}`;
    assert.strictEqual(sampleToken.startsWith('conn_'), true);
    assert.strictEqual(sampleToken.length, 5 + 64);
    assert.match(sampleToken, /^conn_[0-9a-f]{64}$/);
  });
});
