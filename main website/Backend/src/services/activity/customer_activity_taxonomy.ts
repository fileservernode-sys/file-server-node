import { AuditEventType } from '@prisma/client';

/**
 * ZDEXCLOUD PHASE 9.1 - AUTHORITATIVE CUSTOMER ACTIVITY EVENT TAXONOMY
 *
 * Defines the canonical, customer-visible activity categories, event types,
 * display templates, safe metadata allowlists, existing AuditEventType mappings,
 * noise-suppression policies, and privacy sanitization rules for:
 * - Phase 9.2: Backend Activity Event Recording
 * - Phase 9.3: Customer Activity History API
 * - Phase 9.4: Customer Activity Feed UI
 */

export enum CustomerActivityCategory {
  ACCOUNT_SECURITY = 'ACCOUNT_SECURITY',
  SERVERS_DEVICES = 'SERVERS_DEVICES',
  FILE_ACCESS = 'FILE_ACCESS',
  BILLING_INVOICES = 'BILLING_INVOICES',
  NOTIFICATIONS = 'NOTIFICATIONS'
}

export const ALL_CUSTOMER_ACTIVITY_CATEGORIES: readonly CustomerActivityCategory[] = Object.freeze([
  CustomerActivityCategory.ACCOUNT_SECURITY,
  CustomerActivityCategory.SERVERS_DEVICES,
  CustomerActivityCategory.FILE_ACCESS,
  CustomerActivityCategory.BILLING_INVOICES,
  CustomerActivityCategory.NOTIFICATIONS
]);

export enum CustomerActivityEventType {
  // 1. Account & Security
  ACCOUNT_CREATED = 'ACCOUNT.CREATED',
  ACCOUNT_EMAIL_VERIFIED = 'ACCOUNT.EMAIL_VERIFIED',
  AUTH_SIGN_IN_SUCCEEDED = 'AUTH.SIGN_IN_SUCCEEDED',
  AUTH_SIGN_IN_FAILED = 'AUTH.SIGN_IN_FAILED',
  AUTH_SIGN_OUT = 'AUTH.SIGN_OUT',
  AUTH_OTP_VERIFIED = 'AUTH.OTP_VERIFIED',
  SECURITY_PASSWORD_RESET_REQUESTED = 'SECURITY.PASSWORD_RESET_REQUESTED',
  SECURITY_PASSWORD_RESET_COMPLETED = 'SECURITY.PASSWORD_RESET_COMPLETED',
  SECURITY_PASSWORD_CHANGED = 'SECURITY.PASSWORD_CHANGED',
  SECURITY_DEVICE_CREDENTIALS_REVOKED = 'SECURITY.DEVICE_CREDENTIALS_REVOKED',

  // 2. Servers & Devices
  DEVICE_LINKED = 'DEVICE.LINKED',
  DEVICE_UNLINKED = 'DEVICE.UNLINKED',
  DEVICE_CONNECTED = 'DEVICE.CONNECTED',
  DEVICE_DISCONNECTED = 'DEVICE.DISCONNECTED',
  SERVER_CREATED = 'SERVER.CREATED',
  SERVER_RENAMED = 'SERVER.RENAMED',
  SERVER_STARTED = 'SERVER.STARTED',
  SERVER_STOPPED = 'SERVER.STOPPED',
  SERVER_ENDPOINT_ASSIGNED = 'SERVER.ENDPOINT_ASSIGNED',
  REMOTE_TUNNEL_CONNECTED = 'SERVER.REMOTE_TUNNEL_CONNECTED',
  REMOTE_TUNNEL_DISCONNECTED = 'SERVER.REMOTE_TUNNEL_DISCONNECTED',
  REMOTE_TUNNEL_FAILED = 'SERVER.REMOTE_TUNNEL_FAILED',

  // 3. File Access & Management
  FILE_SERVER_LOGIN_SUCCEEDED = 'FILE.SERVER_LOGIN_SUCCEEDED',
  FILE_SERVER_LOGIN_FAILED = 'FILE.SERVER_LOGIN_FAILED',
  FILE_UPLOADED = 'FILE.UPLOADED',
  FILE_DOWNLOADED = 'FILE.DOWNLOADED',
  FILE_DELETED = 'FILE.DELETED',
  FILE_RENAMED = 'FILE.RENAMED',
  FOLDER_CREATED = 'FILE.FOLDER_CREATED',

  // 4. Billing & Invoices
  BILLING_PROFILE_UPDATED = 'BILLING.PROFILE_UPDATED',
  BILLING_COUNTRY_CONFIRMED = 'BILLING.COUNTRY_CONFIRMED',
  SUBSCRIPTION_CHECKOUT_STARTED = 'BILLING.SUBSCRIPTION_CHECKOUT_STARTED',
  SUBSCRIPTION_ACTIVATED = 'BILLING.SUBSCRIPTION_ACTIVATED',
  SUBSCRIPTION_RENEWED = 'BILLING.SUBSCRIPTION_RENEWED',
  SUBSCRIPTION_UPGRADE_REQUESTED = 'BILLING.SUBSCRIPTION_UPGRADE_REQUESTED',
  SUBSCRIPTION_UPGRADED = 'BILLING.SUBSCRIPTION_UPGRADED',
  SUBSCRIPTION_DOWNGRADE_SCHEDULED = 'BILLING.SUBSCRIPTION_DOWNGRADE_SCHEDULED',
  SUBSCRIPTION_DOWNGRADE_CANCELLED = 'BILLING.SUBSCRIPTION_DOWNGRADE_CANCELLED',
  SUBSCRIPTION_DOWNGRADE_EFFECTIVE = 'BILLING.SUBSCRIPTION_DOWNGRADE_EFFECTIVE',
  SUBSCRIPTION_CANCELLATION_REQUESTED = 'BILLING.SUBSCRIPTION_CANCELLATION_REQUESTED',
  SUBSCRIPTION_CANCELLATION_UNDONE = 'BILLING.SUBSCRIPTION_CANCELLATION_UNDONE',
  SUBSCRIPTION_CANCELLED = 'BILLING.SUBSCRIPTION_CANCELLED',
  SUBSCRIPTION_PAYMENT_PAST_DUE = 'BILLING.SUBSCRIPTION_PAYMENT_PAST_DUE',
  SUBSCRIPTION_GRACE_PERIOD_STARTED = 'BILLING.SUBSCRIPTION_GRACE_PERIOD_STARTED',
  SUBSCRIPTION_GRACE_PERIOD_RECOVERED = 'BILLING.SUBSCRIPTION_GRACE_PERIOD_RECOVERED',
  SUBSCRIPTION_EXPIRED = 'BILLING.SUBSCRIPTION_EXPIRED',
  PAYMENT_SUCCEEDED = 'BILLING.PAYMENT_SUCCEEDED',
  PAYMENT_FAILED = 'BILLING.PAYMENT_FAILED',
  PAYMENT_REFUNDED = 'BILLING.PAYMENT_REFUNDED',
  INVOICE_ISSUED = 'BILLING.INVOICE_ISSUED',
  INVOICE_DOWNLOADED = 'BILLING.INVOICE_DOWNLOADED',
  RECEIPT_ISSUED = 'BILLING.RECEIPT_ISSUED',
  RECEIPT_DOWNLOADED = 'BILLING.RECEIPT_DOWNLOADED',

  // 5. Notifications
  NOTIFICATION_SECURITY_ALERT_SENT = 'NOTIFICATION.SECURITY_ALERT_SENT',
  NOTIFICATION_INVOICE_EMAIL_SENT = 'NOTIFICATION.INVOICE_EMAIL_SENT',
  NOTIFICATION_STORAGE_ALERT_SENT = 'NOTIFICATION.STORAGE_ALERT_SENT',
  NOTIFICATION_PREFERENCES_UPDATED = 'NOTIFICATION.PREFERENCES_UPDATED'
}

export type ActivityCapabilityStatus =
  | 'CONFIRMED_RECORDED'        // Capability exists AND already writes to AuditEvent / NotificationRecord
  | 'CONFIRMED_NEEDS_RECORDING' // Capability exists in routes/services today; Phase 9.2 will add activity recording
  | 'PROPOSED_FUTURE';          // Proposed capability not yet implemented in backend routes

export type ActivityDeduplicationMode =
  | 'NONE'                      // Record every discrete occurrence
  | 'IDEMPOTENT_BY_ENTITY'      // Record once per unique domain entity ID (e.g. invoiceId, paymentId)
  | 'COOLDOWN_WINDOW'           // Suppress repeated identical events within cooldownSeconds
  | 'STATE_TRANSITION_ONLY';    // Record only when state changes (never on heartbeats or polling)

export interface ActivityDeduplicationPolicy {
  mode: ActivityDeduplicationMode;
  cooldownSeconds?: number;
  rationale: string;
}

export interface ActivityEntityReferences {
  deviceId?: boolean;
  serverId?: boolean;
  invoiceId?: boolean;
  subscriptionId?: boolean;
  paymentId?: boolean;
  receiptId?: boolean;
}

export interface AuditEventMappingRule {
  auditEventType: AuditEventType | string;
  metadataActionDiscriminator?: string;
  discriminatingCondition?: string;
}

export interface CustomerActivityEventSpec {
  eventType: CustomerActivityEventType;
  category: CustomerActivityCategory;
  title: string;
  descriptionTemplate: string;
  triggerAction: string;
  sourceService: string;
  capabilityStatus: ActivityCapabilityStatus;
  mappedAuditEvents: readonly AuditEventMappingRule[];
  allowedMetadataKeys: readonly string[];
  entityReferences: ActivityEntityReferences;
  deduplication: ActivityDeduplicationPolicy;
}

/**
 * Keys that MUST NEVER be persisted into or returned from customer-visible activity metadata.
 */
export const PROHIBITED_ACTIVITY_METADATA_SUBSTRINGS: readonly string[] = Object.freeze([
  'password',
  'passwordhash',
  'adminpassword',
  'otp',
  'otpcode',
  'token',
  'tokenhash',
  'credential',
  'credentialhash',
  'secret',
  'privatekey',
  'signature',
  'authorization',
  'cookie',
  'csrf',
  'session',
  'sessionid',
  'apikey',
  'api_key',
  'bearer',
  'jwt',
  'refresh',
  'database64',
  'rawpayload',
  'rawbody',
  'stacktrace',
  'stack',
  'prisma',
  'sql',
  'webhook',
  'webhooksecret',
  'keysecret',
  'fcmtoken',
  'connectiontoken',
  'storagekey',
  'storage_key',
  's3key',
  'filepath',
  'internalnote',
  'adminnote',
  'razorpay',
  'providerpaymentid',
  'providersubscriptionid',
  'providerplanid',
  'providerrefundid',
  'providereventid',
  'refundid'
]);

