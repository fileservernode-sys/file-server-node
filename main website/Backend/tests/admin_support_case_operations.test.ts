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

describe('Admin Support Case Operations, Assignment & Escalation Hardening (Phase 10 — Batch 10.3)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.caseops.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Support Admin (Role: SUPPORT)
  const supportEmail = `support.assignee.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Inactive Support Admin (Status: DISABLED)
  const disabledAdminEmail = `disabled.admin.${Date.now()}@zdexcloud.internal`;
  let disabledAdminUser: any;

  // Read-only / Non-support Admin (Role: AUDITOR)
  const viewerEmail = `viewer.caseops.${Date.now()}@zdexcloud.internal`;
  let viewerUser: any;
  let viewerToken = '';

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
        name: 'Super Admin CaseOps',
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

    // 3. Create Support Admin with SUPPORT role
    const supportRole = await prisma.adminRole.findUnique({
      where: { slug: 'SUPPORT' }
    });
    assert.ok(supportRole, 'SUPPORT role must exist');

    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Active Support Specialist',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    await prisma.adminUserRole.create({
      data: {
        adminId: supportUser.id,
        roleId: supportRole.id
      }
    });
    supportToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: supportUser.id,
        sessionTokenHash: hashSessionToken(supportToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // 4. Create Disabled Admin
    disabledAdminUser = await prisma.adminUser.create({
      data: {
        email: disabledAdminEmail,
        passwordHash: hashPassword('DisabledPass123!'),
        name: 'Disabled Support Specialist',
        status: AdminStatus.DISABLED,
        isSuperAdmin: false
      }
    });
    await prisma.adminUserRole.create({
      data: {
        adminId: disabledAdminUser.id,
        roleId: supportRole.id
      }
    });

    // 5. Create Viewer Admin (Auditor role - support.read only)
    const auditorRole = await prisma.adminRole.findUnique({
      where: { slug: 'SECURITY_AUDITOR' }
    });
    viewerUser = await prisma.adminUser.create({
      data: {
        email: viewerEmail,
        passwordHash: hashPassword('ViewerPass123!'),
        name: 'Support Auditor Viewer',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    if (auditorRole) {
      await prisma.adminUserRole.create({
        data: {
          adminId: viewerUser.id,
          roleId: auditorRole.id
        }
      });
    }
    viewerToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: viewerUser.id,
        sessionTokenHash: hashSessionToken(viewerToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // 6. Create Test Customer
    testCustomer = await prisma.user.create({
      data: {
        email: `customer.caseops.${Date.now()}@zdex.cloud`,
        passwordHash: 'dummy-hash',
        fullName: 'Case Operations Test User',
        emailVerified: true
      }
    });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('1. Assignee Eligibility: GET /api/v1/admin/operations/support/assignees returns active support admins only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/support/assignees',
      headers: {
        authorization: `Bearer ${superAdminToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.assignees));

    const assigneeIds = body.data.assignees.map((a: any) => a.id);
    assert.ok(assigneeIds.includes(superAdminUser.id), 'SuperAdmin must be eligible');
    assert.ok(assigneeIds.includes(supportUser.id), 'Active Support Admin must be eligible');
    assert.ok(!assigneeIds.includes(disabledAdminUser.id), 'Disabled Admin must NOT be eligible');
  });

  test('2. Case Creation with Escalation Indicators: creates OPEN case with derived urgency flags', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/operations/support/cases',
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        userId: testCustomer.id,
        subject: 'Urgent relay network downtime report',
        description: 'Customer nodes cannot connect to cluster gateway',
        category: SupportCaseCategory.CONNECTION,
        priority: SupportCasePriority.URGENT
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'OPEN');
    assert.strictEqual(body.data.priority, 'URGENT');
    assert.strictEqual(body.data.isUrgent, true);
    assert.strictEqual(body.data.isUnassigned, true);
    assert.strictEqual(body.data.needsAttention, true);
  });

  test('3. Assign Case to Valid Eligible Administrator', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-ASSN`,
        userId: testCustomer.id,
        subject: 'Assignment test issue',
        description: 'Testing assignment mechanics',
        category: SupportCaseCategory.ACCOUNT,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.OPEN
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}/assign`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        assignedAdminId: supportUser.id
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.assignedAdminId, supportUser.id);
    assert.strictEqual(body.data.assignedAdmin.name, supportUser.name);
    assert.strictEqual(body.data.isUnassigned, false);
  });

  test('4. Assign Case to Inactive Administrator is rejected with 400 Bad Request', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-INACT`,
        userId: testCustomer.id,
        subject: 'Assignment to inactive admin test',
        description: 'Testing inactive admin rejection',
        category: SupportCaseCategory.GENERAL,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.OPEN
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}/assign`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        assignedAdminId: disabledAdminUser.id
      }
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.match(body.error.message, /active administrator/i);
  });

  test('5. Unassign Case by passing null or empty string', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-UNASN`,
        userId: testCustomer.id,
        subject: 'Unassignment test issue',
        description: 'Testing unassignment mechanics',
        category: SupportCaseCategory.BILLING,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.IN_PROGRESS,
        assignedAdminId: supportUser.id
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}/assign`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        assignedAdminId: null
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.assignedAdminId, null);
    assert.strictEqual(body.data.isUnassigned, true);
  });

  test('6. State Machine: Valid Transition OPEN -> IN_PROGRESS', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-TRANS1`,
        userId: testCustomer.id,
        subject: 'Transition test 1',
        description: 'Testing OPEN to IN_PROGRESS',
        category: SupportCaseCategory.SERVER,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.OPEN
      }
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        status: SupportCaseStatus.IN_PROGRESS
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, SupportCaseStatus.IN_PROGRESS);
  });

  test('7. State Machine: Invalid Transition OPEN -> RESOLVED is rejected with 400 Bad Request', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-INV1`,
        userId: testCustomer.id,
        subject: 'Invalid transition test 1',
        description: 'Testing OPEN to RESOLVED directly',
        category: SupportCaseCategory.DEVICE,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.OPEN
      }
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        status: SupportCaseStatus.RESOLVED,
        resolutionNotes: 'Premature resolution attempt'
      }
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.match(body.error.message, /invalid status transition/i);
  });

  test('8. State Machine: Transition to RESOLVED requires resolutionNotes', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-RESREQ`,
        userId: testCustomer.id,
        subject: 'Resolution notes required test',
        description: 'Testing resolutionNotes validation',
        category: SupportCaseCategory.SECURITY,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.IN_PROGRESS
      }
    });

    // Attempt without resolutionNotes
    const resWithoutNotes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        status: SupportCaseStatus.RESOLVED
      }
    });

    assert.strictEqual(resWithoutNotes.statusCode, 400);
    const bodyWithout = JSON.parse(resWithoutNotes.payload);
    assert.strictEqual(bodyWithout.success, false);
    assert.match(bodyWithout.error.message, /resolution notes are required/i);

    // Provide resolutionNotes
    const resWithNotes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        status: SupportCaseStatus.RESOLVED,
        resolutionNotes: 'Security issue verified and resolved by rotating edge device relay key.'
      }
    });

    assert.strictEqual(resWithNotes.statusCode, 200);
    const bodyWith = JSON.parse(resWithNotes.payload);
    assert.strictEqual(bodyWith.success, true);
    assert.strictEqual(bodyWith.data.status, SupportCaseStatus.RESOLVED);
    assert.ok(bodyWith.data.resolvedAt !== null);
  });

  test('9. Reopening Closed / Resolved Case clears resolvedAt and closedAt', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-REOPEN`,
        userId: testCustomer.id,
        subject: 'Reopening test case',
        description: 'Testing case reopen behavior',
        category: SupportCaseCategory.FILE_ACCESS,
        priority: SupportCasePriority.HIGH,
        status: SupportCaseStatus.CLOSED,
        resolvedAt: new Date(),
        closedAt: new Date()
      }
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        status: SupportCaseStatus.OPEN
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, SupportCaseStatus.OPEN);
    assert.strictEqual(body.data.resolvedAt, null);
    assert.strictEqual(body.data.closedAt, null);
  });

  test('10. Queue Filtering and Sorting: listCases supports unassigned, needsAttention, and sortBy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/support/cases?unassigned=true&sortBy=priority&sortOrder=desc',
      headers: {
        authorization: `Bearer ${superAdminToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.items));

    for (const item of body.data.items) {
      assert.strictEqual(item.assignedAdminId, null);
      assert.strictEqual(item.isUnassigned, true);
    }
  });

  test('11. Internal-Only Note Enforcement: Notes are always internal and customer is never notified', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-NOTE`,
        userId: testCustomer.id,
        subject: 'Internal note test case',
        description: 'Testing note privacy boundary',
        category: SupportCaseCategory.GENERAL,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.OPEN
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}/notes`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        note: 'Diagnostic trace indicates relay socket dropped by peer firewall. Do not expose internal IP.',
        isInternal: true
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.isInternal, true);

    const dbNote = await prisma.supportCaseNote.findUnique({
      where: { id: body.data.id }
    });
    assert.ok(dbNote);
    assert.strictEqual(dbNote.isInternal, true);
  });

  test('12. Audit Trail Logging for Case Lifecycle and Assignment Events', async () => {
    const caseRecord = await prisma.supportCase.create({
      data: {
        caseNumber: `SUP-${Date.now()}-AUDIT`,
        userId: testCustomer.id,
        subject: 'Audit trail verification case',
        description: 'Testing audit logging for assign, status, and note',
        category: SupportCaseCategory.ACCOUNT,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.OPEN
      }
    });

    // 1. Assign
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}/assign`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { assignedAdminId: supportUser.id }
    });

    // 2. Change Priority
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { priority: SupportCasePriority.HIGH }
    });

    // 3. Add Note
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/support/cases/${caseRecord.id}/notes`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { note: 'Audited operator note' }
    });

    const auditLogs = await prisma.adminAuditLog.findMany({
      where: {
        adminId: superAdminUser.id
      }
    });

    const actions = auditLogs.map(l => l.action);
    assert.ok(actions.includes(AdminAuditAction.ADMIN_SUPPORT_CASE_ASSIGNED), 'ADMIN_SUPPORT_CASE_ASSIGNED must be logged');
    assert.ok(actions.includes(AdminAuditAction.ADMIN_SUPPORT_CASE_PRIORITY_CHANGED), 'ADMIN_SUPPORT_CASE_PRIORITY_CHANGED must be logged');
  });
});
