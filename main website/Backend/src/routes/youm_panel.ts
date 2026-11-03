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
}
