import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Backend Foundation & Health Probes', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('GET /api/v1/health returns 200 OK and status ok payload', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health'
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'ok');
    assert.ok(typeof body.data.uptime === 'number');
  });

  test('GET /api/v1/health/db returns structured status without leaking credentials', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/db'
    });

    assert.ok([200, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);

    // Verify response does not leak credentials or connection strings
    const rawPayload = response.payload.toLowerCase();
    assert.strictEqual(rawPayload.includes('mysql://'), false);
    assert.strictEqual(rawPayload.includes('password'), false);

    if (response.statusCode === 200) {
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.status, 'ok');
      assert.strictEqual(body.data.database, 'connected');
    } else {
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'DATABASE_UNAVAILABLE');
      assert.strictEqual(body.error.message, 'Database connectivity check failed');
    }
  });

  test('GET /api/v1/ready returns valid response structure', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ready'
    });

    assert.ok([200, 503].includes(response.statusCode));
    const body = JSON.parse(response.payload);
    assert.strictEqual(typeof body.success, 'boolean');
  });

  test('GET /api/v1/nonexistent returns 404 with standardized error JSON', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nonexistent'
    });

    assert.strictEqual(response.statusCode, 404);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'NOT_FOUND');
  });
});
