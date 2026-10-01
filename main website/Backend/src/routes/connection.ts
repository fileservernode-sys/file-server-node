import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { EndpointService } from '../services/endpoint.js';
import { ConnectionStateMachine } from '../services/connection_state_machine.js';
import { ConnectionObservability } from '../observability/connection_observability.js';
import { ErrorIngestionService } from '../services/error_ingestion_service.js';
import { ConnectionStatus, ErrorSeverity } from '@prisma/client';
import { hashSessionToken } from '../utils/crypto.js';

const registerConnectionSchema = z.object({
  deviceId: z.string().min(1),
  gatewayNodeId: z.string().optional(),
  failedGatewayNodeId: z.string().optional()
});

const updateHeartbeatSchema = z.object({
  status: z.enum(['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'STALE', 'FAILED']).optional()
});

const connectionParamSchema = z.object({
  connectionId: z.string().min(1)
});

const reportTelemetryErrorSchema = z.object({
  component: z.string().max(64).default('ANDROID'),
  errorCode: z.string().max(128).optional(),
  errorType: z.string().max(128).optional(),
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']).optional(),
  message: z.string().min(1).max(4000),
  stackTrace: z.string().max(8000).optional(),
  occurredAt: z.string().optional(),
  deviceId: z.string().max(128).optional(),
  serverInstanceId: z.string().max(128).optional(),
  gatewayNodeId: z.string().max(128).optional(),
  connectionId: z.string().max(128).optional(),
  sessionId: z.string().max(128).optional(),
  requestId: z.string().max(128).optional(),
  metadata: z.record(z.any()).optional()
});

// Helper: Extract authenticated platform user
async function getAuthUser(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization Bearer header');
  }

  const token = authHeader.substring(7).trim();
  const tokenHash = hashSessionToken(token);
  const session = await prisma.userSession.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    include: { user: true }
  });

  if (!session || !session.user) {
    throw new UnauthorizedError('Session expired or invalid token');
  }

  return session.user;
}

