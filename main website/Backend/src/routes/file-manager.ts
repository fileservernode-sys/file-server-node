import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { defaultGatewayService } from '../gateway/gateway_service.js';

const serverIdParamSchema = z.object({
  serverId: z.string().min(1)
});

// ---------------------------------------------------------------------------
// Helper: Resolve authenticated ViewDuration user from Bearer token
// ---------------------------------------------------------------------------
async function getAuthUser(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization Bearer header');
  }
  const token = authHeader.substring(7).trim();
  const session = await prisma.userSession.findFirst({
    where: { token, expiresAt: { gt: new Date() } },
    include: { user: true }
  });
  if (!session || !session.user) {
    throw new UnauthorizedError('Session expired or invalid token');
  }
  return session.user;
}

// ---------------------------------------------------------------------------
// Helper: Resolve and authorise a server + active device connection
// Returns { serverInstance, device, activeConnectionId }
// ---------------------------------------------------------------------------
async function resolveAuthorisedServer(serverId: string, userId: string) {
  // 1. Find the ServerInstance
  const serverInstance = await prisma.serverInstance.findUnique({
    where: { id: serverId },
    include: { device: true }
  });

  if (!serverInstance) {
    throw new NotFoundError('Server not found');
  }

  // 2. Ownership check: ServerInstance → Device → User
  const device = serverInstance.device;
  if (device.userId !== userId) {
    throw new ForbiddenError('You do not have permission to access this server');
  }

  // 3. Server must be RUNNING
  if (serverInstance.status !== 'RUNNING') {
    return { serverInstance, device, activeConnectionId: null, offline: true };
  }

  // 4. Resolve an active DeviceConnection
  const activeConnection = await prisma.deviceConnection.findFirst({
    where: {
      deviceId: device.id,
      status: 'CONNECTED'
    },
    orderBy: { connectedAt: 'desc' }
  });

  // 5. Verify gateway has the live WebSocket for this device
  const hasGatewayConnection = defaultGatewayService.hasActiveConnectionForDevice(device.id);

  if (!activeConnection || !hasGatewayConnection) {
    return { serverInstance, device, activeConnectionId: null, offline: true };
  }

  return {
    serverInstance,
    device,
    activeConnectionId: activeConnection.id,
    offline: false
  };
}

