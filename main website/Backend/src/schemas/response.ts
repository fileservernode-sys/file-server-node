import { RequestContextStore } from '../observability/request_context.js';

export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export function createSuccessResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data
  };
}

export function createErrorResponse(code: string, message: string, requestId?: string): ApiErrorResponse {
  const effectiveRequestId = requestId || RequestContextStore.getRequestId();
  return {
    success: false,
    error: {
      code,
      message,
      ...(effectiveRequestId ? { requestId: effectiveRequestId } : {})
    }
  };
}