/**
 * AuditEventType values that represent strictly internal, operational, reconciliation,
 * cryptographic, or high-frequency telemetry events and MUST NEVER be displayed directly to customers.
 */
export const INTERNAL_ONLY_AUDIT_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  'OTP_SENT',
  'DEVICE_CREDENTIAL_CREATED',
  'DEVICE_SESSION_REFRESHED',
  'DEVICE_SESSION_REFRESH_FAILED',
  'ENDPOINT_ASSIGNED',
  'REMOTE_CONNECTION_CREATED',
  'PUSH_TOKEN_REGISTERED',
  'PUSH_TOKEN_UPDATED',
  'PUSH_TOKEN_REVOKED',
  'NOTIFICATION_CREATED',
  'NOTIFICATION_DELIVERY_FAILED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED',
  'SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED',
  'SUBSCRIPTION_DOWNGRADE_REQUESTED',
  'SUBSCRIPTION_DOWNGRADE_MISMATCHED',
  'REFUND_REQUESTED',
  'REFUND_PROVIDER_REQUESTED',
  'REFUND_FAILED',
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
]);

/**
 * Authoritative Catalog of Customer-Visible Activity Events
 */
export const CUSTOMER_ACTIVITY_TAXONOMY: Readonly<Record<CustomerActivityEventType, CustomerActivityEventSpec>> = Object.freeze({
  // ===========================================================================
  // 1. ACCOUNT & SECURITY
  // ===========================================================================
  [CustomerActivityEventType.ACCOUNT_CREATED]: {
    eventType: CustomerActivityEventType.ACCOUNT_CREATED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Account Created',
    descriptionTemplate: 'Your ZdexCloud account ({email}) was created.',
    triggerAction: 'Customer completes initial registration and email verification.',
    sourceService: 'src/routes/auth.ts (POST /api/v1/auth/register & POST /api/v1/auth/verify-otp)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'ACCOUNT_CREATED' }],
    allowedMetadataKeys: ['email'],
    entityReferences: {},
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'An account is created once per user lifecycle.'
    }
  },

  [CustomerActivityEventType.ACCOUNT_EMAIL_VERIFIED]: {
    eventType: CustomerActivityEventType.ACCOUNT_EMAIL_VERIFIED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Email Address Verified',
    descriptionTemplate: 'Your email address was verified and your account was activated.',
    triggerAction: 'Customer verifies 6-digit registration or login OTP code.',
    sourceService: 'src/routes/auth.ts (POST /api/v1/auth/verify-otp, POST /api/v1/auth/verify-email)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'EMAIL_VERIFIED' }],
    allowedMetadataKeys: ['email', 'maskedIp', 'userAgentSummary'],
    entityReferences: {},
    deduplication: {
      mode: 'NONE',
      rationale: 'Discrete verification completion action.'
    }
  },

  [CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED]: {
    eventType: CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Signed In to Account',
    descriptionTemplate: 'Signed in to your ZdexCloud account on {clientApplication} from {userAgentSummary} ({maskedIp}).',
    triggerAction: 'Customer completes password + 2FA email OTP sign-in flow and receives an active session.',
    sourceService: 'src/routes/auth.ts (POST /api/v1/auth/verify-otp) & src/notifications/producers/account_producer.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'LOGIN_ATTEMPT_SUCCESS' }],
    allowedMetadataKeys: ['maskedIp', 'userAgentSummary', 'authMethod', 'clientApplication'],
    entityReferences: {},
    deduplication: {
      mode: 'NONE',
      rationale: 'Every interactive customer sign-in must be visible for security transparency.'
    }
  },

  [CustomerActivityEventType.AUTH_SIGN_IN_FAILED]: {
    eventType: CustomerActivityEventType.AUTH_SIGN_IN_FAILED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Failed Sign-In Attempt',
    descriptionTemplate: 'An unsuccessful sign-in attempt was detected on your account.',
    triggerAction: 'Invalid password submitted during login for an existing customer account.',
    sourceService: 'src/routes/auth.ts (POST /api/v1/auth/login)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'LOGIN_ATTEMPT_FAILED' }],
    allowedMetadataKeys: ['maskedIp', 'userAgentSummary', 'reasonSummary', 'reasonLabel', 'clientApplication'],
    entityReferences: {},
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 60,
      rationale: 'Rate-limited and coalesced per 60s window to prevent brute-force attempts from flooding the customer activity feed.'
    }
  },

  [CustomerActivityEventType.AUTH_SIGN_OUT]: {
    eventType: CustomerActivityEventType.AUTH_SIGN_OUT,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Signed Out of Account',
    descriptionTemplate: 'Signed out of your ZdexCloud session.',
    triggerAction: 'Customer explicitly logs out via POST /api/v1/auth/logout.',
    sourceService: 'src/routes/auth.ts (POST /api/v1/auth/logout)',
    capabilityStatus: 'CONFIRMED_NEEDS_RECORDING',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['maskedIp', 'userAgentSummary'],
    entityReferences: {},
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit user-initiated session termination.'
    }
  },

  [CustomerActivityEventType.AUTH_OTP_VERIFIED]: {
    eventType: CustomerActivityEventType.AUTH_OTP_VERIFIED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Verification Code Confirmed',
    descriptionTemplate: 'A 6-digit email verification code was confirmed ({purposeLabel}).',
    triggerAction: 'Customer successfully validates a 6-digit OTP code.',
    sourceService: 'src/utils/otp.ts & src/routes/auth.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'OTP_VERIFIED' }],
    allowedMetadataKeys: ['purposeLabel'],
    entityReferences: {},
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 10,
      rationale: 'Prevents duplicate entries when OTP verification immediately accompanies sign-in or password reset.'
    }
  },

  [CustomerActivityEventType.SECURITY_PASSWORD_RESET_REQUESTED]: {
    eventType: CustomerActivityEventType.SECURITY_PASSWORD_RESET_REQUESTED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Password Reset Requested',
    descriptionTemplate: 'A password reset verification code was requested for your account.',
    triggerAction: 'Customer initiates forgot-password flow via POST /api/v1/auth/forgot-password.',
    sourceService: 'src/routes/auth.ts (POST /api/v1/auth/forgot-password)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'PASSWORD_RESET_REQUESTED' }],
    allowedMetadataKeys: ['maskedIp', 'userAgentSummary'],
    entityReferences: {},
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 60,
      rationale: 'Aligned with OTP resend cooldown to avoid duplicate entries.'
    }
  },

  [CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED]: {
    eventType: CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Password Reset Completed',
    descriptionTemplate: 'Your account password was reset and all active sessions were invalidated.',
    triggerAction: 'Customer completes password reset via POST /api/v1/auth/reset-password.',
    sourceService: 'src/routes/auth.ts (POST /api/v1/auth/reset-password)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'PASSWORD_RESET_SUCCESS' }],
    allowedMetadataKeys: ['maskedIp', 'userAgentSummary', 'sessionsInvalidated', 'revokedSessions'],
    entityReferences: {},
    deduplication: {
      mode: 'NONE',
      rationale: 'Critical security state change; every occurrence is recorded.'
    }
  },

  [CustomerActivityEventType.SECURITY_PASSWORD_CHANGED]: {
    eventType: CustomerActivityEventType.SECURITY_PASSWORD_CHANGED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Password Changed',
    descriptionTemplate: 'Your account password was updated from account settings and all active sessions were invalidated.',
    triggerAction: 'Authenticated customer changes password from account security settings.',
    sourceService: 'src/routes/auth.ts (POST /api/v1/auth/change-password/confirm)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      {
        auditEventType: 'PASSWORD_RESET_SUCCESS',
        discriminatingCondition: "metadata.operation === 'AUTHENTICATED_PASSWORD_CHANGE'"
      }
    ],
    allowedMetadataKeys: ['maskedIp', 'userAgentSummary', 'sessionsInvalidated', 'revokedSessions'],
    entityReferences: {},
    deduplication: {
      mode: 'NONE',
      rationale: 'Critical security action.'
    }
  },

  [CustomerActivityEventType.SECURITY_DEVICE_CREDENTIALS_REVOKED]: {
    eventType: CustomerActivityEventType.SECURITY_DEVICE_CREDENTIALS_REVOKED,
    category: CustomerActivityCategory.ACCOUNT_SECURITY,
    title: 'Device Authorization Revoked',
    descriptionTemplate: 'Persistent server authorization credential was revoked ({reasonLabel}).',
    triggerAction: 'Customer revokes a device credential or resets their account password.',
    sourceService: 'src/routes/device.ts (POST /api/v1/devices/:deviceId/credentials/revoke) & src/routes/auth.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'DEVICE_CREDENTIAL_REVOKED' }],
    allowedMetadataKeys: ['deviceName', 'reasonLabel', 'revokedAt'],
    entityReferences: { deviceId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit security revocation action.'
    }
  },

  // ===========================================================================
  // 2. SERVERS & DEVICES
  // ===========================================================================
  [CustomerActivityEventType.DEVICE_LINKED]: {
    eventType: CustomerActivityEventType.DEVICE_LINKED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Android Device Linked',
    descriptionTemplate: 'Device "{deviceName}" ({platform}) was registered to your account.',
    triggerAction: 'Android app registers a new device installation under the authenticated customer account.',
    sourceService: 'src/routes/device.ts (POST /api/v1/devices/register)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'DEVICE_REGISTERED' }],
    allowedMetadataKeys: ['deviceName', 'platform', 'deviceType', 'osVersion', 'appVersion'],
    entityReferences: { deviceId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Recorded only on initial device registration, not on idempotent re-registrations.'
    }
  },

  [CustomerActivityEventType.DEVICE_UNLINKED]: {
    eventType: CustomerActivityEventType.DEVICE_UNLINKED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Server & Device Removed',
    descriptionTemplate: 'Device "{deviceName}" and its personal file server were removed from your account.',
    triggerAction: 'Customer deletes a device/server node via DELETE /api/v1/devices/:deviceId or DELETE /api/v1/servers/:deviceId.',
    sourceService: 'src/routes/device.ts (DELETE /api/v1/devices/:deviceId, DELETE /api/v1/servers/:deviceId)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      {
        auditEventType: 'SERVER_STOPPED',
        metadataActionDiscriminator: 'SERVER_DELETED'
      }
    ],
    allowedMetadataKeys: ['deviceName', 'serverName', 'hostname'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit destructive user action.'
    }
  },

  [CustomerActivityEventType.DEVICE_CONNECTED]: {
    eventType: CustomerActivityEventType.DEVICE_CONNECTED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Device Online',
    descriptionTemplate: 'Device "{deviceName}" connected to ZdexCloud.',
    triggerAction: 'Android device establishes an active connection and transitions to ONLINE.',
    sourceService: 'src/services/connection_state_machine.ts & src/notifications/producers/device_producer.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'DEVICE_CONNECTED' }],
    allowedMetadataKeys: ['deviceName', 'platform'],
    entityReferences: { deviceId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 300,
      rationale: 'Suppresses rapid network reconnect flapping within a 5-minute window; periodic heartbeats are strictly excluded.'
    }
  },

  [CustomerActivityEventType.DEVICE_DISCONNECTED]: {
    eventType: CustomerActivityEventType.DEVICE_DISCONNECTED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Device Offline',
    descriptionTemplate: 'Device "{deviceName}" disconnected from ZdexCloud.',
    triggerAction: 'Android device connection closes or times out and transitions to OFFLINE.',
    sourceService: 'src/services/connection_state_machine.ts & src/notifications/producers/device_producer.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'DEVICE_DISCONNECTED' }],
    allowedMetadataKeys: ['deviceName', 'reasonSummary'],
    entityReferences: { deviceId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 300,
      rationale: 'Suppresses transient mobile network drop/reconnect noise within 5 minutes.'
    }
  },

  [CustomerActivityEventType.SERVER_CREATED]: {
    eventType: CustomerActivityEventType.SERVER_CREATED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Personal File Server Created',
    descriptionTemplate: 'File server "{serverName}" was initialized on device "{deviceName}".',
    triggerAction: 'ServerInstance is provisioned during device registration or POST /api/v1/servers.',
    sourceService: 'src/routes/device.ts (POST /api/v1/devices/register) & src/routes/server.ts (POST /api/v1/servers)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SERVER_CREATED' }],
    allowedMetadataKeys: ['serverName', 'deviceName'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Recorded once per ServerInstance creation.'
    }
  },

  [CustomerActivityEventType.SERVER_RENAMED]: {
    eventType: CustomerActivityEventType.SERVER_RENAMED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'File Server Renamed',
    descriptionTemplate: 'File server was renamed from "{previousName}" to "{newName}".',
    triggerAction: 'Customer renames a server via PATCH /api/v1/servers/:serverId.',
    sourceService: 'src/routes/server.ts (PATCH /api/v1/servers/:serverId)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      {
        auditEventType: 'SERVER_CREATED',
        metadataActionDiscriminator: 'SERVER_RENAMED'
      }
    ],
    allowedMetadataKeys: ['previousName', 'newName', 'deviceName'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit user-initiated configuration change.'
    }
  },

  [CustomerActivityEventType.SERVER_STARTED]: {
    eventType: CustomerActivityEventType.SERVER_STARTED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'File Server Started',
    descriptionTemplate: 'File server "{serverName}" started and is ready for remote connections.',
    triggerAction: 'ServerInstance transitions to RUNNING when the Android file server starts.',
    sourceService: 'src/routes/connection.ts (POST /api/v1/connections/register) & src/services/connection_state_machine.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SERVER_STARTED' }],
    allowedMetadataKeys: ['serverName', 'deviceName', 'hostname'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'STATE_TRANSITION_ONLY',
      cooldownSeconds: 120,
      rationale: 'Only recorded on STOPPED -> RUNNING state transitions, never on recurring heartbeats.'
    }
  },

  [CustomerActivityEventType.SERVER_STOPPED]: {
    eventType: CustomerActivityEventType.SERVER_STOPPED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'File Server Stopped',
    descriptionTemplate: 'File server "{serverName}" was stopped.',
    triggerAction: 'Customer stops server via POST /api/v1/servers/:serverId/stop or POST /api/v1/devices/:deviceId/server/stop.',
    sourceService: 'src/routes/server.ts & src/routes/device.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SERVER_STOPPED' }],
    allowedMetadataKeys: ['serverName', 'deviceName', 'stoppedAt'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'STATE_TRANSITION_ONLY',
      rationale: 'Recorded when server transitions to STOPPED.'
    }
  },

  [CustomerActivityEventType.SERVER_ENDPOINT_ASSIGNED]: {
    eventType: CustomerActivityEventType.SERVER_ENDPOINT_ASSIGNED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Public Subdomain Assigned',
    descriptionTemplate: 'Subdomain "{hostname}" was allocated to your file server.',
    triggerAction: 'EndpointService allocates a dedicated zdexcloud.com subdomain for a server instance.',
    sourceService: 'src/services/endpoint.ts (EndpointService.reserveEndpoint)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SERVER_ENDPOINT_ALLOCATED' }],
    allowedMetadataKeys: ['hostname', 'publicUrl', 'serverName'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Recorded only when a new subdomain endpoint is first allocated, not on subsequent lookups.'
    }
  },

  [CustomerActivityEventType.REMOTE_TUNNEL_CONNECTED]: {
    eventType: CustomerActivityEventType.REMOTE_TUNNEL_CONNECTED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Remote Access Tunnel Connected',
    descriptionTemplate: 'Remote access tunnel established for "{deviceName}" ({remoteEndpoint}).',
    triggerAction: 'Gateway WebSocket tunnel authenticates and transitions to CONNECTED.',
    sourceService: 'src/gateway/gateway_service.ts & src/services/connection_state_machine.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'REMOTE_CONNECTION_CONNECTED' }],
    allowedMetadataKeys: ['deviceName', 'remoteEndpoint', 'region'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 300,
      rationale: 'Debounced across 5-minute windows to avoid noisy entries during mobile network handovers.'
    }
  },

  [CustomerActivityEventType.REMOTE_TUNNEL_DISCONNECTED]: {
    eventType: CustomerActivityEventType.REMOTE_TUNNEL_DISCONNECTED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Remote Access Tunnel Disconnected',
    descriptionTemplate: 'Remote access tunnel closed for "{deviceName}".',
    triggerAction: 'Customer or device explicitly disconnects the remote gateway tunnel via POST /api/v1/connections/:connectionId/disconnect.',
    sourceService: 'src/routes/connection.ts (POST /api/v1/connections/:connectionId/disconnect)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'REMOTE_CONNECTION_DISCONNECTED' }],
    allowedMetadataKeys: ['deviceName', 'remoteEndpoint'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 300,
      rationale: 'Debounced across 5-minute windows to prevent disconnect/reconnect spam.'
    }
  },

  [CustomerActivityEventType.REMOTE_TUNNEL_FAILED]: {
    eventType: CustomerActivityEventType.REMOTE_TUNNEL_FAILED,
    category: CustomerActivityCategory.SERVERS_DEVICES,
    title: 'Remote Access Connection Failed',
    descriptionTemplate: 'Remote tunnel connection failed for "{deviceName}".',
    triggerAction: 'DeviceConnection transitions to FAILED due to transport or authentication failure.',
    sourceService: 'src/services/connection_state_machine.ts & src/gateway/gateway_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'REMOTE_CONNECTION_FAILED' }],
    allowedMetadataKeys: ['deviceName', 'reasonSummary'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 300,
      rationale: 'Coalesces repeated retry failures into a single activity entry per 5-minute window.'
    }
  },

  // ===========================================================================
  // 3. FILE ACCESS & MANAGEMENT
  // ===========================================================================
  [CustomerActivityEventType.FILE_SERVER_LOGIN_SUCCEEDED]: {
    eventType: CustomerActivityEventType.FILE_SERVER_LOGIN_SUCCEEDED,
    category: CustomerActivityCategory.FILE_ACCESS,
    title: 'File Manager Session Authenticated',
    descriptionTemplate: 'Authenticated into file server "{serverName}" on "{deviceName}".',
    triggerAction: 'Customer authenticates against the Android file server via POST /api/v1/file-manager/:serverId/auth/login.',
    sourceService: 'src/routes/file-manager.ts (POST /api/v1/file-manager/:serverId/auth/login)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'FILE_MANAGER_LOGIN_SUCCESS' }],
    allowedMetadataKeys: ['serverName', 'deviceName', 'maskedIp'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Discrete file-server authentication event.'
    }
  },

  [CustomerActivityEventType.FILE_SERVER_LOGIN_FAILED]: {
    eventType: CustomerActivityEventType.FILE_SERVER_LOGIN_FAILED,
    category: CustomerActivityCategory.FILE_ACCESS,
    title: 'Failed File Manager Login Attempt',
    descriptionTemplate: 'Failed login attempt on file server "{serverName}" ("{deviceName}").',
    triggerAction: 'Invalid file-server credentials submitted via POST /api/v1/file-manager/:serverId/auth/login.',
    sourceService: 'src/routes/file-manager.ts (POST /api/v1/file-manager/:serverId/auth/login)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'FILE_MANAGER_LOGIN_FAILED' }],
    allowedMetadataKeys: ['serverName', 'deviceName', 'maskedIp'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 60,
      rationale: 'Coalesces repeated failed login attempts within 60 seconds.'
    }
  },

  [CustomerActivityEventType.FILE_UPLOADED]: {
    eventType: CustomerActivityEventType.FILE_UPLOADED,
    category: CustomerActivityCategory.FILE_ACCESS,
    title: 'File Uploaded',
    descriptionTemplate: 'Uploaded "{fileName}" to "{serverName}".',
    triggerAction: 'Customer uploads a file via POST /api/v1/file-manager/:serverId/upload.',
    sourceService: 'src/routes/file-manager.ts (POST /api/v1/file-manager/:serverId/upload)',
    capabilityStatus: 'CONFIRMED_NEEDS_RECORDING',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['fileName', 'targetDirectory', 'sizeBytes', 'fileSizeBytes', 'serverName', 'deviceName'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Recorded once per completed file upload (never per chunk).'
    }
  },

  [CustomerActivityEventType.FILE_DOWNLOADED]: {
    eventType: CustomerActivityEventType.FILE_DOWNLOADED,
    category: CustomerActivityCategory.FILE_ACCESS,
    title: 'File Downloaded',
    descriptionTemplate: 'Downloaded "{fileName}" from "{serverName}".',
    triggerAction: 'Customer downloads a file attachment (?download=true) via GET /api/v1/file-manager/:serverId/download.',
    sourceService: 'src/routes/file-manager.ts (GET /api/v1/file-manager/:serverId/download)',
    capabilityStatus: 'CONFIRMED_NEEDS_RECORDING',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['fileName', 'sizeBytes', 'fileSizeBytes', 'serverName', 'deviceName'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 30,
      rationale: 'Only explicit attachment downloads (?download=true) are recorded; HTTP 206 byte-range video/audio streaming chunks and inline thumbnails are strictly excluded.'
    }
  },

  [CustomerActivityEventType.FILE_DELETED]: {
    eventType: CustomerActivityEventType.FILE_DELETED,
    category: CustomerActivityCategory.FILE_ACCESS,
    title: 'File or Folder Deleted',
    descriptionTemplate: 'Deleted "{itemName}" on "{serverName}".',
    triggerAction: 'Customer deletes a file or folder via DELETE /api/v1/file-manager/:serverId/files.',
    sourceService: 'src/routes/file-manager.ts (DELETE /api/v1/file-manager/:serverId/files)',
    capabilityStatus: 'CONFIRMED_NEEDS_RECORDING',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['itemName', 'parentDirectory', 'serverName', 'deviceName'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Destructive file-system mutation initiated by customer.'
    }
  },

  [CustomerActivityEventType.FILE_RENAMED]: {
    eventType: CustomerActivityEventType.FILE_RENAMED,
    category: CustomerActivityCategory.FILE_ACCESS,
    title: 'File or Folder Renamed',
    descriptionTemplate: 'Renamed "{oldName}" to "{newName}" on "{serverName}".',
    triggerAction: 'Customer renames a file or folder via POST /api/v1/file-manager/:serverId/rename.',
    sourceService: 'src/routes/file-manager.ts (POST /api/v1/file-manager/:serverId/rename)',
    capabilityStatus: 'CONFIRMED_NEEDS_RECORDING',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['oldName', 'newName', 'parentDirectory', 'serverName', 'deviceName'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit user-initiated file mutation.'
    }
  },

  [CustomerActivityEventType.FOLDER_CREATED]: {
    eventType: CustomerActivityEventType.FOLDER_CREATED,
    category: CustomerActivityCategory.FILE_ACCESS,
    title: 'Folder Created',
    descriptionTemplate: 'Created folder "{folderName}" on "{serverName}".',
    triggerAction: 'Customer creates a folder via POST /api/v1/file-manager/:serverId/folders.',
    sourceService: 'src/routes/file-manager.ts (POST /api/v1/file-manager/:serverId/folders)',
    capabilityStatus: 'CONFIRMED_NEEDS_RECORDING',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['folderName', 'parentDirectory', 'serverName', 'deviceName'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit user-initiated folder creation.'
    }
  },

  // ===========================================================================
  // 4. BILLING & INVOICES
  // ===========================================================================
  [CustomerActivityEventType.BILLING_PROFILE_UPDATED]: {
    eventType: CustomerActivityEventType.BILLING_PROFILE_UPDATED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Billing Profile Updated',
    descriptionTemplate: 'Updated billing address and tax profile ({country}).',
    triggerAction: 'Customer updates billing profile via PUT /api/v1/billing/profile.',
    sourceService: 'src/services/billing/billing_profile_service.ts (BillingProfileService.updateBillingProfile)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      {
        auditEventType: 'BILLING_STATE_UPDATED',
        metadataActionDiscriminator: 'UPDATE_BILLING_PROFILE'
      }
    ],
    allowedMetadataKeys: ['country', 'state', 'currency', 'hasTaxId', 'hasCompanyName'],
    entityReferences: {},
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit customer billing profile update.'
    }
  },

  [CustomerActivityEventType.BILLING_COUNTRY_CONFIRMED]: {
    eventType: CustomerActivityEventType.BILLING_COUNTRY_CONFIRMED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Billing Region Confirmed',
    descriptionTemplate: 'Confirmed billing country ({billingCountry}) and currency ({currency}).',
    triggerAction: 'Customer confirms billing country and postal code via PUT /api/v1/billing/country.',
    sourceService: 'src/services/billing/billing_state_service.ts (BillingStateService.confirmBillingCountry)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      {
        auditEventType: 'BILLING_STATE_UPDATED',
        metadataActionDiscriminator: 'CONFIRM_BILLING_COUNTRY'
      }
    ],
    allowedMetadataKeys: ['billingCountry', 'currency'],
    entityReferences: {},
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit customer billing country confirmation.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_CHECKOUT_STARTED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_CHECKOUT_STARTED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Checkout Started',
    descriptionTemplate: 'Initialized checkout session for {planName} ({currency}).',
    triggerAction: 'Customer starts a Razorpay subscription checkout via POST /api/v1/billing/checkout/session.',
    sourceService: 'src/services/billing/providers/razorpay/razorpay_checkout_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'CHECKOUT_SESSION_CREATED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'currency', 'formattedAmount'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 300,
      rationale: 'Checkout session reuse within 1 hour avoids duplicate activity rows when reopening the modal.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_ACTIVATED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_ACTIVATED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Activated',
    descriptionTemplate: 'Your {planName} subscription is now active.',
    triggerAction: 'Subscription is activated after verified checkout payment or provider webhook.',
    sourceService: 'src/services/billing/providers/razorpay/razorpay_checkout_service.ts & razorpay_webhook_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_ACTIVATED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'billingInterval', 'currency', 'amountMinorUnits', 'currentPeriodEnd'],
    entityReferences: { subscriptionId: true, paymentId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Recorded once per subscription activation regardless of checkout + webhook overlap.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_RENEWED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_RENEWED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Renewed',
    descriptionTemplate: 'Your {planName} subscription was renewed for the next billing period.',
    triggerAction: 'Recurring subscription charge succeeds and advances the billing period.',
    sourceService: 'src/services/billing/providers/razorpay/razorpay_webhook_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_RENEWED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'currency', 'amountMinorUnits', 'currentPeriodEnd'],
    entityReferences: { subscriptionId: true, paymentId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Deduplicated by paymentId / billing cycle.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_UPGRADE_REQUESTED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_UPGRADE_REQUESTED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Plan Upgrade Initiated',
    descriptionTemplate: 'Requested upgrade from {sourcePlan} to {targetPlan}.',
    triggerAction: 'Customer initiates plan upgrade via POST /api/v1/billing/subscription/upgrade.',
    sourceService: 'src/services/billing/billing_state_service.ts (BillingStateService.upgradeSubscription)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_UPGRADE_REQUESTED' }],
    allowedMetadataKeys: ['sourcePlan', 'targetPlan', 'creditMinorUnits', 'netAmountMinorUnits', 'currency'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit customer plan change request.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_UPGRADED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_UPGRADED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Upgraded',
    descriptionTemplate: 'Your subscription was upgraded to {targetPlan}.',
    triggerAction: 'Subscription upgrade completes and new plan entitlements take effect.',
    sourceService: 'src/services/billing/billing_state_service.ts & razorpay_webhook_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_UPGRADED' }],
    allowedMetadataKeys: ['sourcePlan', 'targetPlan', 'currency', 'netAmountMinorUnits'],
    entityReferences: { subscriptionId: true, paymentId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Deduplicated by planChangeId.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_SCHEDULED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_SCHEDULED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Plan Downgrade Scheduled',
    descriptionTemplate: 'Scheduled plan change to {targetPlan} effective at the end of your current billing period.',
    triggerAction: 'Customer schedules a Pro Yearly to Pro Monthly downgrade via POST /api/v1/billing/subscription/downgrade.',
    sourceService: 'src/services/billing/billing_state_service.ts (BillingStateService.downgradeSubscription)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_DOWNGRADE_SCHEDULED' }],
    allowedMetadataKeys: ['sourcePlan', 'targetPlan', 'effectiveAt'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit customer scheduling action.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_CANCELLED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_CANCELLED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Scheduled Downgrade Cancelled',
    descriptionTemplate: 'Cancelled scheduled plan downgrade; your {currentPlan} plan will continue.',
    triggerAction: 'Customer cancels a pending downgrade via POST /api/v1/billing/subscription/downgrade/cancel.',
    sourceService: 'src/services/billing/billing_state_service.ts (BillingStateService.cancelPendingDowngrade)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_DOWNGRADE_CANCELLED' }],
    allowedMetadataKeys: ['currentPlan'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit customer action.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_EFFECTIVE]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_EFFECTIVE,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Plan Downgrade Effective',
    descriptionTemplate: 'Your subscription plan changed to {targetPlan} for the new billing cycle.',
    triggerAction: 'Scheduled downgrade takes effect at billing period renewal.',
    sourceService: 'src/services/billing/billing_state_service.ts & razorpay_webhook_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_DOWNGRADE_EFFECTIVE' }],
    allowedMetadataKeys: ['sourcePlan', 'targetPlan', 'currency'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Deduplicated by planChangeId.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_CANCELLATION_REQUESTED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_CANCELLATION_REQUESTED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Cancellation Scheduled',
    descriptionTemplate: 'Scheduled cancellation for your {planName} subscription at period end.',
    triggerAction: 'Customer requests end-of-period cancellation via POST /api/v1/billing/subscription/cancel.',
    sourceService: 'src/services/billing/billing_state_service.ts (BillingStateService.requestSubscriptionCancellation)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_CANCELLATION_REQUESTED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'currentPeriodEnd', 'cancelAtPeriodEnd'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit customer cancellation action.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_CANCELLATION_UNDONE]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_CANCELLATION_UNDONE,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Cancellation Reversed',
    descriptionTemplate: 'Resumed auto-renewal for your {planName} subscription.',
    triggerAction: 'Customer reverses a scheduled cancellation via POST /api/v1/billing/subscription/cancel/undo.',
    sourceService: 'src/services/billing/billing_state_service.ts (BillingStateService.undoSubscriptionCancellation)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_CANCELLATION_REVERSED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'currentPeriodEnd'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit customer action.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_CANCELLED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_CANCELLED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Cancelled',
    descriptionTemplate: 'Your {planName} subscription has ended.',
    triggerAction: 'Subscription reaches final CANCELLED status.',
    sourceService: 'src/services/billing/providers/razorpay/razorpay_webhook_service.ts & billing_state_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_CANCELLED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'cancelledAt'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Recorded once when subscription transitions to CANCELLED.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_PAYMENT_PAST_DUE]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_PAYMENT_PAST_DUE,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Payment Past Due',
    descriptionTemplate: 'Renewal payment for {planName} is past due. Please review your payment method.',
    triggerAction: 'Subscription transitions to PAST_DUE after a failed renewal charge.',
    sourceService: 'src/services/billing/dunning_service.ts & razorpay_webhook_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_PAST_DUE' }],
    allowedMetadataKeys: ['planCode', 'planName', 'gracePeriodEndsAt'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'STATE_TRANSITION_ONLY',
      rationale: 'Recorded once per transition into PAST_DUE.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_GRACE_PERIOD_STARTED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_GRACE_PERIOD_STARTED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Billing Grace Period Started',
    descriptionTemplate: 'A billing grace period is active for your {planName} subscription while payment retry is pending.',
    triggerAction: 'DunningService starts a grace period for a past-due subscription.',
    sourceService: 'src/services/billing/dunning_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_GRACE_PERIOD_STARTED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'gracePeriodEndsAt'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'STATE_TRANSITION_ONLY',
      rationale: 'Recorded once per grace period activation.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_GRACE_PERIOD_RECOVERED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_GRACE_PERIOD_RECOVERED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Payment Recovered',
    descriptionTemplate: 'Your {planName} subscription payment succeeded and full active status was restored.',
    triggerAction: 'Payment succeeds during PAST_DUE or GRACE_PERIOD, restoring ACTIVE status.',
    sourceService: 'src/services/billing/dunning_service.ts & razorpay_webhook_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_GRACE_PERIOD_RECOVERED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'currentPeriodEnd'],
    entityReferences: { subscriptionId: true, paymentId: true },
    deduplication: {
      mode: 'STATE_TRANSITION_ONLY',
      rationale: 'Recorded once per recovery transition.'
    }
  },

  [CustomerActivityEventType.SUBSCRIPTION_EXPIRED]: {
    eventType: CustomerActivityEventType.SUBSCRIPTION_EXPIRED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Subscription Expired',
    descriptionTemplate: 'Your {planName} subscription expired and your account returned to the Free tier.',
    triggerAction: 'Subscription expires after grace period or end of paid term without renewal.',
    sourceService: 'src/services/billing/dunning_service.ts & billing_state_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'SUBSCRIPTION_EXPIRED' }],
    allowedMetadataKeys: ['planCode', 'planName', 'expiredAt'],
    entityReferences: { subscriptionId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Recorded once per subscription expiration.'
    }
  },

  [CustomerActivityEventType.PAYMENT_SUCCEEDED]: {
    eventType: CustomerActivityEventType.PAYMENT_SUCCEEDED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Payment Succeeded',
    descriptionTemplate: 'Payment of {formattedAmount} for {planName} was processed successfully.',
    triggerAction: 'Customer payment is verified via checkout signature or subscription.charged webhook.',
    sourceService: 'src/services/billing/providers/razorpay/razorpay_checkout_service.ts & razorpay_webhook_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      { auditEventType: 'PAYMENT_VERIFIED' },
      { auditEventType: 'WEBHOOK_PAYMENT_CAPTURED' }
    ],
    allowedMetadataKeys: ['amountMinorUnits', 'currency', 'formattedAmount', 'planCode', 'planName'],
    entityReferences: { subscriptionId: true, paymentId: true, invoiceId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Deduplicated by paymentId so checkout verification and webhook capture produce only one customer event.'
    }
  },

  [CustomerActivityEventType.PAYMENT_FAILED]: {
    eventType: CustomerActivityEventType.PAYMENT_FAILED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Payment Failed',
    descriptionTemplate: 'A subscription payment attempt for {planName} could not be completed.',
    triggerAction: 'Provider reports payment.failed or checkout signature verification fails.',
    sourceService: 'src/services/billing/providers/razorpay/razorpay_webhook_service.ts & razorpay_checkout_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      { auditEventType: 'WEBHOOK_PAYMENT_FAILED' },
      { auditEventType: 'PAYMENT_VERIFICATION_FAILED' }
    ],
    allowedMetadataKeys: ['amountMinorUnits', 'currency', 'planCode', 'planName', 'reasonSummary'],
    entityReferences: { subscriptionId: true, paymentId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 300,
      rationale: 'Prevents duplicate webhook retry events for the same failed charge from spamming the feed.'
    }
  },

  [CustomerActivityEventType.PAYMENT_REFUNDED]: {
    eventType: CustomerActivityEventType.PAYMENT_REFUNDED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Payment Refunded',
    descriptionTemplate: 'A refund of {formattedAmount} was processed for your account.',
    triggerAction: 'Refund reaches PROCESSED status and updates payment/subscription state.',
    sourceService: 'src/services/billing/billing_refund_service.ts & razorpay_webhook_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      { auditEventType: 'REFUND_PROCESSED' },
      { auditEventType: 'SUBSCRIPTION_REFUNDED' }
    ],
    allowedMetadataKeys: ['amountMinorUnits', 'currency', 'formattedAmount', 'planCode', 'planName'],
    entityReferences: { subscriptionId: true, paymentId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Deduplicated by paymentId.'
    }
  },

  [CustomerActivityEventType.INVOICE_ISSUED]: {
    eventType: CustomerActivityEventType.INVOICE_ISSUED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Tax Invoice Issued',
    descriptionTemplate: 'Tax Invoice {invoiceNumber} ({formattedAmount}) was issued for your payment.',
    triggerAction: 'BillingInvoiceService atomically allocates an invoice number and issues a statutory tax invoice.',
    sourceService: 'src/services/billing/billing_invoice_service.ts (BillingInvoiceService.generateInvoiceForPayment)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [
      {
        auditEventType: 'BILLING_STATE_UPDATED',
        metadataActionDiscriminator: 'STATUTORY_INVOICE_ISSUED'
      }
    ],
    allowedMetadataKeys: ['invoiceNumber', 'totalMinorUnits', 'currency', 'formattedAmount', 'planName'],
    entityReferences: { invoiceId: true, paymentId: true, subscriptionId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Strictly 1:1 with issued BillingInvoice.id.'
    }
  },

  [CustomerActivityEventType.INVOICE_DOWNLOADED]: {
    eventType: CustomerActivityEventType.INVOICE_DOWNLOADED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Tax Invoice Downloaded',
    descriptionTemplate: 'Downloaded PDF for Tax Invoice {invoiceNumber}.',
    triggerAction: 'Customer downloads an invoice PDF via GET /api/v1/billing/invoices/:id/download or /payments/:id/invoice/download.',
    sourceService: 'src/routes/billing.ts (GET /api/v1/billing/invoices/:id/download)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'BILLING_INVOICE_DOWNLOAD_REQUESTED' }],
    allowedMetadataKeys: ['invoiceNumber'],
    entityReferences: { invoiceId: true, paymentId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 60,
      rationale: 'Coalesces repeated clicks on the PDF download button within 60 seconds.'
    }
  },

  [CustomerActivityEventType.RECEIPT_ISSUED]: {
    eventType: CustomerActivityEventType.RECEIPT_ISSUED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Payment Receipt Issued',
    descriptionTemplate: 'Payment receipt {receiptNumber} was generated.',
    triggerAction: 'BillingReceiptService generates an immutable payment receipt.',
    sourceService: 'src/services/billing/billing_receipt_service.ts (BillingReceiptService.generateReceiptForPayment)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'BILLING_RECEIPT_ISSUED' }],
    allowedMetadataKeys: ['receiptNumber', 'totalMinorUnits', 'currency', 'planName'],
    entityReferences: { receiptId: true, paymentId: true, subscriptionId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Strictly 1:1 with BillingReceipt.id.'
    }
  },

  [CustomerActivityEventType.RECEIPT_DOWNLOADED]: {
    eventType: CustomerActivityEventType.RECEIPT_DOWNLOADED,
    category: CustomerActivityCategory.BILLING_INVOICES,
    title: 'Payment Receipt Downloaded',
    descriptionTemplate: 'Downloaded payment receipt {receiptNumber}.',
    triggerAction: 'Customer downloads receipt HTML via GET /api/v1/billing/receipts/:id/download.',
    sourceService: 'src/routes/billing.ts (GET /api/v1/billing/receipts/:id/download)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [{ auditEventType: 'BILLING_RECEIPT_DOWNLOAD_REQUESTED' }],
    allowedMetadataKeys: ['receiptNumber'],
    entityReferences: { receiptId: true, paymentId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 60,
      rationale: 'Coalesces repeated receipt download clicks within 60 seconds.'
    }
  },

  // ===========================================================================
  // 5. NOTIFICATIONS
  // ===========================================================================
  [CustomerActivityEventType.NOTIFICATION_SECURITY_ALERT_SENT]: {
    eventType: CustomerActivityEventType.NOTIFICATION_SECURITY_ALERT_SENT,
    category: CustomerActivityCategory.NOTIFICATIONS,
    title: 'Security Alert Dispatched',
    descriptionTemplate: 'Security notification "{notificationTitle}" was sent to your account.',
    triggerAction: 'NotificationService dispatches a high-priority ACCOUNT_SECURITY alert (sign-in, new device linked, security event).',
    sourceService: 'src/notifications/services/notification_service.ts & src/notifications/producers/account_producer.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['notificationTitle', 'notificationType', 'channels'],
    entityReferences: { deviceId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Recorded once per NotificationRecord (never per channel retry or delivery worker poll).'
    }
  },

  [CustomerActivityEventType.NOTIFICATION_INVOICE_EMAIL_SENT]: {
    eventType: CustomerActivityEventType.NOTIFICATION_INVOICE_EMAIL_SENT,
    category: CustomerActivityCategory.NOTIFICATIONS,
    title: 'Invoice Notification Email Sent',
    descriptionTemplate: 'Tax Invoice {invoiceNumber} notification email was sent to {recipientEmail}.',
    triggerAction: 'InvoiceNotificationOutboxWorker or BillingInvoiceNotificationService dispatches the invoice availability email.',
    sourceService: 'src/services/billing/invoice_notification_outbox_worker.ts & billing_invoice_notification_service.ts',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['invoiceNumber', 'recipientEmail', 'documentTitle'],
    entityReferences: { invoiceId: true },
    deduplication: {
      mode: 'IDEMPOTENT_BY_ENTITY',
      rationale: 'Deduplicated by invoiceId so outbox retries or webhook delivery confirmations do not duplicate the activity entry.'
    }
  },

  [CustomerActivityEventType.NOTIFICATION_STORAGE_ALERT_SENT]: {
    eventType: CustomerActivityEventType.NOTIFICATION_STORAGE_ALERT_SENT,
    category: CustomerActivityCategory.NOTIFICATIONS,
    title: 'Device Storage Capacity Alert',
    descriptionTemplate: 'Storage capacity alert ({severity}) triggered for device "{deviceName}".',
    triggerAction: 'Storage threshold warning or critical alert notification is created for a device.',
    sourceService: 'src/notifications/services/notification_service.ts (STORAGE_WARNING / STORAGE_CRITICAL / STORAGE_RECOVERED)',
    capabilityStatus: 'CONFIRMED_RECORDED',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['deviceName', 'severity', 'notificationTitle'],
    entityReferences: { deviceId: true, serverId: true },
    deduplication: {
      mode: 'COOLDOWN_WINDOW',
      cooldownSeconds: 3600,
      rationale: 'Storage threshold alerts are rate-limited to state transitions to prevent repeated capacity warnings.'
    }
  },

  [CustomerActivityEventType.NOTIFICATION_PREFERENCES_UPDATED]: {
    eventType: CustomerActivityEventType.NOTIFICATION_PREFERENCES_UPDATED,
    category: CustomerActivityCategory.NOTIFICATIONS,
    title: 'Notification Preferences Updated',
    descriptionTemplate: 'Updated your email and push notification delivery preferences.',
    triggerAction: 'Customer updates notification settings via PATCH /api/v1/notifications/preferences.',
    sourceService: 'src/notifications/routes/preference_routes.ts (PATCH /api/v1/notifications/preferences)',
    capabilityStatus: 'CONFIRMED_NEEDS_RECORDING',
    mappedAuditEvents: [],
    allowedMetadataKeys: ['globalPushEnabled', 'globalEmailEnabled'],
    entityReferences: {},
    deduplication: {
      mode: 'NONE',
      rationale: 'Explicit user preference update.'
    }
  }
});

