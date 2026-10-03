import { prisma } from '../src/config/database.js';
import { hashPassword } from '../src/utils/crypto.js';
import { AdminStatus } from '@prisma/client';

async function main() {
  const targetEmail = process.env.SUPER_ADMIN_EMAIL || process.argv[2];
  const targetPassword = process.env.SUPER_ADMIN_PASSWORD || process.argv[3];

  if (!targetEmail || !targetPassword) {
    console.error('ERROR: Missing required SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD environment variables or arguments.');
    console.error('Usage: SUPER_ADMIN_EMAIL="admin@zdex.cloud" SUPER_ADMIN_PASSWORD="<secure-password>" npx tsx scripts/setup_super_admin.ts');
    process.exit(1);
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: targetEmail }
  });

  if (existingUser) {
    await prisma.userSession.deleteMany({ where: { userId: existingUser.id } });
    await prisma.emailOtp.deleteMany({ where: { userId: existingUser.id } });
    await prisma.device.deleteMany({ where: { userId: existingUser.id } });
    await prisma.user.delete({ where: { id: existingUser.id } });
  }

  const pwdHash = hashPassword(targetPassword);

  const existingAdmin = await prisma.adminUser.findUnique({
    where: { email: targetEmail }
  });

  let adminId = '';
  if (existingAdmin) {
    const updated = await prisma.adminUser.update({
      where: { email: targetEmail },
      data: {
        passwordHash: pwdHash,
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true,
        name: 'Super Administrator'
      }
    });
    adminId = updated.id;
  } else {
    const created = await prisma.adminUser.create({
      data: {
        email: targetEmail,
        passwordHash: pwdHash,
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true,
        name: 'Super Administrator'
      }
    });
    adminId = created.id;
  }

  let superRole = await prisma.adminRole.findUnique({
    where: { slug: 'SUPER_ADMIN' }
  });

  if (!superRole) {
    superRole = await prisma.adminRole.create({
      data: {
        slug: 'SUPER_ADMIN',
        name: 'Super Administrator',
        description: 'Full unrestricted platform access'
      }
    });
  }

  const hasRole = await prisma.adminUserRole.findUnique({
    where: {
      adminId_roleId: {
        adminId: adminId,
        roleId: superRole.id
      }
    }
  });

  if (!hasRole) {
    await prisma.adminUserRole.create({
      data: {
        adminId: adminId,
        roleId: superRole.id
      }
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
