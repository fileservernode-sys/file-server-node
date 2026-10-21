import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '../errors/app-error.js';
import { getAuthUser } from '../middleware/customer-auth.js';
import { customerStandardRateLimitConfig } from '../middleware/rate_limit_presets.js';
import { createSuccessResponse } from '../schemas/response.js';
import { CustomerActivityService } from '../services/activity/customer_activity_service.js';

interface ActivityQueryInput {
  cursor?: unknown;
  limit?: unknown;
  category?: unknown;
  eventType?: unknown;
  from?: unknown;
  to?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  // Any caller-supplied userId in query is intentionally ignored; ownership is derived strictly from session.
  userId?: unknown;
}

function extractScalarQueryString(value: unknown, paramName: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new ValidationError(`Invalid '${paramName}' query parameter`);
}

function extractScalarLimitParam(value: unknown): string | number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  throw new ValidationError("Invalid 'limit' query parameter");
}

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/account/activity
   *
   * Authenticated, IDOR-safe, read-only endpoint returning the customer's chronological
   * activity history.
   *
   * Security & Privacy Invariants:
   * - Derives `userId` exclusively from the authenticated server-side session (`getAuthUser`).
   * - Never trusts caller-supplied `userId` parameters.
   * - Rejects non-scalar / array query parameter injection.
   * - Validates `category` and `eventType` strictly against the Phase 9.1 customer-visible taxonomy.
   * - Returns only allowlisted, sanitized fields via `CustomerActivityService.listUserActivity`.
   */
  app.get(
    '/account/activity',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const query = (request.query || {}) as ActivityQueryInput;

      const cursor = extractScalarQueryString(query.cursor, 'cursor');
      const limit = extractScalarLimitParam(query.limit);
      const category = extractScalarQueryString(query.category, 'category');
      const eventType = extractScalarQueryString(query.eventType, 'eventType');
      const fromParam =
        query.from !== undefined && query.from !== null && query.from !== ''
          ? extractScalarQueryString(query.from, 'from')
          : extractScalarQueryString(query.startDate, 'startDate');
      const toParam =
        query.to !== undefined && query.to !== null && query.to !== ''
          ? extractScalarQueryString(query.to, 'to')
          : extractScalarQueryString(query.endDate, 'endDate');

      const result = await CustomerActivityService.listUserActivity(user.id, {
        cursor,
        limit,
        category,
        eventType,
        from: fromParam,
        to: toParam
      });

      reply.header('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