/**
 * Exhaustive Classification of Existing Prisma AuditEventType Values
 *
 * Every value in `prisma/schema.prisma` `enum AuditEventType` (plus ad-hoc string casts in routes)
 * is explicitly classified here so Phase 9.2 and Phase 9.3 never accidentally expose internal
 * operational or reconciliation audit logs to customers.
 */
export type AuditEventCustomerVisibility =
  | 'CUSTOMER_VISIBLE_DIRECT'
  | 'CUSTOMER_VISIBLE_DISCRIMINATED'
  | 'INTERNAL_ONLY';

export interface AuditEventClassificationEntry {
  auditEventType: string;
  visibility: AuditEventCustomerVisibility;
  mappedCustomerEventTypes: readonly CustomerActivityEventType[];
  rationale: string;
}

export const EXISTING_AUDIT_EVENT_CLASSIFICATION: Readonly<Record<string, AuditEventClassificationEntry>> = Object.freeze({
  ACCOUNT_CREATED: {
    auditEventType: 'ACCOUNT_CREATED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.ACCOUNT_CREATED],
    rationale: 'Customer account creation milestone.'
  },
  EMAIL_VERIFIED: {
    auditEventType: 'EMAIL_VERIFIED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [
      CustomerActivityEventType.ACCOUNT_EMAIL_VERIFIED,
      CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED
    ],
    rationale: 'Marks email verification and interactive OTP login completion in auth.ts.'
  },
  LOGIN_ATTEMPT_SUCCESS: {
    auditEventType: 'LOGIN_ATTEMPT_SUCCESS',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED],
    rationale: 'Customer sign-in event.'
  },
  LOGIN_ATTEMPT_FAILED: {
    auditEventType: 'LOGIN_ATTEMPT_FAILED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.AUTH_SIGN_IN_FAILED],
    rationale: 'Customer-visible failed login attempt (when userId is known/matched).'
  },
  PASSWORD_RESET_REQUESTED: {
    auditEventType: 'PASSWORD_RESET_REQUESTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SECURITY_PASSWORD_RESET_REQUESTED],
    rationale: 'Customer-visible password reset request.'
  },
  PASSWORD_RESET_SUCCESS: {
    auditEventType: 'PASSWORD_RESET_SUCCESS',
    visibility: 'CUSTOMER_VISIBLE_DISCRIMINATED',
    mappedCustomerEventTypes: [
      CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED,
      CustomerActivityEventType.SECURITY_PASSWORD_CHANGED
    ],
    rationale: 'Customer-visible password reset or authenticated change completion.'
  },
  OTP_SENT: {
    auditEventType: 'OTP_SENT',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal delivery trace for 6-digit OTP dispatch; noisy and redundant with login/reset events.'
  },
  OTP_VERIFIED: {
    auditEventType: 'OTP_VERIFIED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.AUTH_OTP_VERIFIED],
    rationale: 'Customer verification confirmation.'
  },
  DEVICE_REGISTERED: {
    auditEventType: 'DEVICE_REGISTERED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.DEVICE_LINKED],
    rationale: 'Customer-visible Android device linking event.'
  },
  DEVICE_CONNECTED: {
    auditEventType: 'DEVICE_CONNECTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.DEVICE_CONNECTED],
    rationale: 'Customer-visible device online transition (debounced).'
  },
  DEVICE_DISCONNECTED: {
    auditEventType: 'DEVICE_DISCONNECTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.DEVICE_DISCONNECTED],
    rationale: 'Customer-visible device offline transition (debounced).'
  },
  DEVICE_CREDENTIAL_CREATED: {
    auditEventType: 'DEVICE_CREDENTIAL_CREATED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal cryptographic credential provisioning during device registration.'
  },
  DEVICE_SESSION_REFRESHED: {
    auditEventType: 'DEVICE_SESSION_REFRESHED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'High-frequency unattended background token rotation on Android; must not clutter customer activity.'
  },
  DEVICE_CREDENTIAL_REVOKED: {
    auditEventType: 'DEVICE_CREDENTIAL_REVOKED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SECURITY_DEVICE_CREDENTIALS_REVOKED],
    rationale: 'Customer-visible security revocation of persistent device access.'
  },
  DEVICE_SESSION_REFRESH_FAILED: {
    auditEventType: 'DEVICE_SESSION_REFRESH_FAILED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal security audit log for rejected background token refresh.'
  },
  SERVER_CREATED: {
    auditEventType: 'SERVER_CREATED',
    visibility: 'CUSTOMER_VISIBLE_DISCRIMINATED',
    mappedCustomerEventTypes: [
      CustomerActivityEventType.SERVER_CREATED,
      CustomerActivityEventType.SERVER_RENAMED
    ],
    rationale: 'Maps to SERVER.RENAMED when metadata.action === "SERVER_RENAMED", otherwise SERVER.CREATED.'
  },
  SERVER_STARTED: {
    auditEventType: 'SERVER_STARTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SERVER_STARTED],
    rationale: 'Customer-visible file server start event.'
  },
  SERVER_STOPPED: {
    auditEventType: 'SERVER_STOPPED',
    visibility: 'CUSTOMER_VISIBLE_DISCRIMINATED',
    mappedCustomerEventTypes: [
      CustomerActivityEventType.SERVER_STOPPED,
      CustomerActivityEventType.DEVICE_UNLINKED
    ],
    rationale: 'Maps to DEVICE.UNLINKED when metadata.action === "SERVER_DELETED", otherwise SERVER.STOPPED.'
  },
  ENDPOINT_ASSIGNED: {
    auditEventType: 'ENDPOINT_ASSIGNED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal endpoint binding trace superseded by SERVER_ENDPOINT_ALLOCATED.'
  },
  SERVER_ENDPOINT_ALLOCATED: {
    auditEventType: 'SERVER_ENDPOINT_ALLOCATED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SERVER_ENDPOINT_ASSIGNED],
    rationale: 'Customer-visible public subdomain allocation.'
  },
  REMOTE_CONNECTION_CREATED: {
    auditEventType: 'REMOTE_CONNECTION_CREATED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal pre-handshake tunnel registration intent (CONNECTING state) generated on every reconnect attempt.'
  },
  REMOTE_CONNECTION_CONNECTED: {
    auditEventType: 'REMOTE_CONNECTION_CONNECTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.REMOTE_TUNNEL_CONNECTED],
    rationale: 'Customer-visible remote tunnel establishment.'
  },
  REMOTE_CONNECTION_DISCONNECTED: {
    auditEventType: 'REMOTE_CONNECTION_DISCONNECTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.REMOTE_TUNNEL_DISCONNECTED],
    rationale: 'Customer-visible remote tunnel disconnection.'
  },
  REMOTE_CONNECTION_FAILED: {
    auditEventType: 'REMOTE_CONNECTION_FAILED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.REMOTE_TUNNEL_FAILED],
    rationale: 'Customer-visible remote tunnel failure.'
  },
  FILE_MANAGER_LOGIN_SUCCESS: {
    auditEventType: 'FILE_MANAGER_LOGIN_SUCCESS',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.FILE_SERVER_LOGIN_SUCCEEDED],
    rationale: 'Customer-visible file server login success.'
  },
  FILE_MANAGER_LOGIN_FAILED: {
    auditEventType: 'FILE_MANAGER_LOGIN_FAILED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.FILE_SERVER_LOGIN_FAILED],
    rationale: 'Customer-visible file server login failure.'
  },
  PUSH_TOKEN_REGISTERED: {
    auditEventType: 'PUSH_TOKEN_REGISTERED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal FCM device token registration.'
  },
  PUSH_TOKEN_UPDATED: {
    auditEventType: 'PUSH_TOKEN_UPDATED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal FCM device token rotation.'
  },
  PUSH_TOKEN_REVOKED: {
    auditEventType: 'PUSH_TOKEN_REVOKED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal FCM device token cleanup.'
  },
  NOTIFICATION_CREATED: {
    auditEventType: 'NOTIFICATION_CREATED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal notification pipeline trace; curated NotificationRecord entries are used instead.'
  },
  NOTIFICATION_DELIVERY_FAILED: {
    auditEventType: 'NOTIFICATION_DELIVERY_FAILED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal transport delivery failure trace.'
  },
  SUBSCRIPTION_CREATED: {
    auditEventType: 'SUBSCRIPTION_CREATED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal pre-payment contract creation; customer sees SUBSCRIPTION_CHECKOUT_STARTED and SUBSCRIPTION_ACTIVATED.'
  },
  SUBSCRIPTION_ACTIVATED: {
    auditEventType: 'SUBSCRIPTION_ACTIVATED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_ACTIVATED],
    rationale: 'Customer-visible subscription activation.'
  },
  SUBSCRIPTION_RENEWED: {
    auditEventType: 'SUBSCRIPTION_RENEWED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_RENEWED],
    rationale: 'Customer-visible subscription renewal.'
  },
  SUBSCRIPTION_PAST_DUE: {
    auditEventType: 'SUBSCRIPTION_PAST_DUE',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_PAYMENT_PAST_DUE],
    rationale: 'Customer-visible past-due billing alert.'
  },
  SUBSCRIPTION_GRACE_PERIOD_STARTED: {
    auditEventType: 'SUBSCRIPTION_GRACE_PERIOD_STARTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_GRACE_PERIOD_STARTED],
    rationale: 'Customer-visible grace period start.'
  },
  SUBSCRIPTION_GRACE_PERIOD_RECOVERED: {
    auditEventType: 'SUBSCRIPTION_GRACE_PERIOD_RECOVERED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_GRACE_PERIOD_RECOVERED],
    rationale: 'Customer-visible payment recovery.'
  },
  SUBSCRIPTION_CANCELLATION_REQUESTED: {
    auditEventType: 'SUBSCRIPTION_CANCELLATION_REQUESTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_CANCELLATION_REQUESTED],
    rationale: 'Customer-visible cancellation scheduling.'
  },
  SUBSCRIPTION_CANCELLATION_REVERSED: {
    auditEventType: 'SUBSCRIPTION_CANCELLATION_REVERSED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_CANCELLATION_UNDONE],
    rationale: 'Customer-visible reversal of scheduled cancellation.'
  },
  SUBSCRIPTION_CANCELLED: {
    auditEventType: 'SUBSCRIPTION_CANCELLED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_CANCELLED],
    rationale: 'Customer-visible final subscription cancellation.'
  },
  SUBSCRIPTION_EXPIRED: {
    auditEventType: 'SUBSCRIPTION_EXPIRED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_EXPIRED],
    rationale: 'Customer-visible subscription expiration.'
  },
  SUBSCRIPTION_REFUNDED: {
    auditEventType: 'SUBSCRIPTION_REFUNDED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.PAYMENT_REFUNDED],
    rationale: 'Customer-visible subscription refund.'
  },
  SUBSCRIPTION_UPGRADE_REQUESTED: {
    auditEventType: 'SUBSCRIPTION_UPGRADE_REQUESTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_UPGRADE_REQUESTED],
    rationale: 'Customer-visible plan upgrade initiation.'
  },
  SUBSCRIPTION_UPGRADED: {
    auditEventType: 'SUBSCRIPTION_UPGRADED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_UPGRADED],
    rationale: 'Customer-visible plan upgrade completion.'
  },
  SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED: {
    auditEventType: 'SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal financial reconciliation trace.'
  },
  SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED: {
    auditEventType: 'SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal financial reconciliation discrepancy alert.'
  },
  SUBSCRIPTION_DOWNGRADE_REQUESTED: {
    auditEventType: 'SUBSCRIPTION_DOWNGRADE_REQUESTED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal pre-validation trace; SUBSCRIPTION_DOWNGRADE_SCHEDULED is the customer-visible event.'
  },
  SUBSCRIPTION_DOWNGRADE_SCHEDULED: {
    auditEventType: 'SUBSCRIPTION_DOWNGRADE_SCHEDULED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_SCHEDULED],
    rationale: 'Customer-visible downgrade scheduling.'
  },
  SUBSCRIPTION_DOWNGRADE_CANCELLED: {
    auditEventType: 'SUBSCRIPTION_DOWNGRADE_CANCELLED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_CANCELLED],
    rationale: 'Customer-visible cancellation of scheduled downgrade.'
  },
  SUBSCRIPTION_DOWNGRADE_EFFECTIVE: {
    auditEventType: 'SUBSCRIPTION_DOWNGRADE_EFFECTIVE',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_DOWNGRADE_EFFECTIVE],
    rationale: 'Customer-visible downgrade taking effect.'
  },
  SUBSCRIPTION_DOWNGRADE_MISMATCHED: {
    auditEventType: 'SUBSCRIPTION_DOWNGRADE_MISMATCHED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal provider state reconciliation warning.'
  },
  REFUND_REQUESTED: {
    auditEventType: 'REFUND_REQUESTED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal admin/operator refund initiation; customer refund requests are disabled by policy.'
  },
  REFUND_PROVIDER_REQUESTED: {
    auditEventType: 'REFUND_PROVIDER_REQUESTED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal Razorpay refund API dispatch trace.'
  },
  REFUND_PROCESSED: {
    auditEventType: 'REFUND_PROCESSED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.PAYMENT_REFUNDED],
    rationale: 'Customer-visible completed refund.'
  },
  REFUND_FAILED: {
    auditEventType: 'REFUND_FAILED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal operator refund failure trace.'
  },
  REFUND_REQUIRES_REVIEW: {
    auditEventType: 'REFUND_REQUIRES_REVIEW',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal operator review queue flag.'
  },
  REFUND_DUPLICATE_REQUEST: {
    auditEventType: 'REFUND_DUPLICATE_REQUEST',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal idempotency rejection trace.'
  },
  BILLING_RECEIPT_ISSUED: {
    auditEventType: 'BILLING_RECEIPT_ISSUED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.RECEIPT_ISSUED],
    rationale: 'Customer-visible receipt generation.'
  },
  BILLING_RECEIPT_GENERATION_FAILED: {
    auditEventType: 'BILLING_RECEIPT_GENERATION_FAILED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal system error trace.'
  },
  BILLING_RECEIPT_DOWNLOAD_REQUESTED: {
    auditEventType: 'BILLING_RECEIPT_DOWNLOAD_REQUESTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.RECEIPT_DOWNLOADED],
    rationale: 'Customer-visible receipt download.'
  },
  BILLING_INVOICE_DOWNLOAD_REQUESTED: {
    auditEventType: 'BILLING_INVOICE_DOWNLOAD_REQUESTED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.INVOICE_DOWNLOADED],
    rationale: 'Customer-visible statutory tax invoice PDF download.'
  },
  BILLING_STATE_UPDATED: {
    auditEventType: 'BILLING_STATE_UPDATED',
    visibility: 'CUSTOMER_VISIBLE_DISCRIMINATED',
    mappedCustomerEventTypes: [
      CustomerActivityEventType.INVOICE_ISSUED,
      CustomerActivityEventType.BILLING_PROFILE_UPDATED,
      CustomerActivityEventType.BILLING_COUNTRY_CONFIRMED
    ],
    rationale: 'Discriminated by metadata.action: STATUTORY_INVOICE_ISSUED, UPDATE_BILLING_PROFILE, or CONFIRM_BILLING_COUNTRY.'
  },
  CHECKOUT_SESSION_CREATED: {
    auditEventType: 'CHECKOUT_SESSION_CREATED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.SUBSCRIPTION_CHECKOUT_STARTED],
    rationale: 'Customer-visible subscription checkout session creation.'
  },
  PAYMENT_VERIFIED: {
    auditEventType: 'PAYMENT_VERIFIED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.PAYMENT_SUCCEEDED],
    rationale: 'Customer-visible verified payment.'
  },
  PAYMENT_VERIFICATION_FAILED: {
    auditEventType: 'PAYMENT_VERIFICATION_FAILED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.PAYMENT_FAILED],
    rationale: 'Customer-visible payment verification failure.'
  },
  WEBHOOK_PAYMENT_CAPTURED: {
    auditEventType: 'WEBHOOK_PAYMENT_CAPTURED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.PAYMENT_SUCCEEDED],
    rationale: 'Customer-visible captured subscription payment (deduplicated with PAYMENT_VERIFIED by paymentId).'
  },
  WEBHOOK_PAYMENT_FAILED: {
    auditEventType: 'WEBHOOK_PAYMENT_FAILED',
    visibility: 'CUSTOMER_VISIBLE_DIRECT',
    mappedCustomerEventTypes: [CustomerActivityEventType.PAYMENT_FAILED],
    rationale: 'Customer-visible failed subscription payment.'
  },
  TAX_CALCULATED: {
    auditEventType: 'TAX_CALCULATED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal tax engine calculation trace.'
  },
  TAX_CALCULATION_FAILED: {
    auditEventType: 'TAX_CALCULATION_FAILED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal tax engine error trace.'
  },
  TAX_CONFIGURATION_MISSING: {
    auditEventType: 'TAX_CONFIGURATION_MISSING',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal statutory configuration alert.'
  },
  PROCESSING_FEE_RECORDED: {
    auditEventType: 'PROCESSING_FEE_RECORDED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal payment gateway fee accounting.'
  },
  PROCESSING_FEE_PENDING: {
    auditEventType: 'PROCESSING_FEE_PENDING',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal payment gateway fee accounting.'
  },
  PROCESSING_FEE_RECONCILIATION_REQUIRED: {
    auditEventType: 'PROCESSING_FEE_RECONCILIATION_REQUIRED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal payment gateway fee reconciliation.'
  },
  BILLING_RECONCILIATION_RUN_STARTED: {
    auditEventType: 'BILLING_RECONCILIATION_RUN_STARTED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal background reconciliation worker trace.'
  },
  BILLING_RECONCILIATION_RUN_COMPLETED: {
    auditEventType: 'BILLING_RECONCILIATION_RUN_COMPLETED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal background reconciliation worker trace.'
  },
  BILLING_RECONCILIATION_RUN_FAILED: {
    auditEventType: 'BILLING_RECONCILIATION_RUN_FAILED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal background reconciliation worker error.'
  },
  BILLING_RECONCILIATION_DISCREPANCY_DETECTED: {
    auditEventType: 'BILLING_RECONCILIATION_DISCREPANCY_DETECTED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal financial discrepancy alert.'
  },
  BILLING_RECONCILIATION_DISCREPANCY_RESOLVED: {
    auditEventType: 'BILLING_RECONCILIATION_DISCREPANCY_RESOLVED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal operator discrepancy resolution.'
  },
  BILLING_RECONCILIATION_AUTO_HEALED: {
    auditEventType: 'BILLING_RECONCILIATION_AUTO_HEALED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal background self-healing trace.'
  },
  BILLING_SETTLEMENT_IMPORTED: {
    auditEventType: 'BILLING_SETTLEMENT_IMPORTED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal bank settlement batch import.'
  },
  BILLING_SETTLEMENT_RECONCILED: {
    auditEventType: 'BILLING_SETTLEMENT_RECONCILED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal bank settlement reconciliation.'
  },
  BILLING_SETTLEMENT_MISMATCH_DETECTED: {
    auditEventType: 'BILLING_SETTLEMENT_MISMATCH_DETECTED',
    visibility: 'INTERNAL_ONLY',
    mappedCustomerEventTypes: [],
    rationale: 'Internal bank settlement mismatch alert.'
  }
});

