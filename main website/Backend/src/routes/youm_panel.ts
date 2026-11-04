import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  YoumPanelService,
  YOUM_PANEL_AUTHORIZED_EMAIL
} from '../services/youm_panel_service.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';

const requestOtpSchema = z.object({
  email: z.string().email()
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().min(6).max(6)
});

const analyticsQuerySchema = z.object({
  range: z.enum(['24h', 'daily', '7d', '30d', 'days', '90d', '12m', 'months', 'all']).optional(),
  interval: z.enum(['hour', 'day', 'month']).optional()
});

const usersQuerySchema = z.object({
  search: z.string().optional(),
  plan: z.enum(['all', 'free', 'pro_monthly', 'pro_yearly']).optional(),
  expiration: z.enum(['all', 'active', 'expiring_soon', 'expired', 'free']).optional(),
  hasServers: z.enum(['all', 'yes', 'no', 'online']).optional(),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(200).optional().default(50)
});

const userIdParamSchema = z.object({
  id: z.string().min(1)
});

/**
 * Extracts and validates the Youm Panel bearer token from request headers.
 */
async function extractAndValidateYoumToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const authHeader = request.headers.authorization;
  const customHeader = request.headers['x-youm-panel-token'];
  let rawToken: string | null = null;

  if (typeof customHeader === 'string' && customHeader.trim()) {
    rawToken = customHeader.trim();
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.substring(7).trim();
  }

  if (!rawToken || !rawToken.startsWith('youm_')) {
    reply.status(401).send(createErrorResponse('UNAUTHORIZED', 'Valid Youm Panel master session token required'));
    return false;
  }

  const isValid = await YoumPanelService.validateToken(rawToken);
  if (!isValid) {
    reply.status(401).send(createErrorResponse('SESSION_EXPIRED', 'Youm Panel session has expired or is invalid'));
    return false;
  }

  return true;
}

export async function youmPanelRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/youm-panel/auth/request-otp
   * Requests a login OTP strictly for fileservernode@gmail.com
   */
  app.post('/youm-panel/auth/request-otp', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = requestOtpSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', 'A valid email address is required.'));
    }

    const { email } = parseResult.data;
    if (!YoumPanelService.isAuthorizedEmail(email)) {
      return reply.status(403).send(createErrorResponse(
        'FORBIDDEN',
        'Access denied. Youm Panel is exclusively accessible by fileservernode@gmail.com.'
      ));
    }

    try {
      const res = await YoumPanelService.requestOtp(email);
      return reply.send(createSuccessResponse({
        email: YOUM_PANEL_AUTHORIZED_EMAIL,
        message: 'A 6-digit login passcode has been dispatched to fileservernode@gmail.com.',
        cooldownSeconds: res.cooldownSeconds
      }));
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      const code = err.code || 'INTERNAL_ERROR';
      return reply.status(statusCode).send(createErrorResponse(code, err.message));
    }
  });

  /**
   * POST /api/v1/youm-panel/auth/verify-otp
   * Verifies the 6-digit passcode and generates a master token
   */
  app.post('/youm-panel/auth/verify-otp', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = verifyOtpSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', 'A 6-digit verification code is required.'));
    }

    const { email, code } = parseResult.data;
    if (!YoumPanelService.isAuthorizedEmail(email)) {
      return reply.status(403).send(createErrorResponse(
        'FORBIDDEN',
        'Access denied. Youm Panel is exclusively accessible by fileservernode@gmail.com.'
      ));
    }

    try {
      const result = await YoumPanelService.verifyOtp(email, code);
      return reply.send(createSuccessResponse({
        token: result.token,
        email: result.email,
        expiresAt: result.expiresAt,
        message: 'Master session authenticated successfully.'
      }));
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      const code = err.code || 'AUTHENTICATION_FAILED';
      return reply.status(statusCode).send(createErrorResponse(code, err.message));
    }
  });

  /**
   * GET /api/v1/youm-panel/auth/me
   * Validates active session
   */
  app.get('/youm-panel/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const isValid = await extractAndValidateYoumToken(request, reply);
    if (!isValid) return;

    return reply.send(createSuccessResponse({
      email: YOUM_PANEL_AUTHORIZED_EMAIL,
      role: 'MASTER_ADMIN',
      authenticated: true
    }));
  });

  /**
   * POST /api/v1/youm-panel/auth/logout
   * Invalidates active session
   */
  app.post('/youm-panel/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const customHeader = request.headers['x-youm-panel-token'];
    let rawToken: string | null = null;
    if (typeof customHeader === 'string' && customHeader.trim()) {
      rawToken = customHeader.trim();
    } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.substring(7).trim();
    }

    if (rawToken) {
      await YoumPanelService.revokeToken(rawToken);
    }

    return reply.send(createSuccessResponse({
      message: 'Master session signed out successfully.'
    }));
  });

  /**
   * GET /api/v1/youm-panel/analytics
   * Returns authoritative system KPIs, time series aggregations, and recent activities.
   */
  app.get('/youm-panel/analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    const isValid = await extractAndValidateYoumToken(request, reply);
    if (!isValid) return;

    const queryResult = analyticsQuerySchema.safeParse(request.query);
    const range = queryResult.success ? queryResult.data.range : '30d';
    const interval = queryResult.success ? queryResult.data.interval : undefined;

    try {
      const analytics = await YoumPanelService.getAnalytics(range, interval);
      return reply.send(createSuccessResponse(analytics));
    } catch (err: any) {
      request.log.error({ err }, 'Failed to compute Youm Panel analytics');
      return reply.status(500).send(createErrorResponse('ANALYTICS_ERROR', 'Failed to calculate system analytics metrics'));
    }
  });

  /**
   * GET /api/v1/youm-panel/users
   * Returns comprehensive user accounts directory with:
   * - Plan details, pricing, subscription intervals
   * - Plan expiration calculation (exact days left)
   * - Servers details (status, active since, host device specs, endpoints)
   * - Filters by plan, expiration, server presence, search, and pagination
   */
  app.get('/youm-panel/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const isValid = await extractAndValidateYoumToken(request, reply);
    if (!isValid) return;

    const queryResult = usersQuerySchema.safeParse(request.query);
    const filters = queryResult.success ? queryResult.data : {};

    try {
      const directory = await YoumPanelService.getUsersDirectory(filters);
      return reply.send(createSuccessResponse(directory));
    } catch (err: any) {
      request.log.error({ err }, 'Failed to retrieve Youm Panel users directory');
      return reply.status(500).send(createErrorResponse('DIRECTORY_ERROR', 'Failed to retrieve users directory'));
    }
  });

  /**
   * GET /api/v1/youm-panel/users/:id
   * Returns deep user intelligence record:
   * Profile, full subscription lifecycle, all devices & hardware specs,
   * all servers with real-time tunnel state & endpoints, invoices, and payments.
   */
  app.get('/youm-panel/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const isValid = await extractAndValidateYoumToken(request, reply);
    if (!isValid) return;

    const paramResult = userIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', 'Invalid user ID'));
    }

    try {
      const userDetails = await YoumPanelService.getUserDetails(paramResult.data.id);
      return reply.send(createSuccessResponse(userDetails));
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      const code = err.code || 'USER_DETAILS_ERROR';
      return reply.status(statusCode).send(createErrorResponse(code, err.message));
    }
  });
}
