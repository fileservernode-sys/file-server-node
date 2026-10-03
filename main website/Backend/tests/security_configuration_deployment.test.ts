/**
 * Phase 14 — Category #12: Security Configuration & Deployment Test Suite
 *
 * Verifies:
 * 1. Production Startup Invariant Validation (Fail-closed on missing secrets, dangerous flags, invalid URLs)
 * 2. CORS Configuration & Fail-Closed Origin Whitelist
 * 3. Cookie Configuration (RFC 6265bis __Host- prefix, Secure, HttpOnly, SameSite=Lax, Path=/)
 * 4. CSRF Configuration & Secret Validation
 * 5. Gateway Configuration & Production Protocol Hardening (WSS mandatory in production)
 * 6. Proxy Trust & Client IP Configuration Bounds
 * 7. Negative Configuration & Dangerous Default Detection
 */

import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { validateEnvironment } from '../src/config/env_validator.js';
import { gatewayConfigSchema } from '../src/gateway/gateway_config.js';
import {
  getCustomerSessionCookieOptions,
  getAdminSessionCookieOptions,
  CUSTOMER_SESSION_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME
} from '../src/config/cookie.js';
import { isOriginAllowed } from '../src/utils/security.js';
import { generateCsrfToken, validateCsrfToken } from '../src/utils/csrf.js';

