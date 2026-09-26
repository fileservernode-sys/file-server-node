import { AdminStatus, AdminAuditAction } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { hashPassword } from '../../utils/crypto.js';

export interface BootstrapAdminParams {
  email?: string;
  password?: string;
  name?: string;
}

export interface BootstrapResult {
  created: boolean;
  adminId?: string;
  email?: string;
  message: string;
}

/**
 * Idempotently bootstraps the initial SuperAdmin account if configured via environment or parameters.
 * Does NOT overwrite existing accounts, log passwords, or commit secrets.
 */
export async function bootstrapSuperAdmin(params?: BootstrapAdminParams): Promise<BootstrapResult> {
  const email = (params?.email || process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = params?.password || process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  const name = (params?.name || process.env.BOOTSTRAP_ADMIN_NAME || 'Super Administrator').trim();

  if (!email || !password) {
    return {
      created: false,
      message: 'Bootstrap skipped: BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_ADMIN_PASSWORD not set.'
    };
  }

  if (password.length < 12) {
    return {
      created: false,
      message: 'Bootstrap failed: Admin password must be at least 12 characters.'
    };
  }

  const existingAdmin = await prisma.adminUser.findUnique({
    where: { email }
  });

  if (existingAdmin) {
    return {
      created: false,
      adminId: existingAdmin.id,
      email: existingAdmin.email,
      message: 'Bootstrap skipped: SuperAdmin account already exists.'
    };
  }

  const passwordHash = hashPassword(password);

  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name,
      status: AdminStatus.ACTIVE,
      isSuperAdmin: true
    }
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action: AdminAuditAction.ADMIN_LOGIN_SUCCESS,
      status: 'BOOTSTRAP',
      metadata: { action: 'SUPER_ADMIN_BOOTSTRAP_CREATED', email: admin.email }
    }
  });

  return {
    created: true,
    adminId: admin.id,
    email: admin.email,
    message: 'SuperAdmin account bootstrapped successfully.'
  };
}