export async function connectionRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/connections/register
   * Registers intent for outbound remote connection from an Android device
   * Supports deterministic gateway candidate selection and failed-node avoidance (Batch 11A.10)
   */
  app.post('/connections/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = registerConnectionSchema.safeParse(request.body);

    if (!body.success) {
      throw new ValidationError('deviceId is required to register a remote connection');
    }

    const { deviceId, gatewayNodeId, failedGatewayNodeId } = body.data;

    ConnectionObservability.emit({
      event: 'registration_started',
      component: 'backend_connection',
      outcome: 'started',
      deviceId,
      reason: failedGatewayNodeId ? 'gateway_failover' : 'initial_start'
    });

    const device = await prisma.device.findUnique({ where: { id: deviceId } });

    if (!device) {
      ConnectionObservability.emit({
        event: 'registration_failed',
        component: 'backend_connection',
        outcome: 'failed',
        errorCategory: 'device_not_owned',
        deviceId
      });
      throw new NotFoundError('Device node not found');
    }

    if (device.userId !== user.id) {
      ConnectionObservability.emit({
        event: 'auth_failed',
        component: 'backend_connection',
        outcome: 'failed',
        errorCategory: 'device_not_owned',
        deviceId
      });
      throw new ForbiddenError('You do not have permission to register connections for this device');
    }

    const serverInstance = await prisma.serverInstance.findFirst({ where: { deviceId } });
    let remoteEndpointStr = 'https://pending-allocation.remotenode.net';

    if (serverInstance) {
      const endpoint = await EndpointService.reserveEndpoint(serverInstance.id);
      remoteEndpointStr = `https://${endpoint.hostname}`;

      // Mark ServerInstance as RUNNING and record start timestamp
      await prisma.serverInstance.update({
        where: { id: serverInstance.id },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          lastHeartbeatAt: new Date()
        }
      });
    }

    // Resolve or discover active GatewayNode with deterministic failover candidate selection
    let selectedGateway = null;

    if (gatewayNodeId) {
      selectedGateway = await prisma.gatewayNode.findUnique({ where: { id: gatewayNodeId } });
    }

    if (!selectedGateway) {
      if (failedGatewayNodeId) {
        ConnectionObservability.emit({
          event: 'gateway_failover_started',
          component: 'backend_connection',
          outcome: 'started',
          reason: 'failover_candidate_search',
          deviceId,
          metadata: { failedGatewayNodeId }
        });

        // Attempt to select an alternative active gateway node first to avoid thrashing
        selectedGateway = await prisma.gatewayNode.findFirst({
          where: {
            status: 'ACTIVE',
            id: { not: failedGatewayNodeId }
          },
          orderBy: { lastHeartbeatAt: 'desc' }
        });
      }

      // If no alternative active gateway found, select any active gateway node
      if (!selectedGateway) {
        selectedGateway = await prisma.gatewayNode.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { lastHeartbeatAt: 'desc' }
        });
      }
    }

    const resolvedGatewayId = selectedGateway?.id ?? null;

    if (failedGatewayNodeId && selectedGateway) {
      ConnectionObservability.emit({
        event: 'gateway_failover_succeeded',
        component: 'backend_connection',
        outcome: 'success',
        deviceId,
        gatewayNodeId: selectedGateway.id,
        metadata: { failedGatewayNodeId, newGatewayNodeId: selectedGateway.id }
      });
    }

    // Atomic connection registration & stale connection reconciliation
    const now = new Date();
    const token = `conn-token-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

    const connection = await prisma.$transaction(async (tx) => {
      // Find existing connection records for this device
      const existingConns = await tx.deviceConnection.findMany({
        where: { deviceId },
        orderBy: { createdAt: 'desc' }
      });

      let targetConn = existingConns.length > 0 ? existingConns[0] : null;

      // If older/duplicate connection records exist, mark them as DISCONNECTED
      if (existingConns.length > 1) {
        const staleIds = existingConns.slice(1).map(c => c.id);
        await tx.deviceConnection.updateMany({
          where: { id: { in: staleIds } },
          data: {
            status: 'DISCONNECTED',
            disconnectedAt: now
          }
        });
      }

      if (targetConn) {
        targetConn = await tx.deviceConnection.update({
          where: { id: targetConn.id },
          data: {
            gatewayNodeId: resolvedGatewayId,
            connectionToken: token,
            remoteEndpoint: remoteEndpointStr,
            status: 'CONNECTING',
            lastHeartbeatAt: now,
            disconnectedAt: null
          }
        });
      } else {
        targetConn = await tx.deviceConnection.create({
          data: {
            deviceId,
            gatewayNodeId: resolvedGatewayId,
            connectionToken: token,
            remoteEndpoint: remoteEndpointStr,
            status: 'CONNECTING',
            lastHeartbeatAt: now
          }
        });
      }

      await tx.auditEvent.create({
        data: {
          userId: user.id,
          deviceId,
          eventType: 'REMOTE_CONNECTION_CREATED',
          metadata: { connectionId: targetConn.id, remoteEndpoint: remoteEndpointStr, gatewayNodeId: resolvedGatewayId }
        }
      });

      return targetConn;
    });

    let assignedHostname = '';
    if (serverInstance) {
      const activeEp = await prisma.serverEndpoint.findFirst({
        where: { serverInstanceId: serverInstance.id, status: 'ACTIVE' }
      });
      if (activeEp) {
        assignedHostname = activeEp.hostname;
      }
    }

    const gatewayWsUrl = selectedGateway?.hostname
      ? (selectedGateway.hostname.startsWith('ws://') || selectedGateway.hostname.startsWith('wss://')
          ? selectedGateway.hostname
          : `wss://${selectedGateway.hostname}/tunnel`)
      : undefined;

    ConnectionObservability.emit({
      event: 'registration_succeeded',
      component: 'backend_connection',
      outcome: 'success',
      deviceId: connection.deviceId,
      connectionId: connection.id,
      gatewayNodeId: connection.gatewayNodeId ?? undefined,
      newState: 'CONNECTING'
    });

    return reply.status(200).send(createSuccessResponse({
      connection: {
        id: connection.id,
        deviceId: connection.deviceId,
        gatewayNodeId: connection.gatewayNodeId,
        connectionToken: connection.connectionToken,
        remoteEndpoint: connection.remoteEndpoint,
        hostname: assignedHostname,
        publicUrl: remoteEndpointStr,
        gatewayWsUrl,
        gatewayNode: selectedGateway ? {
          id: selectedGateway.id,
          hostname: selectedGateway.hostname,
          region: selectedGateway.region,
          status: selectedGateway.status
        } : null,
        status: connection.status,
        createdAt: connection.createdAt.toISOString()
      }
    }));
  });

  /**
   * POST /api/v1/connections/:connectionId/heartbeat
   * Reports heartbeat and status state transitions for remote connection
   */
  app.post('/connections/:connectionId/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = connectionParamSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid connectionId parameter');
    }

    const connectionId = params.data.connectionId;
    const connection = await prisma.deviceConnection.findUnique({
      where: { id: connectionId },
      include: { device: true }
    });

    if (!connection) {
      throw new NotFoundError('Remote connection record not found');
    }

    if (connection.device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to manage this remote connection');
    }

    const body = updateHeartbeatSchema.safeParse(request.body);
    const newStatus = body.success && body.data.status ? (body.data.status as ConnectionStatus) : connection.status;
    const now = new Date();

    const transitionResult = await ConnectionStateMachine.transition({
      connectionId,
      nextStatus: newStatus,
      eventSource: 'HEARTBEAT_UPDATE',
      timestamp: now
    });

    return reply.status(200).send(createSuccessResponse({
      connectionId,
      status: transitionResult.currentStatus,
      lastHeartbeatAt: now.toISOString(),
      applied: transitionResult.applied
    }));
  });

  /**
   * POST /api/v1/connections/:connectionId/disconnect
   * Gracefully disconnects a remote connection
   */
  app.post('/connections/:connectionId/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = connectionParamSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid connectionId parameter');
    }

    const connectionId = params.data.connectionId;
    const connection = await prisma.deviceConnection.findUnique({
      where: { id: connectionId },
      include: { device: true }
    });

    if (!connection) {
      throw new NotFoundError('Remote connection record not found');
    }

    if (connection.device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to manage this remote connection');
    }

    const now = new Date();
    const transitionResult = await ConnectionStateMachine.transition({
      connectionId,
      nextStatus: ConnectionStatus.DISCONNECTED,
      eventSource: 'DISCONNECT_EXPLICIT',
      timestamp: now
    });

    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        deviceId: connection.deviceId,
        eventType: 'REMOTE_CONNECTION_DISCONNECTED',
        metadata: { connectionId }
      }
    });

    return reply.status(200).send(createSuccessResponse({
      connectionId,
      status: transitionResult.currentStatus,
      disconnectedAt: now.toISOString()
    }));
  });

  /**
   * GET /api/v1/connections/:connectionId
   * Retrieves current status and metrics for a remote connection
   */
  app.get('/connections/:connectionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = connectionParamSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid connectionId parameter');
    }

    const connectionId = params.data.connectionId;
    const connection = await prisma.deviceConnection.findUnique({
      where: { id: connectionId },
      include: { device: true }
    });

    if (!connection) {
      throw new NotFoundError('Remote connection record not found');
    }

    if (connection.device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to view this remote connection');
    }

    const serverInst = await prisma.serverInstance.findFirst({
      where: { deviceId: connection.deviceId },
      include: { endpoints: true }
    });
    const activeEp = serverInst?.endpoints.find(e => e.status === 'ACTIVE');

    return reply.status(200).send(createSuccessResponse({
      connection: {
        id: connection.id,
        deviceId: connection.deviceId,
        status: connection.status,
        remoteEndpoint: connection.remoteEndpoint,
        hostname: activeEp?.hostname ?? '',
        publicUrl: connection.remoteEndpoint ?? (activeEp ? `https://${activeEp.hostname}` : null),
        connectedAt: connection.connectedAt?.toISOString(),
        disconnectedAt: connection.disconnectedAt?.toISOString(),
        lastHeartbeatAt: connection.lastHeartbeatAt?.toISOString()
      }
    }));
  });

  /**
   * POST /api/v1/connections/telemetry/errors
   * Authenticated, rate-limited endpoint for Android edge and native client operational error telemetry.
   * Ingests error telemetry directly into ErrorIngestionService (Phase 12.7).
   */
  app.post(
    '/connections/telemetry/errors',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const parsed = reportTelemetryErrorSchema.safeParse(request.body);

      if (!parsed.success) {
        throw new ValidationError('Invalid telemetry error payload format');
      }

      const data = parsed.data;

      // Fail-safe ingestion
      try {
        const component = (data.component || 'ANDROID').toUpperCase().trim();
        const severity = data.severity ? (data.severity as ErrorSeverity) : ErrorSeverity.WARNING;

        await ErrorIngestionService.getInstance().ingest({
          component,
          severity,
          errorCode: data.errorCode || 'ANDROID_RUNTIME_ERROR',
          errorType: data.errorType || 'AndroidClientException',
          message: data.message,
          stackTrace: data.stackTrace,
          occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
          userId: user.id,
          deviceId: data.deviceId,
          serverInstanceId: data.serverInstanceId,
          gatewayNodeId: data.gatewayNodeId,
          connectionId: data.connectionId,
          sessionId: data.sessionId,
          requestId: data.requestId || (request as any).requestId,
          metadata: {
            ...data.metadata,
            source: 'android_telemetry_client',
            authenticatedUserId: user.id
          }
        });

        return reply.status(200).send(createSuccessResponse({ ingested: true }));
      } catch (err: any) {
        // Telemetry failure is fail-safe; returns clean failure acknowledgment without leaking stack traces
        return reply.status(200).send(createSuccessResponse({ ingested: false }));
      }
    }
  );
}
