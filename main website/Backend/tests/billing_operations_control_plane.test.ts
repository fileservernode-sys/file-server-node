import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import {
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval,
  CurrencyCode,
  ReconciliationStatus,
  ReconciliationDiscrepancyType,
  ReconciliationRunStatus,
  ReconciliationEntityType,
  WebhookEventStatus,
  AuditEventType
} from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { billingReconciliationService } from '../src/services/billing/billing_reconciliation_service.js';
import { RazorpayWebhookService } from '../src/services/billing/providers/razorpay/razorpay_webhook_service.js';

describe('Phase 7.2G: Production Billing Operations Control Plane', () => {
  let app: FastifyInstance;
  let testUser: any;
  let testUserAuthToken: string;
  let operatorUser: any;
  let operatorAuthToken: string;
  let testPlan: any;
  let testPrice: any;
  let testRun: any;
  let testDiscrepancy: any;

  const validAdminKey = 'test_operator_admin_secret_key_123';

  before(async () => {
    process.env.ADMIN_API_KEY = validAdminKey;
    process.env.INTERNAL_SERVICE_KEY = validAdminKey;
    process.env.CRON_SECRET = validAdminKey;

    app = await buildApp();
    await app.ready();

    // 1. Create normal test customer
    const customerEmail = `cust_ops_${Date.now()}@zdexcloud.test`;
    testUser = await prisma.user.create({
      data: {
        email: customerEmail,
        fullName: 'Ops Customer',
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });

    testUserAuthToken = `session_cust_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: testUser.id,
        token: testUserAuthToken,
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    // 2. Create operator user
    const operatorEmail = `operator_${Date.now()}@zdexcloud.internal`;
    operatorUser = await prisma.user.create({
      data: {
        email: operatorEmail,
        fullName: 'ZdexCloud Operator',
        passwordHash: 'dummy_hash',
        emailVerified: true
      }
    });

    operatorAuthToken = `session_op_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: operatorUser.id,
        token: operatorAuthToken,
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    // 3. Ensure test plan and pricing
    testPlan = await prisma.plan.upsert({
      where: { code: 'PRO_MONTHLY' },
      update: {},
      create: {
        code: 'PRO_MONTHLY',
        name: 'Pro Monthly',
        interval: BillingInterval.MONTHLY,
        serverLimit: 5,
        priorityRelay: true
      }
    });

    testPrice = await prisma.planPrice.findFirst({
      where: { planId: testPlan.id, currency: CurrencyCode.INR }
    });

    if (!testPrice) {
      testPrice = await prisma.planPrice.create({
        data: {
          planId: testPlan.id,
          currency: CurrencyCode.INR,
          amountMinorUnits: 49900,
          version: 1
        }
      });
    }

    // 4. Create sample reconciliation run
    testRun = await prisma.billingReconciliationRun.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        periodStart: new Date(Date.now() - 7 * 86400000),
        periodEnd: new Date(),
        status: ReconciliationRunStatus.COMPLETED,
        totalRecords: 15,
        paymentRecords: 10,
        refundRecords: 5,
        matchedCount: 13,
        mismatchCount: 2,
        reviewCount: 2,
        correlationId: `corr_${Date.now()}`,
        startedAt: new Date(Date.now() - 3600000),
        completedAt: new Date(Date.now() - 3500000)
      }
    });

    // 5. Create sample discrepancy
    testDiscrepancy = await prisma.billingReconciliationDiscrepancy.create({
      data: {
        runId: testRun.id,
        provider: PaymentProvider.RAZORPAY,
        entityType: ReconciliationEntityType.PAYMENT,
        providerEntityId: `pay_sample_${Date.now()}`,
        internalEntityId: `sub_internal_${Date.now()}`,
        discrepancyType: ReconciliationDiscrepancyType.PAYMENT_STATE_MISMATCH,
        status: ReconciliationStatus.REQUIRES_REVIEW,
        expectedValue: 'captured',
        actualValue: 'authorized',
        metadata: {
          severity: 'WARNING',
          providerSecretKey: 'should_be_redacted_secret',
          customerAuthToken: 'should_be_redacted_token',
          safeNote: 'Discrepancy detected during cycle'
        }
      }
    });
  });

  after(async () => {
    try {
      if (testDiscrepancy) {
        await prisma.billingReconciliationDiscrepancy.deleteMany({ where: { id: testDiscrepancy.id } });
      }
      if (testRun) {
        await prisma.billingReconciliationRun.deleteMany({ where: { id: testRun.id } });
      }
      if (testUser) {
        await prisma.userSession.deleteMany({ where: { userId: testUser.id } });
        await prisma.user.deleteMany({ where: { id: testUser.id } });
      }
      if (operatorUser) {
        await prisma.userSession.deleteMany({ where: { userId: operatorUser.id } });
        await prisma.user.deleteMany({ where: { id: operatorUser.id } });
      }
    } catch {
      // Non-blocking cleanup
    }
    await app.close();
  });

  // =========================================================================
  // 1. OPERATOR AUTHORIZATION & ACCESS CONTROL
  // =========================================================================

  it('1. Unauthenticated request to operational runs endpoint returns 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/operations/runs'
    });
    assert.strictEqual(res.statusCode, 401);
  });

  it('2. Normal customer Bearer session receives 403 Forbidden across operational endpoints', async () => {
    const endpoints = [
      { method: 'GET' as const, url: '/api/v1/billing/operations/runs' },
      { method: 'GET' as const, url: '/api/v1/billing/operations/discrepancies' },
      { method: 'GET' as const, url: `/api/v1/billing/operations/discrepancies/${testDiscrepancy.id}` },
      { method: 'PATCH' as const, url: `/api/v1/billing/operations/discrepancies/${testDiscrepancy.id}`, payload: { status: 'RESOLVED', resolutionReason: 'Test' } },
      { method: 'GET' as const, url: '/api/v1/billing/operations/webhooks' },
      { method: 'GET' as const, url: '/api/v1/billing/operations/metrics' },
      { method: 'GET' as const, url: '/api/v1/billing/operations/webhooks/health' },
      { method: 'POST' as const, url: '/api/v1/billing/operations/reconcile', payload: {} },
      { method: 'POST' as const, url: '/api/v1/billing/operations/webhooks/replay', payload: { providerEventId: 'evt_123' } }
    ];

    for (const ep of endpoints) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        headers: { authorization: `Bearer ${testUserAuthToken}` },
        payload: (ep as any).payload
      });
      assert.strictEqual(res.statusCode, 403, `Expected 403 on ${ep.method} ${ep.url}, got ${res.statusCode}`);
    }
  });

  it('3. Authorized operator with x-admin-key header succeeds on operational endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/operations/runs',
      headers: {
        'x-admin-key': validAdminKey
      }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.runs));
  });

  it('4. Authorized operator with session + x-admin-authorized header succeeds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/operations/metrics',
      headers: {
        authorization: `Bearer ${operatorAuthToken}`,
        'x-admin-authorized': 'true'
      }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(typeof body.data.totalRuns === 'number');
  });

  // =========================================================================
  // 2. RECONCILIATION RUN HISTORY & PAGINATION
  // =========================================================================

  it('5. Paginated reconciliation runs query supports pagination and bounds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/operations/runs?page=1&limit=5',
      headers: { 'x-admin-key': validAdminKey }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.page, 1);
    assert.strictEqual(body.data.limit, 5);
    assert.ok(body.data.total >= 1);
    assert.ok(body.data.runs.length <= 5);

    // Verify safe fields (no secrets)
    const run = body.data.runs[0];
    assert.ok(run.id);
    assert.ok(run.status);
    assert.strictEqual(run.secret, undefined);
    assert.strictEqual(run.apiKey, undefined);
  });

  it('6. Reconciliation runs filtering by status works accurately', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/operations/runs?status=${ReconciliationRunStatus.COMPLETED}`,
      headers: { 'x-admin-key': validAdminKey }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    for (const r of body.data.runs) {
      assert.strictEqual(r.status, ReconciliationRunStatus.COMPLETED);
    }
  });

  // =========================================================================
  // 3. DISCREPANCY REVIEW, FILTERING & SANITIZATION
  // =========================================================================

  it('7. Discrepancy list query returns paginated records with safe filtering', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/operations/discrepancies?status=${ReconciliationStatus.REQUIRES_REVIEW}&entityType=${ReconciliationEntityType.PAYMENT}`,
      headers: { 'x-admin-key': validAdminKey }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.total >= 1);

    const match = body.data.discrepancies.find((d: any) => d.id === testDiscrepancy.id);
    assert.ok(match, 'Expected to find test discrepancy in filtered results');
    assert.strictEqual(match.status, ReconciliationStatus.REQUIRES_REVIEW);
    assert.strictEqual(match.entityType, ReconciliationEntityType.PAYMENT);
  });

  it('8. Discrepancy metadata sanitizes secret tokens and credentials in responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/operations/discrepancies/${testDiscrepancy.id}`,
      headers: { 'x-admin-key': validAdminKey }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, testDiscrepancy.id);

    // Verify secret redaction in metadata
    assert.strictEqual(body.data.metadata.providerSecretKey, '[REDACTED]');
    assert.strictEqual(body.data.metadata.customerAuthToken, '[REDACTED]');
    assert.strictEqual(body.data.metadata.safeNote, 'Discrepancy detected during cycle');
  });

  it('9. Non-existent discrepancy lookup returns 404 Not Found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/operations/discrepancies/non_existent_disc_id_123',
      headers: { 'x-admin-key': validAdminKey }
    });
    assert.strictEqual(res.statusCode, 404);
  });

  // =========================================================================
  // 4. SAFE DISCREPANCY ACTIONS & AUDIT TRAIL
  // =========================================================================

  it('10. Updating discrepancy status to RESOLVED records resolution and AuditEvent', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/billing/operations/discrepancies/${testDiscrepancy.id}`,
      headers: {
        authorization: `Bearer ${operatorAuthToken}`,
        'x-admin-authorized': 'true'
      },
      payload: {
        status: ReconciliationStatus.RESOLVED,
        resolutionReason: 'Manually verified capture in Razorpay dashboard'
      }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, ReconciliationStatus.RESOLVED);
    assert.strictEqual(body.data.resolutionReason, 'Manually verified capture in Razorpay dashboard');
    assert.strictEqual(body.data.resolvedBy, operatorUser.id);
    assert.ok(body.data.resolvedAt);

    // Verify AuditEvent in database
    const audit = await prisma.auditEvent.findFirst({
      where: {
        eventType: AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_RESOLVED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(audit);
    const meta = audit?.metadata as any;
    assert.strictEqual(meta?.discrepancyId, testDiscrepancy.id);
    assert.strictEqual(meta?.newStatus, ReconciliationStatus.RESOLVED);
  });

  it('11. Updating discrepancy rejects empty resolution reason with 400 ValidationError', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/billing/operations/discrepancies/${testDiscrepancy.id}`,
      headers: { 'x-admin-key': validAdminKey },
      payload: {
        status: ReconciliationStatus.IGNORED,
        resolutionReason: ''
      }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  it('12. Updating discrepancy rejects invalid target status with 400 ValidationError', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/billing/operations/discrepancies/${testDiscrepancy.id}`,
      headers: { 'x-admin-key': validAdminKey },
      payload: {
        status: 'INVALID_STATUS_CODE',
        resolutionReason: 'Test'
      }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  // =========================================================================
  // 5. WEBHOOK LEDGER & REPLAY AUDIT
  // =========================================================================

  it('13. Webhook event ledger lists recorded webhooks with status filtering', async () => {
    const testEvtId = `evt_ledger_${Date.now()}`;
    await prisma.billingWebhookEvent.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerEventId: testEvtId,
        eventType: 'subscription.charged',
        status: WebhookEventStatus.PROCESSED
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/operations/webhooks?status=${WebhookEventStatus.PROCESSED}&eventType=subscription.charged`,
      headers: { 'x-admin-key': validAdminKey }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.total >= 1);
    const evt = body.data.events.find((e: any) => e.providerEventId === testEvtId);
    assert.ok(evt);
    assert.strictEqual(evt.eventType, 'subscription.charged');
    assert.strictEqual(evt.status, WebhookEventStatus.PROCESSED);
  });

  it('14. Webhook replay executes idempotently and records AuditEvent', async () => {
    const replayEvtId = `evt_replay_ops_${Date.now()}`;
    await prisma.billingWebhookEvent.create({
      data: {
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerEventId: replayEvtId,
        eventType: 'subscription.activated',
        status: WebhookEventStatus.PROCESSED
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/operations/webhooks/replay',
      headers: {
        authorization: `Bearer ${operatorAuthToken}`,
        'x-admin-authorized': 'true'
      },
      payload: {
        providerEventId: replayEvtId
      }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.replayed, true);

    // Verify AuditEvent
    const replayAudit = await prisma.auditEvent.findFirst({
      where: {
        eventType: AuditEventType.BILLING_STATE_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(replayAudit);
    const auditMeta = replayAudit?.metadata as any;
    assert.strictEqual(auditMeta?.providerEventId, replayEvtId);
  });

  // =========================================================================
  // 6. RECONCILIATION BOUNDS & LOOKBACK SAFETY
  // =========================================================================

  it('15. Reconciliation trigger enforces lookbackDays maximum bound (<= 90)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/operations/reconcile',
      headers: { 'x-admin-key': validAdminKey },
      payload: {
        lookbackDays: 120, // Exceeds 90 day safety limit
        autoRepair: false
      }
    });
    assert.strictEqual(res.statusCode, 400);
    const body = res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.error.message.includes('90 days'));
  });

  it('16. Reconciliation trigger with valid lookback succeeds and generates audit log', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/operations/reconcile',
      headers: {
        authorization: `Bearer ${operatorAuthToken}`,
        'x-admin-authorized': 'true'
      },
      payload: {
        lookbackDays: 7,
        autoRepair: false
      }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.success, true);

    // Verify AuditEvent
    const reconAudit = await prisma.auditEvent.findFirst({
      where: {
        eventType: AuditEventType.BILLING_RECONCILIATION_STARTED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(reconAudit);
    const meta = reconAudit?.metadata as any;
    assert.strictEqual(meta?.lookbackDays, 7);
    assert.strictEqual(meta?.autoRepair, false);
  });
});
