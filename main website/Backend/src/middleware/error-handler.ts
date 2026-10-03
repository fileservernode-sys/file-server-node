import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { createErrorResponse } from '../schemas/response.js';
import { config } from '../config/env.js';
import { reconnectDatabase } from '../config/database.js';
import { errorIngestionService } from '../services/error_ingestion_service.js';
import { SecurityAuditService } from '../observability/security_audit_service.js';
import { resolveClientIp } from '../utils/ip.js';

export function globalErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const reqId = request.id;
  if (reqId) {
    reply.header('x-request-id', reqId);
  }

  const clientIp = resolveClientIp(request);
  const userAgent = request.headers['user-agent'] as string;
  const userId = (request as any).user?.id || (request as any).userId;
  const adminId = (request as any).admin?.id || (request as any).adminId;

  // 1. Operational App Errors
  if (error instanceof AppError) {
    request.log.warn({ err: error, url: request.url, reqId }, error.message);

    // If authorization or authentication denial, emit structured security event
    if (error.statusCode === 403 || error.statusCode === 401) {
      SecurityAuditService.recordSecurityEvent({
        eventType: error.statusCode === 403 ? 'AUTHZ_DENIED' : 'AUTH_REJECTED',
        severity: 'SECURITY',
        actor: {
          type: adminId ? 'ADMIN' : (userId ? 'USER' : 'ANONYMOUS'),
          id: adminId || userId || null
        },
        resource: { type: 'API_ENDPOINT', id: request.url.split('?')[0] },
        action: request.method,
        result: 'DENIED',
        statusCode: error.statusCode,
        errorCode: error.errorCode,
        reason: error.message,
        requestId: reqId,
        ipAddress: clientIp,
        userAgent
      }).catch(() => {/* non-blocking */});
    }

    // Ingest into Observability Error Center
    errorIngestionService.ingest({
      error,
      component: 'BACKEND_API',
      errorCode: error.errorCode,
      httpMethod: request.method,
      httpPath: request.url,
      httpStatus: error.statusCode,
      requestId: reqId,
      userId,
      metadata: {
        adminId,
        url: request.url,
        params: request.params,
        query: request.query
      }
    }).catch(() => {/* fail-safe non-blocking */});

    return reply.status(error.statusCode).send(createErrorResponse(error.errorCode, error.message, reqId));
  }

  // 2. Rate Limiting Errors
  if ((error as any).statusCode === 429 || (error as any).code === 'FST_ERR_RATE_LIMIT' || (error as any).error?.code === 'TOO_MANY_REQUESTS') {
    request.log.warn({ err: error, url: request.url, reqId }, 'Rate limit exceeded');

    // Record Security Audit event for rate limiting
    SecurityAuditService.recordRateLimitThrottled({
      ipAddress: clientIp,
      endpoint: request.url.split('?')[0],
      userId,
      limitType: (error as any).code || 'RATE_LIMIT_EXCEEDED'
    }).catch(() => {/* non-blocking */});

    errorIngestionService.ingest({
      error,
      component: 'BACKEND_API',
      severity: 'WARNING',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      httpMethod: request.method,
      httpPath: request.url,
      httpStatus: 429,
      requestId: reqId,
      userId,
      metadata: { url: request.url }
    }).catch(() => {/* fail-safe */});

    return reply.status(429).send(createErrorResponse('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded. Please try again later.', reqId));
  }

  // 3. Fastify Schema Validation Error
  if (error.validation) {
    request.log.warn({ validation: error.validation, url: request.url, reqId }, 'Request validation failed');

    errorIngestionService.ingest({
      error,
      component: 'BACKEND_API',
      severity: 'WARNING',
      errorCode: 'VALIDATION_ERROR',
      httpMethod: request.method,
      httpPath: request.url,
      httpStatus: 400,
      requestId: reqId,
      userId,
      metadata: { validation: error.validation, url: request.url }
    }).catch(() => {/* fail-safe */});

    return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', error.message || 'Invalid request payload', reqId));
  }

  // 4. Client Errors with explicit 4xx status code (e.g. malformed JSON in body parser)
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    request.log.warn({ err: error, url: request.url, reqId }, error.message);

    errorIngestionService.ingest({
      error,
      component: 'BACKEND_API',
      severity: 'WARNING',
      errorCode: (error as any).code || 'BAD_REQUEST',
      httpMethod: request.method,
      httpPath: request.url,
      httpStatus: error.statusCode,
      requestId: reqId,
      userId,
      metadata: { url: request.url }
    }).catch(() => {/* fail-safe */});

    return reply.status(error.statusCode).send(createErrorResponse((error as any).code || 'BAD_REQUEST', error.message, reqId));
  }

  // 5. All Prisma Database Errors (connection lost, pool timeout, rust panic, unknown)
  const isPrismaError =
    error.name === 'PrismaClientInitializationError' ||
    error.name === 'PrismaClientKnownRequestError' ||
    error.name === 'PrismaClientUnknownRequestError' ||
    error.name === 'PrismaClientRustPanicError' ||
    error.name === 'PrismaClientValidationError' ||
    (error.message && error.message.includes('connection') && error.message.includes('database'));

  if (isPrismaError) {
    request.log.error({ err: error, url: request.url, reqId }, 'Database service connection error');
    // Attempt a non-blocking disconnect + reconnect so subsequent requests succeed
    reconnectDatabase().catch(() => {/* ignore */});

    errorIngestionService.ingest({
      error,
      component: 'DATABASE',
      severity: 'ERROR',
      errorCode: (error as any).code || 'DATABASE_ERROR',
      httpMethod: request.method,
      httpPath: request.url,
      httpStatus: 503,
      requestId: reqId,
      userId,
      metadata: { url: request.url }
    }).catch(() => {/* fail-safe */});

    return reply.status(503).send(createErrorResponse('DATABASE_ERROR', 'Database service is currently unavailable', reqId));
  }

  // 6. Log unexpected internal errors
  request.log.error({ err: error, url: request.url, reqId }, 'Unhandled application exception');

  errorIngestionService.ingest({
    error,
    component: 'BACKEND_API',
    severity: 'CRITICAL',
    errorCode: 'INTERNAL_SERVER_ERROR',
    httpMethod: request.method,
    httpPath: request.url,
    httpStatus: 500,
    requestId: reqId,
    userId,
    metadata: {
      adminId,
      url: request.url
    }
  }).catch(() => {/* fail-safe */});

  // Safe Production Error (No stack trace leakage)
  const isDev = config.NODE_ENV === 'development';
  const responseMessage = isDev ? error.message : 'An unexpected internal error occurred';

  return reply.status(500).send(createErrorResponse('INTERNAL_SERVER_ERROR', responseMessage, reqId));
}
