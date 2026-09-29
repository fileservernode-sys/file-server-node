import { ForbiddenError, NotFoundError } from '../../../../errors/app-error.js';
import { ObjectAuthorizationParams } from '../types.js';

/**
 * Object-level authorization extension point.
 * Verifies that the administrator possesses adequate rights and status to operate on a specific target resource.
 * In Phase 8.2, this establishes the validation contract and anti-tamper invariants.
 * Future domain controllers (8.3 to 8.6) plug in domain-specific resource ownership/state checks.
 */
export async function assertAdminCanOperateOnResource(
  params: ObjectAuthorizationParams
): Promise<boolean> {
  const { resourceType, resourceId, operation, context, targetOwnerUserId } = params;

  if (!context || !context.adminId) {
    throw new ForbiddenError('Operation context missing or unauthenticated');
  }

  if (context.status !== 'ACTIVE') {
    throw new ForbiddenError('Admin account is inactive');
  }

  if (!resourceId || resourceId.trim().length === 0) {
    throw new NotFoundError(`Target ${resourceType} resource ID cannot be empty`);
  }

  // SuperAdmins have global object access
  if (context.isSuperAdmin) {
    return true;
  }

  // Future Phase 8.3-8.6 domain checks will hook in here
  return true;
}
