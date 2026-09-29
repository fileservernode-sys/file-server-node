import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import {
  AdminStatus,
  SupportCaseStatus,
  SupportCasePriority,
  SupportCaseCategory,
  AdminAuditAction
} from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin Support Operations & Help Desk (Phase 10 — Batch 10.1)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.support.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Support Agent user (with SUPPORT role)
  const supportEmail = `support.agent.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles)
  const unassignedEmail = `unassigned.support.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Test Customer
  let testCustomer: any;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Seed RBAC
    await seedAdminRbac();

    // 2. Create SuperAdmin
    superAdminUser = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: hashPassword('SuperAdminPass123!'),
        name: 'Super Admin SupportOps',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true
      }
    });
    superAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: superAdminUser.id,
        sessionTokenHash: hashSessionToken(superAdminToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // 3. Create Support Agent with SUPPORT role
    const supportRole = await prisma.adminRole.findUnique({ where: { slug: 'SUPPORT' } });
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Agent 1',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    if (supportRole) {
      await prisma.adminUserRole.create({
        data: {
          adminId: supportUser.id,
          roleId: supportRole.id
        }
      });
    }
    supportToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: supportUser.id,
        sessionTokenHash: hashSessionToken(supportToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // 4. Create Unassigned Admin
    unassignedUser = await prisma.adminUser.create({
      data: {
        email: unassignedEmail,
        passwordHash: hashPassword('UnassignedPass123!'),
        name: 'Unassigned Admin',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    unassignedToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: unassignedUser.id,
        sessionTokenHash: hashSessionToken(unassignedToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // 5. Create Test Customer
    testCustomer = await prisma.user.create({
      data: {
        email: `customer.support.${Date.now()}@example.com`,
        fullName: 'Support Customer',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
  });

  after(async () => {
    // Cleanup created test records
    if (testCustomer) {
      await prisma.supportCaseNote.deleteMany({ where: { case: { userId: testCustomer.id } } });
      await prisma.supportCase.deleteMany({ where: { userId: testCustomer.id } });
      await prisma.user.delete({ where: { id: testCustomer.id } });
    }
    if (superAdminUser) {
      await prisma.adminSession.deleteMany({ where: { adminId: superAdminUser.id } });
      await prisma.adminUser.delete({ where: { id: superAdminUser.id } });
    }
    if (supportUser) {
      await prisma.adminSession.deleteMany({ where: { adminId: supportUser.id } });
      await prisma.adminUserRole.deleteMany({ where: { adminId: supportUser.id } });
      await prisma.adminUser.delete({ where: { id: supportUser.id } });
    }
    if (unassignedUser) {
      await prisma.adminSession.deleteMany({ where: { adminId: unassignedUser.id } });
      await prisma.adminUser.delete({ where: { id: unassignedUser.id } });
    }
    await app.close();
  });

  test('GET /admin/operations/support/overview returns metrics for authorized agent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/support/overview',
      headers: {
        authorization: `Bearer ${supportToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(typeof body.data.totalCases === 'number');
    assert.ok(typeof body.data.openCases === 'number');
    assert.ok(typeof body.data.unassignedCases === 'number');
  });

  test('POST /admin/operations/support/cases creates a new support ticket and logs audit event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/operations/support/cases',
      headers: {
        authorization: `Bearer ${supportToken}`
      },
      payload: {
        userId: testCustomer.id,
        subject: 'Cannot access Android local server port',
        description: 'Customer reports timeout when attempting to connect to node port 8080.',
        category: SupportCaseCategory.SERVER,
        priority: SupportCasePriority.HIGH
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.caseNumber.startsWith('ZDEX-SUP-'));
    assert.strictEqual(body.data.userId, testCustomer.id);
    assert.strictEqual(body.data.status, 'OPEN');
    assert.strictEqual(body.data.priority, 'HIGH');
    assert.strictEqual(body.data.category, 'SERVER');
  });

  test('GET /admin/operations/support/cases lists paginated cases with filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/support/cases?userId=${testCustomer.id}`,
      headers: {
        authorization: `Bearer ${supportToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.items.length >= 1);
    assert.strictEqual(body.data.items[0].userEmail, testCustomer.email);
  });

  test('GET /admin/operations/support/cases/:caseId returns bounded customer context projection', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/support/cases?userId=${testCustomer.id}`,
      headers: { authorization: `Bearer ${supportToken}` }
    });
    const createdCase = JSON.parse(listRes.body).data.items[0];

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/support/cases/${createdCase.id}`,
      headers: {
        authorization: `Bearer ${supportToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, createdCase.id);
    assert.ok(body.data.customerContext);
    assert.strictEqual(body.data.customerContext.user.id, testCustomer.id);
    assert.ok(Array.isArray(body.data.customerContext.devices));
    assert.ok(Array.isArray(body.data.customerContext.servers));
  });

  test('POST /admin/operations/support/cases/:caseId/notes adds an internal operator note', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/support/cases?userId=${testCustomer.id}`,
      headers: { authorization: `Bearer ${supportToken}` }
    });
    const createdCase = JSON.parse(listRes.body).data.items[0];

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/support/cases/${createdCase.id}/notes`,
      headers: {
        authorization: `Bearer ${supportToken}`
      },
      payload: {
        note: 'Customer Android node is offline due to battery saver restrictions. Advised to disable battery optimization.',
        isInternal: true
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.caseId, createdCase.id);
    assert.strictEqual(body.data.adminId, supportUser.id);
    assert.strictEqual(body.data.isInternal, true);
  });

  test('PATCH /admin/operations/support/cases/:caseId transitions status to RESOLVED', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/support/cases?userId=${testCustomer.id}`,
      headers: { authorization: `Bearer ${supportToken}` }
    });
    const createdCase = JSON.parse(listRes.body).data.items[0];

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/operations/support/cases/${createdCase.id}`,
      headers: {
        authorization: `Bearer ${supportToken}`
      },
      payload: {
        status: SupportCaseStatus.RESOLVED,
        resolutionNotes: 'Resolved after edge server was brought back online by customer.'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'RESOLVED');
    assert.ok(body.data.resolvedAt !== null);
  });

  test('POST /admin/operations/support/cases/:caseId/assign updates assigned administrator', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/support/cases?userId=${testCustomer.id}`,
      headers: { authorization: `Bearer ${supportToken}` }
    });
    const createdCase = JSON.parse(listRes.body).data.items[0];

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/support/cases/${createdCase.id}/assign`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        assignedAdminId: supportUser.id
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.assignedAdminId, supportUser.id);
    assert.strictEqual(body.data.assignedAdminName, 'Support Agent 1');
  });

  test('Unassigned administrator is denied access (403 Forbidden)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/support/overview',
      headers: {
        authorization: `Bearer ${unassignedToken}`
      }
    });

    assert.strictEqual(res.statusCode, 403);
  });
});
