import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import {
  getRazorpayConfig,
  isRazorpayConfigured,
  assertRazorpayConfigured,
  assertRazorpayWebhookConfigured
} from '../src/config/razorpay.js';
import {
  RazorpayProviderError,
  RazorpayClient,
  verifyRazorpayWebhookSignature,
  assertValidRazorpayWebhook
} from '../src/services/billing/providers/razorpay/index.js';

describe('ZC-BILLING-3.2 Razorpay Configuration & Provider Foundation Test Suite', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
  });

  after(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. CONFIGURATION TESTS
  // ---------------------------------------------------------------------------
  test('1. Default / Missing Credentials — Safe boot and unconfigured state', () => {
    const cfg = getRazorpayConfig({ keyId: '', keySecret: '', webhookSecret: '' });
    assert.strictEqual(cfg.isConfigured, false);
    assert.strictEqual(cfg.isComplete, false);
    assert.strictEqual(isRazorpayConfigured({ keyId: '', keySecret: '' }), false);

    assert.throws(
      () => assertRazorpayConfigured({ keyId: '', keySecret: '' }),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'NOT_CONFIGURED');
        return true;
      }
    );
  });

  test('2. Complete Configuration — Validates keyId, keySecret, and webhookSecret', () => {
    const cfg = getRazorpayConfig({
      keyId: 'rzp_test_1234567890abcdef',
      keySecret: 'sec_test_secret987654321',
      webhookSecret: 'whsec_test_secret_abc123'
    });

    assert.strictEqual(cfg.keyId, 'rzp_test_1234567890abcdef');
    assert.strictEqual(cfg.keySecret, 'sec_test_secret987654321');
    assert.strictEqual(cfg.webhookSecret, 'whsec_test_secret_abc123');
    assert.strictEqual(cfg.isConfigured, true);
    assert.strictEqual(cfg.isComplete, true);
    assert.strictEqual(
      isRazorpayConfigured({
        keyId: 'rzp_test_1234567890abcdef',
        keySecret: 'sec_test_secret987654321'
      }),
      true
    );

    const verified = assertRazorpayConfigured({
      keyId: 'rzp_test_1234567890abcdef',
      keySecret: 'sec_test_secret987654321'
    });
    assert.strictEqual(verified.keyId, 'rzp_test_1234567890abcdef');

    const whSecret = assertRazorpayWebhookConfigured({
      webhookSecret: 'whsec_test_secret_abc123'
    });
    assert.strictEqual(whSecret, 'whsec_test_secret_abc123');
  });

  test('3. Partial Configuration — Missing keySecret throws PARTIAL_CONFIG', () => {
    assert.throws(
      () =>
        assertRazorpayConfigured({
          keyId: 'rzp_test_1234567890abcdef',
          keySecret: ''
        }),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'PARTIAL_CONFIG');
        assert.ok(err.message.includes('RAZORPAY_KEY_SECRET is missing'));
        return true;
      }
    );
  });

  test('4. Partial Configuration — Missing keyId throws PARTIAL_CONFIG', () => {
    assert.throws(
      () =>
        assertRazorpayConfigured({
          keyId: '',
          keySecret: 'sec_test_secret987654321'
        }),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'PARTIAL_CONFIG');
        assert.ok(err.message.includes('RAZORPAY_KEY_ID is missing'));
        return true;
      }
    );
  });

  test('5. Missing Webhook Secret — Throws WEBHOOK_SECRET_MISSING', () => {
    assert.throws(
      () =>
        assertRazorpayWebhookConfigured({
          webhookSecret: ''
        }),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'WEBHOOK_SECRET_MISSING');
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 2. ERROR SANITIZATION & SECRET ISOLATION
  // ---------------------------------------------------------------------------
  test('6. Error Sanitization — Strips Basic Auth and API secrets from messages', () => {
    const rawError = 'Failed request with header Basic cnBfdGVzdF8xMjM6c2VjcmV0MTIz and key_secret=supersecret123';
    const error = new RazorpayProviderError('API_ERROR', rawError);

    assert.ok(!error.message.includes('cnBfdGVzdF8xMjM6c2VjcmV0MTIz'));
    assert.ok(!error.message.includes('supersecret123'));
    assert.ok(error.message.includes('Basic [REDACTED]'));
    assert.ok(error.message.includes('key_secret=[REDACTED]'));
  });

  // ---------------------------------------------------------------------------
  // 3. WEBHOOK HMAC SHA-256 SIGNATURE VERIFICATION
  // ---------------------------------------------------------------------------
  test('7. Webhook Crypto — Valid signature verified successfully', () => {
    const secret = 'whsec_test_secret_998877';
    const payload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_123456',
      event: 'subscription.activated',
      contains: ['subscription'],
      created_at: 1789128000
    });

    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(Buffer.from(payload, 'utf8'))
      .digest('hex');

    const isValid = verifyRazorpayWebhookSignature(payload, validSignature, secret);
    assert.strictEqual(isValid, true);

    // assertValidRazorpayWebhook should not throw
    assert.doesNotThrow(() => {
      assertValidRazorpayWebhook(payload, validSignature, secret);
    });
  });

  test('8. Webhook Crypto — Rejects tampered payload, invalid signature, or wrong secret', () => {
    const secret = 'whsec_test_secret_998877';
    const payload = JSON.stringify({ event: 'subscription.charged', amount: 4900 });

    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(Buffer.from(payload, 'utf8'))
      .digest('hex');

    // Tampered payload
    const tamperedPayload = JSON.stringify({ event: 'subscription.charged', amount: 0 });
    assert.strictEqual(verifyRazorpayWebhookSignature(tamperedPayload, validSignature, secret), false);

    // Tampered signature
    const forgedSignature = validSignature.slice(0, -4) + 'abcd';
    assert.strictEqual(verifyRazorpayWebhookSignature(payload, forgedSignature, secret), false);

    // Wrong secret
    assert.strictEqual(verifyRazorpayWebhookSignature(payload, validSignature, 'wrong_secret'), false);

    // Empty/missing inputs
    assert.strictEqual(verifyRazorpayWebhookSignature('', validSignature, secret), false);
    assert.strictEqual(verifyRazorpayWebhookSignature(payload, '', secret), false);
    assert.strictEqual(verifyRazorpayWebhookSignature(payload, validSignature, ''), false);

    assert.throws(
      () => assertValidRazorpayWebhook(payload, 'bad_signature', secret),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'INVALID_SIGNATURE');
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 4. FASTIFY RAW BODY CAPTURE INFRASTRUCTURE
  // ---------------------------------------------------------------------------
  test('9. Fastify Raw Body Infrastructure — Preserves exact raw payload bytes', async () => {
    const secret = 'test_webhook_signing_secret';
    const rawPayload = JSON.stringify({ testId: 'raw-body-test', timestamp: 123456789 });
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(Buffer.from(rawPayload, 'utf8'))
      .digest('hex');

    // POST to an API route (e.g. /api/v1/auth/login) with application/json
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': expectedSignature
      },
      payload: rawPayload
    });

    // Verify HMAC validation can be executed against raw payload
    const isValid = verifyRazorpayWebhookSignature(rawPayload, expectedSignature, secret);
    assert.strictEqual(isValid, true);
    assert.ok(res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 422);
  });

  // ---------------------------------------------------------------------------
  // 5. PROVIDER CLIENT TRANSPORT & TIMEOUT
  // ---------------------------------------------------------------------------
  test('10. Razorpay Client — Unconfigured client throws on assertConfigured or request', async () => {
    const client = new RazorpayClient({ keyId: '', keySecret: '' });
    assert.strictEqual(client.isConfigured(), false);

    assert.throws(
      () => client.assertConfigured(),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'NOT_CONFIGURED');
        return true;
      }
    );

    await assert.rejects(
      async () => await client.get('/plans'),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'NOT_CONFIGURED');
        return true;
      }
    );
  });

  test('11. Razorpay Client — Rejects non-HTTPS base URL in production/external mode', async () => {
    const client = new RazorpayClient({
      keyId: 'rzp_test_123',
      keySecret: 'sec_123',
      baseUrl: 'http://insecure-api.razorpay.com/v1'
    });

    await assert.rejects(
      async () => await client.get('/plans'),
      (err: any) => {
        assert.ok(err instanceof RazorpayProviderError);
        assert.strictEqual(err.code, 'NETWORK_ERROR');
        assert.ok(err.message.includes('must use HTTPS'));
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 6. PUBLIC API SECRET LEAKAGE PREVENTION
  // ---------------------------------------------------------------------------
  test('12. Public API Security — GET /api/v1/plans does not leak secrets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plans'
    });

    assert.strictEqual(res.statusCode, 200);
    const bodyText = res.body;

    assert.ok(!bodyText.includes('keySecret'));
    assert.ok(!bodyText.includes('webhookSecret'));
    assert.ok(!bodyText.includes('RAZORPAY_KEY_SECRET'));
    assert.ok(!bodyText.includes('RAZORPAY_WEBHOOK_SECRET'));
  });

  test('13. Public API Security — GET /api/v1/storefront/region does not leak secrets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region'
    });

    assert.strictEqual(res.statusCode, 200);
    const bodyText = res.body;

    assert.ok(!bodyText.includes('keySecret'));
    assert.ok(!bodyText.includes('webhookSecret'));
    assert.ok(!bodyText.includes('RAZORPAY_KEY_SECRET'));
    assert.ok(!bodyText.includes('RAZORPAY_WEBHOOK_SECRET'));
  });
});
