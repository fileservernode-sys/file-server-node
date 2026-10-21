// NOTE: These tests are NOT EXECUTED as per policy.

/**
 * -----------------------------------------------------------------------------
 * STATIC TEST SPECIFICATION: ATTEMPT-SPECIFIC WEBHOOK CORRELATION,
 * VERIFIED OPERATOR EVIDENCE & CRASH-SAFE RESEND AUDIT
 * (PHASE 8.4, BATCH E.5.2 ARCHITECTURE)
 *
 * MANDATORY OPERATIONAL RESTRICTION NOTICE:
 * THIS TEST SPECIFICATION IS AUTHORED FOR STATIC VERIFICATION AND REGRESSION AUDITING ONLY.
 * PER MANDATORY PHASE 8.4 RESTRICTIONS, THIS FILE HAS NOT BEEN EXECUTED.
 * DO NOT RUN VIA TEST RUNNERS (npm test, node --test) OR APPLICATION BUILDS.
 * -----------------------------------------------------------------------------
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 8.4 Batch E.5.2: Attempt-Specific Webhook Correlation, Verified Evidence & Crash Safety', () => {

  const reconcilerPath = path.resolve(
    process.cwd(),
    'src/services/billing/email_webhook_reconciliation_worker.ts'
  );
  const outboxWorkerPath = path.resolve(
    process.cwd(),
    'src/services/billing/invoice_notification_outbox_worker.ts'
  );
  const notificationsServicePath = path.resolve(
    process.cwd(),
    'src/routes/admin/operations/billing/notifications_service.ts'
  );
  const notificationsRoutesPath = path.resolve(
    process.cwd(),
    'src/routes/admin/operations/billing/notifications_routes.ts'
  );
  const notificationsSchemasPath = path.resolve(
    process.cwd(),
    'src/routes/admin/operations/billing/notifications_schemas.ts'
  );
  const recoveryServicePath = path.resolve(
    process.cwd(),
    'src/services/billing/billing_invoice_recovery_service.ts'
  );
  const envPath = path.resolve(
    process.cwd(),
    'src/config/env.ts'
  );
  const serverPath = path.resolve(
    process.cwd(),
    'src/server.ts'
  );

  test('SPEC 1: Authorizing a resend does not erase the original ambiguous attempt history or provider identifiers', () => {
    assert.ok(fs.existsSync(notificationsServicePath), 'notifications_service.ts must exist');
    const content = fs.readFileSync(notificationsServicePath, 'utf8');

    assert.ok(
      content.includes("priorAttempts: ["),
      'authorizeResend must archive prior attempt details in metadata.priorAttempts'
    );
    assert.ok(
      content.includes("previousProviderMessageIds"),
      'authorizeResend must preserve previousProviderMessageIds in metadata'
    );
    assert.ok(
      content.includes("transportStartedAt: outbox.transportStartedAt"),
      'authorizeResend must archive the original transportStartedAt before clearing it for the new attempt'
    );
  });

  test('SPEC 2: An ambiguous resend requires explicit operator authorization and rejects PENDING or CLAIMED state races', () => {
    assert.ok(fs.existsSync(notificationsServicePath), 'notifications_service.ts must exist');
    const content = fs.readFileSync(notificationsServicePath, 'utf8');

    assert.ok(
      content.includes("priorStatus === InvoiceNotificationOutboxStatus.PENDING"),
      'authorizeResend must reject notifications that are already PENDING'
    );
    assert.ok(
      content.includes("priorStatus === InvoiceNotificationOutboxStatus.CLAIMED"),
      'authorizeResend must reject notifications that are actively CLAIMED'
    );
    assert.ok(
      content.includes("priorStatus === InvoiceNotificationOutboxStatus.DELIVERED"),
      'authorizeResend must reject notifications that are already DELIVERED'
    );
  });

  test('SPEC 3: A resend authorization cannot be consumed twice concurrently due to optimistic fencing', () => {
    assert.ok(fs.existsSync(notificationsServicePath), 'notifications_service.ts must exist');
    const content = fs.readFileSync(notificationsServicePath, 'utf8');

    assert.ok(
      content.includes("WHERE `id` = ? AND `status` = ? AND `claimVersion` = ?"),
      'authorizeResend must enforce optimistic fencing on both status and claimVersion'
    );
    assert.ok(
      content.includes("if (updateCount === 0) {"),
      'authorizeResend must throw ConflictError if state was concurrently modified'
    );
  });

  test('SPEC 4: Recovery cannot bypass resend authorization because recovery defers to outbox rows', () => {
    assert.ok(fs.existsSync(recoveryServicePath), 'billing_invoice_recovery_service.ts must exist');
    const content = fs.readFileSync(recoveryServicePath, 'utf8');

    assert.ok(
      content.includes("outboxRow = await (prisma as any).invoiceNotificationOutbox?.findFirst"),
      'Recovery must inspect outbox row existence'
    );
    assert.ok(
      content.includes("Skipping direct recovery dispatch: Invoice is governed by outbox record"),
      'Recovery must skip any invoice governed by an outbox record'
    );
  });

  test('SPEC 5: FORCE_MARK_DISPATCHED cannot falsely establish provider acceptance or delivery', () => {
    assert.ok(fs.existsSync(notificationsServicePath), 'notifications_service.ts must exist');
    const content = fs.readFileSync(notificationsServicePath, 'utf8');

    assert.ok(
      content.includes("SET `status` = 'DISPATCHED'"),
      'forceMarkDispatched must update status to DISPATCHED'
    );
    assert.ok(
      !content.includes("resultingStatus: InvoiceNotificationOutboxStatus.DELIVERED"),
      'forceMarkDispatched must never set resultingStatus to DELIVERED'
    );
    assert.ok(
      content.includes("WHERE `id` = ? AND `status` = ?"),
      'forceMarkDispatched must execute conditional atomic update on priorStatus'
    );
  });

  test('SPEC 6: PERMANENT_FAILURE and EXHAUSTED cannot be force-marked without verified evidence', () => {
    assert.ok(fs.existsSync(notificationsServicePath), 'notifications_service.ts must exist');
    const content = fs.readFileSync(notificationsServicePath, 'utf8');

    assert.ok(
      content.includes("priorStatus === InvoiceNotificationOutboxStatus.PERMANENT_FAILURE"),
      'forceMarkDispatched must reject notifications in PERMANENT_FAILURE'
    );
    assert.ok(
      content.includes("priorStatus === InvoiceNotificationOutboxStatus.EXHAUSTED"),
      'forceMarkDispatched must reject notifications in EXHAUSTED status'
    );
  });

  test('SPEC 7: opened and clicked alone do not establish delivery and only record engagement telemetry', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("isDeliveryConfirmation: true"),
      'Only delivered event is classified as isDeliveryConfirmation'
    );
    assert.ok(
      content.includes("isEngagement: true"),
      'opened and clicked must be classified as isEngagement'
    );
    assert.ok(
      content.includes("updatedEngagement.openedAt"),
      'Engagement events must record openedAt in metadata'
    );
    assert.ok(
      content.includes("result.engagementRecordedCount++"),
      'Engagement events must increment engagementRecordedCount without changing delivery status'
    );
  });

  test('SPEC 8: Conflicting delivery and bounce events preserve evidence for operator review', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("hasConflictingEvidence: true"),
      'Conflicting events must set hasConflictingEvidence flag in metadata'
    );
    assert.ok(
      content.includes("conflictingEvents: ["),
      'Conflicting events must be appended to conflictingEvents array in metadata'
    );
    assert.ok(
      content.includes("result.conflictingEvidenceCount++"),
      'Worker must track conflictingEvidenceCount metric'
    );
  });

  test('SPEC 9: A stale inbox worker cannot overwrite a newer worker completion due to optimistic fencing', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("WHERE `id` = ? AND `status` = 'PROCESSING' AND `processingAttempts` = ?"),
      'Inbox completion updates must require status=PROCESSING and matching processingAttempts'
    );
    assert.ok(
      content.includes("STALE_WORKER_FENCING_REJECTED"),
      'Worker must abort transaction if optimistic fence is rejected'
    );
  });

  test('SPEC 10: Lease reclamation is conditional and concurrency-safe', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("WHERE `status` = 'PROCESSING'"),
      'recoverExpiredLeases must check status is PROCESSING'
    );
    assert.ok(
      content.includes("AND `updatedAt` <= ?"),
      'recoverExpiredLeases must check lease timeout cutoff'
    );
  });

  test('SPEC 11: Outbox updates and inbox completion execute inside an atomic database transaction', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("prisma.$transaction(async (tx) => {"),
      'Outbox state change and inbox completion must execute within prisma.$transaction'
    );
  });

  test('SPEC 12: Payload sanitization preserves required matching identifiers without exposing sensitive data', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("sanitizeJsonPayload("),
      'Metadata payloads must be sanitized with sanitizeJsonPayload'
    );
    assert.ok(
      content.includes("cleanMessageId"),
      'cleanMessageId must be preserved for exact matching'
    );
  });

  test('SPEC 13: Unsupported or incomplete webhook events remain available for safe investigation', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("SET `status` = 'UNMATCHED_NO_IDENTIFIER'"),
      'Missing providerMessageId must preserve row with status UNMATCHED_NO_IDENTIFIER'
    );
    assert.ok(
      content.includes("SET `status` = 'UNMATCHED'"),
      'Unmatched webhook must be persisted with UNMATCHED status for triage'
    );
  });

  test('SPEC 14: Reconciliation never sends an email or changes immutable invoice data', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      !content.includes("sendInvoiceIssuedNotification"),
      'Reconciliation worker must never call email transport dispatch'
    );
    assert.ok(
      !content.includes("UPDATE `BillingInvoice`"),
      'Reconciliation worker must never mutate statutory BillingInvoice records'
    );
  });

  test('SPEC 15: Existing RBAC, CSRF, audit, and fail-closed behavior remain strictly enforced', () => {
    assert.ok(fs.existsSync(notificationsRoutesPath), 'notifications_routes.ts must exist');
    assert.ok(fs.existsSync(notificationsServicePath), 'notifications_service.ts must exist');
    const routesContent = fs.readFileSync(notificationsRoutesPath, 'utf8');
    const serviceContent = fs.readFileSync(notificationsServicePath, 'utf8');

    assert.ok(
      routesContent.includes("requireOperationPermission('billing.read')"),
      'Inspection routes must enforce billing.read'
    );
    assert.ok(
      routesContent.includes("requireOperationPermission('billing.reconcile')"),
      'forceMarkDispatched must enforce billing.reconcile'
    );
    assert.ok(
      routesContent.includes("requireOperationPermission('billing.write')"),
      'authorizeResend must enforce billing.write'
    );
    assert.ok(
      serviceContent.includes("executeAdminOperation({"),
      'Mutations must execute within executeAdminOperation for fail-closed audit logging'
    );
  });

  test('SPEC 16: Outbox worker consumes resend authorization upon dispatch and resets resendAuthorized to false', () => {
    assert.ok(fs.existsSync(outboxWorkerPath), 'invoice_notification_outbox_worker.ts must exist');
    const content = fs.readFileSync(outboxWorkerPath, 'utf8');

    assert.ok(
      content.includes("`resendAuthorized` = false"),
      'Outbox worker must reset resendAuthorized to false upon successful dispatch'
    );
    assert.ok(
      content.includes("previousProviderMessageIds"),
      'Outbox worker must preserve previousProviderMessageIds in metadata'
    );
  });

  test('SPEC 17: Historical provider message IDs allow delayed webhooks from previous ambiguous attempts to correlate', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("previousIds.some((pId) => pId.replace(/^<|>$/g, '').trim() === cleanMessageId)"),
      'Reconciliation worker must correlate webhooks matching archived previousProviderMessageIds'
    );
  });

  test('SPEC 18: Repeated reconciliation is idempotent without repeating side effects', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("SET `status` = 'DUPLICATE'"),
      'Repeated delivery events must be marked DUPLICATE without side effects'
    );
  });

  test('SPEC 19: Worker disablement and shutdown prevent new processing', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("if (this.isTickRunning || !this.enabled) return result;"),
      'Tick execution must refuse processing when worker is disabled'
    );
  });

  test('SPEC 20: Missing providerMessageId does not cause payload loss', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("SET `status` = 'UNMATCHED_NO_IDENTIFIER'"),
      'Missing providerMessageId must preserve payload and set status UNMATCHED_NO_IDENTIFIER'
    );
  });

  test('SPEC 21: Attempt-Specific Webhook Correlation distinguishes current from historical attempts', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("isCurrentAttempt = (rowCleanId === cleanMessageId)"),
      'Reconciliation worker must explicitly distinguish current attempt from historical attempt IDs'
    );
    assert.ok(
      content.includes("reconcileHistoricalAttemptRecord"),
      'Historical attempt events must be routed to specialized historical attempt reconciliation'
    );
  });

  test('SPEC 22: Historical attempt bounce does not regress or mutate an active newer resend attempt', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("active resend attempt preserved without mutation"),
      'Historical attempt bounce must be archived in metadata without transitioning active resend status'
    );
    assert.ok(
      content.includes("historicalBounceObserved: true"),
      'Metadata must track historical bounce observation flag'
    );
  });

  test('SPEC 23: Historical delivery confirms delivery while noting historical fulfillment', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("deliveredViaHistoricalAttempt: true"),
      'Historical delivery must record deliveredViaHistoricalAttempt in metadata'
    );
    assert.ok(
      content.includes("historicalDeliveryProviderMessageId"),
      'Historical delivery must record historicalDeliveryProviderMessageId'
    );
  });

  test('SPEC 24: FORCE_MARK_DISPATCHED fails closed without verified persisted provider evidence', () => {
    assert.ok(fs.existsSync(notificationsServicePath), 'notifications_service.ts must exist');
    const content = fs.readFileSync(notificationsServicePath, 'utf8');

    assert.ok(
      content.includes("No persisted provider evidence found in EmailWebhookInbox or EmailMessage"),
      'forceMarkDispatched must fail closed if providerMessageId is not verified in persisted evidence'
    );
    assert.ok(
      content.includes("verifiedEvidence: {"),
      'forceMarkDispatched must store verified evidence source and recordId in metadata'
    );
  });

  test('SPEC 25: Provider event time and local receipt time are treated as distinct concepts', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("eventTimestampMissing: !providerEventTime"),
      'Worker must explicitly flag when provider event timestamp is missing'
    );
    assert.ok(
      content.includes("providerEventTimestamp: providerEventTime ? providerEventTime.toISOString() : null"),
      'Missing provider event timestamp must be preserved as null, not replaced with local receipt time'
    );
  });

  test('SPEC 26: Contradictory evidence preserves both timestamps and requires operator triage', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("hasConflictingEvidence: true"),
      'Conflicting evidence must be flagged in metadata'
    );
    assert.ok(
      content.includes("note: 'Delivery confirmation webhook received for record already in terminal failure'") ||
      content.includes("note: 'Terminal bounce webhook received after delivery was already confirmed'"),
      'Conflicting events must be annotated with explanatory diagnostic note'
    );
  });

  test('SPEC 27: Resend authorization is atomically consumed on ambiguous or terminal failure', () => {
    assert.ok(fs.existsSync(outboxWorkerPath), 'invoice_notification_outbox_worker.ts must exist');
    const content = fs.readFileSync(outboxWorkerPath, 'utf8');

    assert.ok(
      content.includes("`resendAuthorized` = CASE WHEN ? IN ('AMBIGUOUS_OUTCOME', 'PERMANENT_FAILURE', 'EXHAUSTED') THEN false ELSE `resendAuthorized` END"),
      'Outbox worker must reset resendAuthorized to false on terminal failure or ambiguous outcome'
    );
  });

  test('SPEC 28: Lease recovery increments processingAttempts to immediately invalidate stale workers', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("`processingAttempts` = `processingAttempts` + 1"),
      'recoverExpiredLeases must increment processingAttempts when reclaiming expired leases'
    );
  });

  test('SPEC 29: Transaction rollback occurs across all reconciliation branches when inbox fence affects zero rows', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("throw new Error('STALE_WORKER_FENCING_REJECTED')"),
      'Worker must abort transaction when optimistic inbox fence fails'
    );
    assert.ok(
      content.includes("result.staleFencingCount++"),
      'Stale fencing rejections must increment staleFencingCount across all branches'
    );
  });

  test('SPEC 30: Atomic claim query checks expected processingAttempts token before granting lease', () => {
    assert.ok(fs.existsSync(reconcilerPath), 'email_webhook_reconciliation_worker.ts must exist');
    const content = fs.readFileSync(reconcilerPath, 'utf8');

    assert.ok(
      content.includes("AND `processingAttempts` = ?"),
      'reconcileSingleRecord claim query must match expected processingAttempts to prevent stale claims'
    );
  });
});
