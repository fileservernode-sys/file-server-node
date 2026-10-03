import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { defaultGatewayService } from '../gateway/gateway_service.js';
import { getAuthUser } from '../middleware/customer-auth.js';
import {
  fileManagerStandardRateLimitConfig,
  fileManagerMutationRateLimitConfig,
  fileManagerDownloadRateLimitConfig,
  authStrictRateLimitConfig
} from '../middleware/rate_limit_presets.js';

const serverIdParamSchema = z.object({
  serverId: z.string().min(1)
});

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

  // 3. Verify gateway has the live WebSocket for this device
  const hasGatewayConnection = defaultGatewayService.hasActiveConnectionForDevice(device.id);

  // 4. Resolve active DeviceConnection
  const activeConnection = await prisma.deviceConnection.findFirst({
    where: {
      deviceId: device.id,
      status: 'CONNECTED'
    },
    orderBy: { connectedAt: 'desc' }
  });

  if (!hasGatewayConnection) {
    return { serverInstance, device, activeConnectionId: activeConnection?.id || null, offline: true };
  }

  // Self-heal serverInstance status if live WebSocket connection exists
  if (serverInstance.status !== 'RUNNING') {
    await prisma.serverInstance.update({
      where: { id: serverInstance.id },
      data: { status: 'RUNNING', lastHeartbeatAt: new Date() }
    }).catch(() => {});
  }

  // 5. Perform end-to-end HEALTH probe to verify real Android connection
  try {
    const probe = await defaultGatewayService.handleProxiedFileRequestByDeviceId(device.id, 'HEALTH', {});
    if (!probe || probe.success === false) {
      console.warn(`[FILE_MANAGER] Health probe failed for deviceId=${device.id}`);
      return { serverInstance, device, activeConnectionId: activeConnection?.id || null, offline: true };
    }
  } catch (err) {
    console.warn(`[FILE_MANAGER] Health probe error for deviceId=${device.id}:`, err);
    return { serverInstance, device, activeConnectionId: activeConnection?.id || null, offline: true };
  }

  return {
    serverInstance,
    device,
    activeConnectionId: activeConnection?.id || null,
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
    dataBase64?: string;
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
   * Authenticates the ZdexCloud session, verifies server ownership,
   * checks real-time connectivity, and returns safe server metadata.
   * NEVER returns adminPasswordHash or any credential secret.
   */
  app.get(
    '/file-manager/:serverId/access',
    {
      config: {
        rateLimit: fileManagerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.get(
    '/file-manager/:serverId/storage',
    {
      config: {
        rateLimit: fileManagerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.get(
    '/file-manager/:serverId/files/recent',
    {
      config: {
        rateLimit: fileManagerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.get(
    '/file-manager/:serverId/files',
    {
      config: {
        rateLimit: fileManagerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.delete(
    '/file-manager/:serverId/files',
    {
      config: {
        rateLimit: fileManagerMutationRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!body.path || typeof body.path !== 'string') {
      throw new ValidationError('path is required');
    }

    if (body.path.includes('..') || body.path.includes('\0')) {
      return reply.status(403).send(createErrorResponse('FORBIDDEN', 'Invalid path traversal detected'));
    }

    const result = await proxyToGateway(device.id, 'DELETE', { path: body.path });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * POST /api/v1/file-manager/:serverId/folders
   * Proxies a CREATE_FOLDER operation.
   * Accepts JSON body: { path: string, name: string }
   */
  app.post(
    '/file-manager/:serverId/folders',
    {
      config: {
        rateLimit: fileManagerMutationRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    const folderName = typeof body.name === 'string' ? body.name.trim() : '';
    if (!folderName || folderName === '.' || folderName === '..' || folderName.includes('/') || folderName.includes('\\') || folderName.includes('\0') || folderName.length > 255) {
      return reply.status(400).send(createErrorResponse('INVALID_FOLDER_NAME', 'Folder name cannot be empty, contain path separators, or exceed 255 characters'));
    }

    const parentPath = typeof body.path === 'string' ? body.path : '/';
    if (parentPath.includes('..') || parentPath.includes('\0')) {
      return reply.status(403).send(createErrorResponse('FORBIDDEN', 'Invalid path traversal detected'));
    }

    const result = await proxyToGateway(device.id, 'CREATE_FOLDER', {
      path: parentPath,
      name: folderName
    });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * POST /api/v1/file-manager/:serverId/rename
   * Proxies a RENAME operation.
   * Accepts JSON body: { oldPath: string, newName: string }
   */
  app.post(
    '/file-manager/:serverId/rename',
    {
      config: {
        rateLimit: fileManagerMutationRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!body.oldPath || !body.newName || typeof body.oldPath !== 'string' || typeof body.newName !== 'string') {
      throw new ValidationError('oldPath and newName are required');
    }

    const newName = body.newName.trim();
    if (!newName || newName === '.' || newName === '..' || newName.includes('/') || newName.includes('\\') || newName.includes('\0') || newName.length > 255) {
      return reply.status(400).send(createErrorResponse('INVALID_NAME', 'New name cannot be empty, contain path separators, or exceed 255 characters'));
    }

    if (body.oldPath.includes('..') || body.oldPath.includes('\0')) {
      return reply.status(403).send(createErrorResponse('FORBIDDEN', 'Invalid path traversal detected'));
    }

    const result = await proxyToGateway(device.id, 'RENAME', {
      oldPath: body.oldPath,
      newName
    });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * POST /api/v1/file-manager/:serverId/upload
   * Proxies an UPLOAD initiation to the Android device.
   * Accepts JSON body: { path: string, name: string, dataBase64?: string }
   */
  app.post(
    '/file-manager/:serverId/upload',
    {
      config: {
        rateLimit: fileManagerMutationRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const body = request.body as Record<string, any> || {};
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!body.name || typeof body.name !== 'string') {
      throw new ValidationError('name is required for upload');
    }

    const rawName = body.name.trim();
    if (!rawName || rawName === '.' || rawName === '..' || rawName.includes('/') || rawName.includes('\\') || rawName.includes('\0') || rawName.length > 255) {
      throw new ValidationError('Invalid upload filename: path separators and control characters are prohibited, and length cannot exceed 255 characters');
    }

    const rawPath = typeof body.path === 'string' ? body.path : '/';
    if (rawPath.includes('..') || rawPath.includes('\0')) {
      return reply.status(403).send(createErrorResponse('FORBIDDEN', 'Invalid path traversal detected'));
    }

    const result = await proxyToGateway(device.id, 'UPLOAD', {
      path: rawPath,
      name: rawName,
      dataBase64: body.dataBase64
    });
    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * GET /api/v1/file-manager/:serverId/download
   * Proxies a file download / media stream through the gateway.
   * Accepts query params: ?path=<filePath>&download=true|false
   */
  app.get(
    '/file-manager/:serverId/download',
    {
      config: {
        rateLimit: fileManagerDownloadRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverIdParamSchema.safeParse(request.params);
    if (!params.success) throw new ValidationError('Invalid server ID');

    const { serverId } = params.data;
    const query = request.query as Record<string, string>;
    const { device, offline } = await resolveAuthorisedServer(serverId, user.id);

    if (offline) {
      return reply.status(503).send(createErrorResponse('SERVER_OFFLINE', 'Android device is currently offline or disconnected'));
    }

    if (!query.path || typeof query.path !== 'string') {
      throw new ValidationError('path query parameter is required');
    }

    if (query.path.includes('..') || query.path.includes('\0')) {
      return reply.status(403).send(createErrorResponse('FORBIDDEN', 'Invalid path traversal detected'));
    }

    const result = await proxyToGateway(device.id, 'DOWNLOAD', { path: query.path });

    if (result?.success && typeof result?.dataBase64 === 'string') {
      const buffer = Buffer.from(result.dataBase64, 'base64');
      const filename = result.filename || query.path.split('/').pop() || 'download';
      let mimeType = result.mimeType;

      if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext === 'mp4') mimeType = 'video/mp4';
        else if (ext === 'webm') mimeType = 'video/webm';
        else if (ext === 'mov') mimeType = 'video/quicktime';
        else if (ext === 'mkv') mimeType = 'video/x-matroska';
        else if (ext === 'mp3') mimeType = 'audio/mpeg';
        else if (ext === 'wav') mimeType = 'audio/wav';
        else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        else if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'webp') mimeType = 'image/webp';
        else mimeType = 'application/octet-stream';
      }

      const isDownloadAttachment = query.download === 'true' || query.download === '1';
      const dispositionType = isDownloadAttachment ? 'attachment' : 'inline';

      reply
        .header('Content-Type', mimeType)
        .header('Content-Disposition', `${dispositionType}; filename="${encodeURIComponent(filename)}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Accept-Ranges', 'bytes');

      const rangeHeader = request.headers.range;
      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const rangeSpec = rangeHeader.substring(6).trim();
        const parts = rangeSpec.split('-');
        let start = parseInt(parts[0], 10);
        if (isNaN(start) || start < 0) start = 0;
        let end = parts[1] && parts[1].length > 0 ? parseInt(parts[1], 10) : buffer.length - 1;
        if (isNaN(end) || end < 0) end = buffer.length - 1;

        if (start > end || start >= buffer.length) {
          return reply
            .status(416)
            .header('Content-Range', `bytes */${buffer.length}`)
            .header('X-Content-Type-Options', 'nosniff')
            .send();
        }
        if (end >= buffer.length) end = buffer.length - 1;
        const chunk = buffer.subarray(start, end + 1);
        return reply
          .status(206)
          .header('Content-Range', `bytes ${start}-${end}/${buffer.length}`)
          .header('Content-Length', chunk.length)
          .header('X-Content-Type-Options', 'nosniff')
          .send(chunk);
      }

      return reply
        .header('Content-Length', buffer.length)
        .send(buffer);
    }

    return reply.status(result?.success === false ? 400 : 200).send(result);
  });

  /**
   * POST /api/v1/file-manager/:serverId/auth/login
   * Proxies file-server credential authentication.
   * Accepts JSON body: { username: string, password: string }
   * Used when the Android file server requires its own login.
   * NEVER stores the password — only proxies it to Android for verification.
   * Returns a file-server session token (not the ZdexCloud token).
   */
  app.post(
    '/file-manager/:serverId/auth/login',
    {
      config: {
        rateLimit: authStrictRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