// ---------------------------------------------------------------------------
// Helper: Send a file operation to Android via gateway and return response
// ---------------------------------------------------------------------------
async function proxyToGateway(
  deviceId: string,
  operation: string,
  params: {
    path?: string;
    name?: string;
    oldPath?: string;
    newName?: string;
  } = {}
): Promise<any> {
  return defaultGatewayService.handleProxiedFileRequestByDeviceId(deviceId, operation, params);
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------
export async function fileManagerRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/file-manager/:serverId/access
   * Authenticates the ViewDuration session, verifies server ownership,
   * checks real-time connectivity, and returns safe server metadata.
   * NEVER returns adminPasswordHash or any credential secret.
   */
  app.get('/file-manager/:serverId/access', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const { serverInstance, device, offline } = await resolveAuthorisedServer(serverId, user.id);

    return reply.status(200).send(createSuccessResponse({
      ok: !offline,
      serverId: serverInstance.id,
      serverName: serverInstance.serverName || device.deviceName,
      adminUsername: serverInstance.adminUsername || null,
      status: serverInstance.status,
      deviceName: device.deviceName,
      platform: device.platform,
      online: !offline
    }));
  });

  /**
   * GET /api/v1/file-manager/:serverId/storage
   * Proxies a STORAGE operation to the Android device via the gateway.
   */
  app.get('/file-manager/:serverId/storage', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    const result = await proxyToGateway(device.id, 'STORAGE', {});
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * GET /api/v1/file-manager/:serverId/files/recent
   * Proxies a RECENT operation to the Android device via the gateway.
   */
  app.get('/file-manager/:serverId/files/recent', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    const result = await proxyToGateway(device.id, 'RECENT', {});
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * GET /api/v1/file-manager/:serverId/files
   * Proxies a LIST operation for file/folder browsing.
   * Accepts query params: ?path=/ and ?type=photos|videos
   */
  app.get('/file-manager/:serverId/files', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const query = request.query as Record<string, string>;
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    const pathParam = query.path || '/';
    const typeFilter = query.type || null;

    // Determine operation based on type filter
    let operation = 'LIST';
    if (typeFilter === 'photos') operation = 'PHOTOS';
    else if (typeFilter === 'videos') operation = 'VIDEOS';

    const result = await proxyToGateway(device.id, operation, { path: pathParam, name: typeFilter || undefined });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * DELETE /api/v1/file-manager/:serverId/files
   * Proxies a DELETE operation.
   * Accepts JSON body: { path: string }
   */
  app.delete('/file-manager/:serverId/files', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!body.path) {
      throw new ValidationError('path is required');
    }

    const result = await proxyToGateway(device.id, 'DELETE', { path: body.path });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * POST /api/v1/file-manager/:serverId/folders
   * Proxies a CREATE_FOLDER operation.
   * Accepts JSON body: { path: string, name: string }
   */
  app.post('/file-manager/:serverId/folders', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    const result = await proxyToGateway(device.id, 'CREATE_FOLDER', {
      path: body.path || '/',
      name: body.name
    });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * POST /api/v1/file-manager/:serverId/rename
   * Proxies a RENAME operation.
   * Accepts JSON body: { oldPath: string, newName: string }
   */
  app.post('/file-manager/:serverId/rename', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!body.oldPath || !body.newName) {
      throw new ValidationError('oldPath and newName are required');
    }

    const result = await proxyToGateway(device.id, 'RENAME', {
      oldPath: body.oldPath,
      newName: body.newName
    });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * POST /api/v1/file-manager/:serverId/upload
   * Proxies an UPLOAD initiation to the Android device.
   * The actual file data streaming uses the gateway WebSocket directly.
   * This endpoint authenticates, verifies ownership, and returns connection info
   * needed by the frontend to initiate the upload transfer.
   * Accepts JSON body: { path: string, name: string, size?: number }
   */
  app.post('/file-manager/:serverId/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!body.name) {
      throw new ValidationError('name is required for upload');
    }

    const result = await proxyToGateway(device.id, 'UPLOAD', {
      path: body.path || '/',
      name: body.name
    });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * GET /api/v1/file-manager/:serverId/download
   * Proxies a file download through the gateway.
   * Accepts query param: ?path=<filePath>
   */
  app.get('/file-manager/:serverId/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const query = request.query as Record<string, string>;
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!query.path) {
      throw new ValidationError('path query parameter is required');
    }

    // For download, we proxy the request and let the gateway handle streaming
    const result = await proxyToGateway(device.id, 'DOWNLOAD', { path: query.path });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * POST /api/v1/file-manager/:serverId/auth/login
   * Proxies file-server credential authentication.
   * Accepts JSON body: { username: string, password: string }
   * Used when the Android file server requires its own login.
   * NEVER stores the password — only proxies it to Android for verification.
   * Returns a file-server session token (not the ViewDuration token).
   */
  app.post('/file-manager/:serverId/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!body.username || !body.password) {
      throw new ValidationError('username and password are required');
    }

    // Proxy the login request to the Android server via gateway
    // The Android server validates the credentials and returns a token
    const result = await proxyToGateway(device.id, 'AUTH_LOGIN', {
      name: body.username,
      path: body.password  // Reusing path field for password — gateway passes it as-is
    });

    // Log the auth event (without password)
    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        deviceId: device.id,
        eventType: result?.success ? 'FILE_MANAGER_LOGIN_SUCCESS' : 'FILE_MANAGER_LOGIN_FAILED'
      }
    });

    return reply.status(result?.success === false ? 401 : 200).send(result);
  });
}
