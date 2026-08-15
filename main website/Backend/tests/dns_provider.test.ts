import assert from 'node:assert';
import { test, describe } from 'node:test';
import { MockDnsProvider } from '../src/services/dns_provider.js';
import { EndpointService } from '../src/services/endpoint.js';

describe('DNS Provider Abstraction & Endpoint Integration', () => {
  test('MockDnsProvider provisions and verifies CNAME record', async () => {
    const provider = new MockDnsProvider();

    const res = await provider.provisionRecord({
      hostname: 'node-test123.remotenode.net',
      target: 'gateway.remotenode.net',
      type: 'CNAME'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.hostname, 'node-test123.remotenode.net');
    assert.ok(res.recordId);

    const verified = await provider.verifyRecord('node-test123.remotenode.net');
    assert.strictEqual(verified, true);
  });

  test('MockDnsProvider handles record deletion cleanly', async () => {
    const provider = new MockDnsProvider();

    await provider.provisionRecord({
      hostname: 'node-delete.remotenode.net',
      target: 'gateway.remotenode.net',
      type: 'CNAME'
    });

    const deleted = await provider.removeRecord('node-delete.remotenode.net');
    assert.strictEqual(deleted.success, true);

    const exists = await provider.verifyRecord('node-delete.remotenode.net');
    assert.strictEqual(exists, false);
  });

  test('EndpointService generates clean deterministic node hostnames', () => {
    const hostname = EndpointService.generateHostname('srv-abcd-1234-xyz');
    assert.strictEqual(hostname.endsWith('.remotenode.net'), true);
    assert.strictEqual(hostname.startsWith('node-'), true);
  });

  test('EndpointService strictly validates hostname safety', () => {
    // Valid subdomains
    assert.strictEqual(EndpointService.validateHostname('node-12345678.remotenode.net'), true);
    assert.strictEqual(EndpointService.validateHostname('srv-my-device-1.remotenode.net'), true);

    // Invalid: protocol prefixes, slashes, spaces, external domains
    assert.strictEqual(EndpointService.validateHostname('https://node-123.remotenode.net'), false);
    assert.strictEqual(EndpointService.validateHostname('node-123.remotenode.net/admin'), false);
    assert.strictEqual(EndpointService.validateHostname('node 123.remotenode.net'), false);
    assert.strictEqual(EndpointService.validateHostname('evil-hacker.com'), false);
    assert.strictEqual(EndpointService.validateHostname('subdomain.otherdomain.net'), false);
  });
});
