import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Admin UI & Static Shell Foundation (Phase 7.4)', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('1. GET /admin resolves and serves Admin SPA Shell (index.html)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/html/);
    assert.match(response.body, /ZdexCloud — Admin Operations Control Plane/);
    assert.match(response.body, /adminSidebarNav/);
    assert.match(response.body, /admin-shell\.js/);
  });

  test('2. GET /admin/ resolves and serves Admin SPA Shell', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/html/);
    assert.match(response.body, /ZdexControl/);
  });

  test('3. GET /admin/index.html serves Admin SPA Shell directly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/index.html'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/html/);
    assert.match(response.body, /adminViewContainer/);
  });

  test('4. GET /admin/login resolves and serves Admin Login portal', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/login'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/html/);
    assert.match(response.body, /Admin Control Plane Sign In/);
    assert.match(response.body, /loginForm/);
    assert.match(response.body, /otpForm/);
  });

  test('5. GET /admin/login.html serves Admin Login portal directly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/login.html'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/html/);
    assert.match(response.body, /Admin Email Address/);
    assert.match(response.body, /otp-box/);
  });

  test('6. GET /admin/css/admin.css serves Admin stylesheet', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/css/admin.css'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /text\/css/);
    assert.match(response.body, /--admin-bg-base/);
    assert.match(response.body, /admin-sidebar/);
  });

  test('7. GET /admin/js/admin-api.js serves Admin API client', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/js/admin-api.js'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /application\/javascript/);
    assert.match(response.body, /AdminApiClient/);
    assert.match(response.body, /x-admin-session-token/);
  });

  test('8. GET /admin/js/admin-auth.js serves Admin Auth & Permission service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/js/admin-auth.js'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /application\/javascript/);
    assert.match(response.body, /AdminAuthService/);
    assert.match(response.body, /hasPermission/);
  });

  test('9. GET /admin/js/admin-shell.js serves Admin SPA Shell manager', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/js/admin-shell.js'
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type'] || ''), /application\/javascript/);
    assert.match(response.body, /AdminShellManager/);
    assert.match(response.body, /NAV_SCHEMA/);
  });

  test('10. Customer routes regression check (marketing landing, pricing, customer dashboard)', async () => {
    const landingRes = await app.inject({
      method: 'GET',
      url: '/'
    });
    assert.equal(landingRes.statusCode, 200);

    const pricingRes = await app.inject({
      method: 'GET',
      url: '/pricing'
    });
    assert.equal(pricingRes.statusCode, 200);

    const dashboardRes = await app.inject({
      method: 'GET',
      url: '/dashboard'
    });
    assert.equal(dashboardRes.statusCode, 200);
  });
});
