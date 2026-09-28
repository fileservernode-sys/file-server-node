import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { isValidAdminRedirect, getSafeAdminRedirect, isOriginAllowed } from '../src/utils/security.js';

describe('Admin Transport, CORS, CSP & Redirect Security (Phase 7.5-C)', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. OPEN REDIRECT SECURITY TESTS (SEC-HIGH-01)
  // =========================================================================
  describe('1. Open Redirect Validation & Sanitization', () => {
    test('allows legitimate internal Admin destinations', () => {
      assert.equal(isValidAdminRedirect('/admin'), true);
      assert.equal(isValidAdminRedirect('/admin/'), true);
      assert.equal(isValidAdminRedirect('/admin/index.html'), true);
      assert.equal(isValidAdminRedirect('/admin/login'), true);
      assert.equal(isValidAdminRedirect('/admin/login.html'), true);
      assert.equal(isValidAdminRedirect('/admin/#dashboard'), true);
      assert.equal(isValidAdminRedirect('/admin/index.html#admin-roles'), true);
      assert.equal(isValidAdminRedirect('#dashboard'), true);
      assert.equal(isValidAdminRedirect('index.html#admin-roles'), true);
      assert.equal(isValidAdminRedirect('/admin?tab=overview'), true);

      assert.equal(getSafeAdminRedirect('/admin'), '/admin');
      assert.equal(getSafeAdminRedirect('/admin/'), '/admin/');
      assert.equal(getSafeAdminRedirect('#dashboard'), '/admin/#dashboard');
      assert.equal(getSafeAdminRedirect('index.html#admin-roles'), '/admin/index.html#admin-roles');
    });

    test('rejects external absolute URLs and schemes', () => {
      const maliciousTargets = [
        'https://evil.example',
        'http://evil.example',
        'https://attacker.com/admin',
        'http://attacker.com/admin',
        'javascript:alert(document.cookie)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'blob:https://evil.example/12345',
        'file:///etc/passwd'
      ];

      for (const target of maliciousTargets) {
        assert.equal(isValidAdminRedirect(target), false, `Should reject ${target}`);
        assert.equal(getSafeAdminRedirect(target), '/admin/', `Should fallback to /admin/ for ${target}`);
      }
    });

    test('rejects protocol-relative and backslash obfuscated redirects', () => {
      const maliciousTargets = [
        '//evil.example',
        '///evil.example',
        '\\\\evil.example',
        '/\\evil.example',
        '\\/evil.example',
        '/admin\\evil.example',
        '\\admin'
      ];

      for (const target of maliciousTargets) {
        assert.equal(isValidAdminRedirect(target), false, `Should reject ${target}`);
        assert.equal(getSafeAdminRedirect(target), '/admin/', `Should fallback to /admin/ for ${target}`);
      }
    });

    test('rejects encoded and double-encoded redirect bypasses', () => {
      const encodedTargets = [
        '%2f%2fevil.example',
        '%252f%252fevil.example',
        '%6a%61%76%61%73%63%72%69%70%74:alert(1)',
        '%2fadmin%2f..%2f..%2fevil.com',
        '/%2e%2e/evil.example'
      ];

      for (const target of encodedTargets) {
        assert.equal(isValidAdminRedirect(target), false, `Should reject ${target}`);
        assert.equal(getSafeAdminRedirect(target), '/admin/', `Should fallback to /admin/ for ${target}`);
      }
    });

    test('rejects whitespace, userinfo (@), and control characters', () => {
      const edgeCases = [
        '   https://evil.example   ',
        '/admin@evil.example',
        '/admin\r\nLocation: https://evil.example',
        '/admin\0/evil',
        '',
        null,
        undefined
      ];

      for (const target of edgeCases) {
        assert.equal(isValidAdminRedirect(target as any), false, `Should reject ${target}`);
        assert.equal(getSafeAdminRedirect(target as any), '/admin/', `Should fallback to /admin/ for ${target}`);
      }
    });
  });

  // =========================================================================
  // 2. CORS SECURITY TESTS (SEC-HIGH-02)
  // =========================================================================
  describe('2. CORS Origin Verification & Fail-Closed Behavior', () => {
    const allowed = ['https://zdexcloud.com', 'https://app.zdexcloud.com'];
    const base = 'zdexcloud.com';

    test('permits requests with no origin (curl, native apps, same-origin)', () => {
      assert.equal(isOriginAllowed(undefined, 'production', allowed, base), true);
      assert.equal(isOriginAllowed(null, 'production', allowed, base), true);
      assert.equal(isOriginAllowed('', 'production', allowed, base), true);
    });

    test('permits localhost and 127.0.0.1 in development and test environments', () => {
      assert.equal(isOriginAllowed('http://localhost:3000', 'development', allowed, base), true);
      assert.equal(isOriginAllowed('http://127.0.0.1:8080', 'development', allowed, base), true);
      assert.equal(isOriginAllowed('http://localhost:4000', 'test', allowed, base), true);
    });

    test('permits trusted production origins and subdomains in production', () => {
      assert.equal(isOriginAllowed('https://zdexcloud.com', 'production', allowed, base), true);
      assert.equal(isOriginAllowed('https://app.zdexcloud.com', 'production', allowed, base), true);
      assert.equal(isOriginAllowed('https://admin.zdexcloud.com', 'production', allowed, base), true);
      assert.equal(isOriginAllowed('https://srv-123.zdexcloud.com', 'production', allowed, base), true);
      assert.equal(isOriginAllowed('https://test.onrender.com', 'production', allowed, base), true);
    });

    test('rejects untrusted, malicious, and substring attack origins (Fail-Closed)', () => {
      const maliciousOrigins = [
        'https://evil.example',
        'http://evilzdexcloud.com',
        'https://notzdexcloud.com',
        'https://evil-localhost.com',
        'http://localhost.evil.com',
        'https://attacker.com'
      ];

      for (const origin of maliciousOrigins) {
        assert.equal(isOriginAllowed(origin, 'production', allowed, base), false, `Should reject ${origin} in production`);
        assert.equal(isOriginAllowed(origin, 'development', allowed, base), false, `Should reject ${origin} in development`);
      }
    });

    test('Fastify HTTP integration: allows trusted origin and sets CORS headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          origin: 'https://app.zdexcloud.com'
        }
      });

      assert.equal(response.headers['access-control-allow-origin'], 'https://app.zdexcloud.com');
      assert.equal(response.headers['access-control-allow-credentials'], 'true');
    });

    test('Fastify HTTP integration: rejects untrusted origin without CORS headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          origin: 'https://evil.attacker.com'
        }
      });

      // When rejected by Fastify CORS, access-control-allow-origin is NOT present
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    });

    test('Fastify HTTP integration: handles CORS preflight OPTIONS request correctly', async () => {
      // Allowed preflight
      const allowedPreflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/admin/auth/login',
        headers: {
          origin: 'https://admin.zdexcloud.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'Content-Type, X-Admin-Session-Token'
        }
      });
      assert.equal(allowedPreflight.statusCode, 204);
      assert.equal(allowedPreflight.headers['access-control-allow-origin'], 'https://admin.zdexcloud.com');

      // Rejected preflight
      const rejectedPreflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/admin/auth/login',
        headers: {
          origin: 'https://evil.attacker.com',
          'access-control-request-method': 'POST'
        }
      });
      assert.equal(rejectedPreflight.headers['access-control-allow-origin'], undefined);
    });
  });

  // =========================================================================
  // 3. CONTENT SECURITY POLICY (CSP) & FRAMEGUARD TESTS (SEC-MED-01)
  // =========================================================================
  describe('3. Content-Security-Policy & Frame Protection', () => {
    test('GET /admin sets strict Content-Security-Policy and X-Frame-Options: DENY', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin'
      });

      assert.equal(response.statusCode, 200);
      const csp = String(response.headers['content-security-policy'] || '');
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /style-src 'self'/);
      assert.match(csp, /connect-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
      assert.equal(response.headers['x-frame-options'], 'DENY');
    });

    test('GET /admin/login sets strict Content-Security-Policy', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/login'
      });

      assert.equal(response.statusCode, 200);
      const csp = String(response.headers['content-security-policy'] || '');
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /default-src 'self'/);
      assert.equal(response.headers['x-frame-options'], 'DENY');
    });

    test('GET /api/v1/admin/auth/me sets strict Content-Security-Policy on admin API routes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me'
      });

      const csp = String(response.headers['content-security-policy'] || '');
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(response.headers['x-frame-options'], 'DENY');
    });

    test('Customer public routes do not inherit Admin CSP restriction', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/'
      });

      assert.equal(response.statusCode, 200);
      // Public customer landing page does not have restrictive admin-only frame-ancestors 'none'
      assert.equal(response.headers['content-security-policy'], undefined);
    });
  });

  // =========================================================================
  // 4. CACHE-CONTROL & STATIC ASSET TESTS (SEC-LOW-01)
  // =========================================================================
  describe('4. Cache-Control & Static Shell Security', () => {
    test('Admin HTML shells enforce no-cache, no-store, must-revalidate', async () => {
      const responses = await Promise.all([
        app.inject({ method: 'GET', url: '/admin' }),
        app.inject({ method: 'GET', url: '/admin/' }),
        app.inject({ method: 'GET', url: '/admin/index.html' }),
        app.inject({ method: 'GET', url: '/admin/login' }),
        app.inject({ method: 'GET', url: '/admin/login.html' })
      ]);

      for (const res of responses) {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['cache-control'], 'no-cache, no-store, must-revalidate');
        assert.equal(res.headers['pragma'], 'no-cache');
        assert.equal(res.headers['expires'], '0');
      }
    });

    test('Admin static assets (CSS, JS) permit efficient public caching', async () => {
      const cssRes = await app.inject({ method: 'GET', url: '/admin/css/admin.css' });
      assert.equal(cssRes.statusCode, 200);
      assert.equal(cssRes.headers['cache-control'], 'public, max-age=3600, stale-while-revalidate=86400');

      const jsRes = await app.inject({ method: 'GET', url: '/admin/js/admin-api.js' });
      assert.equal(jsRes.statusCode, 200);
      assert.equal(jsRes.headers['cache-control'], 'public, max-age=3600, stale-while-revalidate=86400');
    });

    test('Customer HTML pages use standard revalidation cache control', async () => {
      const res = await app.inject({ method: 'GET', url: '/pricing' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cache-control'], 'no-cache, must-revalidate');
    });
  });

  // =========================================================================
  // 5. SECURITY HEADER CONSISTENCY (SEC-LOW-03 & Helmet)
  // =========================================================================
  describe('5. Security Header Consistency & Content-Type Protection', () => {
    test('Enforces X-Content-Type-Options: nosniff across all routes', async () => {
      const adminRes = await app.inject({ method: 'GET', url: '/admin' });
      assert.equal(adminRes.headers['x-content-type-options'], 'nosniff');

      const apiRes = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      assert.equal(apiRes.headers['x-content-type-options'], 'nosniff');
    });

    test('Handles 404 responses gracefully for browser and API clients', async () => {
      // API 404
      const apiNotFound = await app.inject({ method: 'GET', url: '/api/v1/nonexistent' });
      assert.equal(apiNotFound.statusCode, 404);
      assert.match(String(apiNotFound.headers['content-type'] || ''), /application\/json/);
      assert.equal(JSON.parse(apiNotFound.body).success, false);

      // Browser 404
      const htmlNotFound = await app.inject({
        method: 'GET',
        url: '/admin/nonexistent-page',
        headers: { accept: 'text/html,application/xhtml+xml' }
      });
      assert.equal(htmlNotFound.statusCode, 404);
      assert.match(String(htmlNotFound.headers['content-type'] || ''), /text\/html/);
      assert.match(htmlNotFound.body, /404/);
    });
  });
});
