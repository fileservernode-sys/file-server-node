import { prisma } from '../config/database.js';
import { DnsProvider, MockDnsProvider } from './dns_provider.js';

/**
 * Service Abstraction for Remote Endpoint Subdomain & Hostname Allocation
 */
export class EndpointService {
  private static dnsProvider: DnsProvider = new MockDnsProvider();
  private static baseDomain: string = process.env.REMOTENODE_BASE_DOMAIN || 'viewduration.com';
  private static gatewayDomain: string =
    process.env.REMOTENODE_GATEWAY_DOMAIN || `gateway.${process.env.REMOTENODE_BASE_DOMAIN || 'viewduration.com'}`;

  static setDnsProvider(provider: DnsProvider): void {
    this.dnsProvider = provider;
  }

  static getDnsProvider(): DnsProvider {
    return this.dnsProvider;
  }

  static setBaseDomain(domain: string): void {
    this.baseDomain = domain;
    if (!process.env.REMOTENODE_GATEWAY_DOMAIN) {
      this.gatewayDomain = `gateway.${domain}`;
    }
  }

  static getBaseDomain(): string {
    return this.baseDomain;
  }

  static setGatewayDomain(domain: string): void {
    this.gatewayDomain = domain;
  }

  static getGatewayDomain(): string {
    return this.gatewayDomain;
  }

  /**
   * Validates that a hostname conforms strictly to a valid subdomain under the configured gateway or base domain.
   * Rejects path components, protocol prefixes, uppercase letters, invalid characters, and external domains.
   */
  static validateHostname(hostname: string, expectedDomain?: string): boolean {
    if (!hostname || typeof hostname !== 'string') return false;
    if (hostname.includes('://') || hostname.includes('/') || hostname.includes('\\') || hostname.includes(' ')) {
      return false;
    }

    const domain = expectedDomain || this.gatewayDomain;
    const escapedDomain = domain.replace(/\./g, '\\.');
    const hostnameRegex = new RegExp(`^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]\\.${escapedDomain}$`, 'i');

    if (hostnameRegex.test(hostname)) return true;

    // Fallback check against baseDomain if domain was not explicitly provided
    if (!expectedDomain && this.baseDomain !== this.gatewayDomain) {
      const escapedBase = this.baseDomain.replace(/\./g, '\\.');
      const baseRegex = new RegExp(`^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]\\.${escapedBase}$`, 'i');
      return baseRegex.test(hostname);
    }

    return false;
  }

  /**
   * Generates a clean, short, human-friendly remote endpoint hostname for a server instance.
   * e.g. node-a5qylx.viewduration.com (or srv-123456.gateway.viewduration.com)
   */
  static generateHostname(serverId: string, customDomain?: string): string {
    const domain = customDomain || this.baseDomain;
    const cleanId = serverId.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
    // If it's a long 25-char cuid, extract a clean 6-character short suffix
    const shortSlug =
      cleanId.length > 10
        ? `node-${cleanId.slice(-6)}`
        : cleanId.startsWith('srv') || cleanId.startsWith('node')
        ? cleanId
        : `node-${cleanId}`;
    return `${shortSlug}.${domain}`;
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
          target: this.gatewayDomain,
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
      target: this.gatewayDomain,
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
