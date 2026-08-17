import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { createErrorResponse } from '../schemas/response.js';
import { config } from '../config/env.js';
import { reconnectDatabase } from '../config/database.js';

export function globalErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  // Operational App Errors
  if (error instanceof AppError) {
    request.log.warn({ err: error, url: request.url }, error.message);
    return reply.status(error.statusCode).send(createErrorResponse(error.errorCode, error.message));
  }

  // Fastify Schema Validation Error
  if (error.validation) {
    request.log.warn({ validation: error.validation, url: request.url }, 'Request validation failed');
    return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', error.message || 'Invalid request payload'));
  }

  // All Prisma Database Errors (connection lost, pool timeout, rust panic, unknown)
  const isPrismaError =
    error.name === 'PrismaClientInitializationError' ||
    error.name === 'PrismaClientKnownRequestError' ||
    error.name === 'PrismaClientUnknownRequestError' ||
    error.name === 'PrismaClientRustPanicError' ||
    error.name === 'PrismaClientValidationError' ||
    (error.message && error.message.includes('connection') && error.message.includes('database'));

  if (isPrismaError) {
    request.log.error({ err: error, url: request.url }, 'Database service connection error');
    // Attempt a non-blocking disconnect + reconnect so subsequent requests succeed
    reconnectDatabase().catch(() => {/* ignore */});
    return reply.status(503).send(createErrorResponse('DATABASE_ERROR', 'Database service is currently unavailable'));
  }

  // Log unexpected internal errors
  request.log.error({ err: error, url: request.url }, 'Unhandled application exception');

  // Safe Production Error (No stack trace leakage)
  const isDev = config.NODE_ENV === 'development';
  const responseMessage = isDev ? error.message : 'An unexpected internal error occurred';

  return reply.status(500).send(createErrorResponse('INTERNAL_SERVER_ERROR', responseMessage));
}
