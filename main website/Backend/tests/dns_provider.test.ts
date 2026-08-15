import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { MockDnsProvider } from '../src/services/dns_provider.js';
import { EndpointService } from '../src/services/endpoint.js';

describe('DNS Provider Abstraction & Dynamic Base Domain Integration', () => {
  beforeEach(() => {
    EndpointService.setBaseDomain('viewduration.com');
    EndpointService.setDnsProvider(new MockDnsProvider());
  });

  test('MockDnsProvider provisions and verifies CNAME record', async () => {
    const provider = new MockDnsProvider();

    const res = await provider.provisionRecord({
      hostname: 'srv-test123.viewduration.com',
      target: 'gateway.viewduration.com',
      type: 'CNAME'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.hostname, 'srv-test123.viewduration.com');
    assert.ok(res.recordId);

    const verified = await provider.verifyRecord('srv-test123.viewduration.com');
    assert.strictEqual(verified, true);
  });

  test('MockDnsProvider handles record deletion cleanly', async () => {
    const provider = new MockDnsProvider();

    await provider.provisionRecord({
      hostname: 'srv-delete.viewduration.com',
      target: 'gateway.viewduration.com',
      type: 'CNAME'
    });

    const deleted = await provider.removeRecord('srv-delete.viewduration.com');
    assert.strictEqual(deleted.success, true);

    const exists = await provider.verifyRecord('srv-delete.viewduration.com');
    assert.strictEqual(exists, false);
  });

  test('EndpointService generates clean deterministic node hostnames with testing domain', () => {
    const hostname = EndpointService.generateHostname('srv_123456');
    assert.strictEqual(hostname, 'srv_123456.viewduration.com');
  });

  test('EndpointService allows seamless production domain substitution without code changes', () => {
    EndpointService.setBaseDomain('example-production-domain.test');

    const hostname = EndpointService.generateHostname('srv_production_99');
    assert.strictEqual(hostname, 'srv_production_99.example-production-domain.test');

    assert.strictEqual(
      EndpointService.validateHostname('srv_production_99.example-production-domain.test'),
      true
    );
  });

  test('EndpointService strictly validates hostname safety and rejects protocol prefixes and paths', () => {
    // Valid subdomains
    assert.strictEqual(EndpointService.validateHostname('srv-12345678.viewduration.com'), true);
    assert.strictEqual(EndpointService.validateHostname('node_device_1.viewduration.com'), true);

    // Invalid: protocol prefixes, slashes, spaces, trailing slashes, external domains
    assert.strictEqual(EndpointService.validateHostname('https://srv-123.viewduration.com'), false);
    assert.strictEqual(EndpointService.validateHostname('http://srv-123.viewduration.com'), false);
    assert.strictEqual(EndpointService.validateHostname('srv-123.viewduration.com/'), false);
    assert.strictEqual(EndpointService.validateHostname('srv-123.viewduration.com/path'), false);
    assert.strictEqual(EndpointService.validateHostname('srv 123.viewduration.com'), false);
    assert.strictEqual(EndpointService.validateHostname('evil-hacker.com'), false);
    assert.strictEqual(EndpointService.validateHostname('subdomain.otherdomain.net'), false);
  });
});
