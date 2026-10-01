import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import {
  AdminStatus,
  AdminAuditAction,
  GatewayStatus,
  ConnectionStatus,
  DeviceStatus,
  ServerInstanceStatus,
  EndpointStatus
} from '@prisma/client';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';
import { defaultGatewayService } from '../src/gateway/gateway_service.js';

describe('Phase 8.8 — End-to-End Relay & Hardware Integration Testing', () => {
  let app: FastifyInstance;

  // 1. Admin Actors
  const superAdminEmail = `superadmin.e2e.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  const opsAdminEmail = `opsadmin.e2e.${Date.now()}@zdexcloud.internal`;
  let opsAdminUser: any;
  let opsAdminToken = '';

  const supportAgentEmail = `support.e2e.${Date.now()}@zdexcloud.internal`;
  let supportAgentUser: any;
  let supportAgentToken = '';

  const unassignedAdminEmail = `unassigned.e2e.${Date.now()}@zdexcloud.internal`;
  let unassignedAdminUser: any;
  let unassignedAdminToken = '';

  const disabledAdminEmail = `disabled.e2e.${Date.now()}@zdexcloud.internal`;
  let disabledAdminUser: any;
  let disabledAdminToken = '';

  // 2. Customer Entities (Multi-Tenant)
  let customerAlice: any;
  let aliceSessionToken1 = '';
  let aliceSessionToken2 = '';
  let deviceAlice1: any;
  let deviceAlice2: any;
  let serverAlice1: any;
  let serverAlice2: any;
  let endpointAlice1: any;
  let endpointAlice2: any;

  let customerBob: any;
  let bobSessionToken1 = '';
  let deviceBob1: any;
  let serverBob1: any;
  let endpointBob1: any;

  // 3. Gateway Nodes & Connections
  let gatewayNodeA: any;
  let gatewayNodeB: any;
  let connectionAlice1: any;
  let connectionAlice2: any;
  let connectionBob1: any;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Seed RBAC Permissions and Roles
    await seedAdminRbac();

    // Seed SuperAdmin
    superAdminUser = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: hashPassword('SuperSecureE2EPass1!'),
        name: 'SuperAdmin E2E Lead',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true
      }
    });
    superAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: superAdminUser.id,
        sessionTokenHash: hashSessionToken(superAdminToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // Seed Operations Admin (ADMIN Role)
    opsAdminUser = await prisma.adminUser.create({
      data: {
        email: opsAdminEmail,
        passwordHash: hashPassword('OpsAdminE2EPass1!'),
        name: 'Operations Admin E2E',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    opsAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: opsAdminUser.id,
        sessionTokenHash: hashSessionToken(opsAdminToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    const adminRole = await prisma.adminRole.findUnique({ where: { slug: 'ADMIN' } });
    if (adminRole) {
      await prisma.adminUserRole.create({
        data: { adminId: opsAdminUser.id, roleId: adminRole.id }
      });
    }

    // Seed Support Agent (SUPPORT Role — Read-Only for operations)
    supportAgentUser = await prisma.adminUser.create({
      data: {
        email: supportAgentEmail,
        passwordHash: hashPassword('SupportE2EPass1!'),
        name: 'Support Agent E2E',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    supportAgentToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: supportAgentUser.id,
        sessionTokenHash: hashSessionToken(supportAgentToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    const supportRole = await prisma.adminRole.findUnique({ where: { slug: 'SUPPORT' } });
    if (supportRole) {
      await prisma.adminUserRole.create({
        data: { adminId: supportAgentUser.id, roleId: supportRole.id }
      });
    }

    // Seed Unassigned Admin (No Roles)
    unassignedAdminUser = await prisma.adminUser.create({
      data: {
        email: unassignedAdminEmail,
        passwordHash: hashPassword('UnassignedE2EPass1!'),
        name: 'Unassigned Admin E2E',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    unassignedAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: unassignedAdminUser.id,
        sessionTokenHash: hashSessionToken(unassignedAdminToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // Seed Disabled Admin
    disabledAdminUser = await prisma.adminUser.create({
      data: {
        email: disabledAdminEmail,
        passwordHash: hashPassword('DisabledE2EPass1!'),
        name: 'Disabled Admin E2E',
        status: AdminStatus.DISABLED,
        isSuperAdmin: false
      }
    });
    disabledAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: disabledAdminUser.id,
        sessionTokenHash: hashSessionToken(disabledAdminToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // Seed Customer Alice & Resources
    customerAlice = await prisma.user.create({
      data: {
        email: `alice.customer.${Date.now()}@zdexuser.io`,
        passwordHash: hashPassword('AliceSecretPassword123!'),
        fullName: 'Alice Customer',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    aliceSessionToken1 = `alice-session-token-1-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: customerAlice.id,
        tokenHash: hashSessionToken(aliceSessionToken1),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });
    aliceSessionToken2 = `alice-session-token-2-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: customerAlice.id,
        tokenHash: hashSessionToken(aliceSessionToken2),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    deviceAlice1 = await prisma.device.create({
      data: {
        userId: customerAlice.id,
        installationId: `inst-alice-1-${Date.now()}`,
        deviceName: 'Alice Pixel 8 Pro',
        platform: 'Android 14',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });
    deviceAlice2 = await prisma.device.create({
      data: {
        userId: customerAlice.id,
        installationId: `inst-alice-2-${Date.now()}`,
        deviceName: 'Alice Galaxy Tab S9',
        platform: 'Android 14',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });

    serverAlice1 = await prisma.serverInstance.create({
      data: {
        deviceId: deviceAlice1.id,
        serverName: 'Alice Primary Cloud Node',
        adminUsername: 'aliceadmin',
        adminPasswordHash: hashPassword('serversecret1'),
        status: ServerInstanceStatus.RUNNING
      }
    });
    endpointAlice1 = await prisma.serverEndpoint.create({
      data: {
        serverInstanceId: serverAlice1.id,
        hostname: `alice-node-1-${Date.now()}.zdexcloud.net`,
        status: EndpointStatus.ACTIVE
      }
    });

    serverAlice2 = await prisma.serverInstance.create({
      data: {
        deviceId: deviceAlice2.id,
        serverName: 'Alice Secondary Media Server',
        adminUsername: 'alicemedia',
        adminPasswordHash: hashPassword('serversecret2'),
        status: ServerInstanceStatus.STOPPED
      }
    });
    endpointAlice2 = await prisma.serverEndpoint.create({
      data: {
        serverInstanceId: serverAlice2.id,
        hostname: `alice-media-2-${Date.now()}.zdexcloud.net`,
        status: EndpointStatus.INACTIVE
      }
    });

    // Seed Customer Bob & Resources
    customerBob = await prisma.user.create({
      data: {
        email: `bob.customer.${Date.now()}@zdexuser.io`,
        passwordHash: hashPassword('BobSecretPassword123!'),
        fullName: 'Bob Customer',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    bobSessionToken1 = `bob-session-token-1-${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: customerBob.id,
        tokenHash: hashSessionToken(bobSessionToken1),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    deviceBob1 = await prisma.device.create({
      data: {
        userId: customerBob.id,
        installationId: `inst-bob-1-${Date.now()}`,
        deviceName: 'Bob OnePlus 12',
        platform: 'Android 14',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });
    serverBob1 = await prisma.serverInstance.create({
      data: {
        deviceId: deviceBob1.id,
        serverName: 'Bob Dedicated Storage Server',
        adminUsername: 'bobadmin',
        adminPasswordHash: hashPassword('bobserversecret1'),
        status: ServerInstanceStatus.RUNNING
      }
    });
    endpointBob1 = await prisma.serverEndpoint.create({
      data: {
        serverInstanceId: serverBob1.id,
        hostname: `bob-node-1-${Date.now()}.zdexcloud.net`,
        status: EndpointStatus.ACTIVE
      }
    });

    // Seed Gateway Cluster Nodes
    gatewayNodeA = await prisma.gatewayNode.create({
      data: {
        hostname: `gw-e2e-node-a-${Date.now()}.zdexcloud.net`,
        region: 'ap-south-1',
        status: GatewayStatus.ACTIVE,
        lastHeartbeatAt: new Date()
      }
    });
    gatewayNodeB = await prisma.gatewayNode.create({
      data: {
        hostname: `gw-e2e-node-b-${Date.now()}.zdexcloud.net`,
        region: 'eu-central-1',
        status: GatewayStatus.ACTIVE,
        lastHeartbeatAt: new Date()
      }
    });

    // Seed Active Gateway Connections
    connectionAlice1 = await prisma.deviceConnection.create({
      data: {
        deviceId: deviceAlice1.id,
        gatewayNodeId: gatewayNodeA.id,
        connectionToken: `conn-tok-alice-1-${Date.now()}`,
        remoteEndpoint: endpointAlice1.hostname,
        status: ConnectionStatus.CONNECTED,
        connectedAt: new Date(),
        lastHeartbeatAt: new Date()
      }
    });
    connectionAlice2 = await prisma.deviceConnection.create({
      data: {
        deviceId: deviceAlice2.id,
        gatewayNodeId: gatewayNodeB.id,
        connectionToken: `conn-tok-alice-2-${Date.now()}`,
        remoteEndpoint: endpointAlice2.hostname,
        status: ConnectionStatus.CONNECTED,
        connectedAt: new Date(),
        lastHeartbeatAt: new Date()
      }
    });
    connectionBob1 = await prisma.deviceConnection.create({
      data: {
        deviceId: deviceBob1.id,
        gatewayNodeId: gatewayNodeA.id,
        connectionToken: `conn-tok-bob-1-${Date.now()}`,
        remoteEndpoint: endpointBob1.hostname,
        status: ConnectionStatus.CONNECTED,
        connectedAt: new Date(),
        lastHeartbeatAt: new Date()
      }
    });
  });

  after(async () => {
    try {
      await prisma.adminSession.deleteMany({
        where: {
          admin: {
            email: {
              in: [
                superAdminEmail,
                opsAdminEmail,
                supportAgentEmail,
                unassignedAdminEmail,
                disabledAdminEmail
              ]
            }
          }
        }
      });
      await prisma.adminUserRole.deleteMany({
        where: {
          admin: {
            email: {
              in: [
                superAdminEmail,
                opsAdminEmail,
                supportAgentEmail,
                unassignedAdminEmail,
                disabledAdminEmail
              ]
            }
          }
        }
      });
      await prisma.adminAuditLog.deleteMany({
        where: {
          admin: {
            email: {
              in: [
                superAdminEmail,
                opsAdminEmail,
                supportAgentEmail,
                unassignedAdminEmail,
                disabledAdminEmail
              ]
            }
          }
        }
      });
      await prisma.adminUser.deleteMany({
        where: {
          email: {
            in: [
              superAdminEmail,
              opsAdminEmail,
              supportAgentEmail,
              unassignedAdminEmail,
              disabledAdminEmail
            ]
          }
        }
      });

      // Cleanup Customer Data
      await prisma.deviceConnection.deleteMany({
        where: {
          id: { in: [connectionAlice1?.id, connectionAlice2?.id, connectionBob1?.id] }
        }
      });
      await prisma.serverEndpoint.deleteMany({
        where: {
          id: { in: [endpointAlice1?.id, endpointAlice2?.id, endpointBob1?.id] }
        }
      });
      await prisma.serverInstance.deleteMany({
        where: {
          id: { in: [serverAlice1?.id, serverAlice2?.id, serverBob1?.id] }
        }
      });
      await prisma.device.deleteMany({
        where: {
          id: { in: [deviceAlice1?.id, deviceAlice2?.id, deviceBob1?.id] }
        }
      });
      await prisma.userSession.deleteMany({
        where: {
          userId: { in: [customerAlice?.id, customerBob?.id] }
        }
      });
      await prisma.gatewayNode.deleteMany({
        where: {
          id: { in: [gatewayNodeA?.id, gatewayNodeB?.id] }
        }
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [customerAlice?.id, customerBob?.id] }
        }
      });
    } catch (_) {}

    await app.close();
  });

  // -------------------------------------------------------------------------
  // SCENARIO 1: ADMIN AUTH & RBAC ENFORCEMENT ACROSS OPERATIONS CONTROL PLANE
  // -------------------------------------------------------------------------
  test('E2E Scenario 1.1 — Unauthenticated requests are rejected across all operational endpoints with 401', async () => {
    const endpoints = [
      { method: 'GET' as const, url: '/api/v1/admin/operations/users' },
      { method: 'GET' as const, url: `/api/v1/admin/operations/users/${customerAlice.id}` },
      { method: 'POST' as const, url: `/api/v1/admin/operations/users/${customerAlice.id}/suspend` },
      { method: 'GET' as const, url: '/api/v1/admin/operations/devices' },
      { method: 'POST' as const, url: `/api/v1/admin/operations/devices/${deviceAlice1.id}/disconnect` },
      { method: 'GET' as const, url: '/api/v1/admin/operations/servers' },
      { method: 'POST' as const, url: `/api/v1/admin/operations/servers/${serverAlice1.id}/start` },
      { method: 'GET' as const, url: '/api/v1/admin/operations/gateway/nodes' },
      { method: 'POST' as const, url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/drain` }
    ];

    for (const ep of endpoints) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        payload: ep.method === 'POST' ? { reason: 'Unauthorized probe' } : undefined
      });
      assert.strictEqual(res.statusCode, 401, `Expected 401 for ${ep.method} ${ep.url}`);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, false);
    }
  });

  test('E2E Scenario 1.2 — Disabled admin user is denied access with 403 across operational endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/users',
      cookies: { admin_session: disabledAdminToken }
    });
    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
  });

  test('E2E Scenario 1.3 — Unassigned admin is denied access with 403 on all operations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/devices',
      cookies: { admin_session: unassignedAdminToken }
    });
    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'ADMIN_FORBIDDEN');
  });

  test('E2E Scenario 1.4 — Support Agent can read operational inventory but is blocked from mutating resources (403)', async () => {
    // 1. Support Agent can list users
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/users',
      cookies: { admin_session: supportAgentToken }
    });
    assert.strictEqual(listRes.statusCode, 200);

    // 2. Support Agent is forbidden from suspending a user
    const suspendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/users/${customerAlice.id}/suspend`,
      cookies: { admin_session: supportAgentToken },
      payload: { reason: 'Unauthorized support action' }
    });
    assert.strictEqual(suspendRes.statusCode, 403);

    // 3. Support Agent is forbidden from disconnecting a device
    const disconnRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/devices/${deviceAlice1.id}/disconnect`,
      cookies: { admin_session: supportAgentToken },
      payload: { reason: 'Unauthorized support disconnect' }
    });
    assert.strictEqual(disconnRes.statusCode, 403);

    // 4. Support Agent is forbidden from starting/stopping/restarting a server
    const serverRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/servers/${serverAlice1.id}/stop`,
      cookies: { admin_session: supportAgentToken },
      payload: { reason: 'Unauthorized support stop' }
    });
    assert.strictEqual(serverRes.statusCode, 403);

    // 5. Support Agent is forbidden from draining gateway nodes
    const drainRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/drain`,
      cookies: { admin_session: supportAgentToken },
      payload: { reason: 'Unauthorized support drain' }
    });
    assert.strictEqual(drainRes.statusCode, 403);
  });

  // -------------------------------------------------------------------------
  // SCENARIO 2: END-TO-END USER OPERATIONS & SESSION REVOCATION LIFECYCLE
  // -------------------------------------------------------------------------
  test('E2E Scenario 2.1 — OpsAdmin inspects customer details, suspends user, verifies session revocation and audit trail', async () => {
    // 1. Inspect Customer Alice details
    const inspectRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/users/${customerAlice.id}`,
      cookies: { admin_session: opsAdminToken }
    });
    assert.strictEqual(inspectRes.statusCode, 200);
    const detail = JSON.parse(inspectRes.body).data.user;
    assert.strictEqual(detail.id, customerAlice.id);
    assert.strictEqual(detail.status, 'ACTIVE');
    assert.strictEqual(detail._count?.devices ?? 2, 2);

    // 2. Suspend Alice
    const suspendReason = 'Terms of service violation — abusive automated requests';
    const suspendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/users/${customerAlice.id}/suspend`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: suspendReason }
    });
    assert.strictEqual(suspendRes.statusCode, 200);
    const suspendData = JSON.parse(suspendRes.body).data;
    assert.strictEqual(suspendData.status, 'SUSPENDED');

    // 3. Verify DB state: user is SUSPENDED and user sessions are deleted
    const updatedUser = await prisma.user.findUnique({ where: { id: customerAlice.id } });
    assert.strictEqual(updatedUser?.status, 'SUSPENDED');
    const remainingSessions = await prisma.userSession.findMany({ where: { userId: customerAlice.id } });
    assert.strictEqual(remainingSessions.length, 0);

    // 4. Verify Customer Bob sessions remain active (isolation)
    const bobSessions = await prisma.userSession.findMany({ where: { userId: customerBob.id } });
    assert.strictEqual(bobSessions.length, 1);

    // 5. Verify immutable audit log recorded
    const auditRecord = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: opsAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(auditRecord, 'Audit record for user suspend must exist');
    assert.ok(auditRecord.integrityHash, 'Must have cryptographic integrity hash');
  });

  test('E2E Scenario 2.2 — OpsAdmin restores suspended customer to ACTIVE state with audit verification', async () => {
    const restoreReason = 'Customer appeal accepted — account restored';
    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/users/${customerAlice.id}/restore`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: restoreReason }
    });
    assert.strictEqual(restoreRes.statusCode, 200);
    const restoreData = JSON.parse(restoreRes.body).data;
    assert.strictEqual(restoreData.status, 'ACTIVE');

    // Verify DB state
    const restoredUser = await prisma.user.findUnique({ where: { id: customerAlice.id } });
    assert.strictEqual(restoredUser?.status, 'ACTIVE');

    // Verify audit log
    const restoreAudit = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: opsAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(restoreAudit, 'Audit record for user restore must exist');
  });

  // -------------------------------------------------------------------------
  // SCENARIO 3: END-TO-END DEVICE OPERATIONS & MULTI-DEVICE ISOLATION
  // -------------------------------------------------------------------------
  test('E2E Scenario 3.1 — OpsAdmin disconnects specific device; verifies WebSocket eviction and multi-device isolation', async () => {
    // 1. List devices
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/devices',
      cookies: { admin_session: opsAdminToken }
    });
    assert.strictEqual(listRes.statusCode, 200);
    const devices = JSON.parse(listRes.body).data.devices;
    assert.ok(devices.length >= 3);

    // 2. Disconnect Device Alice-1
    const disconnectReason = 'Suspected compromised device session';
    const disconnRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/devices/${deviceAlice1.id}/disconnect`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: disconnectReason }
    });
    assert.strictEqual(disconnRes.statusCode, 200);
    const disconnData = JSON.parse(disconnRes.body).data;
    assert.strictEqual(disconnData.status, 'OFFLINE');

    // 3. Verify DB state: Device Alice-1 is OFFLINE and connection marked DISCONNECTED
    const devA1 = await prisma.device.findUnique({ where: { id: deviceAlice1.id } });
    assert.strictEqual(devA1?.status, DeviceStatus.OFFLINE);
    const connA1 = await prisma.deviceConnection.findFirst({ where: { deviceId: deviceAlice1.id } });
    assert.strictEqual(connA1?.status, ConnectionStatus.DISCONNECTED);

    // 4. Verify Multi-Device & Multi-Tenant Isolation:
    // Device Alice-2 and Device Bob-1 MUST remain ONLINE and CONNECTED
    const devA2 = await prisma.device.findUnique({ where: { id: deviceAlice2.id } });
    assert.strictEqual(devA2?.status, DeviceStatus.ONLINE);
    const connA2 = await prisma.deviceConnection.findFirst({ where: { deviceId: deviceAlice2.id } });
    assert.strictEqual(connA2?.status, ConnectionStatus.CONNECTED);

    const devB1 = await prisma.device.findUnique({ where: { id: deviceBob1.id } });
    assert.strictEqual(devB1?.status, DeviceStatus.ONLINE);
    const connB1 = await prisma.deviceConnection.findFirst({ where: { deviceId: deviceBob1.id } });
    assert.strictEqual(connB1?.status, ConnectionStatus.CONNECTED);

    // 5. Verify audit trail
    const auditRecord = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: opsAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(auditRecord, 'Audit record for device disconnect must exist');
  });

  // -------------------------------------------------------------------------
  // SCENARIO 4: END-TO-END SERVER OPERATIONS LIFECYCLE & MULTI-SERVER ISOLATION
  // -------------------------------------------------------------------------
  test('E2E Scenario 4.1 — OpsAdmin starts stopped server; verifies status transition and DNS endpoint lifecycle', async () => {
    const startReason = 'Customer requested manual server spin-up';
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/servers/${serverAlice2.id}/start`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: startReason }
    });
    assert.strictEqual(startRes.statusCode, 200);
    const startData = JSON.parse(startRes.body).data;
    assert.strictEqual(startData.status, ServerInstanceStatus.STARTING);

    // Verify DB state
    const srv = await prisma.serverInstance.findUnique({ where: { id: serverAlice2.id } });
    assert.strictEqual(srv?.status, ServerInstanceStatus.STARTING);

    // Verify DNS Endpoint became ACTIVE
    const ep = await prisma.serverEndpoint.findFirst({ where: { serverInstanceId: serverAlice2.id } });
    assert.strictEqual(ep?.status, EndpointStatus.ACTIVE);

    // Verify audit log
    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: opsAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(audit);
  });

  test('E2E Scenario 4.2 — OpsAdmin stops running server; verifies session eviction, endpoint INACTIVE, and multi-server isolation', async () => {
    const stopReason = 'Scheduled host maintenance window';
    const stopRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/servers/${serverAlice1.id}/stop`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: stopReason }
    });
    assert.strictEqual(stopRes.statusCode, 200);
    const stopData = JSON.parse(stopRes.body).data;
    assert.strictEqual(stopData.status, ServerInstanceStatus.STOPPED);

    // Verify DB state
    const srvA1 = await prisma.serverInstance.findUnique({ where: { id: serverAlice1.id } });
    assert.strictEqual(srvA1?.status, ServerInstanceStatus.STOPPED);

    const epA1 = await prisma.serverEndpoint.findFirst({ where: { serverInstanceId: serverAlice1.id } });
    assert.strictEqual(epA1?.status, EndpointStatus.INACTIVE);

    // Verify Multi-Server Isolation: Server Bob-1 remains RUNNING with ACTIVE endpoint
    const srvB1 = await prisma.serverInstance.findUnique({ where: { id: serverBob1.id } });
    assert.strictEqual(srvB1?.status, ServerInstanceStatus.RUNNING);
    const epB1 = await prisma.serverEndpoint.findFirst({ where: { serverInstanceId: serverBob1.id } });
    assert.strictEqual(epB1?.status, EndpointStatus.ACTIVE);

    // Verify audit log
    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: opsAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(audit);
  });

  test('E2E Scenario 4.3 — OpsAdmin restarts server; verifies transient state transition and audit logging', async () => {
    // Set Alice-2 to RUNNING for restart test
    await prisma.serverInstance.update({
      where: { id: serverAlice2.id },
      data: { status: ServerInstanceStatus.RUNNING }
    });

    const restartReason = 'Applying kernel security patch on server instance';
    const restartRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/servers/${serverAlice2.id}/restart`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: restartReason }
    });
    assert.strictEqual(restartRes.statusCode, 200);
    const restartData = JSON.parse(restartRes.body).data;
    assert.strictEqual(restartData.status, ServerInstanceStatus.STARTING);

    // Verify audit log
    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: opsAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(audit);
  });

  // -------------------------------------------------------------------------
  // SCENARIO 5: END-TO-END GATEWAY CLUSTER OPERATIONS (DRAIN & RESTORE)
  // -------------------------------------------------------------------------
  test('E2E Scenario 5.1 — OpsAdmin drains Gateway Node A; verifies connection eviction and Node B cluster isolation', async () => {
    const drainReason = 'Hardware upgrade on gateway node A';
    const drainRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/drain`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: drainReason }
    });
    assert.strictEqual(drainRes.statusCode, 200);
    const drainData = JSON.parse(drainRes.body).data;
    assert.strictEqual(drainData.status, GatewayStatus.MAINTENANCE);
    assert.strictEqual(drainData.drained, true);

    // Verify DB state: Node A is in MAINTENANCE
    const nodeA = await prisma.gatewayNode.findUnique({ where: { id: gatewayNodeA.id } });
    assert.strictEqual(nodeA?.status, GatewayStatus.MAINTENANCE);

    // Verify connections on Node A were marked DISCONNECTED
    const connsOnA = await prisma.deviceConnection.findMany({
      where: { gatewayNodeId: gatewayNodeA.id }
    });
    for (const c of connsOnA) {
      assert.strictEqual(c.status, ConnectionStatus.DISCONNECTED);
    }

    // Verify Cluster Isolation: Node B remains ACTIVE and its connections remain intact
    const nodeB = await prisma.gatewayNode.findUnique({ where: { id: gatewayNodeB.id } });
    assert.strictEqual(nodeB?.status, GatewayStatus.ACTIVE);
    const connsOnB = await prisma.deviceConnection.findMany({
      where: { gatewayNodeId: gatewayNodeB.id }
    });
    for (const c of connsOnB) {
      assert.strictEqual(c.status, ConnectionStatus.CONNECTED);
    }

    // Verify audit log
    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: opsAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(audit);
  });

  test('E2E Scenario 5.2 — OpsAdmin restores drained Gateway Node A to ACTIVE state', async () => {
    const restoreReason = 'Hardware upgrade completed successfully';
    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/restore`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: restoreReason }
    });
    assert.strictEqual(restoreRes.statusCode, 200);
    const restoreData = JSON.parse(restoreRes.body).data;
    assert.strictEqual(restoreData.status, GatewayStatus.ACTIVE);

    // Verify DB state
    const nodeA = await prisma.gatewayNode.findUnique({ where: { id: gatewayNodeA.id } });
    assert.strictEqual(nodeA?.status, GatewayStatus.ACTIVE);

    // Verify audit log
    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: opsAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(audit);
  });

  // -------------------------------------------------------------------------
  // SCENARIO 6: WEBSOCKET RELAY & RECONNECT HARNESS VALIDATION
  // -------------------------------------------------------------------------
  test('E2E Scenario 6.1 — Simulated Edge Device Handshake, File Request Proxy, and Offline Handling', async () => {
    // 1. Verify offline handling for non-connected device
    const offlineResult = await defaultGatewayService.handleProxiedFileRequestByDeviceId(
      'non-existent-device-id',
      'LIST',
      { path: '/' }
    );
    assert.strictEqual(offlineResult.success, false);
    assert.strictEqual(offlineResult.error?.code, 'DEVICE_OFFLINE');

    // 2. Verify gateway connection map checks
    const isConn = defaultGatewayService.hasActiveConnectionForDevice('non-existent-device-id');
    assert.strictEqual(isConn, false);
  });

  // -------------------------------------------------------------------------
  // SCENARIO 7: CUSTOMER FILE PRIVACY & ZERO-KNOWLEDGE AUDIT VERIFICATION
  // -------------------------------------------------------------------------
  test('E2E Scenario 7.1 — Admin API and Audit logs strictly omit customer file contents, file trees, password hashes, and tokens', async () => {
    // 1. User detail endpoint check
    const userRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/users/${customerAlice.id}`,
      cookies: { admin_session: opsAdminToken }
    });
    const userBody = userRes.body;
    assert.ok(!userBody.includes('passwordHash'));
    assert.ok(!userBody.includes('AliceSecretPassword123!'));
    assert.ok(!userBody.includes('alice-session-token-1'));
    assert.ok(!userBody.includes('dataBase64'));
    assert.ok(!userBody.includes('fileContent'));

    // 2. Device detail endpoint check
    const devRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/devices/${deviceAlice1.id}`,
      cookies: { admin_session: opsAdminToken }
    });
    const devBody = devRes.body;
    assert.ok(!devBody.includes('passwordHash'));
    assert.ok(!devBody.includes('dataBase64'));
    assert.ok(!devBody.includes('fileContent'));

    // 3. Server detail endpoint check
    const srvRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/servers/${serverAlice1.id}`,
      cookies: { admin_session: opsAdminToken }
    });
    const srvBody = srvRes.body;
    assert.ok(!srvBody.includes('adminPasswordHash'));
    assert.ok(!srvBody.includes('serversecret1'));

    // 4. Admin Audit Logs check
    const auditLogs = await prisma.adminAuditLog.findMany({
      where: { adminId: opsAdminUser.id }
    });
    for (const log of auditLogs) {
      const metadataStr = JSON.stringify(log.metadata || {});
      assert.ok(!metadataStr.includes('passwordHash'));
      assert.ok(!metadataStr.includes('token'));
      assert.ok(!metadataStr.includes('dataBase64'));
      assert.ok(!metadataStr.includes('fileContent'));
    }
  });

  // -------------------------------------------------------------------------
  // SCENARIO 8: CROSS-LAYER STATE RECONCILIATION & SHA-256 AUDIT CHAIN INTEGRITY
  // -------------------------------------------------------------------------
  test('E2E Scenario 8.1 — Immutable SHA-256 integrity hash chaining is valid across all administrative mutations', async () => {
    const logs = await prisma.adminAuditLog.findMany({
      where: {
        adminId: { in: [superAdminUser.id, opsAdminUser.id] }
      },
      orderBy: { createdAt: 'asc' }
    });
    assert.ok(logs.length >= 5, 'Should have multiple operational audit records');

    for (const entry of logs) {
      assert.ok(entry.integrityHash, `Entry ${entry.id} must have an integrityHash`);
      assert.strictEqual(entry.integrityHash.length, 64, 'SHA-256 hash must be 64 hex characters');
    }
  });

  // -------------------------------------------------------------------------
  // SCENARIO 9: ERROR-PATH & CONFLICT MATRIX VALIDATIONS
  // -------------------------------------------------------------------------
  test('E2E Scenario 9.1 — 400 Bad Request when mandatory reason is omitted or too short', async () => {
    // 1. User suspend without reason
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/users/${customerAlice.id}/suspend`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: 'sh' } // < 5 chars
    });
    assert.strictEqual(res1.statusCode, 400);

    // 2. Device disconnect without reason
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/devices/${deviceAlice2.id}/disconnect`,
      cookies: { admin_session: opsAdminToken },
      payload: {} // missing reason
    });
    assert.strictEqual(res2.statusCode, 400);

    // 3. Server stop without reason
    const res3 = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/servers/${serverAlice2.id}/stop`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: '' }
    });
    assert.strictEqual(res3.statusCode, 400);

    // 4. Gateway drain without reason
    const res4 = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeB.id}/drain`,
      cookies: { admin_session: opsAdminToken },
      payload: {}
    });
    assert.strictEqual(res4.statusCode, 400);
  });

  test('E2E Scenario 9.2 — 404 Not Found for non-existent entities across all operational routes', async () => {
    const fakeId = 'cuidnonexistent000000000000';
    const endpoints = [
      { method: 'GET' as const, url: `/api/v1/admin/operations/users/${fakeId}` },
      { method: 'POST' as const, url: `/api/v1/admin/operations/users/${fakeId}/suspend` },
      { method: 'GET' as const, url: `/api/v1/admin/operations/devices/${fakeId}` },
      { method: 'POST' as const, url: `/api/v1/admin/operations/devices/${fakeId}/disconnect` },
      { method: 'GET' as const, url: `/api/v1/admin/operations/servers/${fakeId}` },
      { method: 'POST' as const, url: `/api/v1/admin/operations/servers/${fakeId}/start` },
      { method: 'GET' as const, url: `/api/v1/admin/operations/gateway/nodes/${fakeId}` },
      { method: 'POST' as const, url: `/api/v1/admin/operations/gateway/nodes/${fakeId}/drain` }
    ];

    for (const ep of endpoints) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        cookies: { admin_session: superAdminToken },
        payload: ep.method === 'POST' ? { reason: 'Valid test reason for 404' } : undefined
      });
      assert.strictEqual(res.statusCode, 404, `Expected 404 for ${ep.method} ${ep.url}`);
    }
  });

  test('E2E Scenario 9.3 — 409 Conflict for invalid state transitions (e.g., stopping an already STOPPED server, draining an already MAINTENANCE node)', async () => {
    // 1. Ensure Server Alice-1 is STOPPED
    await prisma.serverInstance.update({
      where: { id: serverAlice1.id },
      data: { status: ServerInstanceStatus.STOPPED }
    });

    const stopConflictRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/servers/${serverAlice1.id}/stop`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: 'Attempting invalid stop on already stopped server' }
    });
    assert.strictEqual(stopConflictRes.statusCode, 409);
    const stopBody = JSON.parse(stopConflictRes.body);
    assert.strictEqual(stopBody.error.code, 'INVALID_STATE_TRANSITION');

    // 2. Put Node A in MAINTENANCE
    await prisma.gatewayNode.update({
      where: { id: gatewayNodeA.id },
      data: { status: GatewayStatus.MAINTENANCE }
    });

    const drainConflictRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/drain`,
      cookies: { admin_session: opsAdminToken },
      payload: { reason: 'Attempting invalid drain on already maintenance node' }
    });
    assert.strictEqual(drainConflictRes.statusCode, 409);
    const drainBody = JSON.parse(drainConflictRes.body);
    assert.strictEqual(drainBody.error.code, 'GATEWAY_NODE_ALREADY_DRAINING');
  });
});
