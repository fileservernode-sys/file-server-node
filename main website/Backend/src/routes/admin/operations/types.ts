import { AdminStatus } from '@prisma/client';

export interface AdminOperationContext {
  adminId: string;
  adminEmail: string;
  adminName: string;
  isSuperAdmin: boolean;
  status: AdminStatus;
  sessionId: string;
  roles: string[];
  permissions: string[];
  requestId: string;
  clientIp: string;
  userAgent: string;
  operationName?: string;
  targetResourceType?: string;
  targetResourceId?: string;
}

export interface AdminOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export interface ObjectAuthorizationParams {
  resourceType: 'user' | 'device' | 'server' | 'gateway' | 'billing' | 'system' | string;
  resourceId: string;
  operation: string;
  context: AdminOperationContext;
  targetOwnerUserId?: string | null;
}
