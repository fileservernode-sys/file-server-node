import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CameraStatus, CameraEndpointStatus, CameraUsageCategory } from '@prisma/client';
import { getAuthUser } from '../middleware/customer-auth.js';
import {
  expensiveCustomerRateLimitConfig,
  customerStandardRateLimitConfig
} from '../middleware/rate_limit_presets.js';
import { createSuccessResponse } from '../schemas/response.js';
import { ValidationError } from '../errors/app-error.js';
import { resolveClientIp } from '../utils/ip.js';
import { CameraService } from '../services/camera_service.js';
import { CameraDeviceIdentityService } from '../services/camera_device_identity_service.js';
import { CameraLifecycleService } from '../services/camera_lifecycle_service.js';
import { defaultCameraSignalingService } from '../services/camera_signaling_service.js';

// Input Validation Schemas
const registerCameraSchema = z.object({
  cameraName: z.string().trim().min(1, 'Camera name cannot be empty').max(64, 'Camera name must be 64 characters or fewer').optional(),
  deviceId: z.string().min(1).optional(),
  installationId: z.string().min(8).max(128).optional(),
  resolution: z.enum(['360p', '480p', '720p', '1080p']).optional(),
  fps: z.number().int().min(5).max(30).optional(),
  audioEnabled: z.boolean().optional(),
  lensFacing: z.enum(['BACK', 'FRONT', 'back', 'front']).optional().transform(v => v ? v.toUpperCase() : undefined),
  metadata: z.record(z.any()).optional()
});

const associateDeviceSchema = z.object({
  deviceId: z.string().min(1).optional(),
  installationId: z.string().min(8).max(128).optional()
}).refine(data => data.deviceId || data.installationId, {
  message: 'Either deviceId or installationId must be provided'
});

const consumePairingChallengeSchema = z.object({
  pairingChallengeToken: z.string().min(1, 'Pairing challenge token is required'),
  installationId: z.string().min(8).max(128, 'Valid installationId is required'),
  deviceName: z.string().trim().min(1).max(64),
  platform: z.string().optional(),
  osVersion: z.string().optional(),
  appVersion: z.string().optional()
});

const updateCameraConfigSchema = z.object({
  cameraName: z.string().trim().min(1, 'Camera name cannot be empty').max(64, 'Camera name must be 64 characters or fewer').optional(),
  resolution: z.enum(['360p', '480p', '720p', '1080p']).optional(),
  fps: z.number().int().min(5).max(30).optional(),
  audioEnabled: z.boolean().optional(),
  lensFacing: z.enum(['BACK', 'FRONT', 'back', 'front']).optional().transform(v => v ? v.toUpperCase() : undefined),
  metadata: z.record(z.any()).optional()
});

const cameraIdParamSchema = z.object({
  cameraId: z.string().min(1, 'Valid cameraId is required')
});

const cameraHeartbeatSchema = z.object({
  deviceId: z.string().min(1).optional(),
  status: z.nativeEnum(CameraStatus).optional(),
  endpointStatus: z.nativeEnum(CameraEndpointStatus).optional(),
  reportedAt: z.string().datetime({ offset: true }).optional(),
  confirmedCommand: z.enum(['START', 'STOP']).optional(),
  commandId: z.string().min(1).max(128).optional(),
  commandRequestedAt: z.string().datetime({ offset: true }).optional(),
  errorCode: z.string().trim().min(1).max(64).optional(),
  errorMessage: z.string().trim().min(1).max(500).optional()
});

const cameraLifecycleReportSchema = z.object({
  deviceId: z.string().min(1).optional(),
  status: z.nativeEnum(CameraStatus),
  reason: z.string().trim().min(1).max(255).optional(),
  errorCode: z.string().trim().min(1).max(64).optional(),
  errorMessage: z.string().trim().min(1).max(500).optional(),
  confirmedCommand: z.enum(['START', 'STOP']).optional(),
  commandId: z.string().min(1).max(128).optional(),
  commandRequestedAt: z.string().datetime({ offset: true }).optional(),
  reportedAt: z.string().datetime({ offset: true }).optional()
});

