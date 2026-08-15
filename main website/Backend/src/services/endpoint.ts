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
   * Generates a clean, deterministic remote endpoint hostname for a server instance.
   */
  static generateHostname(serverId: string): string {
    const cleanId = serverId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const shortHash = cleanId.substring(Math.max(0, cleanId.length - 8));
    return `node-${shortHash}.remotenode.net`;
  }

  /**
   * Reserves or retrieves an allocated remote endpoint for a ServerInstance.
   */
  static async reserveEndpoint(serverInstanceId: string) {
    const existing = await prisma.serverEndpoint.findFirst({
      where: { serverInstanceId, status: 'ACTIVE' }
    });

    if (existing) {
      return existing;
    }

    const hostname = this.generateHostname(serverInstanceId);

    // Provision record in DNS provider abstraction
    await this.dnsProvider.provisionRecord({
      hostname,
      target: 'gateway.remotenode.net',
      type: 'CNAME'
    });

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
