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
});