const listCamerasQuerySchema = z.object({
  status: z.nativeEnum(CameraStatus).optional(),
  deviceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional()
});

const usageQuerySchema = z.object({
  category: z.nativeEnum(CameraUsageCategory).optional(),
  from: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional()
});

export async function cameraRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/cameras
   * Registers a new CameraInstance under the authenticated platform account.
   * Enforces device ownership, authoritative camera entitlements, and quotas.
   */
  app.post(
    '/cameras',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const parseResult = registerCameraSchema.safeParse(request.body);

      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors.map(e => e.message).join(', '));
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const camera = await CameraService.registerCamera(
        user.id,
        parseResult.data,
        { ip: clientIp, userAgent }
      );

      return reply.status(201).send(createSuccessResponse({ camera }));
    }
  );

  /**
   * GET /api/v1/cameras
   * Lists all CameraInstances owned by the authenticated account.
   * Supports pagination and filtering by status and deviceId.
   */
  app.get(
    '/cameras',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const parseResult = listCamerasQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors.map(e => e.message).join(', '));
      }

      const result = await CameraService.listCameras(user.id, parseResult.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/cameras/usage
   * Account-wide usage retrieval using the CameraUsageRecord foundation.
   * (Registered before :cameraId to avoid route collision).
   */
  app.get(
    '/cameras/usage',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const parseResult = usageQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors.map(e => e.message).join(', '));
      }

      const result = await CameraService.getUsageRecords(user.id, parseResult.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/cameras/:cameraId
   * Retrieves detailed metadata and status for a specific CameraInstance.
   * Fails closed with 404 on unowned or non-existent cameras.
   */
  app.get(
    '/cameras/:cameraId',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);

      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const camera = await CameraService.getCameraDetails(user.id, params.data.cameraId);
      return reply.status(200).send(createSuccessResponse({ camera }));
    }
  );

  /**
   * PATCH /api/v1/cameras/:cameraId
   * Updates supported configuration preferences for a CameraInstance.
   */
  app.patch(
    '/cameras/:cameraId',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const body = updateCameraConfigSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map(e => e.message).join(', '));
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await CameraService.updateCameraConfig(
        user.id,
        params.data.cameraId,
        body.data,
        { ip: clientIp, userAgent }
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/cameras/:cameraId/start
   * Submits a start streaming request for the CameraInstance.
   */
  app.post(
    '/cameras/:cameraId/start',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await CameraService.requestStartCamera(
        user.id,
        params.data.cameraId,
        { ip: clientIp, userAgent }
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/cameras/:cameraId/stop
   * Submits a stop streaming request for the CameraInstance.
   */
  app.post(
    '/cameras/:cameraId/stop',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await CameraService.requestStopCamera(
        user.id,
        params.data.cameraId,
        { ip: clientIp, userAgent }
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/cameras/:cameraId/heartbeat
   * Device-credential-only endpoint for recording Android Camera heartbeats and resolving pending commands.
   */
  app.post(
    '/cameras/:cameraId/heartbeat',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const parsed = cameraHeartbeatSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors.map(e => e.message).join(', ') || 'Invalid heartbeat payload');
      }

      const authDevice = await CameraLifecycleService.authenticateDeviceRequest(request, {
        expectedDeviceId: parsed.data.deviceId
      });

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] || null;

      const result = await CameraLifecycleService.recordCameraHeartbeat({
        cameraId: params.data.cameraId,
        authDevice,
        status: parsed.data.status,
        endpointStatus: parsed.data.endpointStatus,
        reportedAt: parsed.data.reportedAt,
        confirmedCommand: parsed.data.confirmedCommand,
        commandId: parsed.data.commandId,
        commandRequestedAt: parsed.data.commandRequestedAt,
        errorCode: parsed.data.errorCode,
        errorMessage: parsed.data.errorMessage,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(
        createSuccessResponse({
          cameraId: result.camera.id,
          status: result.currentStatus,
          previousStatus: result.previousStatus,
          currentStatus: result.currentStatus,
          transitioned: result.transitioned,
          idempotent: result.idempotent,
          lastSeenAt: result.camera.lastSeenAt,
          activeViewerCount: result.activeViewerCount,
          pendingCommand: result.pendingCommand,
          lastCommandResolution: result.lastCommandResolution,
          camera: result.camera
        })
      );
    }
  );

  /**
   * POST /api/v1/cameras/:cameraId/lifecycle
   * Device-credential-only endpoint for explicit CameraInstance lifecycle transitions reported by Android hardware.
   */
  app.post(
    '/cameras/:cameraId/lifecycle',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const parsed = cameraLifecycleReportSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors.map(e => e.message).join(', ') || 'Invalid camera lifecycle report payload');
      }

      const authDevice = await CameraLifecycleService.authenticateDeviceRequest(request, {
        expectedDeviceId: parsed.data.deviceId
      });

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] || null;

      const result = await CameraLifecycleService.reportCameraLifecycle({
        cameraId: params.data.cameraId,
        authDevice,
        status: parsed.data.status,
        reason: parsed.data.reason,
        errorCode: parsed.data.errorCode,
        errorMessage: parsed.data.errorMessage,
        confirmedCommand: parsed.data.confirmedCommand,
        commandId: parsed.data.commandId,
        commandRequestedAt: parsed.data.commandRequestedAt,
        reportedAt: parsed.data.reportedAt,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(
        createSuccessResponse({
          cameraId: result.camera.id,
          status: result.currentStatus,
          previousStatus: result.previousStatus,
          currentStatus: result.currentStatus,
          transitioned: result.transitioned,
          idempotent: result.idempotent,
          lastSeenAt: result.camera.lastSeenAt,
          activeViewerCount: result.activeViewerCount,
          pendingCommand: result.pendingCommand,
          lastCommandResolution: result.lastCommandResolution,
          camera: result.camera
        })
      );
    }
  );

  /**
   * GET /api/v1/cameras/:cameraId/status
   * Retrieves the latest persisted status, session counts, and lifecycle timestamps.
   */
  app.get(
    '/cameras/:cameraId/status',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const status = await CameraService.getCameraStatus(user.id, params.data.cameraId);
      return reply.status(200).send(createSuccessResponse(status));
    }
  );

  /**
   * DELETE /api/v1/cameras/:cameraId
   * Unlinks and removes a CameraInstance while preserving audit trails and Storage servers.
   */
  app.delete(
    '/cameras/:cameraId',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await CameraService.unregisterCamera(
        user.id,
        params.data.cameraId,
        { ip: clientIp, userAgent }
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/cameras/:cameraId/view-token
   * Viewing Authorization Foundation: Issues an ephemeral, short-lived Camera Viewing Token (CVT).
   * Validates viewer entitlements, records session tracking with token hash.
   */
  app.post(
    '/cameras/:cameraId/view-token',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const tokenResult = await CameraService.createViewingToken(
        user.id,
        params.data.cameraId,
        { ip: clientIp, userAgent }
      );

      return reply.status(200).send(createSuccessResponse(tokenResult));
    }
  );

  /**
   * GET /api/v1/cameras/:cameraId/usage
   * Camera-scoped usage retrieval using the CameraUsageRecord foundation.
   */
  app.get(
    '/cameras/:cameraId/usage',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const parseResult = usageQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors.map(e => e.message).join(', '));
      }

      const result = await CameraService.getUsageRecords(user.id, {
        ...parseResult.data,
        cameraId: params.data.cameraId
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * PUT /api/v1/cameras/:cameraId/device
   * Links or re-associates an authenticated physical Device node with a CameraInstance.
   * Enforces account ownership, device eligibility, and non-revocation status.
   */
  app.put(
    '/cameras/:cameraId/device',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const body = associateDeviceSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map(e => e.message).join(', '));
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const camera = await CameraDeviceIdentityService.associateCameraWithDevice({
        userId: user.id,
        cameraId: params.data.cameraId,
        deviceId: body.data.deviceId,
        installationId: body.data.installationId,
        context: { ip: clientIp, userAgent }
      });

      return reply.status(200).send(createSuccessResponse({ camera }));
    }
  );

  /**
   * DELETE /api/v1/cameras/:cameraId/device
   * Dissociates physical Device from CameraInstance (sets deviceId = null).
   * Completely preserves the Device and any Storage ServerInstance.
   */
  app.delete(
    '/cameras/:cameraId/device',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const camera = await CameraDeviceIdentityService.dissociateCameraFromDevice(
        user.id,
        params.data.cameraId,
        { ip: clientIp, userAgent }
      );

      return reply.status(200).send(createSuccessResponse({
        camera,
        message: 'Device successfully unlinked from camera.'
      }));
    }
  );

  /**
   * POST /api/v1/cameras/:cameraId/pairing-challenge
   * Generates a single-use, 10-minute pairing challenge token (pct_<hex>) for cross-device linking.
   */
  app.post(
    '/cameras/:cameraId/pairing-challenge',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const challenge = await CameraDeviceIdentityService.createPairingChallenge(
        user.id,
        params.data.cameraId,
        { ip: clientIp, userAgent }
      );

      return reply.status(200).send(createSuccessResponse(challenge));
    }
  );

  /**
   * POST /api/v1/cameras/pair-device
   * Consumes an ephemeral pairing challenge token presented by an Android client.
   * Atomically registers the installation, links camera, and marks challenge used.
   */
  app.post(
    '/cameras/pair-device',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = consumePairingChallengeSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map(e => e.message).join(', '));
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await CameraDeviceIdentityService.consumePairingChallenge({
        rawChallengeToken: body.data.pairingChallengeToken,
        installationId: body.data.installationId,
        deviceName: body.data.deviceName,
        platform: body.data.platform,
        osVersion: body.data.osVersion,
        appVersion: body.data.appVersion,
        context: { ip: clientIp, userAgent }
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/cameras/:cameraId/signaling
   * Returns authenticated camera owner's non-secret WebRTC signaling connectivity state and endpoint path.
   */
  app.get(
    '/cameras/:cameraId/signaling',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = cameraIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid cameraId parameter');
      }

      // Enforce strict account ownership (throws NotFoundError if unowned/nonexistent)
      await CameraService.getCameraStatus(user.id, params.data.cameraId);
      const signaling = defaultCameraSignalingService.getCameraSignalingState(params.data.cameraId);

      return reply.status(200).send(createSuccessResponse({ signaling }));
    }
  );

  /**
   * POST /api/v1/cameras/:cameraId/sessions/:sessionId/revoke
   * Explicitly revokes an active camera viewing session and severs any live signaling socket.
   */
  app.post(
    '/cameras/:cameraId/sessions/:sessionId/revoke',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const params = z
        .object({
          cameraId: z.string().min(1),
          sessionId: z.string().min(1)
        })
        .safeParse(request.params);

      if (!params.success) {
        throw new ValidationError('Invalid cameraId or sessionId parameter');
      }

      const body = z
        .object({
          reason: z.string().trim().min(1).max(256).optional()
        })
        .safeParse(request.body ?? {});

      if (!body.success) {
        throw new ValidationError(body.error.errors.map(e => e.message).join(', '));
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await CameraService.revokeViewingSession(
        user.id,
        params.data.sessionId,
        body.data.reason || 'REVOKED_BY_USER',
        { ip: clientIp, userAgent, expectedCameraId: params.data.cameraId }
      );

      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
