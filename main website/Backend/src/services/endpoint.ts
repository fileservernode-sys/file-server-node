import { prisma } from '../config/database.js';
import { DnsProvider, MockDnsProvider } from './dns_provider.js';

/**
 * Service Abstraction for Remote Endpoint Subdomain & Hostname Allocation
 */
export class EndpointService {
  private static dnsProvider: DnsProvider = new MockDnsProvider();

  static setDnsProvider(provider: DnsProvider): void {
    this.dnsProvider = provider;
  }

  static getDnsProvider(): DnsProvider {
    return this.dnsProvider;
  }

  /**
   * Validates that a hostname conforms strictly to the expected *.remotenode.net format.
   * Rejects path components, protocol prefixes, uppercase letters, invalid characters, and external domains.
   */
  static validateHostname(hostname: string): boolean {
    if (!hostname || typeof hostname !== 'string') return false;
    if (hostname.includes('://') || hostname.includes('/') || hostname.includes('\\') || hostname.includes(' ')) {
      return false;
    }
    // Must strictly be a valid subdomain of remotenode.net (e.g. node-abc12345.remotenode.net)
    const hostnameRegex = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.remotenode\.net$/;
    return hostnameRegex.test(hostname);
  }

  /**
   * Generates a clean, deterministic remote endpoint hostname for a server instance.
   */
  static generateHostname(serverId: string): string {
    const cleanId = serverId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const shortHash = cleanId.substring(Math.max(0, cleanId.length - 8));
    const hostname = `node-${shortHash || 'default'}.remotenode.net`;
    return hostname;
  }

  /**
   * Reserves or retrieves an allocated remote endpoint for a ServerInstance.
   * Idempotent: repeated calls do not create duplicate DNS records or endpoints.
   */
  static async reserveEndpoint(serverInstanceId: string) {
    const existing = await prisma.serverEndpoint.findFirst({
      where: { serverInstanceId, status: 'ACTIVE' }
    });

    if (existing) {
      // Verify record exists in DNS provider
      const existsInDns = await this.dnsProvider.verifyRecord(existing.hostname);
      if (!existsInDns) {
        await this.dnsProvider.provisionRecord({
          hostname: existing.hostname,
          target: 'gateway.remotenode.net',
          type: 'CNAME'
        });
      }
      return existing;
    }

    const hostname = this.generateHostname(serverInstanceId);

    if (!this.validateHostname(hostname)) {
      throw new Error(`Generated invalid hostname format: ${hostname}`);
    }

    // Provision record in DNS provider abstraction
    const provisionRes = await this.dnsProvider.provisionRecord({
      hostname,
      target: 'gateway.remotenode.net',
      type: 'CNAME'
    });

    if (!provisionRes.success) {
      throw new Error(`Failed to provision DNS endpoint record: ${provisionRes.error || 'Unknown error'}`);
    }

    const endpoint = await prisma.serverEndpoint.create({
      data: {
        serverInstanceId,
        hostname,
        status: 'ACTIVE'
      }
    });

    await prisma.auditEvent.create({
      data: {
        eventType: 'SERVER_ENDPOINT_ALLOCATED',
        metadata: { serverInstanceId, endpointId: endpoint.id, hostname }
      }
    });

    return endpoint;
  }

  /**
   * Deactivates a reserved endpoint.
   */
  static async releaseEndpoint(endpointId: string) {
    const endpoint = await prisma.serverEndpoint.findUnique({
      where: { id: endpointId }
    });

    if (endpoint) {
      await this.dnsProvider.removeRecord(endpoint.hostname);
    }

    return prisma.serverEndpoint.update({
      where: { id: endpointId },
      data: { status: 'INACTIVE' }
    });
  }
}