/**
 * Masks an IPv4 or IPv6 address for privacy-safe customer activity display.
 * Handles X-Forwarded-For chains, IPv4-mapped IPv6 (::ffff:), ports, and already-masked values.
 * Never returns an unmasked IP address.
 * Example: "203.0.113.42" -> "203.0.113.xxx", "2001:db8:85a3::8a2e:370:7334" -> "2001:db8:85a3:****"
 */
export function maskIpAddressForCustomerDisplay(ip?: string | null): string {
  if (!ip || typeof ip !== 'string') {
    return 'unknown';
  }

  // Extract first client IP if a comma-separated X-Forwarded-For list was supplied
  let candidate = ip.split(',')[0]?.trim() ?? '';
  if (!candidate) {
    return 'unknown';
  }

  const lower = candidate.toLowerCase();
  if (lower === 'unknown' || lower === 'masked') {
    return lower;
  }

  // Strip surrounding IPv6 brackets, e.g. "[2001:db8::1]:8080" -> "2001:db8::1"
  if (candidate.startsWith('[')) {
    const closeIdx = candidate.indexOf(']');
    if (closeIdx > 1) {
      candidate = candidate.slice(1, closeIdx);
    }
  }

  // Strip IPv4-mapped IPv6 prefix "::ffff:"
  if (candidate.toLowerCase().startsWith('::ffff:')) {
    const mappedRest = candidate.slice(7).trim();
    if (mappedRest.includes('.')) {
      candidate = mappedRest;
    }
  }

  // Handle IPv4 (with optional :port or already-masked .xxx)
  if (candidate.includes('.')) {
    const withoutPort = candidate.replace(/:\d+$/, '');
    const parts = withoutPort.split('.');
    if (parts.length === 4) {
      const firstThreeValid = parts.slice(0, 3).every((octet) => {
        if (!/^\d{1,3}$/.test(octet)) return false;
        const num = Number(octet);
        return num >= 0 && num <= 255;
      });
      const fourth = parts[3].toLowerCase();
      const fourthValid =
        fourth === 'xxx' ||
        fourth === '*' ||
        (/^\d{1,3}$/.test(fourth) && Number(fourth) >= 0 && Number(fourth) <= 255);

      if (firstThreeValid && fourthValid) {
        return `${Number(parts[0])}.${Number(parts[1])}.${Number(parts[2])}.xxx`;
      }
    }
    return 'masked';
  }

  // Handle IPv6 (with optional %zone suffix or already-masked :****)
  if (candidate.includes(':')) {
    const withoutZone = candidate.split('%')[0].replace(/:\*{4}$/, '');
    const parts = withoutZone.split(':').filter(Boolean);
    if (parts.length >= 1 && parts.every((seg) => /^[0-9a-fA-F]{1,4}$/.test(seg))) {
      return `${parts.slice(0, 3).map((seg) => seg.toLowerCase()).join(':')}:****`;
    }
    return 'masked';
  }

  return 'masked';
}

