export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, errorCode = 'INTERNAL_SERVER_ERROR', isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', errorCode = 'NOT_FOUND') {
    super(message, 404, errorCode);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request parameters', errorCode = 'VALIDATION_ERROR') {
    super(message, 400, errorCode);
  }
}

export class DatabaseError extends AppError {
  constructor(message = 'Database service unavailable', errorCode = 'DATABASE_ERROR') {
    super(message, 503, errorCode);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', errorCode = 'UNAUTHORIZED') {
    super(message, 401, errorCode);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden', errorCode = 'FORBIDDEN') {
    super(message, 403, errorCode);
  }
}
