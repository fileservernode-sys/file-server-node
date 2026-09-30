import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse } from '../schemas/response.js';
import { ValidationError } from '../errors/app-error.js';

const gatewayHeartbeatSchema = z.object({
  gatewayId: z.string().optional(),
  hostname: z.string().min(1),
  region: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).default('ACTIVE')
});

export async function gatewayRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/gateway/heartbeat
   * Gateway Node Registration & Heartbeat Probe (Vendor-Neutral Control Plane API)
   */
  app.post('/gateway/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = gatewayHeartbeatSchema.safeParse(request.body);

    if (!body.success) {
      throw new ValidationError('hostname is required for gateway heartbeat');
    }

    const { gatewayId, hostname, region, status } = body.data;
    const now = new Date();

    let gatewayNode;
    if (gatewayId) {
      gatewayNode = await prisma.gatewayNode.upsert({
        where: { id: gatewayId },
        update: { hostname, region, status, lastHeartbeatAt: now },
        create: { id: gatewayId, hostname, region, status, lastHeartbeatAt: now }
      });
    } else {
      const existing = await prisma.gatewayNode.findUnique({ where: { hostname } });
      if (existing) {
        gatewayNode = await prisma.gatewayNode.update({
          where: { id: existing.id },
          data: { region, status, lastHeartbeatAt: now }
        });
      } else {
        gatewayNode = await prisma.gatewayNode.create({
          data: { hostname, region, status, lastHeartbeatAt: now }
        });
      }
    }

    return reply.status(200).send(createSuccessResponse({
      gatewayNode: {
        id: gatewayNode.id,
        hostname: gatewayNode.hostname,
        region: gatewayNode.region,
        status: gatewayNode.status,
        lastHeartbeatAt: gatewayNode.lastHeartbeatAt?.toISOString()
      }
    }));
  });

  /**
   * POST /api/v1/gateway/reconciliation/run
   * Manually trigger an on-demand state reconciliation cycle
   */
  app.post('/gateway/reconciliation/run', async (request: FastifyRequest, reply: FastifyReply) => {
    const { StateReconciliationService } = await import('../observability/state_reconciliation.js');
    const { defaultGatewayService } = await import('../gateway/gateway_service.js');
    
    const config = defaultGatewayService.getConfig();
    const result = await StateReconciliationService.runReconciliationCycle(
      config.GATEWAY_NODE_ID,
      new Set(), // Active connection set if invoked externally
      config.GATEWAY_NODE_HOSTNAME,
      config.GATEWAY_NODE_STALE_THRESHOLD_MS,
      config.GATEWAY_CONNECTION_STALE_THRESHOLD_MS
    );

    return reply.status(200).send(createSuccessResponse({
      reconciliation: result
    }));
  });

  /**
   * GET /api/v1/gateway/reconciliation/metrics
   * Retrieves live metrics & counters from the state reconciliation subsystem
   */
  app.get('/gateway/reconciliation/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const { StateReconciliationService } = await import('../observability/state_reconciliation.js');
    const metrics = StateReconciliationService.getReconciliationMetrics();

    return reply.status(200).send(createSuccessResponse({
      metrics
    }));
  });
}

