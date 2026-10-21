// NOTE: These tests are NOT EXECUTED as per policy.
/**
 * ZDEXCLOUD PHASE 9.1 — CUSTOMER ACTIVITY EVENT TAXONOMY STATIC TEST SPECIFICATIONS
 *
 * Verifies:
 * 1. All 5 required customer activity categories are defined.
 * 2. Every CustomerActivityEventType has a complete specification in CUSTOMER_ACTIVITY_TAXONOMY.
 * 3. Every existing Prisma AuditEventType is explicitly classified in EXISTING_AUDIT_EVENT_CLASSIFICATION.
 * 4. Internal, operational, reconciliation, and high-frequency heartbeat/token events are strictly excluded.
 * 5. Metadata privacy sanitization strips secrets, passwords, OTPs, tokens, and unallowed keys.
 * 6. Discriminated AuditEvent mappings (e.g. SERVER_RENAMED, SERVER_DELETED, STATUTORY_INVOICE_ISSUED) resolve deterministically.
 */

import { describe, it, expect } from 'vitest';
import {
  CustomerActivityCategory,
  ALL_CUSTOMER_ACTIVITY_CATEGORIES,
  CustomerActivityEventType,
  CUSTOMER_ACTIVITY_TAXONOMY,
  INTERNAL_ONLY_AUDIT_EVENT_TYPES,
  EXISTING_AUDIT_EVENT_CLASSIFICATION,
  isProhibitedActivityMetadataKey,
  sanitizeCustomerActivityMetadata,
  maskIpAddressForCustomerDisplay,
  resolveAuditEventToCustomerActivity
} from '../src/services/activity/customer_activity_taxonomy.js';

