import { AdminAuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { AdminAuditService } from '../../../../services/admin/admin_audit_service.js';
import { AppError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';

export interface ExecuteOperationOptions<T> {
  operationName: string;
  targetResourceType: string;
  targetResourceId?: string;
  context: AdminOperationContext;
  action: AdminAuditAction;
  metadata?: Record<string, unknown>;
  execute: (tx: Prisma.TransactionClient) => Promise<T>;
}

/**
 * Reusable execution helper for administrative operations.
 * Enforces transaction boundaries, executes domain mutation, and guarantees
 * cryptographic SHA-256 hash-chained audit logging with fail-closed semantics.
 */
export async function executeAdminOperation<T>(
  options: ExecuteOperationOptions<T>
): Promise<T> {
  const {
    operationName,
    targetResourceType,
    targetResourceId,
    context,
    action,
    metadata = {},
    execute
  } = options;

  let operationResult: T;

  try {
    // 1. Execute mutation inside transaction
    operationResult = await prisma.$transaction(async (tx) => {
      const result = await execute(tx);
      return result;
    }, {
      timeout: 20000,
      maxWait: 15000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
    });
  } catch (error) {
    // Log failure event to audit trail
    await AdminAuditService.logEvent({
      adminId: context.adminId,
      action,
      status: 'FAILED',
      ipAddress: context.clientIp,
      userAgent: context.userAgent,
      metadata: {
        operationName,
        targetResourceType,
        targetResourceId,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...metadata
      }
    }).catch(auditErr => console.error('[executeAdminOperation] Failed to log failure audit:', auditErr));

    throw error;
  }

  // 2. Log mandatory audit event with Fail-Closed semantics
  try {
    await AdminAuditService.logEvent({
      adminId: context.adminId,
      action,
      status: 'SUCCESS',
      ipAddress: context.clientIp,
      userAgent: context.userAgent,
      metadata: {
        operationName,
        targetResourceType,
        targetResourceId,
        requestId: context.requestId,
        ...metadata
      }
    });
  } catch (auditError) {
    console.error('[executeAdminOperation] Mandatory audit logging failed (FAIL-CLOSED):', auditError);
    throw new AppError(
      'Operational mutation could not complete: mandatory audit logging failure',
      500,
      'AUDIT_FAILURE',
      false
    );
  }

  return operationResult;
}