/**
 * Checks whether a metadata key name violates the customer activity privacy policy.
 */
export function isProhibitedActivityMetadataKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  // Safe taxonomy-permitted keys: sessionsInvalidated, revokedSessions
  if (normalized === 'sessionsinvalidated' || normalized === 'revokedsessions') {
    return false;
  }
  return PROHIBITED_ACTIVITY_METADATA_SUBSTRINGS.some((forbidden) => normalized.includes(forbidden));
}

/**
 * Detects whether a string value contains embedded secrets, credentials, tokens, password hashes,
 * provider keys, stack traces, SQL/ORM diagnostic errors, or internal host filesystem paths.
 */
export function containsSensitiveOrDiagnosticActivityValue(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const v = value.trim();
  if (!v) {
    return false;
  }

  // 1. JWTs (header.payload.signature or header.payload)
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,})?/.test(v)) {
    return true;
  }

  // 2. Bearer / Basic authorization headers or token assignments
  if (/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/i.test(v)) {
    return true;
  }

  // 3. Password hashes (bcrypt, argon2, scrypt)
  if (/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{15,}|\$argon2(?:id|i|d)\$/i.test(v)) {
    return true;
  }

  // 4. Payment provider secrets, webhook secrets, or internal provider IDs (rzp_, whsec_, sk_, pay_, sub_, rfnd_)
  if (
    /\b(?:rzp_(?:live|test)_[A-Za-z0-9]{4,}|whsec_[A-Za-z0-9_]{4,}|sk_(?:live|test)_[A-Za-z0-9]{4,}|pay_[A-Za-z0-9]{8,}|sub_[A-Za-z0-9]{8,}|rfnd_[A-Za-z0-9]{8,})\b/.test(
      v
    )
  ) {
    return true;
  }

  // 5. Stack traces, Prisma/SQL errors, or internal diagnostic dumps
  if (
    /\bat\s+[^\r\n]+\([^)]+:\d+:\d+\)|PrismaClient\w*Error|Invalid\s+`?prisma\.|\bSELECT\s+.+\s+FROM\s+|\bINSERT\s+INTO\s+|\bUPDATE\s+\w+\s+SET\s+|\bDELETE\s+FROM\s+/i.test(
      v
    )
  ) {
    return true;
  }

  // 6. Internal host OS paths or object-storage URIs (Windows drive paths, Unix system dirs, s3://, file://)
  if (/^[A-Za-z]:\\|^\/(?:var|etc|usr|opt|proc|sys|root|tmp|srv)\/|(?:^|\s)(?:s3|file|gs|azure):\/\//i.test(v)) {
    return true;
  }

  return false;
}

/**
 * Cleans a customer-visible string by removing control characters, stripping HTML/script tags,
 * neutralizing dangerous URL protocols, and bounding length.
 */
function cleanMetadataStringValue(raw: string, maxLength = 255): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\b(?:javascript|vbscript|data)\s*:/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitizes raw event metadata according to the event's strict allowlist and global secret-exclusion rules.
 * Enforces both key-level allowlisting and value-level privacy/security sanitization.
 */
export function sanitizeCustomerActivityMetadata(
  eventType: CustomerActivityEventType,
  rawMetadata?: Record<string, unknown> | null
): Record<string, string | number | boolean | null> {
  if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
    return {};
  }

  const spec = CUSTOMER_ACTIVITY_TAXONOMY[eventType];
  if (!spec) {
    return {};
  }

  const allowedSet = new Set(spec.allowedMetadataKeys);
  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(rawMetadata)) {
    if (isProhibitedActivityMetadataKey(key)) {
      continue;
    }
    if (!allowedSet.has(key)) {
      continue;
    }
    if (value === null || value === undefined) {
      sanitized[key] = null;
      continue;
    }

    if (typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        sanitized[key] = value;
      }
      continue;
    }

    if (typeof value === 'string') {
      if (key === 'maskedIp') {
        sanitized[key] = maskIpAddressForCustomerDisplay(value);
        continue;
      }

      if (containsSensitiveOrDiagnosticActivityValue(value)) {
        continue;
      }

      if (
        key === 'userAgentSummary' &&
        (/Mozilla\/|AppleWebKit\/|Chrome\/|Safari\/|Firefox\/|Edg\/|curl\//i.test(value) || value.length > 60)
      ) {
        let browser = 'Web Browser';
        if (/Edg\//i.test(value)) browser = 'Edge';
        else if (/OPR\/|Opera/i.test(value)) browser = 'Opera';
        else if (/Chrome\//i.test(value) && !/Chromium/i.test(value)) browser = 'Chrome';
        else if (/Firefox\//i.test(value)) browser = 'Firefox';
        else if (/Safari\//i.test(value) && !/Chrome\//i.test(value)) browser = 'Safari';
        else if (/curl\//i.test(value)) browser = 'CLI Client';

        let os = '';
        if (/Windows NT/i.test(value)) os = 'Windows';
        else if (/Macintosh|Mac OS X/i.test(value)) os = 'macOS';
        else if (/Android/i.test(value)) os = 'Android';
        else if (/iPhone|iPad|iPod/i.test(value)) os = 'iOS';
        else if (/Linux/i.test(value)) os = 'Linux';

        sanitized[key] = os ? `${browser} on ${os}` : browser;
        continue;
      }

      const cleaned = cleanMetadataStringValue(value, 255);
      if (cleaned.length > 0) {
        sanitized[key] = cleaned;
      }
    }
  }

  return sanitized;
}

/**
 * Resolves an existing AuditEvent (eventType + optional metadata) into its canonical
 * CustomerActivityEventType, or returns null if the AuditEvent is internal-only.
 */
export function resolveAuditEventToCustomerActivity(
  auditEventType: string,
  metadata?: Record<string, unknown> | null
): CustomerActivityEventType | null {
  if (!auditEventType || INTERNAL_ONLY_AUDIT_EVENT_TYPES.has(auditEventType)) {
    return null;
  }

  const action = typeof metadata?.action === 'string' ? metadata.action : undefined;

  if (auditEventType === 'SERVER_CREATED') {
    if (action === 'SERVER_RENAMED') {
      return CustomerActivityEventType.SERVER_RENAMED;
    }
    return CustomerActivityEventType.SERVER_CREATED;
  }

  if (auditEventType === 'SERVER_STOPPED') {
    if (action === 'SERVER_DELETED') {
      return CustomerActivityEventType.DEVICE_UNLINKED;
    }
    return CustomerActivityEventType.SERVER_STOPPED;
  }

  if (auditEventType === 'BILLING_STATE_UPDATED') {
    if (action === 'STATUTORY_INVOICE_ISSUED') {
      return CustomerActivityEventType.INVOICE_ISSUED;
    }
    if (action === 'UPDATE_BILLING_PROFILE') {
      return CustomerActivityEventType.BILLING_PROFILE_UPDATED;
    }
    if (action === 'CONFIRM_BILLING_COUNTRY') {
      return CustomerActivityEventType.BILLING_COUNTRY_CONFIRMED;
    }
    return null;
  }

  if (auditEventType === 'PASSWORD_RESET_SUCCESS') {
    if (
      action === 'AUTHENTICATED_PASSWORD_CHANGE' ||
      metadata?.operation === 'AUTHENTICATED_PASSWORD_CHANGE'
    ) {
      return CustomerActivityEventType.SECURITY_PASSWORD_CHANGED;
    }
    return CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED;
  }

  const classification = EXISTING_AUDIT_EVENT_CLASSIFICATION[auditEventType];
  if (!classification || classification.visibility === 'INTERNAL_ONLY') {
    return null;
  }

  return classification.mappedCustomerEventTypes[0] ?? null;
}
