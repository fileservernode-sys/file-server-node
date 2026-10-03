import assert from 'node:assert';
import http from 'node:http';
import { test, describe, before, after } from 'node:test';
import dns from 'node:dns';
import {
  parseAlternateIpv4,
  normalizeIpAddress,
  isPrivateOrRestrictedIp,
  validateExternalUrl,
  createSsrfSafeLookup,
  resolveAndValidateDestination,
  safeExternalFetch,
  SsrfError
} from '../src/utils/ssrf_guard.js';

describe('Phase 14 — Category #9: SSRF & External Request Security', () => {

  describe('1. Alternate IPv4 Encoding & Parsing', () => {
    test('parses pure decimal representation of 127.0.0.1 (2130706433)', () => {
      const parsed = parseAlternateIpv4('2130706433');
      assert.strictEqual(parsed, '127.0.0.1');
    });

    test('parses hex representation of 127.0.0.1 (0x7f000001)', () => {
      const parsed = parseAlternateIpv4('0x7f000001');
      assert.strictEqual(parsed, '127.0.0.1');
    });

    test('parses octal dotted representation of 127.0.0.1 (0177.0.0.1)', () => {
      const parsed = parseAlternateIpv4('0177.0.0.1');
      assert.strictEqual(parsed, '127.0.0.1');
    });

    test('parses shorthand two-part IP (127.1 -> 127.0.0.1)', () => {
      const parsed = parseAlternateIpv4('127.1');
      assert.strictEqual(parsed, '127.0.0.1');
    });

    test('parses shorthand three-part IP (10.0.1 -> 10.0.0.1)', () => {
      const parsed = parseAlternateIpv4('10.0.1');
      assert.strictEqual(parsed, '10.0.0.1');
    });

    test('returns null for non-numeric domain names', () => {
      assert.strictEqual(parseAlternateIpv4('example.com'), null);
      assert.strictEqual(parseAlternateIpv4('api.brevo.com'), null);
    });
  });

  describe('2. IP Normalization & IPv6 Translation', () => {
    test('normalizes bracketed IPv6 address', () => {
      const result = normalizeIpAddress('[::1]');
      assert.strictEqual(result.ip, '::1');
      assert.strictEqual(result.isIpv6, true);
    });

    test('normalizes IPv4-mapped IPv6 address (::ffff:127.0.0.1)', () => {
      const result = normalizeIpAddress('::ffff:127.0.0.1');
      assert.strictEqual(result.ip, '127.0.0.1');
      assert.strictEqual(result.isIpv6, false);
    });

    test('normalizes NAT64 translated IPv4 address (64:ff9b::192.168.1.1)', () => {
      const result = normalizeIpAddress('64:ff9b::192.168.1.1');
      assert.strictEqual(result.ip, '192.168.1.1');
      assert.strictEqual(result.isIpv6, false);
    });

    test('normalizes decimal IP address (2130706433)', () => {
      const result = normalizeIpAddress('2130706433');
      assert.strictEqual(result.ip, '127.0.0.1');
      assert.strictEqual(result.isIpv6, false);
    });
  });

  describe('3. Private & Restricted IP Detection (RFC Ranges)', () => {
    test('identifies loopback addresses as restricted', () => {
      assert.strictEqual(isPrivateOrRestrictedIp('127.0.0.1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('127.255.255.254'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('0.0.0.0'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('::1'), true);
    });

    test('identifies RFC 1918 private IPv4 ranges as restricted', () => {
      // 10.0.0.0/8
      assert.strictEqual(isPrivateOrRestrictedIp('10.0.0.1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('10.254.254.254'), true);

      // 172.16.0.0/12
      assert.strictEqual(isPrivateOrRestrictedIp('172.16.0.1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('172.31.255.254'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('172.32.0.1'), false); // Public

      // 192.168.0.0/16
      assert.strictEqual(isPrivateOrRestrictedIp('192.168.1.1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('192.168.254.254'), true);
    });

    test('identifies Link-Local and Cloud Metadata (169.254.0.0/16) as restricted', () => {
      assert.strictEqual(isPrivateOrRestrictedIp('169.254.169.254'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('169.254.1.1'), true);
    });

    test('identifies Carrier-Grade NAT (100.64.0.0/10) as restricted', () => {
      assert.strictEqual(isPrivateOrRestrictedIp('100.64.0.1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('100.127.255.254'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('100.128.0.1'), false); // Public
    });

    test('identifies IPv6 ULA (fc00::/7) and Link-Local (fe80::/10) as restricted', () => {
      assert.strictEqual(isPrivateOrRestrictedIp('fc00::1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('fd12:3456:789a::1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('fe80::1'), true);
    });

    test('identifies Discard prefix (100::/64) and Documentation (2001:db8::/32) as restricted', () => {
      assert.strictEqual(isPrivateOrRestrictedIp('100::1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('2001:db8::1'), true);
    });

    test('identifies Multicast and Reserved ranges as restricted', () => {
      assert.strictEqual(isPrivateOrRestrictedIp('224.0.0.1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('240.0.0.1'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('255.255.255.255'), true);
      assert.strictEqual(isPrivateOrRestrictedIp('ff02::1'), true); // IPv6 Multicast
    });

    test('permits legitimate public routable IPs', () => {
      assert.strictEqual(isPrivateOrRestrictedIp('8.8.8.8'), false);
      assert.strictEqual(isPrivateOrRestrictedIp('1.1.1.1'), false);
      assert.strictEqual(isPrivateOrRestrictedIp('93.184.216.34'), false);
      assert.strictEqual(isPrivateOrRestrictedIp('2606:4700:4700::1111'), false);
    });
  });

  describe('4. URL Validation & Policy Enforcement', () => {
    test('allows valid public HTTPS URLs on default port 443', () => {
      const parsed = validateExternalUrl('https://api.brevo.com/v3/smtp/email');
      assert.strictEqual(parsed.hostname, 'api.brevo.com');
      assert.strictEqual(parsed.protocol, 'https:');
    });

    test('normalizes trailing-dot hostnames', () => {
      const parsed = validateExternalUrl('https://api.brevo.com./v3/account');
      assert.strictEqual(parsed.hostname, 'api.brevo.com.');
    });

    test('rejects non-HTTPS protocols by default (http, file, gopher, ftp, dict)', () => {
      assert.throws(() => validateExternalUrl('http://api.brevo.com'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'FORBIDDEN_PROTOCOL';
      });

      assert.throws(() => validateExternalUrl('file:///etc/passwd'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'FORBIDDEN_PROTOCOL';
      });

      assert.throws(() => validateExternalUrl('gopher://127.0.0.1:70/'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'FORBIDDEN_PROTOCOL';
      });

      assert.throws(() => validateExternalUrl('ftp://example.com/file'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'FORBIDDEN_PROTOCOL';
      });
    });

    test('rejects embedded credentials in URL', () => {
      assert.throws(() => validateExternalUrl('https://admin:secret@api.example.com/path'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'EMBEDDED_CREDENTIALS';
      });
    });

    test('rejects cloud metadata endpoints and hostnames', () => {
      assert.throws(() => validateExternalUrl('https://169.254.169.254/latest/meta-data/'), (err: any) => {
        return err instanceof SsrfError && (err.reasonCode === 'CLOUD_METADATA_BLOCKED' || err.reasonCode === 'PRIVATE_IP_BLOCKED');
      });

      assert.throws(() => validateExternalUrl('https://metadata.google.internal/computeMetadata/v1/'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'CLOUD_METADATA_BLOCKED';
      });

      assert.throws(() => validateExternalUrl('https://instance-data/latest/'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'CLOUD_METADATA_BLOCKED';
      });
    });

    test('rejects localhost and loopback targets in production mode', () => {
      assert.throws(() => validateExternalUrl('https://localhost'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'LOOPBACK_FORBIDDEN';
      });

      assert.throws(() => validateExternalUrl('https://127.0.0.1'), (err: any) => {
        return err instanceof SsrfError && (err.reasonCode === 'LOOPBACK_FORBIDDEN' || err.reasonCode === 'PRIVATE_IP_BLOCKED');
      });
    });

    test('rejects alternate numeric IP representations targeting loopback/private', () => {
      // 2130706433 -> 127.0.0.1
      assert.throws(() => validateExternalUrl('https://2130706433'), (err: any) => {
        return err instanceof SsrfError && (err.reasonCode === 'PRIVATE_IP_BLOCKED' || err.reasonCode === 'LOOPBACK_FORBIDDEN');
      });

      // 0x7f000001 -> 127.0.0.1
      assert.throws(() => validateExternalUrl('https://0x7f000001'), (err: any) => {
        return err instanceof SsrfError && (err.reasonCode === 'PRIVATE_IP_BLOCKED' || err.reasonCode === 'LOOPBACK_FORBIDDEN');
      });

      // 0177.0.0.1 -> 127.0.0.1
      assert.throws(() => validateExternalUrl('https://0177.0.0.1'), (err: any) => {
        return err instanceof SsrfError && (err.reasonCode === 'PRIVATE_IP_BLOCKED' || err.reasonCode === 'LOOPBACK_FORBIDDEN');
      });
    });

    test('enforces explicit port policy: non-443 rejected by default', () => {
      assert.throws(() => validateExternalUrl('https://api.example.com:8080/path'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'FORBIDDEN_PORT';
      });

      assert.throws(() => validateExternalUrl('https://api.example.com:80/path'), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'FORBIDDEN_PORT';
      });

      // Allowed when configured explicitly
      const customAllowed = validateExternalUrl('https://api.example.com:8443/path', { allowedPorts: [443, 8443] });
      assert.strictEqual(customAllowed.port, '8443');
    });

    test('enforces explicit hostname allowlist when specified', () => {
      const options = { allowedHostnames: ['api.razorpay.com', 'api.brevo.com'] };

      const approved = validateExternalUrl('https://api.razorpay.com/v1/orders', options);
      assert.strictEqual(approved.hostname, 'api.razorpay.com');

      assert.throws(() => validateExternalUrl('https://attacker.com/steal', options), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'UNAPPROVED_HOSTNAME';
      });
    });

    test('enforces explicit hostname blocklist when specified', () => {
      const options = { blockedHostnames: ['malicious.com'] };

      assert.throws(() => validateExternalUrl('https://malicious.com/api', options), (err: any) => {
        return err instanceof SsrfError && err.reasonCode === 'BLOCKED_HOSTNAME';
      });
    });
  });

  describe('5. DNS Resolution & Socket Binding (DNS Pinning)', () => {
    test('createSsrfSafeLookup directly blocks literal private IPv4 addresses at socket init', (t, done) => {
      const lookup = createSsrfSafeLookup();
      lookup('10.0.0.1', {}, (err) => {
        assert.ok(err);
        assert.strictEqual(err.code, 'SSRF_PRIVATE_IP_BLOCKED');
        done();
      });
    });

    test('createSsrfSafeLookup directly blocks cloud metadata hostnames at socket init', (t, done) => {
      const lookup = createSsrfSafeLookup();
      lookup('metadata.google.internal', {}, (err) => {
        assert.ok(err);
        assert.strictEqual(err.code, 'SSRF_CLOUD_METADATA_BLOCKED');
        done();
      });
    });

    test('resolveAndValidateDestination rejects literal private IPs', async () => {
      await assert.rejects(
        resolveAndValidateDestination('10.0.0.1'),
        (err: any) => err instanceof SsrfError && err.reasonCode === 'PRIVATE_IP_BLOCKED'
      );

      await assert.rejects(
        resolveAndValidateDestination('192.168.1.100'),
        (err: any) => err instanceof SsrfError && err.reasonCode === 'PRIVATE_IP_BLOCKED'
      );
    });

    test('resolveAndValidateDestination rejects cloud metadata hosts', async () => {
      await assert.rejects(
        resolveAndValidateDestination('metadata.google.internal'),
        (err: any) => err instanceof SsrfError && err.reasonCode === 'CLOUD_METADATA_BLOCKED'
      );
    });

    test('DNS interceptor rejects host resolving to mixed answers when one is private', (t, done) => {
      const originalLookup = dns.lookup;
      // Mock dns.lookup to simulate DNS rebinding / mixed response
      (dns as any).lookup = (host: string, opts: any, cb: any) => {
        cb(null, [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 } // Rebinding trap
        ]);
      };

      const lookup = createSsrfSafeLookup();
      lookup('mixed-rebind.test', { all: true }, (err) => {
        // Restore original lookup
        (dns as any).lookup = originalLookup;
        assert.ok(err);
        assert.strictEqual(err.code, 'SSRF_DNS_REBINDING_PREVENTED');
        done();
      });
    });

    test('DNS interceptor accepts host resolving to public IPv4 and IPv6 addresses', (t, done) => {
      const originalLookup = dns.lookup;
      (dns as any).lookup = (host: string, opts: any, cb: any) => {
        cb(null, [
          { address: '93.184.216.34', family: 4 },
          { address: '2606:4700:4700::1111', family: 6 }
        ]);
      };

      const lookup = createSsrfSafeLookup();
      lookup('public-valid.test', { all: true }, (err, addresses) => {
        (dns as any).lookup = originalLookup;
        assert.strictEqual(err, null);
        assert.strictEqual(Array.isArray(addresses), true);
        assert.strictEqual((addresses as any[]).length, 2);
        done();
      });
    });

    test('DNS interceptor rejects host resolving to restricted IPv6 address (ULA fc00::1)', (t, done) => {
      const originalLookup = dns.lookup;
      (dns as any).lookup = (host: string, opts: any, cb: any) => {
        cb(null, [
          { address: 'fc00::1', family: 6 }
        ]);
      };

      const lookup = createSsrfSafeLookup();
      lookup('ipv6-ula.test', { all: true }, (err) => {
        (dns as any).lookup = originalLookup;
        assert.ok(err);
        assert.strictEqual(err.code, 'SSRF_DNS_REBINDING_PREVENTED');
        done();
      });
    });
  });

  describe('6. Redirect Handling & Unsafe Destination Interception', () => {
    let mockServer: http.Server;
    let mockPort: number;

    before(async () => {
      await new Promise<void>((resolve) => {
        mockServer = http.createServer((req, res) => {
          const path = req.url || '/';
          if (path === '/redirect-to-forbidden-port') {
            res.writeHead(302, { 'Location': `http://127.0.0.1:9999/internal` });
            res.end();
          } else if (path === '/redirect-to-private-ip') {
            res.writeHead(302, { 'Location': 'http://10.254.1.1:80/admin' });
            res.end();
          } else if (path === '/redirect-to-metadata') {
            res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data/' });
            res.end();
          } else if (path === '/redirect-to-unsupported') {
            res.writeHead(302, { 'Location': 'file:///etc/passwd' });
            res.end();
          } else if (path === '/redirect-to-blocked-host') {
            res.writeHead(302, { 'Location': 'http://malicious-target.com/exploit' });
            res.end();
          } else if (path === '/redirect-loop') {
            res.writeHead(302, { 'Location': `http://127.0.0.1:${mockPort}/redirect-loop` });
            res.end();
          } else if (path === '/missing-location') {
            res.writeHead(302);
            res.end();
          } else if (path === '/valid-redirect') {
            res.writeHead(302, { 'Location': `http://127.0.0.1:${mockPort}/valid-dest` });
            res.end();
          } else if (path === '/valid-dest') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'reached' }));
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as any).port;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    });

    test('intercepts and rejects redirect to forbidden port', async () => {
      await assert.rejects(
        safeExternalFetch(
          `http://127.0.0.1:${mockPort}/redirect-to-forbidden-port`,
          {},
          { allowedProtocols: ['http:'], allowedPorts: [mockPort], allowPrivateForLocalDev: true }
        ),
        (err: any) => err instanceof SsrfError && err.reasonCode === 'FORBIDDEN_PORT'
      );
    });

    test('intercepts and rejects redirect to private IPv4 address', async () => {
      await assert.rejects(
        safeExternalFetch(
          `http://127.0.0.1:${mockPort}/redirect-to-private-ip`,
          {},
          { allowedProtocols: ['http:'], allowedPorts: [mockPort, 80], allowPrivateForLocalDev: false }
        ),
        (err: any) => err instanceof SsrfError && (err.reasonCode === 'LOOPBACK_FORBIDDEN' || err.reasonCode === 'PRIVATE_IP_BLOCKED')
      );
    });

    test('intercepts and rejects redirect to cloud metadata', async () => {
      await assert.rejects(
        safeExternalFetch(
          `http://127.0.0.1:${mockPort}/redirect-to-metadata`,
          {},
          { allowedProtocols: ['http:'], allowedPorts: [mockPort, 80], allowPrivateForLocalDev: true }
        ),
        (err: any) => err instanceof SsrfError && (err.reasonCode === 'CLOUD_METADATA_BLOCKED' || err.reasonCode === 'PRIVATE_IP_BLOCKED')
      );
    });

    test('intercepts and rejects redirect to unsupported scheme (file:)', async () => {
      await assert.rejects(
        safeExternalFetch(
          `http://127.0.0.1:${mockPort}/redirect-to-unsupported`,
          {},
          { allowedProtocols: ['http:'], allowedPorts: [mockPort], allowPrivateForLocalDev: true }
        ),
        (err: any) => err instanceof SsrfError && err.reasonCode === 'FORBIDDEN_PROTOCOL'
      );
    });

    test('intercepts and rejects redirect to blocked hostname', async () => {
      await assert.rejects(
        safeExternalFetch(
          `http://127.0.0.1:${mockPort}/redirect-to-blocked-host`,
          {},
          { allowedProtocols: ['http:'], allowedPorts: [mockPort, 80], blockedHostnames: ['malicious-target.com'], allowPrivateForLocalDev: true }
        ),
        (err: any) => err instanceof SsrfError && err.reasonCode === 'BLOCKED_HOSTNAME'
      );
    });

    test('intercepts and rejects missing Location header in redirect', async () => {
      await assert.rejects(
        safeExternalFetch(
          `http://127.0.0.1:${mockPort}/missing-location`,
          {},
          { allowedProtocols: ['http:'], allowedPorts: [mockPort], allowPrivateForLocalDev: true }
        ),
        (err: any) => err instanceof SsrfError && err.reasonCode === 'MALFORMED_REDIRECT'
      );
    });

    test('enforces max redirect limit and aborts infinite loops', async () => {
      await assert.rejects(
        safeExternalFetch(
          `http://127.0.0.1:${mockPort}/redirect-loop`,
          {},
          { allowedProtocols: ['http:'], allowedPorts: [mockPort], maxRedirects: 2, allowPrivateForLocalDev: true }
        ),
        (err: any) => err instanceof SsrfError && err.reasonCode === 'EXCESSIVE_REDIRECTS'
      );
    });

    test('successfully follows legitimate redirect within policy limits', async () => {
      const res = await safeExternalFetch(
        `http://127.0.0.1:${mockPort}/valid-redirect`,
        {},
        { allowedProtocols: ['http:'], allowedPorts: [mockPort], allowPrivateForLocalDev: true }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.bodyJson?.success, true);
    });
  });

  describe('7. Safe Fetch Wrapper Constraints (Bounds & Timeouts)', () => {
    test('rejects outbound fetch to forbidden local address in production mode', async () => {
      await assert.rejects(
        safeExternalFetch('https://127.0.0.1:443/admin'),
        (err: any) => err instanceof SsrfError
      );
    });

    test('rejects outbound fetch to cloud metadata', async () => {
      await assert.rejects(
        safeExternalFetch('https://169.254.169.254/latest/meta-data/'),
        (err: any) => err instanceof SsrfError
      );
    });

    test('supports caller AbortSignal cancellation', async () => {
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        safeExternalFetch('https://127.0.0.1:443/cancelled', { signal: controller.signal }),
        (err: any) => err instanceof SsrfError
      );
    });
  });

});