describe('Phase 14 — Category #12: Security Configuration & Deployment', () => {

  // =========================================================================
  // 1. PRODUCTION STARTUP INVARIANT VALIDATION & FAIL-CLOSED CHECKS
  // =========================================================================
  describe('1. Production Startup Invariant Validation & Fail-Closed Checks', () => {
    const originalEnv = { ...process.env };

    after(() => {
      process.env = { ...originalEnv };
    });

    test('validates valid production configuration cleanly with zero fatal errors', () => {
      process.env.ZDEX_CSRF_SECRET = 'super_secure_production_csrf_hmac_secret_32_bytes_long';

      const result = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod_user:prod_pass@db.production.internal:3306/zdexcloud_prod',
        CORS_ORIGIN: 'https://zdexcloud.com,https://app.zdexcloud.com,https://admin.zdexcloud.com',
        API_BASE_URL: 'https://api.zdexcloud.com/api/v1',
        REMOTENODE_BASE_DOMAIN: 'zdexcloud.com',
        REMOTENODE_GATEWAY_DOMAIN: 'gateway.zdexcloud.com',
        TRUST_PROXY: 'loopback,linklocal,uniquelocal',
        LOG_LEVEL: 'info'
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    test('rejects missing DATABASE_URL with fatal error', () => {
      const result = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: ''
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('DATABASE_URL is mandatory')));
    });

    test('rejects wildcard CORS_ORIGIN in production mode', () => {
      process.env.ZDEX_CSRF_SECRET = 'super_secure_production_csrf_hmac_secret_32_bytes_long';

      const result = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod_user:prod_pass@db.production.internal:3306/zdexcloud_prod',
        CORS_ORIGIN: '*',
        API_BASE_URL: 'https://api.zdexcloud.com/api/v1'
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Wildcard CORS_ORIGIN (*) is strictly forbidden in production')));
    });

    test('rejects insecure http:// in API_BASE_URL in production mode', () => {
      process.env.ZDEX_CSRF_SECRET = 'super_secure_production_csrf_hmac_secret_32_bytes_long';

      const result = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod_user:prod_pass@db.production.internal:3306/zdexcloud_prod',
        CORS_ORIGIN: 'https://zdexcloud.com',
        API_BASE_URL: 'http://api.zdexcloud.com/api/v1' // INSECURE HTTP
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Insecure http:// protocol in API_BASE_URL is forbidden in production')));
    });

    test('rejects localhost domain configuration in production mode', () => {
      process.env.ZDEX_CSRF_SECRET = 'super_secure_production_csrf_hmac_secret_32_bytes_long';

      const result = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod_user:prod_pass@db.production.internal:3306/zdexcloud_prod',
        CORS_ORIGIN: 'https://zdexcloud.com',
        API_BASE_URL: 'https://api.zdexcloud.com/api/v1',
        REMOTENODE_BASE_DOMAIN: 'localhost'
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('REMOTENODE_BASE_DOMAIN cannot be localhost')));
    });

    test('rejects unbounded wildcard TRUST_PROXY in production mode', () => {
      process.env.ZDEX_CSRF_SECRET = 'super_secure_production_csrf_hmac_secret_32_bytes_long';

      const result = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod_user:prod_pass@db.production.internal:3306/zdexcloud_prod',
        CORS_ORIGIN: 'https://zdexcloud.com',
        API_BASE_URL: 'https://api.zdexcloud.com/api/v1',
        TRUST_PROXY: '*'
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Unbounded wildcard TRUST_PROXY (*) is forbidden')));
    });

    test('rejects missing or weak CSRF secret in production mode', () => {
      delete process.env.ZDEX_CSRF_SECRET;
      delete process.env.INTERNAL_SERVICE_KEY;
      delete process.env.ADMIN_AUTH_SECRET;

      const result = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod_user:prod_pass@db.production.internal:3306/zdexcloud_prod',
        CORS_ORIGIN: 'https://zdexcloud.com',
        API_BASE_URL: 'https://api.zdexcloud.com/api/v1'
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Production startup requires at least one authoritative cryptographic secret')));
    });

    test('rejects dangerous bypass flags in production mode', () => {
      process.env.ZDEX_CSRF_SECRET = 'super_secure_production_csrf_hmac_secret_32_bytes_long';
      process.env.DISABLE_AUTH = 'true';
      process.env.SKIP_CSRF = 'true';

      const result = validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://prod_user:prod_pass@db.production.internal:3306/zdexcloud_prod',
        CORS_ORIGIN: 'https://zdexcloud.com',
        API_BASE_URL: 'https://api.zdexcloud.com/api/v1'
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('DISABLE_AUTH')));
      assert.ok(result.errors.some(e => e.includes('SKIP_CSRF')));

      delete process.env.DISABLE_AUTH;
      delete process.env.SKIP_CSRF;
    });
  });

  // =========================================================================
  // 2. GATEWAY PROTOCOL & DOMAIN CONFIGURATION
  // =========================================================================
  describe('2. Gateway Protocol & Domain Configuration', () => {
    test('gatewayConfigSchema rejects insecure ws:// in production mode', () => {
      const parsed = gatewayConfigSchema.safeParse({
        NODE_ENV: 'production',
        GATEWAY_WS_URL: 'ws://gateway.zdexcloud.com'
      });

      assert.strictEqual(parsed.success, false);
      if (!parsed.success) {
        assert.ok(parsed.error.errors.some(e => e.message.includes('Insecure ws:// protocol is strictly forbidden in production')));
      }
    });

    test('gatewayConfigSchema accepts secure wss:// in production mode', () => {
      const parsed = gatewayConfigSchema.safeParse({
        NODE_ENV: 'production',
        GATEWAY_WS_URL: 'wss://gateway.zdexcloud.com',
        REMOTENODE_BASE_DOMAIN: 'zdexcloud.com',
        REMOTENODE_GATEWAY_DOMAIN: 'gateway.zdexcloud.com'
      });

      assert.strictEqual(parsed.success, true);
    });

    test('gatewayConfigSchema rejects domain names containing protocol schemes or slashes', () => {
      const parsed = gatewayConfigSchema.safeParse({
        REMOTENODE_BASE_DOMAIN: 'https://zdexcloud.com/'
      });

      assert.strictEqual(parsed.success, false);
    });
  });

  // =========================================================================
  // 3. COOKIE SECURITY CONFIGURATION
  // =========================================================================
  describe('3. Cookie Security Configuration', () => {
    test('Customer session cookie conforms to RFC 6265bis __Host- prefix requirements', () => {
      const opts = getCustomerSessionCookieOptions(true);

      assert.strictEqual(CUSTOMER_SESSION_COOKIE_NAME, '__Host-zdex_session');
      assert.strictEqual(opts.secure, true, 'RFC 6265bis __Host- requires Secure attribute');
      assert.strictEqual(opts.httpOnly, true, 'HttpOnly must be enabled');
      assert.strictEqual(opts.sameSite, 'lax');
      assert.strictEqual(opts.path, '/');
      assert.strictEqual((opts as any).domain, undefined, 'RFC 6265bis __Host- forbids Domain attribute');
      assert.strictEqual(opts.maxAge, 86400);
    });

    test('Admin session cookie conforms to RFC 6265bis __Host- prefix requirements', () => {
      const opts = getAdminSessionCookieOptions(true);

      assert.strictEqual(ADMIN_SESSION_COOKIE_NAME, '__Host-zdex_admin_session');
      assert.strictEqual(opts.secure, true);
      assert.strictEqual(opts.httpOnly, true);
      assert.strictEqual(opts.sameSite, 'lax');
      assert.strictEqual(opts.path, '/');
      assert.strictEqual((opts as any).domain, undefined);
      assert.strictEqual(opts.maxAge, 86400);
    });
  });

  // =========================================================================
  // 4. CORS ORIGIN WHITELIST & FAIL-CLOSED VALIDATION
  // =========================================================================
  describe('4. CORS Origin Whitelist & Fail-Closed Validation', () => {
    const allowed = ['https://zdexcloud.com', 'https://app.zdexcloud.com'];
    const baseDomain = 'zdexcloud.com';

    test('allows legitimate production HTTPS origins', () => {
      assert.strictEqual(isOriginAllowed('https://zdexcloud.com', 'production', allowed, baseDomain), true);
      assert.strictEqual(isOriginAllowed('https://app.zdexcloud.com', 'production', allowed, baseDomain), true);
      assert.strictEqual(isOriginAllowed('https://admin.zdexcloud.com', 'production', allowed, baseDomain), true);
      assert.strictEqual(isOriginAllowed('https://gateway.zdexcloud.com', 'production', allowed, baseDomain), true);
    });

    test('rejects malicious external origins', () => {
      assert.strictEqual(isOriginAllowed('https://evil-attacker.com', 'production', allowed, baseDomain), false);
      assert.strictEqual(isOriginAllowed('https://zdexcloud.com.evil.com', 'production', allowed, baseDomain), false);
      assert.strictEqual(isOriginAllowed('http://zdexcloud.com', 'production', allowed, baseDomain), false, 'Insecure HTTP must be rejected');
    });

    test('allows localhost strictly in development mode, rejects in production', () => {
      assert.strictEqual(isOriginAllowed('http://localhost:3000', 'development', allowed, baseDomain), true);
      assert.strictEqual(isOriginAllowed('http://localhost:3000', 'production', allowed, baseDomain), false);
      assert.strictEqual(isOriginAllowed('http://127.0.0.1:8080', 'production', allowed, baseDomain), false);
    });

    test('handles missing or empty origin safely (same-origin / native client)', () => {
      assert.strictEqual(isOriginAllowed(null, 'production', allowed, baseDomain), true);
      assert.strictEqual(isOriginAllowed(undefined, 'production', allowed, baseDomain), true);
    });

    test('fails closed on malformed origin strings', () => {
      assert.strictEqual(isOriginAllowed('not-a-valid-url', 'production', allowed, baseDomain), false);
      assert.strictEqual(isOriginAllowed('javascript:alert(1)', 'production', allowed, baseDomain), false);
    });
  });

  // =========================================================================
  // 5. CSRF CONFIGURATION & CRYPTOGRAPHIC HMAC VALIDATION
  // =========================================================================
  describe('5. CSRF Configuration & Cryptographic HMAC Validation', () => {
    const session = {
      id: 'sess_test_123',
      tokenHash: 'hash_abc_999'
    };

    test('generates cryptographically signed, session-bound CSRF token', () => {
      const token = generateCsrfToken(session);
      assert.ok(token);
      const parts = token.split('.');
      assert.strictEqual(parts.length, 3);
      assert.strictEqual(parts[0], session.id);
      assert.strictEqual(parts[1].length, 32); // 16-byte hex nonce
      assert.strictEqual(parts[2].length, 64); // 32-byte sha256 hex signature
    });

    test('validates authentic CSRF token successfully', () => {
      const token = generateCsrfToken(session);
      const isValid = validateCsrfToken(token, session);
      assert.strictEqual(isValid, true);
    });

    test('rejects token bound to a different session ID', () => {
      const token = generateCsrfToken(session);
      const otherSession = { id: 'sess_attacker_999', tokenHash: session.tokenHash };
      const isValid = validateCsrfToken(token, otherSession);
      assert.strictEqual(isValid, false);
    });

    test('rejects tampered or forged CSRF signature', () => {
      const token = generateCsrfToken(session);
      const parts = token.split('.');
      const forgedToken = `${parts[0]}.${parts[1]}.${'a'.repeat(64)}`;
      const isValid = validateCsrfToken(forgedToken, session);
      assert.strictEqual(isValid, false);
    });
  });

});
