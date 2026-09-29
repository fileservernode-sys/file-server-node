const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

async function run() {
  const targetEmail = 'filenodeserver@gmail.com';
  const targetPassword = 'zdexcloud@2020';

  console.log('1. Checking user table for:', targetEmail);
  const existingUser = await prisma.user.findUnique({ where: { email: targetEmail } });
  if (existingUser) {
    console.log('Found user in customer user table (ID: ' + existingUser.id + '). Removing associated user records...');
    await prisma.userSession.deleteMany({ where: { userId: existingUser.id } });
    await prisma.emailOtp.deleteMany({ where: { userId: existingUser.id } });
    await prisma.userSubscription.deleteMany({ where: { userId: existingUser.id } });
    await prisma.device.deleteMany({ where: { userId: existingUser.id } });
    await prisma.user.delete({ where: { id: existingUser.id } });
    console.log('Removed from customer user table successfully.');
  } else {
    console.log('User not present in customer user table.');
  }

  console.log('2. Upserting SuperAdmin in adminUser table...');
  const pwdHash = hashPassword(targetPassword);
  const existingAdmin = await prisma.adminUser.findUnique({ where: { email: targetEmail } });
  let adminId = '';
  if (existingAdmin) {
    const updated = await prisma.adminUser.update({
      where: { email: targetEmail },
      data: {
        passwordHash: pwdHash,
        status: 'ACTIVE',
        isSuperAdmin: true,
        name: 'Super Administrator'
      }
    });
    adminId = updated.id;
    console.log('Updated existing AdminUser to SuperAdmin. ID:', adminId);
  } else {
    const created = await prisma.adminUser.create({
      data: {
        email: targetEmail,
        passwordHash: pwdHash,
        status: 'ACTIVE',
        isSuperAdmin: true,
        name: 'Super Administrator'
      }
    });
    adminId = created.id;
    console.log('Created new SuperAdmin. ID:', adminId);
  }

  let superRole = await prisma.adminRole.findUnique({ where: { slug: 'SUPER_ADMIN' } });
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
    console.log('Assigned SUPER_ADMIN role.');
  }

  console.log('SUPER_ADMIN CONFIGURATION COMPLETE FOR filenodeserver@gmail.com');
  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