describe('Phase 9.1 — Customer Activity Event Taxonomy', () => {
  it('defines the 5 required customer-visible activity categories', () => {
    expect(ALL_CUSTOMER_ACTIVITY_CATEGORIES).toEqual([
      CustomerActivityCategory.ACCOUNT_SECURITY,
      CustomerActivityCategory.SERVERS_DEVICES,
      CustomerActivityCategory.FILE_ACCESS,
      CustomerActivityCategory.BILLING_INVOICES,
      CustomerActivityCategory.NOTIFICATIONS
    ]);
  });

  it('registers a complete, well-formed specification for every CustomerActivityEventType', () => {
    const allEventTypes = Object.values(CustomerActivityEventType);
    expect(allEventTypes.length).toBeGreaterThanOrEqual(45);

    for (const eventType of allEventTypes) {
      const spec = CUSTOMER_ACTIVITY_TAXONOMY[eventType];
      expect(spec).toBeDefined();
      expect(spec.eventType).toBe(eventType);
      expect(ALL_CUSTOMER_ACTIVITY_CATEGORIES).toContain(spec.category);
      expect(spec.title.trim().length).toBeGreaterThan(0);
      expect(spec.descriptionTemplate.trim().length).toBeGreaterThan(0);
      expect(spec.triggerAction.trim().length).toBeGreaterThan(0);
      expect(spec.sourceService.trim().length).toBeGreaterThan(0);
      expect(['CONFIRMED_RECORDED', 'CONFIRMED_NEEDS_RECORDING', 'PROPOSED_FUTURE']).toContain(
        spec.capabilityStatus
      );
      expect(spec.deduplication).toBeDefined();
      expect(spec.deduplication.rationale.trim().length).toBeGreaterThan(0);

      for (const allowedKey of spec.allowedMetadataKeys) {
        expect(isProhibitedActivityMetadataKey(allowedKey)).toBe(false);
      }
    }
  });

  it('excludes internal, operational, reconciliation, and background token refresh AuditEventTypes from customer display', () => {
    const strictlyInternalEvents = [
      'OTP_SENT',
      'DEVICE_CREDENTIAL_CREATED',
      'DEVICE_SESSION_REFRESHED',
      'DEVICE_SESSION_REFRESH_FAILED',
      'PUSH_TOKEN_REGISTERED',
      'PUSH_TOKEN_UPDATED',
      'PUSH_TOKEN_REVOKED',
      'NOTIFICATION_CREATED',
      'NOTIFICATION_DELIVERY_FAILED',
      'SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED',
      'SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED',
      'SUBSCRIPTION_DOWNGRADE_MISMATCHED',
      'REFUND_PROVIDER_REQUESTED',
      'REFUND_REQUIRES_REVIEW',
      'REFUND_DUPLICATE_REQUEST',
      'BILLING_RECEIPT_GENERATION_FAILED',
      'TAX_CALCULATED',
      'TAX_CALCULATION_FAILED',
      'TAX_CONFIGURATION_MISSING',
      'PROCESSING_FEE_RECORDED',
      'PROCESSING_FEE_PENDING',
      'PROCESSING_FEE_RECONCILIATION_REQUIRED',
      'BILLING_RECONCILIATION_RUN_STARTED',
      'BILLING_RECONCILIATION_RUN_COMPLETED',
      'BILLING_RECONCILIATION_RUN_FAILED',
      'BILLING_RECONCILIATION_DISCREPANCY_DETECTED',
      'BILLING_RECONCILIATION_DISCREPANCY_RESOLVED',
      'BILLING_RECONCILIATION_AUTO_HEALED',
      'BILLING_SETTLEMENT_IMPORTED',
      'BILLING_SETTLEMENT_RECONCILED',
      'BILLING_SETTLEMENT_MISMATCH_DETECTED'
    ];

    for (const internalType of strictlyInternalEvents) {
      expect(INTERNAL_ONLY_AUDIT_EVENT_TYPES.has(internalType)).toBe(true);
      expect(resolveAuditEventToCustomerActivity(internalType, {})).toBeNull();
      expect(EXISTING_AUDIT_EVENT_CLASSIFICATION[internalType]?.visibility).toBe('INTERNAL_ONLY');
    }
  });

  it('resolves discriminated AuditEvent records accurately using metadata.action', () => {
    expect(resolveAuditEventToCustomerActivity('SERVER_CREATED', {})).toBe(
      CustomerActivityEventType.SERVER_CREATED
    );
    expect(
      resolveAuditEventToCustomerActivity('SERVER_CREATED', { action: 'SERVER_RENAMED' })
    ).toBe(CustomerActivityEventType.SERVER_RENAMED);

    expect(resolveAuditEventToCustomerActivity('SERVER_STOPPED', {})).toBe(
      CustomerActivityEventType.SERVER_STOPPED
    );
    expect(
      resolveAuditEventToCustomerActivity('SERVER_STOPPED', { action: 'SERVER_DELETED' })
    ).toBe(CustomerActivityEventType.DEVICE_UNLINKED);

    expect(
      resolveAuditEventToCustomerActivity('BILLING_STATE_UPDATED', {
        action: 'STATUTORY_INVOICE_ISSUED'
      })
    ).toBe(CustomerActivityEventType.INVOICE_ISSUED);
    expect(
      resolveAuditEventToCustomerActivity('BILLING_STATE_UPDATED', {
        action: 'UPDATE_BILLING_PROFILE'
      })
    ).toBe(CustomerActivityEventType.BILLING_PROFILE_UPDATED);
    expect(
      resolveAuditEventToCustomerActivity('BILLING_STATE_UPDATED', {
        action: 'CONFIRM_BILLING_COUNTRY'
      })
    ).toBe(CustomerActivityEventType.BILLING_COUNTRY_CONFIRMED);
    expect(
      resolveAuditEventToCustomerActivity('BILLING_STATE_UPDATED', {
        action: 'INTERNAL_RECONCILIATION'
      })
    ).toBeNull();
  });

  it('strips prohibited secrets, credentials, OTP codes, and unallowed keys from activity metadata', () => {
    const rawMeta = {
      invoiceNumber: 'ZDX/26-27/00001',
      totalMinorUnits: 49900,
      currency: 'INR',
      formattedAmount: '₹499.00',
      planName: 'Pro Monthly',
      passwordHash: '$2b$12$secret',
      otpCode: '123456',
      sessionToken: 'tok_live_secret',
      webhookSecret: 'whsec_123',
      rawPayload: '{"internal":true}',
      unapprovedField: 'should-be-dropped'
    };

    const sanitized = sanitizeCustomerActivityMetadata(
      CustomerActivityEventType.INVOICE_ISSUED,
      rawMeta
    );

    expect(sanitized).toEqual({
      invoiceNumber: 'ZDX/26-27/00001',
      totalMinorUnits: 49900,
      currency: 'INR',
      formattedAmount: '₹499.00',
      planName: 'Pro Monthly'
    });
    expect(sanitized).not.toHaveProperty('passwordHash');
    expect(sanitized).not.toHaveProperty('otpCode');
    expect(sanitized).not.toHaveProperty('sessionToken');
    expect(sanitized).not.toHaveProperty('webhookSecret');
    expect(sanitized).not.toHaveProperty('rawPayload');
    expect(sanitized).not.toHaveProperty('unapprovedField');
  });

  it('masks IPv4 and IPv6 addresses for customer display', () => {
    expect(maskIpAddressForCustomerDisplay('203.0.113.42')).toBe('203.0.113.xxx');
    expect(maskIpAddressForCustomerDisplay('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3:****');
    expect(maskIpAddressForCustomerDisplay(null)).toBe('unknown');
  });
});
