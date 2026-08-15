import { prisma } from '../config/database.js';

/**
 * Service Abstraction for Remote Endpoint Subdomain & Hostname Allocation
 * (Note: Production DNS provisioning deferred to future batches)
 */
export class EndpointService {

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
    return prisma.serverEndpoint.update({
      where: { id: endpointId },
      data: { status: 'INACTIVE' }
    });
  }
}
